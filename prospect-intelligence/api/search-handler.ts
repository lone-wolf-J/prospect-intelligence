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
    sections.push({ title: "Summary", items: topFacts.slice(0, 3).map((f: any) => ({ label: f.claim.slice(0, 50), value: f.evidence.slice(0, 220), sourceUrl: f.sourceUrl, confidence: Math.round(f.confidence * 100) })) });
  } else if (web.length) {
    sections.push({ title: "Summary", items: web.slice(0, 3).map((w: any) => ({ label: (w.title || "").slice(0, 50), value: (w.snippet || "").slice(0, 220), sourceUrl: w.url, confidence: 60 })) });
  }
  if (timeline.length) {
    sections.push({ title: "Timeline & Events", items: timeline.slice(0, 6).map((t: any) => ({ label: t.date, value: t.event, sourceUrl: t.source || null, confidence: 70 })) });
  }
  if (whyNow.length) {
    sections.push({ title: "Signals", items: whyNow.slice(0, 3).map((w: any) => ({ label: w.event, value: `${w.evidence} — ${w.whyItMatters}`, sourceUrl: w.source || null, confidence: 70 })) });
  }
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
  // Also include free HTML fallbacks as additional sources (zero cost)
  const [ddgHtml, allorig] = await Promise.allSettled([fetchDuckDuckGoHtml(query), fetchViaAllOrigins(query)]);
  const ddgHtmlRes = ddgHtml.status === "fulfilled" ? (ddgHtml.value as any[]) : [];
  const allorigRes = allorig.status === "fulfilled" ? (allorig.value as any[]) : [];
  const freeResults = [...ddgHtmlRes, ...allorigRes].map((r: any) => ({ ...r, tier: tierForUrl(r.url, 3), relevance: 40 }));
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
  const webResults = (scrapedData.web || []).slice(0, 6).map((r: any, i: number) => `${i + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet} [Tier ${r.tier || 3}]`).join("\n\n");
  const deepContent = (scrapedData.deepPages || []).slice(0, 4).map((d: any, i: number) => `Deep Page ${i + 1} (${d.url}):\n${d.content?.slice(0, 1200)}`).join("\n\n");
  const contactsText = (scrapedData.contacts || []).map((c: any) => `${c.type}: ${c.value} (confidence ${c.confidence}%)`).join("\n") || "No contacts scraped";
  const enrich = scrapedData.enrichment ? `\n\nEnrichment:\n- Explorium: ${JSON.stringify(scrapedData.enrichment.explorium)?.slice(0, 600) || "none"}\n- Tinyfish: ${scrapedData.enrichment.tinyfish?.slice(0, 600) || "none"}\n- PublicAPIs: ${scrapedData.enrichment.publicApis?.slice(0, 400) || "none"}` : "";
  const factsText = (scrapedData.facts || []).slice(0, 8).map((f: any, i: number) => `${i + 1}. CLAIM: ${f.claim}\n   EVIDENCE: ${f.evidence.slice(0, 120)}\n   SOURCE: ${f.sourceTitle} (${f.sourceUrl}) [Tier ${f.tier}, confidence ${(f.confidence * 100).toFixed(0)}%]`).join("\n\n") || "No structured facts";
  const whyNowText = (scrapedData.whyNow || []).map((w: any) => `- ${w.event} (${w.date}) - ${w.whyItMatters} [${w.source}]`).join("\n") || "No why-now signals";
  const timelineText = (scrapedData.timeline || []).map((t: any) => `${t.date}: ${t.event}`).join("\n") || "No timeline";

  const lineageNote = (() => {
    const comp = scrapedData.web?.find((w: any) => resolveCompanyLineage(w.title + " " + w.snippet))?.title || candidate?.company || "";
    const resolved = resolveCompanyLineage(comp);
    return resolved ? `Company lineage note: ${comp} is now ${resolved}. Treat old and new names as same entity (e.g., PreludeSys/DemandBlue -> LevelShift). Explicitly call out the rename in Company section.` : "";
  })();

  const prompt = `You are a prospect intelligence analyst doing an AGGRESSIVE, HOLISTIC deep dive - get EVERYTHING you can find about this person, not just professional. Analyze "${query}".

FRESH WEB SEARCH (ranked, ${scrapedData.web?.length || 0} results, diverse org branches including events/timeline):
${webResults || "No web results"}

DEEP PAGE CONTENT (5 diverse pages):
${deepContent || "No deep pages"}

STRUCTURED FACTS (extracted, deduplicated, with evidence and tier):
${factsText}

WHY NOW SIGNALS (recent events that make prospect relevant now):
${whyNowText}

TIMELINE (temporal):
${timelineText}

SCRAPED CONTACTS + SOCIAL HANDLES (strict, with confidence):
${contactsText}
${lineageNote}
${enrich}

AGGRESSIVE HOLISTIC RULES:
- GET EVERYTHING: Professional history (every org/branch, including old names before rename), personal interests, education, volunteer/community, writing/books/speaking, social handles, location, events/timeline where person was speaker/participant, awards. Do NOT limit to LinkedIn.
- BRANCHING: You MUST synthesize ALL branches found across diverse domains, not just single link's company. List all involvements in Career - deduplicate but keep distinct orgs. If old company renamed, note "Formerly X, now LevelShift (unified 2025)".
- COMPANY RENAME: Explicitly note rename in Company section.
- EVENTS & TIMELINE: Use Timeline above to build chronological career + event timeline. Include specific event names, dates, roles. Prioritize 30/90/180d recent signals.
- SOCIAL HANDLES: Tag every scraped social URL under contacts with type and confidence. Do NOT invent.
- CONTACTS: use ONLY scraped contacts above. Set person.email/phone/linkedin accordingly. If none, set null. Show confidence% in Contact section.
- STRATEGIC INSIGHTS: Must clearly explain WHO this person is (role, company, professional focus, seniority, decision authority) and WHAT WOULD INTEREST HIM (based on his interests, role, company priorities, tech stack, events, personal motivations). Insights must be specific and evidence-backed, not generic.
- HOLISTIC: Extract personal/outside-professional info if present (interests, volunteer, education, writing). If none, state "No public personal information found".
- EVIDENCE: Every important claim must be grounded in a Fact (see structured FACTS above) with source, tier, confidence. Do NOT invent facts. Distinguish FACT vs INFERENCE vs HYPOTHESIS (label as Verified Fact / Strong Signal / Likely Implication / Research Hypothesis).
- GROUND in web + deep + facts + contacts above.
- confidenceScore: 85-95 strong public figure, 60-84 moderate, 30-50 weak, 5-15 only if ZERO results.
- Deduplicate: Career/Role items distinct. Avoid vague one-liners. Use Timeline for temporal reasoning.

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
If ZERO results, set title "Unknown - no public data found" and confidence 8. Otherwise curate aggressively and holistically. Every important item should have sourceUrl and confidence where possible.

Sections: Summary, Contact, Career, Role, Company, Activity, Leadership, Interests, Tech, Priorities, Signals, Challenges, Stakeholders, Relationships, Opportunities, Openers, Questions, Strategy, Risks, Confidence, Personal Background, Timeline & Events.`;

  const { result, provider } = await aiRegistry.generateJSON(prompt, { temperature: 0.2, maxTokens: 3000 });
  console.log(`[SearchHandler] AI done via ${provider}`);

  // Ensure whyNow and timeline are present
  const res = result as { whyNow?: any[]; timeline: any[] } & Record<string, any>;
  if (res && typeof res === 'object') {
    if (!res.whyNow || !Array.isArray(res.whyNow) || res.whyNow.length === 0) {
      res.whyNow = [];
      console.log("[SearchHandler] AI result missing whyNow, defaulting to empty array");
    }
    if (!res.timeline || !Array.isArray(res.timeline) || res.timeline.length === 0) {
      res.timeline = [];
      console.log("[SearchHandler] AI result missing timeline, defaulting to empty array");
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
    return {
      id, query, timestamp,
      person: { ...(aiAnalysis.person || { name: query, title: "Unknown - no public data found", company: "Unknown", linkedin: scrapedData.linkedin?.url || "", location: "Unknown" }), email: aiAnalysis.person?.email || contacts.find((c: any) => c.type === "email")?.value || null, phone: aiAnalysis.person?.phone || contacts.find((c: any) => c.type === "phone")?.value || null, linkedin: aiAnalysis.person?.linkedin || scrapedData.linkedin?.url || "" },
      contacts,
      company: aiAnalysis.company || { name: "Unknown", industry: "Unknown", size: "Unknown", revenue: null, founded: null, headquarters: "Unknown", website: "", description: "No verifiable public information found." },
      sections,
      aiInsights: aiAnalysis.aiInsights || [],
      confidenceScore: aiAnalysis.confidenceScore ?? 8,
      researchQuality: aiAnalysis.researchQuality || (scrapedData as any).quality || 0,
      citations: aiAnalysis.citations || (scrapedData as any).facts?.slice(0, 8) || [],
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
  return {
    id, query, timestamp,
    person: { name: query.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), title: "", company: "", linkedin: scrapedData.linkedin?.url || "", location: "" },
    company: { name: "", industry: "", size: "", revenue: "", founded: "", headquarters: "", website: "", description: "" },
    sections: [{ title: "Web Results", icon: "Globe", items: web.slice(0, 5).map((r: any) => ({ label: r.title?.slice(0, 50) || "Result", value: `${r.snippet?.slice(0, 150) || ""} | ${r.url || ""}` })) }],
    aiInsights: [hasAiKey ? `AI key set (${process.env.GROQ_API_KEY ? "GROQ" : "GEMINI"}) but analysis failed` : "No AI keys", aiError ? `Error: ${aiError}` : "Check logs", `Crawled ${web.length} web results.`],
    confidenceScore: web.length ? 30 : 10,
    savedToPipeline: false,
    _sources: web.slice(0, 5),
  };
}
