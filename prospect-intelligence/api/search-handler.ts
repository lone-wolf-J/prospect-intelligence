import { aiRegistry } from "../server/lib/ai-registry.js";
import * as cheerio from "cheerio";
import { isUrlAllowed, sanitizeForPrompt, validateQuery } from "./_security.js";
import { getSearchProviders, SearchResult, tierForUrl } from "../server/lib/search-providers.js";
import { expandQueries, rankSources, extractFacts, deduplicateFacts, detectWhyNow, buildTimeline, calculateQuality } from "../server/lib/research-engine.js";
import { extractStructuredData, extractEnhancedContacts, extractDeepPageContent } from "../server/lib/structured-extraction.js";

// Simple in-memory cache (persists for warm Vercel functions, ~7-day logical TTL via timestamp check)
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// Health metrics for monitoring (per https://github.com/TheWebScrapingClub/webscraping-from-0-to-hero - treat as infrastructure)
const healthMetrics: Record<string, { success: number; fail: number; lastError?: string }> = {};

function recordMetric(source: string, success: boolean, err?: string) {
  if (!healthMetrics[source]) healthMetrics[source] = { success: 0, fail: 0 };
  if (success) healthMetrics[source].success++;
  else { healthMetrics[source].fail++; healthMetrics[source].lastError = err?.slice(0, 100); }
}
export function getHealthMetrics() { return healthMetrics; }

// UA rotation + retry with backoff (per Handling Anti-Bot, Scale, And Maintenance)
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

