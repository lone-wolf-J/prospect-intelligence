import { SearchProvider, getSearchProviders, SearchResult, tierForUrl } from "./search-providers.js";
import { isUrlAllowed } from "../../api/_security.js";

// Identity resolution
export interface Identity {
  rawQuery: string;
  name: string;
  company?: string;
  title?: string;
  location?: string;
  linkedinUrl?: string;
  emailDomain?: string;
  confidence: { name: number; company: number; title: number; location: number; profileUrl: number; overall: "HIGH" | "MEDIUM" | "LOW" };
}

export function resolveIdentity(query: string, candidate: any = null): Identity {
  const raw = query.trim();
  let name = raw;
  let company: string | undefined;
  let linkedinUrl: string | undefined;
  let emailDomain: string | undefined;

  // Detect LinkedIn URL
  const linkedinMatch = raw.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\s"']+/i);
  if (linkedinMatch) {
    linkedinUrl = linkedinMatch[0];
    name = raw.replace(linkedinMatch[0], "").trim() || candidate?.name || "";
  }
  // Detect email
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch) {
    emailDomain = emailMatch[1];
    name = name.replace(emailMatch[0], "").trim();
  }
  // Use candidate fields if provided
  if (candidate) {
    if (candidate.name) name = candidate.name;
    if (candidate.company) company = candidate.company;
    if (candidate.title) company = company || candidate.title;
    if (candidate.location) company = company || candidate.location;
    if (candidate.url && candidate.url.includes("linkedin.com")) linkedinUrl = candidate.url;
    if (candidate.linkedin) linkedinUrl = candidate.linkedin;
  }
  // Heuristic: "John Smith Acme" -> last word(s) as company if query has 3+ words
  const parts = name.split(/\s+/);
  if (!company && parts.length >= 3) {
    // Assume last part is company if we have no candidate
    // e.g., "John Smith Acme" -> name "John Smith", company "Acme"
    // This is weak, so low confidence
  }

  // Company/title/location from candidate or raw
  if (!company && candidate?.company) company = candidate.company;
  const title = candidate?.title;
  const location = candidate?.location;

  const nameConf = name.split(/\s+/).length >= 2 ? 95 : 60;
  const companyConf = company ? 100 : 30;
  const titleConf = title ? 92 : 30;
  const locConf = location ? 85 : 30;
  const profileConf = linkedinUrl ? 100 : 30;
  const overall = (nameConf >= 80 && companyConf >= 80) ? "HIGH" : (nameConf >= 60 ? "MEDIUM" : "LOW");

  return {
    rawQuery: raw,
    name: name.trim().split(" ").slice(0, 4).join(" ") || raw.split(" ").slice(0, 2).join(" "),
    company, title, location, linkedinUrl, emailDomain,
    confidence: { name: nameConf, company: companyConf, title: titleConf, location: locConf, profileUrl: profileConf, overall }
  };
}

// Query expansion matrix
export function expandQueries(identity: Identity): string[] {
  const n = identity.name;
  const c = identity.company || "";
  const t = identity.title || "";
  const queries: string[] = [];

  // Person identity
  if (c) queries.push(`"${n}" "${c}"`);
  else queries.push(`"${n}"`);

  // Professional
  if (c) {
    queries.push(`"${n}" ${c} CEO`, `"${n}" ${c} executive`, `"${n}" ${c} leadership`, `"${n}" ${c} biography`);
  }

  // Career
  queries.push(`"${n}" previous company`, `"${n}" former`, `"${n}" career`);

  // Public writing
  queries.push(`"${n}" interview`, `"${n}" podcast`, `"${n}" article`, `"${n}" keynote`, `"${n}" conference`);

  // Professional activity
  queries.push(`"${n}" announcement`, `"${n}" partnership`, `"${n}" acquisition`, `"${n}" launch`);

  // Company context
  if (c) {
    queries.push(`${c} recent news`, `${c} funding`, `${c} leadership`, `${c} hiring`, `${c} product launch`);
  }

  // Social
  queries.push(`"${n}" LinkedIn`, `"${n}" GitHub`);

  // Deduplicate and limit to 18
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of queries) {
    if (!q.trim() || seen.has(q)) continue;
    seen.add(q);
    deduped.push(q);
  }
  return deduped.slice(0, 18);
}

