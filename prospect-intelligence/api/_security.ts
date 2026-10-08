import type { VercelRequest } from "@vercel/node";

// ---------- Input validation ----------
export function validateQuery(query: unknown): string {
  if (typeof query !== "string") throw new Error("Query must be a string");
  const trimmed = query.trim();
  if (trimmed.length < 2) throw new Error("Query too short (min 2 chars)");
  if (trimmed.length > 200) throw new Error("Query too long (max 200 chars)");
  // Allow letters, numbers, spaces, basic punctuation, but block control chars and excessive special chars
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) throw new Error("Invalid characters in query");
  // Block obvious prompt injection attempts in query itself
  if (/(ignore previous|system:|assistant:|<\/?script)/i.test(trimmed)) {
    throw new Error("Query contains disallowed content");
  }
  return trimmed;
}

// ---------- SSRF protection ----------
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1", "0:0:0:0:0:0:0:1"
]);
const BLOCKED_IP_PREFIXES = [
  "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.", "169.254.", "127.", "0."
];
const BLOCKED_DOMAINS = [
  "169.254.169.254", // AWS metadata
  "metadata.google.internal",
  "metadata.google",
];

export function isUrlAllowed(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host)) return false;
    if (BLOCKED_DOMAINS.includes(host)) return false;
    for (const prefix of BLOCKED_IP_PREFIXES) {
      if (host.startsWith(prefix)) return false;
    }
    // Block private IPv6
    if (host.includes(":") && (host.startsWith("fd") || host.startsWith("fc00") || host === "::1")) return false;
    // Block vercel internal
    if (host.endsWith(".internal") || host.includes("vercel")) return false;
    // Block localhost variants
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    return true;
  } catch { return false; }
}

// ---------- Rate limiting (in-memory, best-effort for serverless) ----------
const rateMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  search: { max: 10, windowMs: 60_000 }, // 10 searches/min per IP
  candidates: { max: 15, windowMs: 60_000 },
  pitch: { max: 10, windowMs: 60_000 },
  org: { max: 6, windowMs: 60_000 },
};

export function checkRateLimit(req: VercelRequest, key: string): boolean {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || (req.headers["x-real-ip"] as string) || "unknown";
  const mapKey = `${key}:${ip}`;
  const now = Date.now();
  const cfg = RATE_LIMITS[key] || { max: 10, windowMs: 60_000 };
  const entry = rateMap.get(mapKey);
  if (!entry || now > entry.reset) {
    rateMap.set(mapKey, { count: 1, reset: now + cfg.windowMs });
    return true;
  }
  if (entry.count >= cfg.max) return false;
  entry.count++;
  return true;
}

// Cleanup old entries every 5min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateMap.entries()) if (now > v.reset) rateMap.delete(k);
}, 5 * 60 * 1000).unref?.();

// ---------- Prompt injection mitigation ----------
export function sanitizeForPrompt(text: string): string {
  // Treat web content as untrusted data - wrap and neutralize instruction-like content
  return text
    .replace(/\b(ignore|disregard)\s+(previous|above|system|instructions)\b/gi, "[filtered]")
    .replace(/```/g, "[code-block]")
    .slice(0, 2000);
}

export function validateTone(tone: unknown): string {
  const allowed = ["professional", "friendly", "direct", "consultative", "urgent"];
  if (typeof tone !== "string" || !allowed.includes(tone)) throw new Error("Invalid tone");
  return tone;
}