async function withRetry<T>(fn: () => Promise<T>, source: string, retries = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fn();
      recordMetric(source, true);
      return res;
    } catch (e: any) {
      lastErr = e;
      recordMetric(source, false, e.message);
      if (i < retries) {
        const backoff = 400 * Math.pow(2, i) + Math.random() * 200;
        console.log(`[Retry] ${source} attempt ${i + 1} failed, backoff ${Math.round(backoff)}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

// Company lineage - handles renames so search understands old -> new (e.g., PreludeSys/DemandBlue -> LevelShift)
const COMPANY_LINEAGE: Record<string, string> = {
  "preludesys": "LevelShift (formerly PreludeSys, est. 1998)",
  "prelude sys": "LevelShift",
  "demandblue": "LevelShift (formerly DemandBlue, est. 2012)",
  "demand blue": "LevelShift",
  "demanddynamics": "LevelShift (formerly DemandDynamics, est. 2020)",
  "demand dynamics": "LevelShift",
  "levelshift": "LevelShift",
};
function resolveCompanyLineage(name: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [old, neu] of Object.entries(COMPANY_LINEAGE)) {
    if (lower.includes(old)) return neu;
  }
  return null;
}

// ---- Prospect Intelligence Report: 21-section contract ----
export const SPEC_SECTIONS = [
  "Executive Summary",
  "Executive Profile",
  "Career Progression",
  "Current Role & Responsibilities",
  "Current Company Intelligence",
  "Recent Public Activity",
  "Thought Leadership Analysis",
  "Professional Interests",
  "Technology Landscape",
  "Business Priorities",
  "Buying Signal Analysis",
  "Business Challenges",
  "Stakeholder & Influence Assessment",
  "Relationship Indicators",
  "Strategic Sales Assessment",
  "Personalized Conversation Starters",
  "Discovery Questions",
  "Recommended Outreach Strategy",
  "Risks, Unknowns & Information Gaps",
  "Source Appendix",
  "Confidence Assessment",
];

const SECTION_ALIASES: Record<string, string> = {
  "summary": "Executive Summary",
  "executive summary": "Executive Summary",
  "contact": "Contact",
  "career": "Career Progression",
  "career history": "Career Progression",
  "career progression": "Career Progression",
  "role": "Current Role & Responsibilities",
  "current role": "Current Role & Responsibilities",
  "current role & responsibilities": "Current Role & Responsibilities",
  "current role and responsibilities": "Current Role & Responsibilities",
  "responsibilities": "Current Role & Responsibilities",
  "company": "Current Company Intelligence",
  "company intelligence": "Current Company Intelligence",
  "current company intelligence": "Current Company Intelligence",
  "organization intelligence": "Current Company Intelligence",
  "organisation intelligence": "Current Company Intelligence",
  "activity": "Recent Public Activity",
  "recent public activity": "Recent Public Activity",
  "public activity": "Recent Public Activity",
  "leadership": "Thought Leadership Analysis",
  "thought leadership": "Thought Leadership Analysis",
  "thought leadership analysis": "Thought Leadership Analysis",
  "interests": "Professional Interests",
  "professional interests": "Professional Interests",
  "tech": "Technology Landscape",
  "technology": "Technology Landscape",
  "technology landscape": "Technology Landscape",
  "priorities": "Business Priorities",
  "business priorities": "Business Priorities",
  "signals": "Buying Signal Analysis",
  "signals analysis": "Buying Signal Analysis",
  "buying signals": "Buying Signal Analysis",
  "buying signal analysis": "Buying Signal Analysis",
  "challenges": "Business Challenges",
  "business challenges": "Business Challenges",
  "stakeholders": "Stakeholder & Influence Assessment",
  "stakeholder & influence assessment": "Stakeholder & Influence Assessment",
  "stakeholder and influence assessment": "Stakeholder & Influence Assessment",
  "stakeholder influence": "Stakeholder & Influence Assessment",
  "relationships": "Relationship Indicators",
  "relationship indicators": "Relationship Indicators",
  "opportunities": "Strategic Sales Assessment",
  "strategic sales assessment": "Strategic Sales Assessment",
  "sales assessment": "Strategic Sales Assessment",
  "openers": "Personalized Conversation Starters",
  "conversation starters": "Personalized Conversation Starters",
  "personalized conversation starters": "Personalized Conversation Starters",
  "personalised conversation starters": "Personalized Conversation Starters",
  "questions": "Discovery Questions",
  "discovery questions": "Discovery Questions",
  "strategy": "Recommended Outreach Strategy",
  "outreach strategy": "Recommended Outreach Strategy",
  "recommended outreach strategy": "Recommended Outreach Strategy",
  "risks": "Risks, Unknowns & Information Gaps",
  "risks & unknowns": "Risks, Unknowns & Information Gaps",
  "risks and unknowns": "Risks, Unknowns & Information Gaps",
  "risks, unknowns & information gaps": "Risks, Unknowns & Information Gaps",
  "risks, unknowns and information gaps": "Risks, Unknowns & Information Gaps",
  "unknowns": "Risks, Unknowns & Information Gaps",
  "confidence": "Confidence Assessment",
  "confidence assessment": "Confidence Assessment",
  "sources": "Source Appendix",
  "source appendix": "Source Appendix",
  "sources appendix": "Source Appendix",
  "personal background": "Personal Background",
  "background": "Personal Background",
  "timeline & events": "Timeline & Events",
  "timeline and events": "Timeline & Events",
  "timeline": "Timeline & Events",
  "events": "Timeline & Events",
};

export function normalizeSectionTitle(title: string): string {
  const t = (title || "").trim().replace(/\s+/g, " ");
  return SECTION_ALIASES[t.toLowerCase()] || t;
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u || ""; }
}

function buildSourceAppendix(citations: any[], sources: any[], deepPages: any[]): { title: string; items: any[] } {
  const items: any[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string, url: string | null, confidence: number) => {
    const key = (url || label || value).toLowerCase();
    if (seen.has(key) || items.length >= 24) return;
    seen.add(key);
    items.push({ label: (label || "Source").slice(0, 90), value, sourceUrl: url, confidence });
  };
  for (const c of citations || []) {
    const parts = [c.claim, c.sourceUrl ? `via ${hostOf(c.sourceUrl)}` : "", `Tier ${c.tier ?? 3}`, `${Math.round((c.confidence ?? 0.7) * (c.confidence > 1 ? 1 : 100))}% confidence`].filter(Boolean);
    push(c.sourceTitle || c.claim?.slice(0, 70) || c.sourceUrl || "Source", parts.join(" · "), c.sourceUrl || null, c.confidence > 1 ? Math.round(c.confidence) : Math.round((c.confidence ?? 0.7) * 100));
  }
  for (const s of sources || []) {
    const conf = s.tier === 1 ? 90 : s.tier === 2 ? 75 : 60;
    push(s.title || s.url || "Web source", `${(s.snippet || "").slice(0, 160)} · [Tier ${s.tier || 3} · ${s.source || "search"}${s.publishedAt ? ` · ${s.publishedAt}` : ""}]`, s.url || null, conf);
  }
  for (const p of deepPages || []) {
    push(p.url ? hostOf(p.url) : "Deep page", `Deep-scraped page content used for analysis${p.url ? ` · ${p.url}` : ""}`, p.url || null, 70);
  }
  if (!items.length) items.push({ label: "Sources", value: "No sources captured in this run.", confidence: 0 });
  return { title: "Source Appendix", items };
}

// Normalize titles, merge duplicates, guarantee all 21 spec sections exist, order canonically.
// Returns which spec sections were missing (for an optional AI repair pass).
export function enforceSectionContract(
  sections: any[],
  appendices?: { citations?: any[]; sources?: any[]; deepPages?: any[] }
): { sections: any[]; missing: string[] } {
  const byTitle = new Map<string, any>();
  const extras: any[] = [];
  for (const raw of sections || []) {
    if (!raw || typeof raw !== "object") continue;
    const title = normalizeSectionTitle(raw.title || "");
    if (!title) continue;
    const items = Array.isArray(raw.items) ? raw.items.filter((it: any) => it && typeof it === "object") : [];
    const existing = byTitle.get(title);
    if (existing) existing.items.push(...items);
    else if (SPEC_SECTIONS.includes(title)) byTitle.set(title, { ...raw, title, items: [...items] });
    else extras.push({ ...raw, title, items: [...items] });
  }
  const missing = SPEC_SECTIONS.filter(t => !byTitle.has(t));
  for (const t of missing) {
    byTitle.set(t, { title: t, items: [{ label: "Status", value: "No public information found for this section in the sources searched.", confidence: 0 }] });
  }
  // Source Appendix: real source data replaces the stub, tops up a thin appendix
  if (appendices) {
    const STUB_RE = /^No public information found/;
    const appendix = byTitle.get("Source Appendix");
    const built = buildSourceAppendix(appendices.citations || [], appendices.sources || [], appendices.deepPages || []);
    const appendixIsStub = !appendix || (appendix.items.length === 1 && STUB_RE.test(String(appendix.items[0]?.value || "")));
    if (appendixIsStub) {
      byTitle.set("Source Appendix", built);
    } else if (appendix.items.length < 5) {
      const seen = new Set(appendix.items.filter((i: any) => !STUB_RE.test(String(i.value || ""))).map((i: any) => (i.sourceUrl || i.label || "").toLowerCase()));
      appendix.items = appendix.items.filter((i: any) => !STUB_RE.test(String(i.value || "")));
      for (const it of built.items) {
        if (appendix.items.length >= 24) break;
        const k = (it.sourceUrl || it.label || "").toLowerCase();
        if (!seen.has(k)) { seen.add(k); appendix.items.push(it); }
      }
    }
  }
  const ordered: any[] = [];
  const exec = byTitle.get("Executive Summary");
  if (exec) ordered.push(exec);
  const contactIdx = extras.findIndex(e => e.title === "Contact");
  if (contactIdx >= 0) ordered.push(extras.splice(contactIdx, 1)[0]);
  for (const t of SPEC_SECTIONS) {
    if (t === "Executive Summary") continue;
    const s = byTitle.get(t);
    if (s) ordered.push(s);
  }
  ordered.push(...extras);
  return { sections: ordered, missing };
}

// Config-driven scrapers (per https://github.com/fabienvauchelles/scraping-workshop - per-site configs)
const SCRAPER_CONFIG: Record<string, { parser: "api" | "html" | "browser"; priority: number }> = {
  "linkedin.com": { parser: "browser", priority: 1 },
  "levelshift.com": { parser: "html", priority: 2 },
  "preludesys.com": { parser: "html", priority: 2 },
  "demandblue.com": { parser: "html", priority: 2 },
  "equilar.com": { parser: "api", priority: 2 },
  "theorg.com": { parser: "html", priority: 2 },
  "crunchbase.com": { parser: "browser", priority: 2 },
  "default": { parser: "html", priority: 3 },
};
function getConfigForUrl(url: string) {
  for (const [domain, cfg] of Object.entries(SCRAPER_CONFIG)) {
    if (url.includes(domain)) return cfg;
  }
  return SCRAPER_CONFIG.default;
}

export async function searchProspectHandler(query: string, candidate: any = null) {
  query = validateQuery(query);
  // Identity resolution (mandatory before collection)
  const { resolveIdentity } = await import("../server/lib/research-engine.js");
  const identity = resolveIdentity(query, candidate);
  console.log("[Identity] Resolved", identity.name, identity.company, identity.confidence);

  // If multiple people match (common name, low company confidence) -> ask for more identifier
  if (identity.confidence.overall === "LOW" && !identity.company && !identity.linkedinUrl && !identity.emailDomain) {
    const nameParts = identity.name.split(/\s+/).length;
    if (query.toLowerCase().split(/\s+/).length <= 2 && nameParts <= 2) {
      // For common names without company, we still proceed but flag low confidence
      console.log("[Identity] Low confidence, will proceed but flag sparse");
    }
  }

  const normalized = (candidate ? `${query}::${candidate.company || ""}::${candidate.location || ""}` : query).toLowerCase().trim();
  const cached = cache.get(normalized);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log("[Cache] HIT for", query);
    return { ...cached.data, _cached: true };
  }
  console.log("[SearchHandler] Starting crawl for:", query, candidate ? `with candidate ${candidate.name}` : "", "identity", identity.confidence.overall);
  const crawlResults = await crawlEverywhere(query, candidate, identity);
  console.log("[SearchHandler] Crawl done. web:", (crawlResults.web as any[])?.length, "deep:", crawlResults.deepPages?.length);

  // Fact extraction pipeline (per requirement 8) + store expanded queries for debug
  try {
    const { extractFacts, deduplicateFacts, detectWhyNow, buildTimeline, calculateQuality } = await import("../server/lib/research-engine.js");
    const rawFacts = extractFacts(crawlResults.web || []);
    const dedupedFacts = deduplicateFacts(rawFacts);
    const whyNowSignals = detectWhyNow(dedupedFacts);
    const timeline = buildTimeline(dedupedFacts);
    const qualityScore = calculateQuality(identity, dedupedFacts, crawlResults.web || []);
    (crawlResults as any).facts = dedupedFacts;
    (crawlResults as any).whyNow = whyNowSignals;
    (crawlResults as any).timeline = timeline;
    (crawlResults as any).quality = qualityScore;
    (crawlResults as any).identity = identity;
    (crawlResults as any).expandedQueries = (globalThis as any).__expandedQueries || [];
    console.log("[Research] Facts", dedupedFacts.length, "WhyNow", whyNowSignals.length, "Timeline", timeline.length, "Quality", qualityScore);
  } catch (e) { console.log("[Research] Fact extraction failed", e); }

  // NOTE: Separate LLM structured-extraction call removed to preserve Groq TPM
  // for the single synthesis call. Contacts/social come from deterministic regex
  // (extractContactsAll), facts/timeline/whyNow from research-engine, and the
  // synthesis prompt asks the LLM for structured sections + citations directly.
  (crawlResults as any).structuredData = null;

  let aiAnalysis: any = null;
  let aiError: string | null = null;
  const hasAiKey = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.TINYFISH_API_KEY);
  if (hasAiKey) {
    try {
      aiAnalysis = await analyzeWithAI(query, crawlResults, candidate);
      console.log("[SearchHandler] AI done, confidence:", aiAnalysis?.confidenceScore);
      
      // If AI analysis returns low confidence, fall back to deterministic evidence
      if (aiAnalysis && aiAnalysis.confidenceScore !== undefined && aiAnalysis.confidenceScore < 30) {
        console.log("[SearchHandler] AI confidence low (", aiAnalysis.confidenceScore, "), falling back to deterministic evidence");
        aiAnalysis = buildDeterministicFallback(query, identity, crawlResults);
        aiError = "AI analysis confidence low; using deterministic evidence";
      }
    } catch (e: any) {
      aiError = e?.message || String(e);
      console.error("[SearchHandler] AI error:", aiError);
      // Deterministic fallback (no second LLM call) so quota failures still return evidence
      aiAnalysis = buildDeterministicFallback(query, identity, crawlResults);
      aiError = "AI analysis failed; using deterministic evidence";
    }
  }
  const result = buildCase(query, crawlResults, aiAnalysis, hasAiKey, aiError);
  if (result.confidenceScore > 30) cache.set(normalized, { data: result, ts: Date.now() });
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value as string;
    cache.delete(firstKey);
  }
  return result;
}

// Deterministic fallback: no LLM calls, built from evidence pipeline only
function buildDeterministicFallback(query: string, identity: any, crawlResults: any) {
  const web: any[] = crawlResults.web || [];
  const facts: any[] = (crawlResults as any).facts || [];
  const contacts: any[] = crawlResults.contacts || [];
  const timeline: any[] = (crawlResults as any).timeline || [];
  const whyNow: any[] = (crawlResults as any).whyNow || [];
  const quality: number = (crawlResults as any).quality || 0;
  const sections: any[] = [];
  const topFacts = facts.slice(0, 6);
  if (topFacts.length) {
    sections.push({ title: "Summary", items: topFacts.slice(0, 3).map((f: any) => ({ label: f.claim.slice(0, 50), value: `Verified Fact: ${f.evidence.slice(0, 220)}`, sourceUrl: f.sourceUrl, confidence: Math.round(f.confidence * 100) })) });
  } else if (web.length) {
    sections.push({ title: "Summary", items: web.slice(0, 3).map((w: any) => ({ label: (w.title || "").slice(0, 50), value: `Verified Fact: ${(w.snippet || "").slice(0, 220)}`, sourceUrl: w.url, confidence: 60 })) });
  }
  if (identity?.name || identity?.title) {
    sections.push({ title: "Executive Profile", items: [
      { label: "Identity", value: [identity.name, identity.title, identity.company, identity.location].filter(Boolean).join(" · "), sourceUrl: identity.linkedinUrl || null, confidence: identity.confidence?.overall === "HIGH" ? 85 : identity.confidence?.overall === "MEDIUM" ? 65 : 40 },
      { label: "Assessment", value: `Likely (inference): identity resolution scored ${identity.confidence?.overall || "UNKNOWN"} (${(identity.confidence?.name ?? 0)}% name, ${(identity.confidence?.company ?? 0)}% company). Reasoning: match strength across searched sources.`, confidence: identity.confidence?.overall === "HIGH" ? 80 : 55 },
    ].filter(x => x.value) });
  }
  if (timeline.length) {
    sections.push({ title: "Career Progression", items: timeline.slice(0, 5).map((t: any) => ({ label: t.date, value: `Verified Fact: ${t.event}`, sourceUrl: t.source || null, confidence: 70 })) });
    sections.push({ title: "Timeline & Events", items: timeline.slice(0, 6).map((t: any) => ({ label: t.date, value: t.event, sourceUrl: t.source || null, confidence: 70 })) });
  }
  if (whyNow.length) {
    sections.push({ title: "Signals", items: whyNow.slice(0, 3).map((w: any) => ({ label: w.event, value: `Verified Fact: ${w.evidence} — Likely (inference): ${w.whyItMatters}`, sourceUrl: w.source || null, confidence: 70 })) });
    sections.push({ title: "Recent Public Activity", items: whyNow.slice(0, 3).map((w: any) => ({ label: w.event, value: `Verified Fact: ${w.evidence}`, sourceUrl: w.source || null, confidence: 70 })) });
  }
  if (web.length) {
    sections.push({ title: "Current Company Intelligence", items: web.slice(0, 4).map((w: any) => ({ label: (w.title || "Source").slice(0, 60), value: `Verified Fact: ${(w.snippet || "").slice(0, 200)}`, sourceUrl: w.url, confidence: w.tier === 1 ? 85 : 70 })) });
  }
  sections.push({ title: "Confidence Assessment", items: [
    { label: `Overall confidence: ${quality || 60}%`, value: `Verified Fact: research quality ${quality}/100 from ${web.length} sources, ${facts.length} deduplicated facts (multi-source corroboration counted), ${timeline.length} timeline events. Likely (inference): evidence density ${facts.length >= 8 ? "high" : facts.length >= 4 ? "moderate" : "low"} - reasoning: fact volume vs source coverage. Unknown: no live AI synthesis available in this run (provider quota), so analysis sections are incomplete.`, confidence: Math.min(90, quality || 60) },
  ] });
  return {
    person: { name: identity?.name || query, title: identity?.title || "", company: identity?.company || "", location: identity?.location || "", email: contacts.find((c: any) => c.type === "email")?.value || null, phone: contacts.find((c: any) => c.type === "phone")?.value || null, linkedin: identity?.linkedinUrl || contacts.find((c: any) => c.type === "linkedin")?.value || "" },
    company: { name: identity?.company || "", industry: "", size: "", revenue: null, founded: null, headquarters: identity?.location || "", website: "", description: "" },
    sections,
    aiInsights: [],
    confidenceScore: 60,
    researchQuality: quality,
    citations: facts.slice(0, 8),
    whyNow,
    timeline,
    contacts,
    identity,
  };
}

async function crawlEverywhere(query: string, candidate: any = null, identity: any = null) {
  const fetchWithTimeout = async (url: string, opts: any = {}, ms = 12000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch(url, { ...opts, headers: { "User-Agent": pickUA(), ...(opts.headers || {}) }, signal: ctrl.signal });
      return res;
    } finally { clearTimeout(t); }
  };

  // ---------- Tier 1: SEARCH (quota-aware, priority order) ----------
  // Reverse-engineer API calls (per Strategies For Dynamic Content & Robustness - prefer JSON APIs over HTML)
  async function fetchDuckDuckGoJsonApi(q: string) {
    // https://duckduckgo.com/d.js?q=... returns JSON {results:[{...}]} - much more robust than HTML scraping
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://duckduckgo.com/d.js?q=${encodeURIComponent(q)}&vqd=&p=1&o=json`, { headers: { "User-Agent": pickUA(), "Referer": "https://duckduckgo.com/" } }, 8000);
      const data: any = await res.json();
      const results = (data.results || []).slice(0, 8).map((r: any) => ({
        title: (r.title || "").replace(/<[^>]+>/g, "").trim(),
        snippet: (r.description || r.content || "").replace(/<[^>]+>/g, "").slice(0, 300).trim(),
        url: r.url || r.href || "",
        source: "ddg-api"
      })).filter((r: any) => r.url);
      console.log("[Crawl] DDG-API", results.length);
      if (results.length) return results;
      throw new Error("empty");
    }, "ddg-api", 1).catch(() => [] as any[]);
  }

  async function fetchSerper(q: string) {
    const key = process.env.SERPER_API_KEY;
    if (!key) return [];
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 10 }) });
      const data: any = await res.json();
      const results = (data.organic || []).slice(0, 10).map((r: any) => ({ title: r.title, snippet: r.snippet || "", url: r.link, source: "serper" }));
      console.log("[Crawl] Serper", results.length); return results;
    }, "serper", 1).catch(() => [] as any[]);
  }
  async function fetchTavily(q: string) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return [];
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, query: q, max_results: 8, search_depth: "basic", include_answer: false }) });
      const data: any = await res.json();
      const results = (data.results || []).slice(0, 8).map((r: any) => ({ title: r.title, snippet: r.content?.slice(0, 300) || "", url: r.url, source: "tavily" }));
      console.log("[Crawl] Tavily", results.length); return results;
    }, "tavily", 1).catch(() => [] as any[]);
  }
  async function fetchBrave(q: string) {
    const key = process.env.BRAVE_API_KEY;
    if (!key) return [];
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`, { headers: { "X-Subscription-Token": key, "Accept": "application/json" } });
      const data: any = await res.json();
      const results = (data.web?.results || []).slice(0, 8).map((r: any) => ({ title: r.title, snippet: r.description || "", url: r.url, source: "brave" }));
      console.log("[Crawl] Brave", results.length); return results;
    }, "brave", 1).catch(() => [] as any[]);
  }
  async function fetchSerpApi(q: string) {
    const key = process.env.SERPAPI_KEY;
    if (!key) return [];
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${key}`);
      const data: any = await res.json();
      const results = (data.organic_results || []).slice(0, 8).map((r: any) => ({ title: r.title, snippet: r.snippet || "", url: r.link, source: "serpapi" }));
      console.log("[Crawl] SerpApi", results.length); return results;
    }, "serpapi", 1).catch(() => [] as any[]);
  }
  async function fetchBingApi(q: string) {
    const key = process.env.BING_API_KEY;
    if (!key) return [];
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=8`, { headers: { "Ocp-Apim-Subscription-Key": key } });
      const data: any = await res.json();
      const results = (data.webPages?.value || []).slice(0, 8).map((r: any) => ({ title: r.name, snippet: r.snippet || "", url: r.url, source: "bing-api" }));
      console.log("[Crawl] BingAPI", results.length); return results;
    }, "bing-api", 1).catch(() => [] as any[]);
  }
  async function fetchWikipedia(q: string) {
    try {
      const res = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5&origin=*`, {}, 6000);
      const data: any = await res.json();
      const results = (data.query?.search || []).slice(0, 3).map((r: any) => ({ title: r.title, snippet: r.snippet?.replace(/<[^>]+>/g, "").slice(0, 300) || "", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, source: "wikipedia" }));
      console.log("[Crawl] Wikipedia", results.length); return results;
    } catch (e: any) { console.log("[Crawl] Wikipedia fail", e.message); return []; }
  }
  // BeautifulSoup equivalent: cheerio for robust HTML parsing (per Core Tools & When To Use Them)
  async function fetchDuckDuckGoHtml(q: string) {
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": pickUA() } });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      // Try structured parsing first
      $("a.result__url").each((_: any, el: any) => {
        if (results.length >= 8) return;
        const href = $(el).attr("href") || "";
        let url = href; const m = href.match(/uddg=([^&]+)/); if (m) try { url = decodeURIComponent(m[1]); } catch {}
        if (url.includes("duckduckgo.com")) return;
        const titleEl = $(el).closest(".result").find(".result__title");
        const title = titleEl.text().trim() || $(el).text().trim();
        const snippet = $(el).closest(".result").find(".result__snippet").text().trim().slice(0, 300);
        if (title) results.push({ title, snippet, url, source: "duckduckgo-html" });
      });
      console.log("[Crawl] DDG-HTML", results.length); if (results.length) return results; throw new Error("empty");
    }, "ddg-html", 1).catch(() => [] as any[]);
  }
  async function fetchViaAllOrigins(q: string) {
    return withRetry(async () => {
      const target = encodeURIComponent(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
      const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${target}`, { headers: { "User-Agent": pickUA() } }, 15000);
      const data: any = await res.json(); const html = data.contents || "";
      const $ = cheerio.load(html);
      const results: any[] = [];
      $('a[rel="nofollow"]').each((_: any, el: any) => {
        if (results.length >= 8) return;
        const href = $(el).attr("href") || "";
        let url = href; const m = href.match(/uddg=([^&]+)/); if (m) try { url = decodeURIComponent(m[1]); } catch {}
        if (url.includes("duckduckgo.com")) return;
        const title = $(el).text().trim();
        if (title) results.push({ title, snippet: "", url, source: "allorigins" });
      });
      console.log("[Crawl] AllOrigins", results.length); if (results.length) return results; throw new Error("empty");
    }, "allorigins", 1).catch(() => [] as any[]);
  }

  // Free no-key intel sources — run once per search (not per query) to preserve rate limits.
  // GitHub (technical footprint), HN Algolia (mentions), Semantic Scholar (papers),
  // SEC EDGAR (filings for public-company execs), Google Books (authored books),
  // Mojeek HTML (independent index), Reddit JSON + StackExchange (community presence).
  async function fetchFreeIntelSources(name: string, company?: string) {
    const out: any[] = [];
    const q = company ? `${name} ${company}` : name;
    const get = async (url: string, headers: any = {}, ms = 6000) => {
      try {
        const res = await fetchWithTimeout(url, { headers: { "User-Agent": pickUA(), ...headers } }, ms);
        return res;
      } catch { return null; }
    };
    const tasks: Promise<any[]>[] = [
      (async () => {
        const res = await get(`https://api.github.com/search/users?q=${encodeURIComponent(name)}+in:fullname&per_page=3`, { "Accept": "application/vnd.github+json" });
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (data.items || []).slice(0, 3).map((u: any) => ({ title: `${u.login} (GitHub)`, snippet: `GitHub user: ${u.login}${u.type ? ` (${u.type})` : ""}`.slice(0, 200), url: u.html_url, source: "github", tier: 2 }));
      })(),
      (async () => {
        const res = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&tags=story&hitsPerPage=4`);
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (data.hits || []).slice(0, 4).map((h: any) => ({ title: h.title || "Hacker News mention", snippet: (h.title || "").slice(0, 200), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, source: "hackernews", tier: 2 }));
      })(),
      (async () => {
        const res = await get(`https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(name)}&fields=name,affiliations,paperCount,citationCount,url&limit=3`);
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (data.data || []).slice(0, 3).map((a: any) => ({ title: `${a.name} (Semantic Scholar)`, snippet: `Papers: ${a.paperCount ?? "?"}, citations: ${a.citationCount ?? "?"}${a.affiliations?.length ? `, ${a.affiliations.map((x: any) => x.name).join("; ")}` : ""}`.slice(0, 250), url: a.url || `https://www.semanticscholar.org/search?q=${encodeURIComponent(name)}&sort=relevance`, source: "semanticscholar", tier: 2 }));
      })(),
      (async () => {
        if (!company) return [];
        const res = await get(`https://efts.sec.gov/LATEST/search?q=${encodeURIComponent('"' + company + '"')}`, { "Accept": "application/json", "Host": "efts.sec.gov" });
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        const hits = data.hits?.hits || data.hits || [];
        return (Array.isArray(hits) ? hits : []).slice(0, 3).map((h: any) => {
          const src = h._source || {};
          return { title: `${company} — SEC filing (${src.form || "filing"})`, snippet: (src.doc || src.summary || "SEC EDGAR filing mention").toString().slice(0, 250), url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(company)}&type=&dateb=&owner=include&count=10`, source: "sec-edgar", tier: 1 };
        });
      })(),
      (async () => {
        const res = await get(`https://www.googleapis.com/books/v1/volumes?q=inauthor:${encodeURIComponent(name)}&maxResults=3`);
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (data.items || []).slice(0, 3).map((b: any) => ({ title: `${b.volumeInfo?.title || "Book"} — ${name}`, snippet: (b.volumeInfo?.description || `Authored by ${name}`).slice(0, 250), url: b.volumeInfo?.infoLink || `https://books.google.com/?q=${encodeURIComponent(name)}`, source: "google-books", tier: 2 }));
      })(),
      (async () => {
        try {
          const res = await fetchWithTimeout(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": pickUA() } }, 8000);
          const html = await res.text();
          const $ = cheerio.load(html);
          const results: any[] = [];
          $("a.title").each((_: any, el: any) => {
            if (results.length >= 6) return;
            const href = $(el).attr("href") || "";
            if (!href.startsWith("http")) return;
            const title = $(el).text().trim();
            if (title) results.push({ title, snippet: $(el).closest("li").find("p.desc, p.s").text().trim().slice(0, 250), url: href, source: "mojeek", tier: 3 });
          });
          console.log("[Crawl] Mojeek", results.length);
          return results;
        } catch { return []; }
      })(),
      (async () => {
        const res = await get(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=4&sort=relevance&restrict_sr=0`, {}, 6000);
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        const kids = data?.data?.children || [];
        return kids.slice(0, 4).map((k: any) => ({ title: k.data?.title || "Reddit mention", snippet: (k.data?.selftext || "").slice(0, 200), url: `https://www.reddit.com${k.data?.permalink || ""}`, source: "reddit", tier: 3 }));
      })(),
      (async () => {
        const res = await get(`https://api.stackexchange.com/2.3/users?inname=${encodeURIComponent(name)}&site=stackoverflow&pagesize=3&order=desc&sort=reputation`);
        if (!res || !res.ok) return [];
        const data: any = await res.json().catch(() => ({}));
        return (data.items || []).slice(0, 3).map((u: any) => ({ title: `${u.display_name} (Stack Overflow)`, snippet: `Reputation: ${u.reputation ?? "?"}${u.location ? `, ${u.location}` : ""}`.slice(0, 200), url: u.link, source: "stackexchange", tier: 2 }));
      })(),
    ];
    const settled = await Promise.allSettled(tasks);
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        for (const r of s.value) {
          if (r.url && isUrlAllowed(r.url)) out.push(r);
        }
      }
    }
    console.log("[Crawl] FreeIntel", out.length, "sources:", [...new Set(out.map((r: any) => r.source))].join(","));
    return out;
  }

  // Tier 1: Research Engine - Query Expansion + Multi-Provider Discovery (per requirement 4 & 25)
  const expandedQueries = expandQueries(identity);
  console.log("[Research] Expanded", expandedQueries.length, expandedQueries.slice(0, 4));
  const providers = getSearchProviders();
  console.log("[Research] Providers", providers.map(p => p.name).join(","));
  const allResults: SearchResult[] = [];
  // Budget: max 5 queries to control cost, 5 results each = up to 25 raw results
  const queryBudget = expandedQueries.slice(0, 5);
  for (const q of queryBudget) {
    let gotForQuery = 0;
    for (const p of providers) {
      try {
        const res = await withRetry(() => p.search(q, { num: 5 }), `search:${p.name}`, 1).catch(() => [] as SearchResult[]);
        if (res.length) {
          // Assign tier if not already
          const tiered = res.map((r: any) => ({ ...r, tier: r.tier || tierForUrl(r.url, p.tier) }));
          allResults.push(...tiered);
          gotForQuery += res.length;
          if (gotForQuery >= 3) break; // Good results, skip fallback for this query
        }
      } catch {}
    }
    // Small delay to respect rate limits
    await new Promise(r => setTimeout(r, 150));
  }
  // Also run legacy comprehensive candidate queries for additional coverage (ensures old company rename etc.)
  let legacyResults: any[] = [];
  if (candidate && candidate.name) {
    const extraQs: string[] = [];
    if (candidate.company) {
      const lineage = resolveCompanyLineage(candidate.company);
      if (lineage) extraQs.push(`${candidate.name} ${lineage}`);
    }
    extraQs.push(`${identity.name} event conference speaker`, `${identity.name} timeline history career`);
    for (const q of extraQs.slice(0, 2)) {
      try {
        const r = await withRetry(() => providers[0].search(q, { num: 5 }), `search:extra`, 1).catch(() => []);
        allResults.push(...r);
      } catch {}
    }
  }
  // Rank via research-engine (30% identity, 20% quality, 15% recency, 15% directness, 10% corroboration, 10% role)
  const ranked = rankSources(allResults as SearchResult[], identity);
  // Free no-key sources: run once (not per query) to preserve rate limits
  const freeIntel = await fetchFreeIntelSources(identity.name, identity.company);
  // Also include free HTML fallbacks as additional sources (zero cost)
  const [ddgHtml, allorig] = await Promise.allSettled([fetchDuckDuckGoHtml(query), fetchViaAllOrigins(query)]);
  const ddgHtmlRes = ddgHtml.status === "fulfilled" ? (ddgHtml.value as any[]) : [];
  const allorigRes = allorig.status === "fulfilled" ? (allorig.value as any[]) : [];
  const freeResults = [...freeIntel, ...ddgHtmlRes, ...allorigRes].map((r: any) => ({ ...r, tier: r.tier || tierForUrl(r.url, 3), relevance: r.relevance || 40 }));
  const mergedSearch = [...ranked, ...freeResults];
  const seen = new Set(); const web = mergedSearch.filter((r: any) => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 15);
  console.log("[Crawl] Tier1 total", web.length, "ranked top", web.slice(0, 3).map((w: any) => `${w.source}:${w.relevance}`).join(", "));

  // For compatibility, keep legacy variable names
  const serperResults: any[] = web; const tavilyResults: any[] = []; const braveResults: any[] = []; const serpApiResults: any[] = []; const bingApiResults: any[] = []; const wikiResults: any[] = [];

  // ---------- Tier 2: DEEP SCRAPE (aggressive, diverse - every org branch + personal footprint) ----------
  const hash = query.split("").reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
  const deepPages: any[] = [];
  const seenDomains = new Set<string>();
  let topUrls: string[] = [];
  for (const w of web) {
    try {
      const domain = new URL(w.url).hostname.replace("www.", "");
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      if (isUrlAllowed(w.url)) topUrls.push(w.url);
      if (topUrls.length >= 5) break;
    } catch {}
  }
  if (candidate?.linkedin && isUrlAllowed(candidate.linkedin) && !topUrls.includes(candidate.linkedin)) {
    topUrls = [candidate.linkedin, ...topUrls].slice(0, 5);
    console.log("[Deep] Added candidate LinkedIn");
  }
  if (candidate?.url && isUrlAllowed(candidate.url) && !topUrls.includes(candidate.url)) {
    topUrls = [...topUrls, candidate.url].slice(0, 5);
  }
  if (candidate?.company && resolveCompanyLineage(candidate.company)) {
    const lsUrl = "https://levelshift.com/leadership";
    if (isUrlAllowed(lsUrl) && !topUrls.includes(lsUrl)) topUrls.push(lsUrl);
  }
  // Ensure we have at least 5 diverse pages for aggressive holistic view
  topUrls = topUrls.slice(0, 5);

  async function deepScrapeScrapeDo(url: string) {
    if (!isUrlAllowed(url)) { console.log("[Deep] Scrape.do blocked SSRF", url.slice(0, 60)); return null; }
    const key = process.env.SCRAPE_DO_KEY || process.env.SCRAPE_DO_TOKEN;
    if (!key) return null;
    const cfg = getConfigForUrl(url);
    console.log(`[Deep] Scrape.do config for ${url.slice(0, 30)}: parser=${cfg.parser} priority=${cfg.priority}`);
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://api.scrape.do?token=${key}&url=${encodeURIComponent(url)}&render=${cfg.parser === "browser" ? "true" : "false"}`, {}, 12000);
      const text = await res.text();
      if (text.length > 50000) { console.log("[Deep] Scrape.do oversized"); return text.slice(0, 3500); }
      console.log("[Deep] Scrape.do", url.slice(0, 40), "len", text.length); return text.slice(0, 3500);
    }, "scrape.do", 1).catch(() => null);
  }
  async function deepScrapeFirecrawl(url: string) {
    if (!isUrlAllowed(url)) { console.log("[Deep] Firecrawl blocked SSRF", url.slice(0, 60)); return null; }
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return null;
    const cfg = getConfigForUrl(url);
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: cfg.parser === "browser" ? 2000 : 0 })
      });
      const data: any = await res.json();
      const md = data.data?.markdown || data.markdown || "";
      if (md.length > 50000) { console.log("[Deep] Firecrawl oversized"); return md.slice(0, 3500); }
      console.log("[Deep] Firecrawl", url.slice(0, 40), "len", md.length); return md.slice(0, 3500);
    }, "firecrawl", 1).catch(() => null);
  }
  async function deepScrapeJina(url: string) {
    if (!isUrlAllowed(url)) { console.log("[Deep] Jina blocked SSRF", url.slice(0, 60)); return null; }
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`, { headers: { "User-Agent": pickUA() } }, 8000);
      const text = await res.text();
      if (text.length > 50000) { console.log("[Deep] Jina oversized"); return text.slice(0, 3500); }
      console.log("[Deep] Jina", url.slice(0, 40), "len", text.length); return text.slice(0, 3500);
    }, "jina", 1).catch(() => null);
  }
  async function deepScrapeScrapingBee(url: string) {
    if (!isUrlAllowed(url)) { console.log("[Deep] ScrapingBee blocked SSRF", url.slice(0, 60)); return null; }
    const key = process.env.SCRAPINGBEE_API_KEY;
    if (!key) return null;
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://app.scrapingbee.com/api/v1/?api_key=${key}&url=${encodeURIComponent(url)}&render_js=${getConfigForUrl(url).parser === "browser" ? "true" : "false"}`, {}, 10000);
      const text = await res.text(); if (text.length > 50000) return text.slice(0, 3500);
      console.log("[Deep] ScrapingBee", url.slice(0, 40), "len", text.length); return text.slice(0, 3500);
    }, "scrapingbee", 1).catch(() => null);
  }
  async function deepScrapeZenRows(url: string) {
    if (!isUrlAllowed(url)) { console.log("[Deep] ZenRows blocked SSRF", url.slice(0, 60)); return null; }
    const key = process.env.ZENROWS_API_KEY;
    if (!key) return null;
    return withRetry(async () => {
      const res = await fetchWithTimeout(`https://api.zenrows.com/v1/?apikey=${key}&url=${encodeURIComponent(url)}&autoparse=false`, {}, 10000);
      const text = await res.text(); if (text.length > 50000) return text.slice(0, 3500);
      console.log("[Deep] ZenRows", url.slice(0, 40), "len", text.length); return text.slice(0, 3500);
    }, "zenrows", 1).catch(() => null);
  }

  // Combine Tools: Jina (free) first for every page; paid browser only as fallback
  for (let i = 0; i < topUrls.length; i++) {
    const url = topUrls[i];
    let content: string | null = await deepScrapeJina(url);
    if (!content || content.length < 500) {
      const choice = (hash + i) % 4;
      if (choice === 0) content = await deepScrapeFirecrawl(url) || await deepScrapeScrapeDo(url);
      else if (choice === 1) content = await deepScrapeScrapeDo(url) || await deepScrapeFirecrawl(url);
      else if (choice === 2) content = await deepScrapeScrapingBee(url);
      else content = await deepScrapeZenRows(url);
      if (!content || content.length < 500) content = await deepScrapeJina(url);
    }
    if (content) {
      // Parse with cheerio/BeautifulSoup for easier extraction (per webscraping.fyi)
      try {
        const $ = cheerio.load(content);
        // If markdown, keep as is; if HTML, extract main text
        const isHtml = content.includes("<html") || content.includes("<div");
        const clean = isHtml ? ($("body").text().slice(0, 2000) || content.slice(0, 2000)) : content.slice(0, 2000);
        deepPages.push({ url, content: clean });
      } catch { deepPages.push({ url, content: content.slice(0, 2000) }); }
    }
  }

  // ---------- Tier 3: ENRICHMENT ----------
  async function fetchExplorium(q: string) {
    const key = process.env.EXPLORIUM_API_KEY;
    if (!key) return null;
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch(`https://api.explorium.ai/v1/prospects?query=${encodeURIComponent(q)}`, { headers: { "api_key": key, "Content-Type": "application/json" } });
      const data: any = await res.json(); console.log("[Enrich] Explorium", JSON.stringify(data).slice(0, 300)); return data;
    }, "explorium", 0).catch(() => null);
  }
  async function fetchTinyfishEnrich(q: string, snippets: string) {
    const key = process.env.TINYFISH_API_KEY;
    if (!key) return null;
    return withRetry(async () => {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch("https://api.tinyfish.ai/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "tinyfish", messages: [{ role: "user", content: `Enrich prospect "${q}" given snippets:\n${snippets.slice(0, 1500)}\n\nReturn 2-3 concise insights.` }], max_tokens: 400 }) });
      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content || data.output || "";
      console.log("[Enrich] Tinyfish", text.slice(0, 200)); return text.slice(0, 800);
    }, "tinyfish", 0).catch(() => null);
  }
  async function fetchPublicApis() {
    return withRetry(async () => {
      const res = await fetchWithTimeout("https://api.publicapis.org/entries?category=business&https=true", {}, 5000);
      const data: any = await res.json();
      const entries = (data.entries || []).slice(0, 3).map((e: any) => `${e.API}: ${e.Description} (${e.Link})`).join("; ");
      console.log("[Enrich] PublicAPIs", entries.slice(0, 200)); return entries;
    }, "publicapis", 0).catch(() => null);
  }
  async function fetchPublicApisRepo(q: string) {
    return withRetry(async () => {
      const res = await fetchWithTimeout("https://r.jina.ai/https://raw.githubusercontent.com/public-apis/public-apis/master/README.md", {}, 6000);
      const text = await res.text();
      const relevant = text.split("\n").filter((l: string) => l.toLowerCase().includes(q.split(" ")[0].toLowerCase())).slice(0, 3).join(" | ").slice(0, 500);
      console.log("[Enrich] PublicAPIs Repo", relevant.slice(0, 100)); return relevant || null;
    }, "public-apis-repo", 0).catch(() => null);
  }

  // Extract contacts + social handles with confidence - aggressive, tag everything under contacts
  function extractContactsAll(webList: any[], deepList: any[]) {
    const allText = [...webList.map((w: any) => `${w.title} ${w.snippet} ${w.url}`), ...deepList.map((d: any) => d.content || "")].join(" \n ");
    const contacts: any[] = [];
    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const emails = allText.match(emailRe) || [];
    const seen = new Set<string>();
    for (const e of emails.slice(0, 3)) {
      const lower = e.toLowerCase();
      if (seen.has(lower) || lower.includes("example.com") || lower.includes("test@") || lower.includes("noreply")) continue;
      seen.add(lower);
      const lowerAll = allText.toLowerCase();
      const nameFirst = query.toLowerCase().split(" ")[0];
      const nearName = lowerAll.indexOf(lower) > -1 && lowerAll.slice(Math.max(0, lowerAll.indexOf(lower) - 120), lowerAll.indexOf(lower) + 120).includes(nameFirst);
      const domainMatch = webList.some((w: any) => w.url && lower.endsWith(w.url.split("/")[2]?.replace("www.", "") || ""));
      contacts.push({ type: "email", value: lower, confidence: nearName || domainMatch ? 85 : 65, source: "scraped" });
    }
    const phoneContextRe = /(phone|contact|tel|mobile|call)[^.\n]{0,80}(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/gi;
    let m;
    while ((m = phoneContextRe.exec(allText)) && contacts.filter(c => c.type === "phone").length < 2) {
      const full = m[0];
      const phoneMatch = full.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (!phoneMatch) continue;
      const p = phoneMatch[0].trim();
      if (seen.has(p)) continue;
      seen.add(p);
      contacts.push({ type: "phone", value: p, confidence: 70, source: "scraped" });
    }
    // Social handles - tag every social under contacts (aggressive)
    const socialPatterns: [RegExp, string, number][] = [
      [/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-\_%\/]+/gi, "linkedin", 95],
      [/https?:\/\/(?:www\.)?twitter\.com\/[A-Za-z0-9_]+/gi, "twitter", 90],
      [/https?:\/\/(?:www\.)?x\.com\/[A-Za-z0-9_]+/gi, "twitter", 90],
      [/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9\-_]+/gi, "github", 90],
      [/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9\._]+/gi, "instagram", 85],
      [/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9\.]+/gi, "facebook", 85],
      [/https?:\/\/(?:www\.)?medium\.com\/@[A-Za-z0-9\-_]+/gi, "medium", 80],
      [/https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[A-Za-z0-9\-_]+/gi, "youtube", 80],
    ];
    for (const [re, type, conf] of socialPatterns) {
      const matches = allText.match(re) || [];
      for (const url of matches.slice(0, 2)) {
        if (seen.has(url)) continue;
        seen.add(url);
        contacts.push({ type, value: url, confidence: conf, source: "social" });
      }
    }
    // Ensure primary LinkedIn is first
    const linkedinHit2 = webList.find((r: any) => r.url.includes("linkedin.com/in/"));
    if (linkedinHit2 && !contacts.find(c => c.type === "linkedin" && c.value === linkedinHit2.url)) {
      contacts.unshift({ type: "linkedin", value: linkedinHit2.url, confidence: 95, source: "linkedin" });
    }
    return contacts;
  }

  const [publicApis, publicRepo] = await Promise.allSettled([fetchPublicApis(), fetchPublicApisRepo(query)]);
  const enrichVals = {
    explorium: null,
    tinyfish: null,
    publicApis: [publicApis.status === "fulfilled" ? publicApis.value : null, publicRepo.status === "fulfilled" ? publicRepo.value : null].filter(Boolean).join(" | "),
  };

  const linkedinHit = web.find((r: any) => r.url.includes("linkedin.com/in/")) || null;
  const linkedin = linkedinHit ? { url: linkedinHit.url } : null;
  const contacts = extractContactsAll(web, deepPages);

  return {
    web, google: web, linkedin, contacts, company: { snippets: web.slice(0, 5).map((w: any) => w.snippet).filter(Boolean) },
    deepPages, enrichment: enrichVals,
    rawCount: web.length,
    health: getHealthMetrics(),
  };
}

