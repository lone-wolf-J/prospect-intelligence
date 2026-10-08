import { isUrlAllowed } from "../../../api/_security.js";
import * as cheerio from "cheerio";

export interface PageFetchResult {
  url: string;
  content: string;
  adapter: string;
  ok: boolean;
}

export interface ScraperAdapter {
  name: string;
  description: string;
  envKeys: string[];
  priority: number;
  available(): boolean;
  fetchPage(url: string, timeoutMs: number): Promise<string | null>;
}

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

function env(...keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

async function timedFetch(url: string, opts: any = {}, ms = 10000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const nf = (await import("node-fetch")).default;
    return await nf(url, { ...opts, headers: { "User-Agent": pickUA(), ...(opts.headers || {}) }, signal: ctrl.signal } as any);
  } finally {
    clearTimeout(t);
  }
}

function clip(text: string, max = 20000): string {
  return text && text.length > max ? text.slice(0, max) : text;
}

// ---------- Page scrape adapters (ordered: free first, then paid, then raw) ----------

const jinaAdapter: ScraperAdapter = {
  name: "jina",
  description: "Jina Reader (free, keyless) - URL to clean text/markdown",
  envKeys: [],
  priority: 10,
  available: () => true,
  async fetchPage(url, timeoutMs) {
    if (!isUrlAllowed(url)) return null;
    try {
      const res = await timedFetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`, {}, timeoutMs);
      if (!res || !res.ok) return null;
      const text = await res.text();
      return text && text.length > 200 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

const firecrawlAdapter: ScraperAdapter = {
  name: "firecrawl",
  description: "Firecrawl v1 scrape (render + markdown)",
  envKeys: ["FIRECRAWL_API_KEY"],
  priority: 20,
  available: () => !!env("FIRECRAWL_API_KEY"),
  async fetchPage(url, timeoutMs) {
    const key = env("FIRECRAWL_API_KEY");
    if (!key || !isUrlAllowed(url)) return null;
    try {
      const res: any = await timedFetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 1500 }),
      }, timeoutMs);
      const data: any = await res.json();
      const md = data?.data?.markdown || data?.markdown || "";
      return md && md.length > 200 ? clip(md) : null;
    } catch {
      return null;
    }
  },
};

const scrapeDoAdapter: ScraperAdapter = {
  name: "scrape.do",
  description: "Scrape.do (proxy + JS render)",
  envKeys: ["SCRAPE_DO_KEY", "SCRAPE_DO_TOKEN"],
  priority: 30,
  available: () => !!(env("SCRAPE_DO_KEY") || env("SCRAPE_DO_TOKEN")),
  async fetchPage(url, timeoutMs) {
    const key = env("SCRAPE_DO_KEY") || env("SCRAPE_DO_TOKEN");
    if (!key || !isUrlAllowed(url)) return null;
    try {
      const res = await timedFetch(`https://api.scrape.do?token=${key}&url=${encodeURIComponent(url)}&render=true`, {}, timeoutMs);
      const text = await res.text();
      return text && text.length > 500 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

const scrapingBeeAdapter: ScraperAdapter = {
  name: "scrapingbee",
  description: "ScrapingBee (JS render + rotating proxies)",
  envKeys: ["SCRAPINGBEE_API_KEY"],
  priority: 40,
  available: () => !!env("SCRAPINGBEE_API_KEY"),
  async fetchPage(url, timeoutMs) {
    const key = env("SCRAPINGBEE_API_KEY");
    if (!key || !isUrlAllowed(url)) return null;
    try {
      const res = await timedFetch(`https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true`, {}, timeoutMs);
      const text = await res.text();
      return text && text.length > 500 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

const zenRowsAdapter: ScraperAdapter = {
  name: "zenrows",
  description: "ZenRows (anti-bot + JS render)",
  envKeys: ["ZENROWS_API_KEY"],
  priority: 50,
  available: () => !!env("ZENROWS_API_KEY"),
  async fetchPage(url, timeoutMs) {
    const key = env("ZENROWS_API_KEY");
    if (!key || !isUrlAllowed(url)) return null;
    try {
      const res = await timedFetch(`https://api.zenrows.com/v1/?apikey=${key}&url=${encodeURIComponent(url)}&js_render=true&antibot=true`, {}, timeoutMs);
      const text = await res.text();
      return text && text.length > 500 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

function parseMcpPayload(raw: string): any {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5).trim()); } catch { /* keep looking */ }
    }
  }
  return null;
}

const brightDataMcpAdapter: ScraperAdapter = {
  name: "brightdata-mcp",
  description: "Bright Data MCP (hosted) - unblocking scrape_as_markdown, LinkedIn structured data",
  envKeys: ["BRIGHTDATA_API_TOKEN", "BRIGHTDATA_API_KEY", "BRIGHTDATA_TOKEN"],
  priority: 15,
  available: () => !!(env("BRIGHTDATA_API_TOKEN") || env("BRIGHTDATA_API_KEY") || env("BRIGHTDATA_TOKEN")),
  async fetchPage(url, timeoutMs) {
    const token = env("BRIGHTDATA_API_TOKEN", "BRIGHTDATA_API_KEY", "BRIGHTDATA_TOKEN");
    if (!token || !isUrlAllowed(url)) return null;
    const base = `https://mcp.brightdata.com/mcp?token=${encodeURIComponent(token)}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    try {
      const initRes = await timedFetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prospect-intelligence", version: "1.0" } } }),
      }, timeoutMs);
      const sessionId = initRes?.headers?.get?.("mcp-session-id");
      if (sessionId) headers["mcp-session-id"] = sessionId;
      await timedFetch(base, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }, 4000).catch(() => null);
      const callRes = await timedFetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "scrape_as_markdown", arguments: { url } } }),
      }, timeoutMs);
      const raw = await callRes.text();
      const payload = parseMcpPayload(raw);
      const text = payload?.result?.content?.[0]?.text || payload?.result?.structuredContent?.markdown || "";
      return text && text.length > 200 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

const rawHttpAdapter: ScraperAdapter = {
  name: "raw-http",
  description: "Direct HTTP GET + cheerio text extraction (no proxy)",
  envKeys: [],
  priority: 90,
  available: () => true,
  async fetchPage(url, timeoutMs) {
    if (!isUrlAllowed(url)) return null;
    try {
      const res = await timedFetch(url, { headers: { Accept: "text/html,application/xhtml+xml" } }, timeoutMs);
      if (!res || !res.ok) return null;
      const html = await res.text();
      if (!html || html.length < 200) return null;
      const $ = cheerio.load(html);
      $("script, style, noscript, svg").remove();
      const text = ($("main").text() || $("body").text() || html).replace(/\s+/g, " ").trim();
      return text.length > 200 ? clip(text) : null;
    } catch {
      return null;
    }
  },
};

export const SCRAPERS: ScraperAdapter[] = [
  jinaAdapter,
  brightDataMcpAdapter,
  firecrawlAdapter,
  scrapeDoAdapter,
  scrapingBeeAdapter,
  zenRowsAdapter,
  rawHttpAdapter,
];

export function getScraperCapabilities(): { name: string; available: boolean; description: string }[] {
  return SCRAPERS.map(s => ({ name: s.name, available: s.available(), description: s.description }));
}

const ADAPTER_TIMEOUTS: Record<string, number> = {
  jina: 5500,
  "brightdata-mcp": 9000,
  firecrawl: 8500,
  "scrape.do": 8500,
  scrapingbee: 8000,
  zenrows: 8000,
  "raw-http": 6000,
};

// Circuit breaker: skip an adapter that keeps failing during this process lifetime
const adapterFailures = new Map<string, number>();

export function resetScraperHealth(): void {
  adapterFailures.clear();
}

export async function fetchPageViaAdapters(url: string, opts: { timeoutMs?: number; maxAdapters?: number } = {}): Promise<PageFetchResult | null> {
  if (!isUrlAllowed(url)) return null;
  const baseTimeout = opts.timeoutMs ?? 10000;
  const adapters = SCRAPERS.filter(a => a.available() && (adapterFailures.get(a.name) || 0) < 3).sort((a, b) => a.priority - b.priority);
  let attempted = 0;
  for (const adapter of adapters) {
    if (opts.maxAdapters && attempted >= opts.maxAdapters) break;
    attempted++;
    try {
      const content = await adapter.fetchPage(url, Math.min(baseTimeout, ADAPTER_TIMEOUTS[adapter.name] ?? baseTimeout));
      if (content && content.length >= 300) {
        adapterFailures.set(adapter.name, 0);
        console.log(`[Scraper] ${adapter.name} ok for ${url.slice(0, 60)} (${content.length} chars)`);
        return { url, content, adapter: adapter.name, ok: true };
      }
      adapterFailures.set(adapter.name, (adapterFailures.get(adapter.name) || 0) + 1);
    } catch (e: any) {
      adapterFailures.set(adapter.name, (adapterFailures.get(adapter.name) || 0) + 1);
      console.log(`[Scraper] ${adapter.name} failed for ${url.slice(0, 60)}: ${e?.message || e}`);
    }
  }
  return null;
}

// Crawlee-style bounded request queue: dedupe + concurrency + per-request fallback chain
export async function fetchPages(urls: string[], opts: { concurrency?: number; timeoutMs?: number } = {}): Promise<PageFetchResult[]> {
  const concurrency = opts.concurrency ?? 3;
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    if (!isUrlAllowed(u)) continue;
    seen.add(u);
    queue.push(u);
  }
  const results: PageFetchResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      const res = await fetchPageViaAdapters(url, { timeoutMs: opts.timeoutMs });
      if (res) results.push(res);
    }
  });
  await Promise.all(workers);
  return results;
}
