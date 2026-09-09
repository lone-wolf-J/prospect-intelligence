import { isUrlAllowed } from "../../api/_security.js";

// SearchProvider abstraction — allows primary/secondary/fallback per requirement 25
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
  tier?: number; // 1-4 quality
  publishedAt?: string;
  relevance?: number;
}

export interface SearchProvider {
  name: string;
  tier: number; // default tier for this provider's results
  search(query: string, opts?: { num?: number }): Promise<SearchResult[]>;
  isAvailable(): boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); })]).finally(() => clearTimeout(t));
}

// Helper to assign tier by domain
export function tierForUrl(url: string, defaultTier: number = 3): number {
  const u = url.toLowerCase();
  if (u.includes("linkedin.com/in/") || u.includes("levelshift.com") || u.includes("preludesys.com") || u.includes("demandblue.com") || u.includes(".gov") || u.includes("sec.gov")) return 1;
  if (u.includes("wikipedia.org") || u.includes("reuters.com") || u.includes("bloomberg.com") || u.includes("forbes.com") || u.includes("techcrunch.com") || u.includes("theverge.com") || u.includes("wsj.com") || u.includes("nytimes.com")) return 1;
  if (u.includes("youtube.com") || u.includes("podcasts.apple.com") || u.includes("spotify.com") || u.includes("conference") || u.includes("ted.com")) return 2;
  if (u.includes("theorg.com") || u.includes("crunchbase.com") || u.includes("glassdoor.com") || u.includes("pitchbook.com")) return 3;
  if (u.includes("content.farm") || u.includes("scraped") ) return 4;
  return defaultTier;
}

// Serper (Google) - Tier 1-2, primary
export class SerperProvider implements SearchProvider {
  name = "serper"; tier = 2;
  isAvailable() { return !!process.env.SERPER_API_KEY; }
  async search(query: string, opts?: { num?: number }): Promise<SearchResult[]> {
    const key = process.env.SERPER_API_KEY!;
    const res: any = await (await import("node-fetch")).default("https://google.serper.dev/search", {
      method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: opts?.num || 10 })
    });
    const data: any = await res.json();
    return (data.organic || []).slice(0, opts?.num || 10).map((r: any) => ({
      title: r.title, snippet: r.snippet || "", url: r.link, source: "serper", tier: tierForUrl(r.link, 2), publishedAt: r.date || undefined
    }));
  }
}

// Tavily - Tier 2, secondary
export class TavilyProvider implements SearchProvider {
  name = "tavily"; tier = 2;
  isAvailable() { return !!process.env.TAVILY_API_KEY; }
  async search(query: string, opts?: { num?: number }): Promise<SearchResult[]> {
    const key = process.env.TAVILY_API_KEY!;
    const res: any = await (await import("node-fetch")).default("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: opts?.num || 8, search_depth: "basic", include_answer: false })
    });
    const data: any = await res.json();
    return (data.results || []).slice(0, opts?.num || 8).map((r: any) => ({
      title: r.title, snippet: r.content?.slice(0, 300) || "", url: r.url, source: "tavily", tier: tierForUrl(r.url, 2)
    }));
  }
}

// Brave - Tier 2
export class BraveProvider implements SearchProvider {
  name = "brave"; tier = 2;
  isAvailable() { return !!process.env.BRAVE_API_KEY; }
  async search(query: string, opts?: { num?: number }): Promise<SearchResult[]> {
    const key = process.env.BRAVE_API_KEY!;
    const res: any = await (await import("node-fetch")).default(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts?.num || 10}`, {
      headers: { "X-Subscription-Token": key, "Accept": "application/json" }
    });
    const data: any = await res.json();
    return (data.web?.results || []).slice(0, opts?.num || 10).map((r: any) => ({
      title: r.title, snippet: r.description || "", url: r.url, source: "brave", tier: tierForUrl(r.url, 2)
    }));
  }
}

// Wikipedia - Tier 1 for public figures, no key
export class WikipediaProvider implements SearchProvider {
  name = "wikipedia"; tier = 1;
  isAvailable() { return true; }
  async search(query: string): Promise<SearchResult[]> {
    const res: any = await (await import("node-fetch")).default(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`, { headers: { "User-Agent": "ProspectIntel/1.0" } });
    const data: any = await res.json();
    return (data.query?.search || []).slice(0, 3).map((r: any) => ({
      title: r.title, snippet: r.snippet?.replace(/<[^>]+>/g, "").slice(0, 300) || "", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, source: "wikipedia", tier: 1
    }));
  }
}

// AllOrigins + DDG HTML - Tier 3-4, free fallback
export class FreeFallbackProvider implements SearchProvider {
  name = "free-fallback"; tier = 3;
  isAvailable() { return true; }
  async search(query: string): Promise<SearchResult[]> {
    try {
      const target = encodeURIComponent(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
      const res: any = await (await import("node-fetch")).default(`https://api.allorigins.win/get?url=${target}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data: any = await res.json();
      const html = data.contents || "";
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];
      $('a[rel="nofollow"]').each((_: any, el: any) => {
        if (results.length >= 6) return;
        const href = $(el).attr("href") || "";
        let url = href; const m = href.match(/uddg=([^&]+)/); if (m) try { url = decodeURIComponent(m[1]); } catch {}
        if (url.includes("duckduckgo.com")) return;
        if (!isUrlAllowed(url)) return;
        const title = $(el).text().trim();
        if (title) results.push({ title, snippet: "", url, source: "allorigins", tier: tierForUrl(url, 3) });
      });
      return results;
    } catch { return []; }
  }
}

export function getSearchProviders(): SearchProvider[] {
  const all: SearchProvider[] = [
    new SerperProvider(),
    new TavilyProvider(),
    new BraveProvider(),
    new WikipediaProvider(),
    new FreeFallbackProvider(),
  ];
  return all.filter(p => p.isAvailable());
}
