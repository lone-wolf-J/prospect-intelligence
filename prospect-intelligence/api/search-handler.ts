import { aiRegistry } from "../server/lib/ai-registry.js";
import * as cheerio from "cheerio";
import { isUrlAllowed, sanitizeForPrompt, validateQuery } from "./_security.js";

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
  // Input validation at handler level (defense in depth)
  query = validateQuery(query);
  const normalized = (candidate ? `${query}::${candidate.company || ""}::${candidate.location || ""}` : query).toLowerCase().trim();
  const cached = cache.get(normalized);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log("[Cache] HIT for", query);
    return { ...cached.data, _cached: true };
  }
  console.log("[SearchHandler] Starting crawl for:", query, candidate ? `with candidate ${candidate.name}` : "");
  const crawlResults = await crawlEverywhere(query, candidate);
  console.log("[SearchHandler] Crawl done. web:", (crawlResults.web as any[])?.length, "deep:", crawlResults.deepPages?.length);

  let aiAnalysis: any = null;
  let aiError: string | null = null;
  const hasAiKey = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.TINYFISH_API_KEY);
  if (hasAiKey) {
    try {
      aiAnalysis = await analyzeWithAI(query, crawlResults, candidate);
      console.log("[SearchHandler] AI done");
    } catch (e: any) {
      aiError = e?.message || String(e);
      console.error("[SearchHandler] AI error:", aiError);
      if (process.env.TINYFISH_API_KEY && aiError && aiError.includes("Groq")) {
        try {
          console.log("[Fallback] Trying Tinyfish LLM...");
          aiAnalysis = await analyzeWithTinyfish(query, crawlResults);
        } catch (e2: any) { console.log("[Fallback] Tinyfish also failed", (e2 as any).message); }
      }
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

async function crawlEverywhere(query: string, candidate: any = null) {
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

  // Tier 1 execution: AGGRESSIVE holistic - every branch, every org, every social, personal footprint
  let serperResults: any[] = [];
  if (candidate && candidate.name) {
    const baseQueries = [query];
    if (candidate.company) baseQueries.push(`${candidate.name} ${candidate.company}`.trim());
    const lineage = candidate.company ? resolveCompanyLineage(candidate.company) : null;
    if (lineage && !candidate.company.toLowerCase().includes("levelshift")) {
      baseQueries.push(`${candidate.name} LevelShift`);
      baseQueries.push(`${candidate.company} renamed LevelShift`);
    }
    // Aggressive holistic: personal + social + contact + events branching
    baseQueries.push(`${candidate.name} bio personal interests volunteer education family`);
    baseQueries.push(`${candidate.name} twitter github instagram facebook linkedin social media`);
    baseQueries.push(`${candidate.name} email contact phone`);
    baseQueries.push(`${candidate.name} event conference speaker timeline history career`);
    baseQueries.push(`${candidate.name} award recognition speaking engagement`);
    const queries = baseQueries.filter((q, i, arr) => q && arr.indexOf(q) === i).slice(0, 6);
    console.log("[Crawl] Aggressive holistic queries:", queries);
    const serperSets = await Promise.all(queries.map(q => withRetry(() => fetchSerper(q), "serper-tier", 1).catch(() => [] as any[])));
    serperResults = ([] as any[]).concat(...serperSets);
    const seenQ = new Set<string>();
    serperResults = serperResults.filter((r: any) => { if (!r.url || seenQ.has(r.url)) return false; seenQ.add(r.url); return true; });
    console.log("[Crawl] Serper aggressive", serperResults.length, "from", queries.length, "queries");
  } else {
    const queries = [query, `${query} bio personal interests volunteer`, `${query} twitter github linkedin`, `${query} email contact`, `${query} event conference speaker timeline`].filter((q, i, arr) => q && arr.indexOf(q) === i).slice(0, 4);
    const sets = await Promise.all(queries.map(q => withRetry(() => fetchSerper(q), "serper-tier", 1).catch(() => [] as any[])));
    serperResults = ([] as any[]).concat(...sets);
    const seenQ = new Set<string>();
    serperResults = serperResults.filter((r: any) => { if (!r.url || seenQ.has(r.url)) return false; seenQ.add(r.url); return true; });
    console.log("[Crawl] Serper holistic aggressive", serperResults.length);
  }
  let tavilyResults: any[] = []; let braveResults: any[] = []; let serpApiResults: any[] = []; let bingApiResults: any[] = []; let wikiResults: any[] = [];
  if (serperResults.length < 3) {
    console.log("[Crawl] Serper low, trying Tavily + Brave + SerpApi in parallel (HTTPX async)...");
    const settled = await Promise.allSettled([fetchTavily(query), fetchBrave(query), fetchSerpApi(query), fetchBingApi(query), fetchWikipedia(query), fetchDuckDuckGoJsonApi(query)]);
    tavilyResults = settled[0].status === "fulfilled" ? (settled[0].value as any[]) : [];
    braveResults = settled[1].status === "fulfilled" ? (settled[1].value as any[]) : [];
    serpApiResults = settled[2].status === "fulfilled" ? (settled[2].value as any[]) : [];
    bingApiResults = settled[3].status === "fulfilled" ? (settled[3].value as any[]) : [];
    wikiResults = settled[4].status === "fulfilled" ? (settled[4].value as any[]) : [];
    const ddgJson = settled[5].status === "fulfilled" ? (settled[5].value as any[]) : [];
    tavilyResults = [...tavilyResults, ...ddgJson];
  } else {
    console.log("[Crawl] Serper sufficient, skipping paid fallbacks to save quota");
    wikiResults = await fetchWikipedia(query);
  }

  // Always try free HTML fallbacks with concurrency (per Core Tools: HTTPX supports sync/async + concurrency)
  const [ddgHtml, allorig] = await Promise.allSettled([fetchDuckDuckGoHtml(query), fetchViaAllOrigins(query)]);
  const ddgHtmlRes = ddgHtml.status === "fulfilled" ? (ddgHtml.value as any[]) : [];
  const allorigRes = allorig.status === "fulfilled" ? (allorig.value as any[]) : [];

  const mergedSearch = [...serperResults, ...tavilyResults, ...braveResults, ...serpApiResults, ...bingApiResults, ...wikiResults, ...ddgHtmlRes, ...allorigRes];
  const seen = new Set(); const web = mergedSearch.filter((r: any) => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 12);
  console.log("[Crawl] Tier1 total", web.length, "sources:", [...new Set(web.map((w: any) => w.source))].join(","));

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

  // Combine Tools: browser to get HTML, then parse with cheerio/BeautifulSoup for easier extraction
  for (let i = 0; i < topUrls.length; i++) {
    const url = topUrls[i];
    let content: string | null = null;
    const choice = (hash + i) % 5;
    if (choice === 0) content = await deepScrapeFirecrawl(url) || await deepScrapeScrapeDo(url) || await deepScrapeJina(url);
    else if (choice === 1) content = await deepScrapeScrapeDo(url) || await deepScrapeFirecrawl(url) || await deepScrapeJina(url);
    else if (choice === 2) content = await deepScrapeScrapingBee(url) || await deepScrapeJina(url);
    else if (choice === 3) content = await deepScrapeZenRows(url) || await deepScrapeJina(url);
    else content = await deepScrapeJina(url) || await deepScrapeScrapeDo(url) || await deepScrapeFirecrawl(url);
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

  const webSnippets = web.map((w: any) => w.snippet).join(" ").slice(0, 1500);
  const [explorium, tinyfish, publicApis, publicRepo] = await Promise.allSettled([fetchExplorium(query), fetchTinyfishEnrich(query, webSnippets), fetchPublicApis(), fetchPublicApisRepo(query)]);
  const enrichVals = {
    explorium: explorium.status === "fulfilled" ? explorium.value : null,
    tinyfish: tinyfish.status === "fulfilled" ? tinyfish.value : null,
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
  const webResults = (scrapedData.web || []).slice(0, 8).map((r: any, i: number) => `${i + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`).join("\n\n");
  const deepContent = (scrapedData.deepPages || []).map((d: any, i: number) => `Deep Page ${i + 1} (${d.url}):\n${d.content?.slice(0, 1500)}`).join("\n\n");
  const contactsText = (scrapedData.contacts || []).map((c: any) => `${c.type}: ${c.value} (confidence ${c.confidence}%)`).join("\n") || "No contacts scraped";
  const enrich = scrapedData.enrichment ? `\n\nEnrichment:\n- Explorium: ${JSON.stringify(scrapedData.enrichment.explorium)?.slice(0, 600) || "none"}\n- Tinyfish: ${scrapedData.enrichment.tinyfish?.slice(0, 600) || "none"}\n- PublicAPIs: ${scrapedData.enrichment.publicApis?.slice(0, 400) || "none"}` : "";

  const lineageNote = (() => {
    const comp = scrapedData.web?.find((w: any) => resolveCompanyLineage(w.title + " " + w.snippet))?.title || candidate?.company || "";
    const resolved = resolveCompanyLineage(comp);
    return resolved ? `Company lineage note: ${comp} is now ${resolved}. Treat old and new names as same entity (e.g., PreludeSys/DemandBlue -> LevelShift). Explicitly call out the rename in Company section.` : "";
  })();

  const prompt = `You are a prospect intelligence analyst doing an AGGRESSIVE, HOLISTIC deep dive - get EVERYTHING you can find about this person, not just professional. Analyze "${query}".

FRESH WEB SEARCH (PRIMARY - ${scrapedData.web?.length || 0} results, diverse org branches including events/timeline):
${webResults || "No web results"}

DEEP PAGE CONTENT (aggressive - 5 diverse pages including LinkedIn, company, personal, social, events):
${deepContent || "No deep pages"}

SCRAPED CONTACTS + SOCIAL HANDLES (strict, with confidence - tag ALL social under contacts, do NOT hallucinate beyond this):
${contactsText}
${lineageNote}
${enrich}

AGGRESSIVE HOLISTIC RULES:
- GET EVERYTHING: Professional history (every org/branch, including old names before rename), personal interests, education, volunteer/community, writing/books/speaking, social handles (tag every Twitter/GitHub/Instagram/Facebook/Medium/YouTube under contacts), location, events/timeline where person was speaker/participant, awards, etc. Do NOT limit to LinkedIn/company page.
- BRANCHING: Person may have multiple org involvements (e.g., PreludeSys/DemandBlue -> LevelShift). You MUST synthesize ALL branches found across diverse domains, not just the single chosen link's company. List all involvements in Career - deduplicate but keep distinct orgs. If old company renamed, note it.
- COMPANY RENAME: If you see old company (PreludeSys/DemandBlue/DemandDynamics) and LevelShift, explicitly note "Formerly X, now LevelShift (unified 2025)" in Company section.
- EVENTS & TIMELINE: Scrape as many events as possible where person was potential participant/speaker, past events attended, and build a timeline of career/events. Include specific event names, dates, roles.
- SOCIAL HANDLES: Tag every scraped social URL under contacts with type (linkedin/twitter/github/instagram/facebook/medium/youtube) and confidence as given. Do NOT invent handles.
- CONTACTS: use ONLY scraped contacts above. Set person.email to highest-confidence email, linkedin to LinkedIn URL, phone only if scraped with confidence 70 and near contact keyword. If no email/phone scraped, set null - do not invent. Show confidence% for each contact in Contact section. If no contacts, state "No public email/phone found".
- STRATEGIC INSIGHTS: Must clearly explain WHO this person is (role, company, professional focus, level of seniority) and WHAT WOULD INTEREST HIM (based on his interests, role, company priorities, tech stack, events, personal motivations). Insights must be specific, not generic like "AI transformation is tied to security".
- HOLISTIC, BEYOND PROFESSIONAL: Extract personal/outside-professional info if present in deep pages (interests, volunteer, education, writing like books, community, family if public). If none found, state "No public personal information found" - do not invent.
- GROUND in web + deep content + contacts above. Do NOT say "no data" when results exist.
- confidenceScore: 85-95 strong public figure, 60-84 moderate (2-5 hits), 30-50 weak, 5-15 only if ZERO results.
- Deduplicate: Career/Role items must be distinct, not reworded duplicates. Each section item must add new info. Avoid one-line vague sections.

Return ONLY valid JSON:
{
  "person": {"name": "string", "title": "string", "company": "string", "location": "string", "email": "string|null", "linkedin": "string|null", "phone": "string|null"},
  "contacts": [{"type": "string", "value": "string", "confidence": number}],
  "company": {"name": "string", "industry": "string", "size": "string", "revenue": "string|null", "founded": "string|null", "headquarters": "string", "website": "string", "description": "string"},
  "sections": [{"title": "string", "items": [{"label": "string", "value": "string"}]}],
  "aiInsights": ["string", "string", "string"],
  "confidenceScore": number
}
If ZERO results, set title "Unknown - no public data found" and confidence 8. Otherwise curate aggressively and holistically.

Sections: Summary, Contact, Career, Role, Company, Activity, Leadership, Interests, Tech, Priorities, Signals, Challenges, Stakeholders, Relationships, Opportunities, Openers, Questions, Strategy, Risks, Confidence, Personal Background, Timeline & Events.`;

  const { result, provider } = await aiRegistry.generateJSON(prompt, { temperature: 0.2, maxTokens: 3500 });
  console.log(`[SearchHandler] AI done via ${provider}`);
  return result;
}

function buildCase(query: string, scrapedData: any, aiAnalysis: any, hasAiKey: boolean, aiError: string | null) {
  const id = Date.now().toString();
  const timestamp = new Date().toISOString();
  if (aiAnalysis) {
    const contacts = aiAnalysis.contacts || scrapedData.contacts || [];
    // Ensure contact section exists if we have contacts
    let sections = aiAnalysis.sections || [];
    if (contacts.length > 0 && !sections.find((s: any) => s.title === "Contact")) {
      sections = [
        { title: "Contact", items: contacts.map((c: any) => ({ label: `${c.type} (${c.confidence}%)`, value: c.value })) },
        ...sections
      ];
    }
    return {
      id, query, timestamp,
      person: { ...(aiAnalysis.person || { name: query, title: "Unknown - no public data found", company: "Unknown", linkedin: scrapedData.linkedin?.url || "", location: "Unknown" }), email: aiAnalysis.person?.email || contacts.find((c: any) => c.type === "email")?.value || null, phone: aiAnalysis.person?.phone || contacts.find((c: any) => c.type === "phone")?.value || null, linkedin: aiAnalysis.person?.linkedin || scrapedData.linkedin?.url || "" },
      contacts,
      company: aiAnalysis.company || { name: "Unknown", industry: "Unknown", size: "Unknown", revenue: null, founded: null, headquarters: "Unknown", website: "", description: "No verifiable public information found." },
      sections,
      aiInsights: aiAnalysis.aiInsights || [],
      confidenceScore: aiAnalysis.confidenceScore ?? 8,
      savedToPipeline: false,
      _sources: (scrapedData.web || []).slice(0, 5),
      _deepPages: scrapedData.deepPages || [],
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