// Source quality ranking
export function rankSources(results: SearchResult[], identity: Identity): SearchResult[] {
  return results.map(r => {
    let score = 0;
    // 30% identity match
    const titleLower = r.title.toLowerCase();
    const snippetLower = r.snippet.toLowerCase();
    const nameLower = identity.name.toLowerCase();
    const companyLower = (identity.company || "").toLowerCase();
    let identityScore = 0;
    if (titleLower.includes(nameLower)) identityScore = 100;
    else if (snippetLower.includes(nameLower)) identityScore = 70;
    else identityScore = 20;
    if (companyLower && (titleLower.includes(companyLower) || snippetLower.includes(companyLower))) identityScore += 10;
    score += identityScore * 0.3;

    // 20% source quality (tier 1 = 100, tier 4 = 25)
    const tierScore = r.tier === 1 ? 100 : r.tier === 2 ? 75 : r.tier === 3 ? 50 : 25;
    score += tierScore * 0.2;

    // 15% recency (if date available, recent = higher)
    let recencyScore = 50;
    if (r.publishedAt) {
      const days = (Date.now() - new Date(r.publishedAt).getTime()) / (86400000);
      if (days < 30) recencyScore = 100;
      else if (days < 90) recencyScore = 80;
      else if (days < 180) recencyScore = 60;
      else if (days < 365) recencyScore = 40;
      else recencyScore = 20;
    }
    score += recencyScore * 0.15;

    // 15% directness (company site or LinkedIn = direct)
    let directScore = r.url.includes("linkedin.com/in/") || (identity.company && r.url.includes(identity.company.toLowerCase().replace(/\s+/g, ""))) ? 100 : 50;
    score += directScore * 0.15;

    // 10% corroboration (will be updated after dedup, placeholder 50)
    score += 50 * 0.1;

    // 10% role relevance (if title/company match)
    let roleScore = 50;
    if (identity.title && snippetLower.includes(identity.title.toLowerCase())) roleScore = 100;
    score += roleScore * 0.1;

    return { ...r, relevance: Math.round(score) };
  }).sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
}

// Fact extraction
export interface Fact {
  claim: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  tier: number;
  publishedAt?: string;
  evidence: string;
  confidence: number;
  discoveredAt: string;
}

export function extractFacts(results: SearchResult[]): Fact[] {
  const facts: Fact[] = [];
  for (const r of results.slice(0, 20)) {
    // Each result becomes 1-2 facts
    if (r.snippet) {
      facts.push({
        claim: r.title,
        sourceTitle: r.title,
        sourceUrl: r.url,
        sourceType: r.source,
        tier: r.tier || 3,
        publishedAt: r.publishedAt,
        evidence: r.snippet.slice(0, 300),
        confidence: r.tier === 1 ? 0.97 : r.tier === 2 ? 0.85 : 0.6,
        discoveredAt: new Date().toISOString(),
      });
    }
  }
  return facts;
}

// Deduplication: same claim from multiple sources -> one event
export function deduplicateFacts(facts: Fact[]): Fact[] {
  const seen = new Map<string, Fact>();
  for (const f of facts) {
    const key = f.claim.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (!seen.has(key)) {
      seen.set(key, f);
    } else {
      // Merge: keep higher tier, add source count (for confidence)
      const existing = seen.get(key)!;
      if (f.tier < existing.tier) seen.set(key, f);
      // Could add corroboration count
    }
  }
  return Array.from(seen.values());
}

// Signal detection: why now
export function detectWhyNow(facts: Fact[]): { event: string; date?: string; evidence: string; source: string; whyItMatters: string }[] {
  const signals: any[] = [];
  const keywords = ["appointed", "joined", "funding", "acquisition", "launch", "expansion", "hiring", "AI initiative", "partnership", "restructuring"];
  for (const f of facts) {
    const lower = (f.claim + " " + f.evidence).toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        signals.push({
          event: f.claim,
          date: f.publishedAt || "2026",
          evidence: f.evidence.slice(0, 150),
          source: f.sourceUrl,
          whyItMatters: `Recent ${kw} may indicate relevance for outreach.`,
        });
        break;
      }
    }
    if (signals.length >= 3) break;
  }
  return signals;
}

// Temporal analysis: timeline
export function buildTimeline(facts: Fact[]): { date: string; event: string; source: string }[] {
  return facts
    .filter(f => f.publishedAt)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())
    .slice(0, 8)
    .map(f => ({ date: f.publishedAt!, event: f.claim, source: f.sourceUrl }));
}

// Research quality score
export function calculateQuality(identity: Identity, facts: Fact[], sources: SearchResult[]): number {
  const identityConf = identity.confidence.overall === "HIGH" ? 100 : identity.confidence.overall === "MEDIUM" ? 70 : 40;
  const tierAvg = sources.length ? sources.reduce((a, s) => a + (s.tier === 1 ? 100 : s.tier === 2 ? 75 : 50), 0) / sources.length : 0;
  const evidenceDensity = Math.min(100, facts.length * 5);
  const recency = facts.filter(f => f.publishedAt && (Date.now() - new Date(f.publishedAt).getTime()) < 90 * 86400000).length * 10;
  const coverage = Math.min(100, sources.length * 5);
  const corroboration = 50; // placeholder
  return Math.round((identityConf * 0.2 + tierAvg * 0.2 + evidenceDensity * 0.2 + recency * 0.15 + coverage * 0.15 + corroboration * 0.1));
}