async function analyzeWithTinyfish(query: string, scrapedData: any): Promise<any> {
  const key = process.env.TINYFISH_API_KEY!;
  const webResults = (scrapedData.web || []).slice(0, 5).map((r: any, i: number) => `${i + 1}. ${r.title} - ${r.snippet} (${r.url})`).join("\n");
  const prompt = `Analyze "${query}" - Web results:\n${webResults}\n\nReturn JSON with person, company, sections (Summary,Career,Role,Company,Activity,Leadership,Interests,Tech,Priorities,Signals,Challenges,Stakeholders,Relationships,Opportunities,Openers,Questions,Strategy,Risks,Confidence), aiInsights (3), confidenceScore. Use web results as source, don't hallucinate.`;
  const nodeFetch = (await import("node-fetch")).default;
  const res: any = await nodeFetch("https://api.tinyfish.ai/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "tinyfish", messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 3000 }) });
  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Tinyfish no JSON");
  return JSON.parse(jsonMatch[0]);
}

async function analyzeWithAI(query: string, scrapedData: any, candidate: any = null) {
  const webResults = (scrapedData.web || []).slice(0, 5).map((r: any, i: number) => `${i + 1}. ${r.title} (${r.url}) — ${(r.snippet || "").slice(0, 200)} [T${r.tier || 3}]`).join("\n");
  const deepContent = (scrapedData.deepPages || []).slice(0, 3).map((d: any, i: number) => `Page ${i + 1} (${d.url}): ${d.content?.slice(0, 650)}`).join("\n\n");
  const contactsText = (scrapedData.contacts || []).map((c: any) => `${c.type}: ${c.value} (confidence ${c.confidence}%)`).join("\n") || "No contacts scraped";
  const enrich = scrapedData.enrichment?.publicApis ? `\n\nExtra context: ${scrapedData.enrichment.publicApis.slice(0, 300)}` : "";
  const factsText = (scrapedData.facts || []).slice(0, 6).map((f: any, i: number) => `${i + 1}. ${f.claim} | ${f.evidence.slice(0, 100)} [${f.sourceUrl}, T${f.tier}]`).join("\n") || "No structured facts";
  const whyNowText = (scrapedData.whyNow || []).map((w: any) => `- ${w.event} (${w.date}) - ${w.whyItMatters} [${w.source}]`).join("\n") || "No why-now signals";
  const timelineText = (scrapedData.timeline || []).map((t: any) => `${t.date}: ${t.event}`).join("\n") || "No timeline";

  const lineageNote = (() => {
    const comp = scrapedData.web?.find((w: any) => resolveCompanyLineage(w.title + " " + w.snippet))?.title || candidate?.company || "";
    const resolved = resolveCompanyLineage(comp);
    return resolved ? `Company lineage note: ${comp} is now ${resolved}. Treat old and new names as same entity (e.g., PreludeSys/DemandBlue -> LevelShift). Explicitly call out the rename in Company section.` : "";
  })();

  const prompt = `You are a prospect intelligence analyst producing an AGGRESSIVE, HOLISTIC deep dive - everything public about this person, professional AND personal. Analyze "${query}".

FRESH WEB SEARCH (ranked, ${scrapedData.web?.length || 0} results, diverse org branches including events/timeline):
${webResults || "No web results"}

DEEP PAGE CONTENT (3 pages):
${deepContent || "No deep pages"}

STRUCTURED FACTS (extracted, deduplicated, evidence + tier):
${factsText}

WHY NOW SIGNALS (recent events making prospect relevant now):
${whyNowText}

TIMELINE (temporal):
${timelineText}

SCRAPED CONTACTS + SOCIAL HANDLES (strict, confidence):
${contactsText}
${lineageNote}
${enrich}

RULES:
- Cover ALL branches across domains: every org/role (incl. pre-rename names), education, volunteer, writing/books/speaking, awards, social handles, events. Not limited to LinkedIn.
- Company rename: in Current Company Intelligence note "Formerly X, now Y" and call out the rename.
- Timeline: build chronological Career Progression + Timeline & Events from TIMELINE above; prioritize 30/90/180-day signals.
- Contacts: use ONLY scraped contacts above for person.email/phone/linkedin (null if none); show confidence% in Contact section; tag each social URL with its type. Never invent.
- Evidence: ground every important claim in a FACT/source above with sourceUrl + confidence. Label items "Verified Fact:" / "Likely (inference): <one line of reasoning>" / "Unknown:". Never present an inference as a fact.
- Strategic insight: WHO is this person (role, company, seniority, decision authority) and WHAT would interest them (interests, priorities, tech stack, events, motivations) - specific and evidence-backed.
- Holistic: include outside-professional info if present; if none, state "No public personal information found".
- confidenceScore: 85-95 strong public figure, 60-84 moderate, 30-50 weak, 5-15 only if ZERO results.
- Deduplicate career/role items; no vague one-liners.

REPORT FORMAT - consulting briefing (analyze, do not merely summarize):
- Return ALL 21 sections, EXACT titles, EXACT order: Executive Summary; Executive Profile; Career Progression; Current Role & Responsibilities; Current Company Intelligence; Recent Public Activity; Thought Leadership Analysis; Professional Interests; Technology Landscape; Business Priorities; Buying Signal Analysis; Business Challenges; Stakeholder & Influence Assessment; Relationship Indicators; Strategic Sales Assessment; Personalized Conversation Starters; Discovery Questions; Recommended Outreach Strategy; Risks, Unknowns & Information Gaps; Source Appendix; Confidence Assessment. Optional extras after: Contact, Personal Background, Timeline & Events.
- DEPTH: every section gets substantive multi-sentence analysis saying WHY it matters to a sales rep and what to do (actionable). Connect findings across sections. Analyze patterns, initiatives, themes, risks, opportunities - not a one-pass summary.
- Business Challenges, Business Priorities, Buying Signal Analysis: split into "Verified ..." (each with source) and "Likely ... (inferences)" (each with its reasoning).
- SOURCE CONFLICTS: if sources disagree (title, tenure, dates, company), state the conflict, choose the more authoritative source, explain why.
- LIMITED INFO: if public info is thin, state in Executive Summary: "Comprehensive research performed; limited publicly available information exists" and list gaps in Risks, Unknowns & Information Gaps.
- Source Appendix: every source actually used - item label = source title, value = how it was used + tier + confidence, sourceUrl = link.
- TABLES: markdown table inside item values where comparison helps (career history, tech stack, stakeholders).
- ACTIONABLE: Conversation Starters personalized to THIS person's recent activity/interests; Discovery Questions target THIS company's likely initiatives; Outreach Strategy names channels, sequencing, timing. No generic advice.
- No markdown headings (#) - the renderer prints section titles; bullets are fine inside values.

Return ONLY valid JSON:
{
  "person": {"name": "string", "title": "string", "company": "string", "location": "string", "email": "string|null", "linkedin": "string|null", "phone": "string|null"},
  "contacts": [{"type": "string", "value": "string", "confidence": number}],
  "company": {"name": "string", "industry": "string", "size": "string", "revenue": "string|null", "founded": "string|null", "headquarters": "string", "website": "string", "description": "string"},
  "sections": [{"title": "string", "items": [{"label": "string", "value": "string", "sourceUrl": "string|null", "confidence": number} ]}],
  "aiInsights": ["string", "string", "string"],
  "confidenceScore": number,
  "researchQuality": number,
  "citations": [{"claim": "string", "sourceTitle": "string", "sourceUrl": "string", "tier": number, "confidence": number}],
  "whyNow": [{"event": "string", "date": "string", "evidence": "string", "source": "string", "whyItMatters": "string"}],
  "timeline": [{"date": "string", "event": "string", "source": "string"}]
}
If ZERO results, set title "Unknown - no public data found" and confidence 8. Otherwise curate aggressively and holistically. Every important item should have sourceUrl and confidence where possible.`;

  const { result, provider } = await aiRegistry.generateJSON(prompt, { temperature: 0.2, maxTokens: 6000, reasoningEffort: "low" });
  console.log(`[SearchHandler] AI done via ${provider}`);

  // Ensure confidence + whyNow + timeline are present (repair path can drop fields)
  const res = result as { confidenceScore?: number | null; whyNow?: any[]; timeline: any[]; sections?: any[] } & Record<string, any>;
  if (res && typeof res === 'object') {
    if (res.confidenceScore === undefined || res.confidenceScore === null) {
      res.confidenceScore = 50;
      console.log("[SearchHandler] AI result missing confidenceScore, defaulting to 50");
    }
    if (!res.whyNow || !Array.isArray(res.whyNow) || res.whyNow.length === 0) {
      res.whyNow = [];
      console.log("[SearchHandler] AI result missing whyNow, defaulting to empty array");
    }
    if (!res.timeline || !Array.isArray(res.timeline) || res.timeline.length === 0) {
      res.timeline = [];
      console.log("[SearchHandler] AI result missing timeline, defaulting to empty array");
    }
    // Repair pass: model dropped spec sections (usually output truncation) -> one targeted call
    try {
      const current = (Array.isArray(res.sections) ? res.sections : []).map((s: any) => normalizeSectionTitle(s?.title || ""));
      const missing = SPEC_SECTIONS.filter(t => !current.includes(t));
      if (missing.length >= 2 && missing.length < SPEC_SECTIONS.length && res.confidenceScore >= 30) {
        console.log("[SearchHandler] Repair pass for missing sections:", missing.join(" | "));
        const repairPrompt = `You are completing a prospect intelligence report on "${query}".
The report is missing these sections: ${missing.join("; ")}.

EVIDENCE AVAILABLE:
${factsText}

WHY NOW: ${whyNowText}
WEB RESULTS: ${webResults || "none"}
DEEP PAGES: ${deepContent || "none"}

Return ONLY valid JSON: {"sections": [{"title": "<exact section title from the list above>", "items": [{"label": "...", "value": "analytical multi-sentence content - verified facts labeled 'Verified Fact:', inferences labeled 'Likely (inference):' with reasoning", "sourceUrl": "string|null", "confidence": number}]}]}
Cover EVERY missing section. Analyze, do not summarize. No markdown # headings. No text outside JSON.`;
        const { result: repair } = await aiRegistry.generateJSON(repairPrompt, { temperature: 0.2, maxTokens: 3000, reasoningEffort: "low" });
        const repSections = ((repair as any)?.sections || []).filter((s: any) =>
          missing.some(m => normalizeSectionTitle(s?.title || "").toLowerCase() === m.toLowerCase())
        );
        if (Array.isArray(repSections) && repSections.length) {
          res.sections = [...(Array.isArray(res.sections) ? res.sections : []), ...repSections];
          console.log("[SearchHandler] Repair added", repSections.length, "sections");
        } else {
          console.log("[SearchHandler] Repair returned no usable sections (provider fallback or quota)");
        }
      }
    } catch (e) {
      console.log("[SearchHandler] Repair pass failed (non-fatal):", (e as any)?.message || e);
    }
  }
  return res;
}

function buildCase(query: string, scrapedData: any, aiAnalysis: any, hasAiKey: boolean, aiError: string | null) {
  const id = Date.now().toString();
  const timestamp = new Date().toISOString();
  if (aiAnalysis) {
    const contacts = aiAnalysis.contacts || scrapedData.contacts || [];
    let sections = aiAnalysis.sections || [];
    if (contacts.length > 0 && !sections.find((s: any) => s.title === "Contact")) {
      sections = [
        { title: "Contact", items: contacts.map((c: any) => ({ label: `${c.type} (${c.confidence}%)`, value: c.value, sourceUrl: c.value.startsWith("http") ? c.value : null, confidence: c.confidence })) },
        ...sections
      ];
    }
    const sd: any = (scrapedData as any).structuredData || {};
    const derivedWhyNow = (aiAnalysis.whyNow && aiAnalysis.whyNow.length ? aiAnalysis.whyNow : null)
      || (sd.whyNow && sd.whyNow.length ? sd.whyNow : null)
      || ((scrapedData as any).whyNow && (scrapedData as any).whyNow.length ? (scrapedData as any).whyNow : null)
      || (sd.signals ? Object.entries(sd.signals).filter(([k, v]) => v).map(([k, v]) => ({ event: k.charAt(0).toUpperCase() + k.slice(1), date: new Date().toISOString().split('T')[0], evidence: Array.isArray(v) ? (v as any[]).join("; ") : String(v), source: "structured extraction", whyItMatters: `Signal detected: ${k}` })) : []);
    const derivedTimeline = (aiAnalysis.timeline && aiAnalysis.timeline.length ? aiAnalysis.timeline : null)
      || (sd.timeline && sd.timeline.length ? sd.timeline : null)
      || ((scrapedData as any).timeline && (scrapedData as any).timeline.length ? (scrapedData as any).timeline : []);
    const citations = aiAnalysis.citations || (scrapedData as any).facts?.slice(0, 8) || [];
    const { sections: fullSections, missing } = enforceSectionContract(sections, {
      citations,
      sources: (scrapedData.web || []).slice(0, 15),
      deepPages: scrapedData.deepPages || [],
    });
    if (missing.length) console.log("[SearchHandler] Section contract stubbed:", missing.join(" | "));
    return {
      id, query, timestamp,
      person: { ...(aiAnalysis.person || { name: query, title: "Unknown - no public data found", company: "Unknown", linkedin: scrapedData.linkedin?.url || "", location: "Unknown" }), email: aiAnalysis.person?.email || contacts.find((c: any) => c.type === "email")?.value || null, phone: aiAnalysis.person?.phone || contacts.find((c: any) => c.type === "phone")?.value || null, linkedin: aiAnalysis.person?.linkedin || scrapedData.linkedin?.url || "" },
      contacts,
      company: aiAnalysis.company || { name: "Unknown", industry: "Unknown", size: "Unknown", revenue: null, founded: null, headquarters: "Unknown", website: "", description: "No verifiable public information found." },
      sections: fullSections,
      aiInsights: aiAnalysis.aiInsights || [],
      confidenceScore: aiAnalysis.confidenceScore ?? 8,
      // Computed quality (evidence density) is objective; the model's self-report is unreliable (seen: 9/100 on a strong run)
      researchQuality: Math.min(100, Math.max(0, (scrapedData as any).quality || aiAnalysis.researchQuality || 0)),
      citations,
      whyNow: derivedWhyNow,
      timeline: derivedTimeline,
      identity: (scrapedData as any).identity || null,
      structuredData: (scrapedData as any).structuredData || null,
      savedToPipeline: false,
      _sources: (scrapedData.web || []).slice(0, 5),
      _deepPages: scrapedData.deepPages || [],
      _debug: {
        queriesExpanded: (scrapedData as any).expandedQueries || [],
        sourcesDiscovered: (scrapedData.web || []).length,
        sourcesUsed: (scrapedData.web || []).slice(0, 5).map((s: any) => ({ url: s.url, tier: s.tier, relevance: s.relevance })),
        factsExtracted: (scrapedData as any).facts?.length || 0,
        researchQuality: (scrapedData as any).quality || 0,
      },
    };
  }
  const web = scrapedData.web || [];
  const { sections: fullSections } = enforceSectionContract(
    [{ title: "Web Results", items: web.slice(0, 5).map((r: any) => ({ label: r.title?.slice(0, 50) || "Result", value: `${r.snippet?.slice(0, 150) || ""} | ${r.url || ""}` })) }],
    { citations: (scrapedData as any).facts?.slice(0, 8) || [], sources: web.slice(0, 15), deepPages: scrapedData.deepPages || [] }
  );
  return {
    id, query, timestamp,
    person: { name: query.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), title: "", company: "", linkedin: scrapedData.linkedin?.url || "", location: "" },
    company: { name: "", industry: "", size: "", revenue: "", founded: "", headquarters: "", website: "", description: "" },
    sections: fullSections,
    aiInsights: [hasAiKey ? `AI key set (${process.env.GROQ_API_KEY ? "GROQ" : "GEMINI"}) but analysis failed` : "No AI keys", aiError ? `Error: ${aiError}` : "Check logs", `Crawled ${web.length} web results.`],
    confidenceScore: web.length ? 30 : 10,
    savedToPipeline: false,
    _sources: web.slice(0, 5),
  };
}
