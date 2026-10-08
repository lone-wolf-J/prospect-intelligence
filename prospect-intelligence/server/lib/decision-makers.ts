import * as cheerio from "cheerio";
import { getSearchProviders, SearchResult, tierForUrl } from "./search-providers.js";
import { fetchPages, getScraperCapabilities } from "./scrapers/adapters.js";
import { aiRegistry } from "./ai-registry.js";
import { isUrlAllowed, sanitizeForPrompt } from "../../api/_security.js";

export interface OrgContact {
  type: string;
  value: string;
  confidence: number;
  source: string;
  derived?: boolean;
}

export interface EvidenceItem {
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  tier: number;
}

export interface DecisionMaker {
  name: string;
  title: string;
  seniority: string;
  authority: string;
  bio: string;
  location: string;
  linkedin: string | null;
  contacts: OrgContact[];
  evidence: EvidenceItem[];
  sourceUrls: string[];
  confidence: number;
  score: number;
  authorityScore: number;
  reachScore: number;
  reasoning: string;
}

export interface OrgProfile {
  name: string;
  website: string | null;
  domain: string | null;
  industry: string;
  headquarters: string;
  size: string;
  founded: string;
  description: string;
}

export interface OrgResearchResult {
  type: "organization";
  id: string;
  query: string;
  timestamp: string;
  organization: OrgProfile;
  decisionMakers: DecisionMaker[];
  recommendation: {
    top: DecisionMaker | null;
    ranked: { rank: number; name: string; title: string; score: number; confidence: number; reasoning: string }[];
  };
  confidenceScore: number;
  researchQuality: number;
  aiInsights: string[];
  sections: { title: string; items: { label: string; value: string; sourceUrl?: string | null; confidence?: number }[] }[];
  person: any;
  company: any;
  contacts: OrgContact[];
  citations: EvidenceItem[];
  savedToPipeline: boolean;
  _sources: SearchResult[];
  _debug: Record<string, any>;
}

const ORG_LINEAGE: Record<string, string> = {
  "preludesys": "LevelShift (formerly PreludeSys)",
  "prelude sys": "LevelShift",
  "demandblue": "LevelShift (formerly DemandBlue)",
  "demand blue": "LevelShift",
  "demanddynamics": "LevelShift (formerly DemandDynamics)",
  "demand dynamics": "LevelShift",
  "levelshift": "LevelShift",
};

const KNOWN_ORGS = ["levelshift", "preludesys", "demandblue", "demanddynamics", "microsoft", "google", "amazon", "apple", "openai", "anthropic", "nvidia", "meta", "ibm", "oracle", "salesforce", "adobe", "dell", "cisco", "intel", "tesla", "netflix", "uber", "airbnb", "stripe", "shopify", "databricks", "snowflake", "palantir", "crowdstrike", "cloudflare", "atlassian", "github", "gitlab", "figma", "notion", "slack", "zoom", "hubspot", "zendesk", "servicenow", "workday", "sap", "accenture", "deloitte", "mckinsey", "jpmorgan", "goldman sachs", "morgan stanley", "boeing", "ford", "toyota"];

const ORG_SUFFIX_RE = /\b(incorporated|inc|corp|corporation|llc|ltd|limited|gmbh|plc|pvt|co|company|group|holdings|partners|ventures|capital|technologies|technologies|systems|solutions|labs|studio|studios|agency|consulting|university|college|foundation|institute|bank|fund|enterprises|industries|logistics|healthcare|pharma)\b/i;
const ORG_HINT_RE = /\b(leadership team|executive team|decision makers?|key people|org chart|organization|organisation|company|firm|startup|business|corporate)\b/i;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function looksLikeOrganization(query: string): boolean {
  const q = (query || "").trim();
  if (!q) return false;
  if (/^[a-z0-9-]+(\.(com|io|ai|co|net|org|dev|app|tech|inc|us|uk|in|de|fr))$/i.test(q)) return true;
  if (ORG_HINT_RE.test(q)) return true;
  if (ORG_SUFFIX_RE.test(q)) return true;
  const lower = q.toLowerCase();
  for (const org of KNOWN_ORGS) {
    if (lower === org || lower.includes(org)) return true;
  }
  for (const org of Object.keys(ORG_LINEAGE)) {
    if (lower.includes(org)) return true;
  }
  const words = q.split(/\s+/);
  if (words.length === 1 && !/^(the|and|of)$/i.test(words[0])) return true;
  return false;
}

export function resolveOrgIdentity(query: string): { name: string; domain: string | null; lineage: string | null } {
  let name = query.trim().replace(/\s+/g, " ");
  let domain: string | null = null;
  if (DOMAIN_RE.test(name)) {
    domain = name.replace(/^www\./i, "").toLowerCase();
    name = name.split(".")[0].replace(/[-_]/g, " ");
  }
  name = name.replace(/\b(leadership team|executive team|decision makers?|key people|org chart|company|organization|organisation)\b/gi, "").trim() || query.trim();
  let lineage: string | null = null;
  const lower = name.toLowerCase();
  for (const [oldName, resolved] of Object.entries(ORG_LINEAGE)) {
    if (lower.includes(oldName)) {
      lineage = resolved;
      name = resolved.split(" (")[0];
      break;
    }
  }
  const capped = name.split(" ").map(w => w.length > 2 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
  return { name: capped || query.trim(), domain, lineage };
}

export function expandOrgQueries(org: { name: string; domain: string | null }): string[] {
  const n = `"${org.name}"`;
  return [
    `${n} leadership team executives`,
    `${n} CEO CTO CFO COO founders`,
    `site:linkedin.com/in ${n} CEO OR founder OR "chief"`,
    `site:theorg.com ${n}`,
    `${n} executive team management`,
    `${n} key people board of directors`,
    `${n} leadership press release appointment`,
    `${n} contact email phone address`,
    org.domain ? `${n} site:${org.domain} team` : `${n} about us team`,
  ];
}

// ---------- Title classification ----------

interface TitleRule { pattern: RegExp; score: number; seniority: string; authority: string }

const TITLE_RULES: TitleRule[] = [
  { pattern: /\b(co[\s-]?founder|founder|owner|proprietor)\b/i, score: 100, seniority: "Founder", authority: "Founder / owner - ultimate decision authority" },
  { pattern: /\b(chief executive officer|chief exec|ceo|managing director|chief physician)\b/i, score: 96, seniority: "C-suite (CEO)", authority: "CEO - final budget and strategy authority" },
  { pattern: /\b(chairman|chairwoman|chairperson|president)\b/i, score: 94, seniority: "President / Chair", authority: "President / Chair - top executive authority" },
  { pattern: /\b(chief [a-z]+ officer|c[teofmripgs]o|chief [a-z]+)\b/i, score: 91, seniority: "C-suite", authority: "C-suite - owns a major budget function" },
  { pattern: /\b(executive vice president|evp|senior vice president|svp)\b/i, score: 85, seniority: "SVP / EVP", authority: "Senior executive - large budget influence" },
  { pattern: /\b(vice president|vp of|vp,|vp\b|head of|global head|director|general manager|gm)\b/i, score: 75, seniority: "VP / Director", authority: "VP / Director - departmental budget owner" },
  { pattern: /\b(partner|managing partner|general counsel|counsel)\b/i, score: 70, seniority: "Partner / Legal", authority: "Partner - shared decision authority" },
  { pattern: /\b(manager|team lead|lead)\b/i, score: 55, seniority: "Manager", authority: "Manager - influencer, limited budget authority" },
];

export function classifyTitle(title: string): TitleRule | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(journalist|reporter|analyst|editor|author|writer|blogger|podcast|host|photographer|producer|intern|student|professor|research scientist)\b/.test(t)) return null;
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(t)) return rule;
  }
  return null;
}

const NAME_TOKEN = `[A-Z][A-Za-z'’\\.\\-]{1,20}`;
const NAME_RE = new RegExp(`\\b(${NAME_TOKEN}(?:\\s+(?:${NAME_TOKEN}|de|van|von|da|di|la|der|den)){1,2})\\b`, "g");

function looksLikePersonName(name: string): boolean {
  if (!name || name.length < 4 || name.length > 45) return false;
  let fixed = name.trim();
  if (/\.\s/.test(fixed)) return false;
  const comma = fixed.match(/^([A-Za-z'’\.\-]{2,25}),\s+([A-Z][A-Za-z'’\.\-]{1,20})$/);
  if (comma) fixed = `${comma[2]} ${comma[1]}`;
  const words = fixed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (!/^[A-Z]/.test(fixed)) return false;
  if (/^(vice|senior|chief|executive|head|director|managing|general|deputy|global|regional|former|acting|interim|president|founder|co|partner|manager|team|associate|assistant|principal|officer|financial|marketing|operating|technology|information|people|commercial|strategy|revenue|product|legal|security|medical|engineering|growth|digital|data|analytics|customer|communications|administrative)\b/i.test(fixed)) return false;
  if (/\b(inc|llc|ltd|corp|co|the|and|of|at|for|ceo|usa|uk|llp|accounts|services|solutions|department|division|business)\b/i.test(fixed)) return false;
  if (/\b(company|systems|technologies|solutions|services|group|university|institute|foundation|media|networks|labs|capital|partners)\b/i.test(fixed)) return false;
  if (/^(mr|mrs|ms|dr|sir)\.?\s/i.test(fixed)) return false;
  const capitalized = words.filter(w => /^[A-Z]/.test(w)).length;
  return capitalized >= Math.min(2, words.length);
}

interface PersonHit {
  name: string;
  title: string;
  url: string;
  sourceTitle: string;
  tier: number;
  snippet: string;
}

function normalizePersonName(name: string): string {
  const trimmed = (name || "").trim();
  const comma = trimmed.match(/^([A-Za-z'’\.\-]{2,25}),\s+([A-Z][A-Za-z'’\.\-]{1,20})$/);
  if (comma) return `${comma[2]} ${comma[1]}`;
  return trimmed;
}

function pushHit(hits: PersonHit[], hit: PersonHit) {
  const name = normalizePersonName(hit.name);
  if (!looksLikePersonName(name)) return;
  const rule = classifyTitle(hit.title);
  if (!rule) return;
  hits.push({ ...hit, name });
}

export function extractPeopleFromText(text: string, url: string, sourceTitle: string, tier: number): PersonHit[] {
  const hits: PersonHit[] = [];
  if (!text) return hits;
  const window = (idx: number, len: number) => text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + len)).replace(/\s+/g, " ").trim();

  const sepRe = /(?:^|[\n•|>])\s*([A-Z][A-Za-z'’\.\-]{1,20}(?:\s+[A-Z][A-Za-z'’\.\-]{1,20}){1,2})\s*(?:[—–·|]|\s[-–—]\s|&ndash;|&mdash;)\s*([^|\n>]{3,70})/gm;
  let m: RegExpExecArray | null;
  while ((m = sepRe.exec(text)) !== null) {
    pushHit(hits, { name: m[1].trim(), title: cleanTitle(m[2]), url, sourceTitle, tier, snippet: window(m.index, 160) });
    if (hits.length > 40) break;
  }

  const commaRe = /\b([A-Z][A-Za-z'’\.\-]{1,20}(?:\s+[A-Z][A-Za-z'’\.\-]{1,20}){1,2})\s*,\s*((?:Chief\s+[A-Za-z&\s]{2,30}|Head\s+of\s+[A-Za-z&\s]{2,30}|VP\s+of\s+[A-Za-z&\s]{2,30}|Vice\s+President(?:\s+of\s+[A-Za-z&\s]{2,30})?|Founder|Co-Founder|CEO|CTO|CFO|COO|CMO|CRO|CIO|CPO|CISO|President|Managing Director|General Manager|Partner|Director(?:\s+of\s+[A-Za-z&\s]{2,30})?))/g;
  while ((m = commaRe.exec(text)) !== null) {
    pushHit(hits, { name: m[1].trim(), title: cleanTitle(m[2]), url, sourceTitle, tier, snippet: window(m.index, 160) });
    if (hits.length > 60) break;
  }

  const parenRe = /\b([A-Z][A-Za-z'’\.\-]{1,20}(?:\s+[A-Z][A-Za-z'’\.\-]{1,20}){1,2})\s*\(([^)]{2,50})\)/g;
  while ((m = parenRe.exec(text)) !== null) {
    pushHit(hits, { name: m[1].trim(), title: cleanTitle(m[2]), url, sourceTitle, tier, snippet: window(m.index, 160) });
    if (hits.length > 80) break;
  }

  const verbRe = /\b([A-Z][A-Za-z'’\.\-]{1,20}(?:\s+[A-Z][A-Za-z'’\.\-]{1,20}){1,2})\s+(?:is|serves as|was named|was appointed as|is currently)\s+(?:the\s+)?(Chief\s+[A-Za-z&\s]{2,30}|Head\s+of\s+[A-Za-z&\s]{2,30}|CEO|CTO|CFO|COO|CMO|CRO|CIO|CPO|Founder|Co-Founder|President)\b/gi;
  while ((m = verbRe.exec(text)) !== null) {
    pushHit(hits, { name: m[1].trim(), title: cleanTitle(m[2]), url, sourceTitle, tier, snippet: window(m.index, 160) });
    if (hits.length > 100) break;
  }

  const titleOfRe = /\b(Chief\s+[A-Za-z&\s]{2,30}|CEO|CTO|CFO|COO|CMO|CRO|CIO|CPO|Founder|Co-Founder|President|Managing Director)\s+(?:of|at|for)\s+[A-Z][A-Za-z0-9&\.\s]{2,40}/g;
  while ((m = titleOfRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 140), m.index);
    const names = [...before.matchAll(NAME_RE)];
    if (names.length) {
      const cand = names[names.length - 1][1].trim();
      pushHit(hits, { name: cand, title: cleanTitle(m[1]), url, sourceTitle, tier, snippet: window(m.index, 160) });
    }
    if (hits.length > 120) break;
  }

  return hits;
}

function cleanTitle(raw: string): string {
  let t = (raw || "").replace(/\s+/g, " ");
  const dot = t.indexOf(". ");
  if (dot > 8) t = t.slice(0, dot);
  return t
    .replace(/^[\s,;:|•\-–—]+|[\s,;:|•\-–—]+$/g, "")
    .replace(/\s*\|\s*LinkedIn.*$/i, "")
    .slice(0, 70)
    .trim();
}

// ---------- Wikipedia (free, tier-1) ----------

function stripWiki(value: string): string {
  if (!value) return "";
  return value
    .replace(/\{\{\s*Start date(?:\s*and\s*age)?\|(\d{4})(?:\|\d{1,2})?(?:\|\d{1,2})?[^}]*\}\}/gi, "$1")
    .replace(/\{\{(?:URL|cite[^}]*|nowrap)[^}]*\}\}/gi, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+in$/, "")
    .trim();
}

function parseInfobox(wikitext: string): Record<string, string> {
  const start = wikitext.search(/\{\{\s*Infobox/i);
  if (start < 0) return {};
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{") { depth++; i++; }
    else if (two === "}}") { depth--; i++; if (depth === 0) { end = i + 1; break; } }
  }
  const body = wikitext.slice(start, end > 0 ? end : Math.min(wikitext.length, start + 8000));
  const parts: string[] = [];
  let cur = "";
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{" && body[i + 1] === "{") { d++; cur += "{{"; i++; continue; }
    if (ch === "}" && body[i + 1] === "}") { d--; cur += "}}"; i++; continue; }
    if (ch === "|" && d <= 1) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const fields: Record<string, string> = {};
  for (const p of parts) {
    const m = p.match(/^\s*([a-z0-9_ \-]+)\s*=\s*([\s\S]*)$/i);
    if (m) fields[m[1].trim().toLowerCase().replace(/[ \-]/g, "_")] = m[2].trim();
  }
  return fields;
}

function parseKeyPeople(value: string): { name: string; title: string }[] {
  const out: { name: string; title: string }[] = [];
  if (!value) return out;
  const chunks = value.split(/,(?![^\(]*\))/);
  for (const chunkRaw of chunks.slice(0, 25)) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;
    const link = chunk.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    let name = "";
    if (link) name = (link[2] || link[1]).trim();
    else {
      const plain = chunk.match(/^\s*([A-Z][A-Za-z'’\.\-]{1,20}(?:\s+[A-Z][A-Za-z'’\.\-]{1,20}){0,2})/);
      if (plain) name = plain[1].trim();
    }
    const titleMatch = chunk.match(/\(([^)]{2,50})\)/);
    const title = titleMatch ? cleanTitle(titleMatch[1]) : "";
    if (name && looksLikePersonName(name)) out.push({ name, title });
  }
  return out;
}

function introDescription(extract: string, max = 500): string {
  const para = (extract.split(/\n\n+/)[0] || "").replace(/\s+/g, " ").trim();
  if (para.length <= max) return para;
  const cut = para.slice(0, max);
  const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastDot > 120) return cut.slice(0, lastDot + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 150 ? `${cut.slice(0, lastSpace).trim()}…` : cut.trim());
}

function normalizeFounded(v: string): string {
  const s = (v || "").replace(/\s+/g, " ").trim();
  const m = s.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  if (!m) return s.slice(0, 60);
  if (/^\d{4}\b/.test(s) && s.length <= 6) return s;
  return /^(\d{4})\s+in\b/i.test(s) ? m[1] : s.slice(0, 60);
}

async function fetchWikipediaProfile(orgName: string): Promise<{
  profile: Partial<OrgProfile>;
  keyPeople: { name: string; title: string }[];
  pageUrl: string | null;
} | null> {
  try {
    const nf = (await import("node-fetch")).default;
    const fetchJson = async (url: string) => {
      const res: any = await nf(url, { headers: { "User-Agent": "ProspectIntel/1.0" } } as any);
      return await res.json();
    };
    const searchData: any = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`"${orgName}"`)}&format=json&srlimit=4&origin=*`);
    const candidates: string[] = (searchData?.query?.search || []).map((s: any) => s.title);
    if (!candidates.length) {
      console.log("[Org] Wikipedia: no exact-phrase page for", orgName);
      return null;
    }
    const orgLower = orgName.toLowerCase();
    for (const candidate of candidates.slice(0, 3)) {
      const pageData: any = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts|revisions&exintro=1&explaintext=1&rvprop=content&rvslots=main&titles=${encodeURIComponent(candidate)}&format=json&origin=*`);
      const page: any = Object.values(pageData?.query?.pages || {})[0];
      if (!page) continue;
      const wikitext: string = page.revisions?.[0]?.slots?.main?.["*"] || "";
      const extract: string = page.extract || "";
      const titleNorm = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
      const orgNorm = orgLower.replace(/[^a-z0-9]/g, "");
      const valid = extract.toLowerCase().includes(orgLower) || titleNorm === orgNorm || (orgNorm.length >= 6 && orgNorm.includes(titleNorm));
      if (!valid) {
        console.log("[Org] Wikipedia: reject page", candidate, "for", orgName);
        continue;
      }
      const info = parseInfobox(wikitext);
      const websiteRaw = info.website || info.url || "";
      let website: string | null = null;
      const siteLink = websiteRaw.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/) || websiteRaw.match(/https?:\/\/[^\s|}\]]+/) || websiteRaw.match(/\{\{URL\|([^}|]+)\}\}/i);
      if (siteLink) website = (siteLink[1] || siteLink[0]).replace(/^https?:\/\//, "").replace(/\/$/, "");
      const keyPeople = parseKeyPeople(info.key_people || info.keypeople || info.management || info.leadership || "");
      return {
        profile: {
          description: introDescription(extract),
          industry: stripWiki(info.industry || info.industry_type || "").slice(0, 120),
          headquarters: stripWiki(info.headquarters || info.location || info.hq_location || "").slice(0, 120),
          founded: stripWiki(info.founded || info.foundation || "").slice(0, 60),
          size: stripWiki(info.num_employees || info.employee_count || info.people || "").slice(0, 60),
          website,
        },
        keyPeople,
        pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(candidate.replace(/ /g, "_"))}`,
      };
    }
    return null;
  } catch (e: any) {
    console.log("[Org] Wikipedia failed:", e?.message || e);
    return null;
  }
}

// ---------- Contacts ----------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d{1,2}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g;
const SKIPPED_EMAIL = /(example\.com|test@|noreply|no-reply|donotreply|@sentry|@w3\.org|@schema\.org|@google|@facebook|@twitter|@github|@reactjs|localhost)/i;

function extractContactsForPerson(name: string, pages: { url: string; content: string }[], searchResults: SearchResult[], orgDomain: string | null, allCompanyEmails: string[]): OrgContact[] {
  const contacts: OrgContact[] = [];
  const seen = new Set<string>();
  const lowerName = name.toLowerCase();
  const parts = lowerName.split(/\s+/);
  const matchesName = (t: string) => t.includes(lowerName) || (parts.length >= 2 && t.includes(`${parts[0]} ${parts[parts.length - 1]}`));

  for (const page of pages) {
    const text = page.content || "";
    const lower = text.toLowerCase();
    let idx = lower.indexOf(lowerName);
    if (idx < 0 && parts.length >= 2) idx = lower.indexOf(`${parts[0]} ${parts[parts.length - 1]}`);
    if (idx < 0) continue;
    const windows: string[] = [];
    let scanFrom = 0;
    let guard = 0;
    while (idx >= 0 && guard < 6) {
      windows.push(text.slice(Math.max(0, idx - 220), Math.min(text.length, idx + 220)));
      scanFrom = idx + lowerName.length;
      idx = lower.indexOf(lowerName, scanFrom);
      guard++;
    }
    for (const w of windows) {
      const emails = w.match(EMAIL_RE) || [];
      for (const e of emails.slice(0, 2)) {
        const v = e.toLowerCase();
        if (seen.has(v) || SKIPPED_EMAIL.test(v)) continue;
        seen.add(v);
        const near = w.toLowerCase().includes(lowerName) || w.toLowerCase().includes(parts[0]);
        contacts.push({ type: "email", value: v, confidence: near ? 88 : 70, source: page.url });
      }
      const phones = w.match(PHONE_RE) || [];
      for (const p of phones.slice(0, 1)) {
        const v = p.trim();
        if (seen.has(v) || v.replace(/\D/g, "").length < 10) continue;
        seen.add(v);
        contacts.push({ type: "phone", value: v, confidence: 68, source: page.url });
      }
    }
  }

  for (const r of searchResults) {
    if (!r.url || !r.url.includes("linkedin.com/in/")) continue;
    const hay = `${r.title} ${r.snippet}`.toLowerCase();
    if (matchesName(hay) && !seen.has(r.url)) {
      seen.add(r.url);
      contacts.push({ type: "linkedin", value: r.url, confidence: 92, source: r.url });
    }
  }
  const twitterRe = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{3,30}\b/gi;
  const junkHandle = /^(share|intent|search|hashtag|hashtag|i|home|explore|notifications|messages|settings|login|signup|about|download)$/i;
  for (const page of pages) {
    const lower = (page.content || "").toLowerCase();
    let at = lower.indexOf(lowerName);
    if (at < 0 && parts.length >= 2) at = lower.indexOf(`${parts[0]} ${parts[parts.length - 1]}`);
    if (at < 0) continue;
    const win = (page.content || "").slice(Math.max(0, at - 300), Math.min((page.content || "").length, at + 300));
    const tw = win.match(twitterRe) || [];
    for (const t of tw.slice(0, 1)) {
      const handle = (t.split("/").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (junkHandle.test(handle) || seen.has(t)) continue;
      const nameTokens = parts.map(p => p.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(p => p.length >= 3);
      if (!nameTokens.some(tk => handle.includes(tk))) continue;
      seen.add(t);
      contacts.push({ type: "twitter", value: t, confidence: 78, source: page.url });
    }
  }

  const derived = deriveEmailFromPattern(name, orgDomain, allCompanyEmails);
  if (derived && !seen.has(derived.value)) contacts.push(derived);
  return contacts;
}

function deriveEmailFromPattern(name: string, orgDomain: string | null, observedEmails: string[]): OrgContact | null {
  if (!orgDomain || !observedEmails.length) return null;
  const onDomain = observedEmails.filter(e => e.endsWith(`@${orgDomain}`));
  if (!onDomain.length) return null;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].toLowerCase().replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!first || !last) return null;
  const patterns: { re: RegExp; build: () => string }[] = [
    { re: new RegExp(`^${first[0]}${last}@`), build: () => `${first[0]}${last}@${orgDomain}` },
    { re: new RegExp(`^${first}\\.${last}@`), build: () => `${first}.${last}@${orgDomain}` },
    { re: new RegExp(`^${first}${last[0]}@`), build: () => `${first}${last[0]}@${orgDomain}` },
    { re: new RegExp(`^${first[0]}\\.${last}@`), build: () => `${first[0]}.${last}@${orgDomain}` },
    { re: new RegExp(`^${first}_${last}@`), build: () => `${first}_${last}@${orgDomain}` },
  ];
  for (const p of patterns) {
    if (onDomain.some(e => p.re.test(e))) {
      return { type: "email", value: p.build(), confidence: 55, source: "derived from published company email pattern", derived: true };
    }
  }
  return null;
}

function collectCompanyEmails(pages: { url: string; content: string }[], orgDomain: string | null): string[] {
  const out = new Set<string>();
  for (const p of pages) {
    const matches = (p.content || "").match(EMAIL_RE) || [];
    for (const e of matches) {
      const v = e.toLowerCase();
      if (SKIPPED_EMAIL.test(v)) continue;
      if (!orgDomain || v.endsWith(`@${orgDomain}`)) out.add(v);
    }
  }
  return [...out].slice(0, 30);
}

// ---------- Scoring ----------

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scoreDecisionMaker(dm: DecisionMaker, orgSizeKnown: boolean): void {
  const sourceCount = dm.sourceUrls.length;
  const evidenceScore = clamp(Math.min(100, sourceCount * 30) + (dm.linkedin ? 15 : 0));
  const reachParts = [
    dm.linkedin ? 40 : 0,
    dm.contacts.some(c => c.type === "email" && !c.derived) ? 35 : 0,
    dm.contacts.some(c => c.type === "email" && c.derived) ? 15 : 0,
    dm.contacts.some(c => c.type === "phone") ? 15 : 0,
    dm.contacts.some(c => c.type === "twitter") ? 10 : 0,
  ];
  dm.reachScore = clamp(reachParts.reduce((a, b) => a + b, 0));
  dm.authorityScore = clamp(classifyTitle(dm.title)?.score || 50);
  dm.confidence = clamp(evidenceScore * 0.5 + dm.authorityScore * 0.3 + dm.reachScore * 0.2);

  let score = dm.authorityScore * 0.45 + dm.reachScore * 0.35 + dm.confidence * 0.2;
  const t = dm.title.toLowerCase();
  if (/\b(sales|revenue|commercial|marketing|growth|partnership|business development|chief revenue|cro|cmo)\b/.test(t)) score += 8;
  else if (/\b(operations|product|strategy|general management|president)\b/.test(t)) score += 5;
  else if (/\b(engineering|technology|information|data|security|research)\b/.test(t)) score += 2;
  if (/\b(founder|ceo|chief executive)\b/.test(t) && !orgSizeKnown) score += 6;
  if (/\b(manager|analyst|assistant|intern)\b/.test(t)) score -= 15;
  dm.score = clamp(score);
}

function buildReasoning(dm: DecisionMaker, orgName: string, rank: number): string {
  const rule = classifyTitle(dm.title);
  const domains = [...new Set(dm.sourceUrls.map(u => {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
  }))];
  const corroboration = domains.length
    ? `Corroborated by ${dm.sourceUrls.length} source${dm.sourceUrls.length === 1 ? "" : "s"} (${domains.slice(0, 4).join(", ")})`
    : "Single-source mention";
  const hasDirect = dm.contacts.some(c => c.type === "email" && !c.derived) || dm.linkedin;
  const direct = dm.linkedin && dm.contacts.some(c => c.type === "email")
    ? "Direct contact available: LinkedIn + email"
    : dm.linkedin
      ? "LinkedIn profile verified - best outreach path"
      : dm.contacts.length
        ? `Contact found: ${dm.contacts.map(c => c.type).join(", ")}`
        : "No direct contact found yet - use company channels";
  const role = rule ? rule.authority : "Executive-level authority";
  const placement = rank === 1
    ? "Top pick: strongest balance of decision authority and verified reachability."
    : `Ranked #${rank} - ${dm.score >= 65 ? "strong alternative with good reachability" : dm.score >= 45 ? "useful secondary contact" : "lower-priority contact"}.`;
  return `${dm.title} at ${orgName} - ${role}. ${corroboration}. ${direct}. ${placement}`;
}

function rankDecisionMakers(dms: DecisionMaker[]): DecisionMaker[] {
  return [...dms].sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}

// ---------- AI refinement ----------

async function refineWithAI(orgName: string, dms: DecisionMaker[]): Promise<{ decisionMakers: DecisionMaker[]; insights: string[] } | null> {
  if (!dms.length) return null;
  const hasKey = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
  if (!hasKey) return null;
  const lines = dms.slice(0, 10).map((dm, i) => {
    const contacts = dm.contacts.map(c => `${c.type}=${c.value}${c.derived ? "(derived)" : ""}`).join(", ") || "none";
    const ev = dm.evidence.slice(0, 2).map(e => sanitizeForPrompt(e.claim)).join(" | ") || "n/a";
    return `${i + 1}. ${dm.name} — ${dm.title} | confidence ${dm.confidence} | sources ${dm.sourceUrls.length} | contacts: ${contacts} | evidence: ${ev}`;
  }).join("\n");

  const prompt = `You are a B2B prospect researcher. Organization: "${orgName}".
Candidate decision-makers found on the open web (LinkedIn, company pages, directories, news):
${lines}

Rules:
- Drop false positives: people who do NOT work at ${orgName}, journalists/analysts, generic org names, hobby clubs.
- Keep only real decision-makers (founder, C-suite, president, VP, director, head of function).
- Fix titles (e.g. "Chief Executive Officer (CEO)" -> "CEO").
- bio: ONE factual sentence max, only from the evidence given. No invented facts.
- score 0-100 = best person to reach for general B2B outreach, balancing budget authority AND reachability (contacts found).
- reasoning: ONE specific sentence citing corroboration/contacts. No fluff.
- best: the single top pick with reasoning.

Return ONLY JSON:
{"decisionMakers":[{"name":"...","title":"...","bio":"...","confidence":0,"score":0,"reasoning":"..."}],"best":{"name":"...","score":0,"reasoning":"..."},"insights":["...","...","..."]}`;

  try {
    const { result } = await aiRegistry.generateJSON<any>(prompt, { temperature: 0.2, maxTokens: 3000 });
    if (!result || !Array.isArray(result.decisionMakers)) return null;
    const byName = new Map<string, any>();
    for (const r of result.decisionMakers) {
      if (r && typeof r.name === "string") byName.set(r.name.toLowerCase().replace(/[^a-z]/g, ""), r);
    }
    const merged = dms.map(dm => {
      const r = byName.get(dm.name.toLowerCase().replace(/[^a-z]/g, ""));
      if (!r) return dm;
      return {
        ...dm,
        title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 70) : dm.title,
        bio: typeof r.bio === "string" ? r.bio.slice(0, 300) : dm.bio,
        confidence: typeof r.confidence === "number" ? clamp(r.confidence) : dm.confidence,
        score: typeof r.score === "number" ? clamp(r.score) : dm.score,
        reasoning: typeof r.reasoning === "string" && r.reasoning.trim().length >= 80 ? r.reasoning.trim().slice(0, 400) : dm.reasoning,
      };
    });
    const insights = Array.isArray(result.insights) ? result.insights.filter((x: any) => typeof x === "string").slice(0, 3).map((s: string) => s.slice(0, 300)) : [];
    return { decisionMakers: merged, insights };
  } catch (e: any) {
    console.log("[Org] AI refinement failed:", e?.message || e);
    return null;
  }
}

// ---------- Main research flow ----------

const cache = new Map<string, { data: OrgResearchResult; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

export async function researchDecisionMakers(query: string): Promise<OrgResearchResult> {
  const started = Date.now();
  const cacheKey = `org:${query.toLowerCase().trim()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return { ...hit.data };

  const identity = resolveOrgIdentity(query);
  console.log("[Org] Identity:", identity.name, identity.domain || "", identity.lineage || "");
  const providers = getSearchProviders();
  const queries = expandOrgQueries(identity).slice(0, 6);
  console.log("[Org] Queries:", queries.length);

  const searchResults: SearchResult[] = [];
  const seenUrls = new Set<string>();
  for (const q of queries) {
    let got = 0;
    for (const p of providers) {
      try {
        const res = await p.search(q, { num: 5 });
        if (res.length) {
          for (const r of res) {
            if (!r.url || seenUrls.has(r.url) || !isUrlAllowed(r.url)) continue;
            seenUrls.add(r.url);
            searchResults.push({ ...r, tier: r.tier || tierForUrl(r.url, p.tier) });
          }
          got += res.length;
          if (got >= 3) break;
        }
      } catch { /* provider failed, next */ }
    }
    await new Promise(r => setTimeout(r, 80));
  }
  console.log("[Org] Search results:", searchResults.length);

  const wiki = await fetchWikipediaProfile(identity.name);
  const earlyDomain = identity.domain || (wiki?.profile?.website ? wiki.profile.website.replace(/^www\./, "") : null) || deriveDomain(searchResults, identity.name);

  const leadershipUrlRe = /(leadership|executive|management|team|people|founders|about|company|org-chart|board|contact)/i;
  const deepUrls: string[] = [];
  const consider = (u?: string | null) => {
    if (!u || deepUrls.length >= 5 || !isUrlAllowed(u)) return;
    if (deepUrls.includes(u)) return;
    deepUrls.push(u);
  };
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return ""; } };
  const orgWordEarly = identity.name.toLowerCase().split(" ")[0];
  const orgDomainHits: string[] = [];
  const dirHits: string[] = [];
  const pushUnique = (arr: string[], u: string) => { if (isUrlAllowed(u) && !arr.includes(u)) arr.push(u); };
  for (const r of searchResults) {
    const host = hostOf(r.url);
    const path = pathOf(r.url);
    const isOrgDomain = earlyDomain ? host === earlyDomain || host.endsWith(`.${earlyDomain}`) : false;
    const isDirectory = /theorg\.com|crunchbase\.com|peopleai\.com|rocketreach\.co|owler\.com/.test(host);
    const isWikiPerson = r.url.includes("wikipedia.org/wiki/") && !decodeURIComponent(path.replace("/wiki/", "")).toLowerCase().includes(orgWordEarly);
    if (isWikiPerson || r.url.includes("linkedin.com")) continue;
    if (isOrgDomain && (leadershipUrlRe.test(path) || leadershipUrlRe.test(r.title))) pushUnique(orgDomainHits, r.url);
    else if (isDirectory) pushUnique(dirHits, r.url);
    else if (!r.url.includes("wikipedia.org/wiki/") && `${r.title} ${r.snippet}`.toLowerCase().includes(orgWordEarly)) pushUnique(orgDomainHits, r.url);
  }
  for (let i = 0; i < Math.max(orgDomainHits.length, dirHits.length); i++) {
    if (deepUrls.length >= 5) break;
    consider(orgDomainHits[i]);
    consider(dirHits[i]);
  }
  if (earlyDomain && deepUrls.length < 3) {
    for (const p of ["/leadership", "/about"]) {
      if (deepUrls.length >= 4) break;
      consider(`https://www.${earlyDomain}${p}`);
    }
  }
  console.log("[Org] Deep pages queued:", deepUrls.length, "domain:", earlyDomain || "none");

  const pages = await fetchPages(deepUrls, { concurrency: 4, timeoutMs: 7000 });
  console.log("[Org] Pages fetched:", pages.length, pages.map(p => p.adapter).join(","));

  const orgDomain = identity.domain || (wiki?.profile?.website ? wiki.profile.website.replace(/^www\./, "") : null) || earlyDomain || deriveDomain(searchResults, identity.name);
  const textCorpus = [...pages, ...searchResults.map(r => ({ url: r.url, content: `${r.title}\n${r.snippet}` }))];
  const allCompanyEmails = collectCompanyEmails(textCorpus, orgDomain);

  const hits: PersonHit[] = [];
  const orgWord = identity.name.toLowerCase().split(" ")[0];
  for (const r of searchResults) {
    const text = `${r.title}\n${r.snippet}`;
    if (text.toLowerCase().includes(orgWord)) {
      hits.push(...extractPeopleFromText(text, r.url, r.title, r.tier || 3));
    }
    const lowerHay = `${r.title} ${r.snippet}`.toLowerCase();
    if (r.url.includes("linkedin.com/in/") && lowerHay.includes(orgWord)) {
      const nameFromTitle = normalizePersonName((r.title.split(/[-–—|]/)[0] || "").replace(/\s*\|?\s*LinkedIn.*$/i, "").trim());
      const titleFromTitle = (r.title.split(/[-–—|]/)[1] || r.snippet.split(/[·|]/)[0] || "").trim();
      if (nameFromTitle && classifyTitle(titleFromTitle)) {
        pushHit(hits, { name: nameFromTitle, title: cleanTitle(titleFromTitle), url: r.url, sourceTitle: r.title, tier: r.tier || 2, snippet: r.snippet });
      }
    }
  }
  for (const page of pages) {
    if (!(page.content || "").toLowerCase().includes(orgWord)) {
      console.log("[Org] Skip page (no org mention):", page.url.slice(0, 70));
      continue;
    }
    hits.push(...extractPeopleFromText(page.content, page.url, page.url, 2));
  }
  if (wiki) {
    for (const kp of wiki.keyPeople) {
      pushHit(hits, { name: kp.name, title: kp.title || "Executive", url: wiki.pageUrl || "https://en.wikipedia.org", sourceTitle: "Wikipedia - Key people", tier: 1, snippet: `${kp.name} listed under key people of ${identity.name}` });
    }
  }
  console.log("[Org] Raw person hits:", hits.length);

  const grouped = new Map<string, DecisionMaker>();
  for (const h of hits) {
    const key = h.name.toLowerCase().replace(/[^a-z]/g, "");
    if (!key || key.length < 4) continue;
    const existing = grouped.get(key);
    const rule = classifyTitle(h.title);
    if (!rule) continue;
    const evidence: EvidenceItem = { claim: h.snippet || h.title, sourceUrl: h.url, sourceTitle: h.sourceTitle, tier: h.tier };
    if (!existing) {
      grouped.set(key, {
        name: h.name.trim(),
        title: h.title.trim(),
        seniority: rule.seniority,
        authority: rule.authority,
        bio: "",
        location: "",
        linkedin: h.url.includes("linkedin.com/in/") ? h.url : null,
        contacts: [],
        evidence: [evidence],
        sourceUrls: [h.url],
        confidence: 0,
        score: 0,
        authorityScore: 0,
        reachScore: 0,
        reasoning: "",
      });
    } else {
      if (rule.score > (classifyTitle(existing.title)?.score || 0)) {
        existing.title = h.title.trim();
        existing.seniority = rule.seniority;
        existing.authority = rule.authority;
      }
      if (!existing.sourceUrls.includes(h.url)) existing.sourceUrls.push(h.url);
      if (!existing.linkedin && h.url.includes("linkedin.com/in/")) existing.linkedin = h.url;
      if (existing.evidence.length < 4 && (evidence.claim || "").length > 20) existing.evidence.push(evidence);
    }
  }

  let dms = [...grouped.values()];
  dms = dms.filter(dm => {
    const n = dm.name.toLowerCase();
    if (n.includes(orgWord) || orgWord.includes(n) || (identity.name.toLowerCase().includes(n) && n.length < 12)) return false;
    const rule = classifyTitle(dm.title);
    if (!rule) return false;
    const corroborated = dm.sourceUrls.length > 1 || dm.sourceUrls.some(u => u.includes("linkedin.com/in/")) || rule.score >= 90;
    if (!corroborated) return false;
    if (/\b(journalist|reporter|editor|professor|student|analyst)\b/.test(dm.title.toLowerCase())) return false;
    const mentionsOrg = dm.evidence.some(e => ((e.claim || "") + " " + (e.sourceTitle || "")).toLowerCase().includes(orgWord))
      || dm.sourceUrls.some(u => (identity.domain ? u.includes(identity.domain) : false) || u.includes(orgWord.replace(/\s+/g, "")));
    return mentionsOrg;
  });
  dms = dms.slice(0, 14);

  for (const dm of dms) {
    dm.contacts = extractContactsForPerson(dm.name, textCorpus, searchResults, orgDomain, allCompanyEmails);
    const li = dm.contacts.find(c => c.type === "linkedin");
    if (!dm.linkedin && li) dm.linkedin = li.value;
    dm.evidence = dm.evidence.filter(e => e.claim && e.claim.length > 3).slice(0, 4);
  }

  const sizeKnown = !!(wiki?.profile?.size);
  for (const dm of dms) scoreDecisionMaker(dm, sizeKnown);
  dms = rankDecisionMakers(dms);
  dms.forEach((dm, i) => { dm.reasoning = buildReasoning(dm, identity.name, i + 1); });
  dms = dms.slice(0, 10);

  let insights: string[] = [];
  const refined = await refineWithAI(identity.name, dms);
  if (refined) {
    dms = rankDecisionMakers(refined.decisionMakers);
    dms.forEach((dm, i) => { if (!dm.reasoning) dm.reasoning = buildReasoning(dm, identity.name, i + 1); });
    insights = refined.insights;
    console.log("[Org] AI refined", dms.length);
  }

  const fieldIndustry = fieldFromCorpus(pages, /(?:Industry|Sector)\s*:\s*([^\n|]{4,70})/i);
  const fieldSize = fieldFromCorpus(pages, /\b(\d[\d,]{1,9}\s*(?:[-–]\s*\d+)?\s*(?:employees|staff members))\b/i);
  const fieldHQ = fieldFromCorpus(pages, /(?:Headquarters|Headquartered|Location)\s*[:\-–]\s*([^\n|]{3,70})/) || fieldFromCorpus(pages, /Based in\s+([^\n|]{3,70})/i);
  const shortDescription = pickDescription(wiki?.profile?.description || "", searchResults);
  const industryFromDesc = shortDescription.match(/\b(?:is|are)\s+an?\s+([a-z][\w\s&\-]{3,50}?(?:company|firm|provider|partner|studio|agency|vendor|consultancy))\b/i)?.[1] || "";
  const hqFromResults = pickFromResults(searchResults, /headquarter(?:ed)? in|based in|located in/i);
  const hqFallback = looksLikePlace(hqFromResults) ? hqFromResults : "";

  const org: OrgProfile = {
    name: identity.name,
    website: wiki?.profile?.website || (orgDomain ? `https://${orgDomain}` : null),
    domain: orgDomain,
    industry: wiki?.profile?.industry || fieldIndustry || titleCase(industryFromDesc),
    headquarters: hqFromText(wiki?.profile?.description || "") || wiki?.profile?.headquarters || fieldHQ || hqFallback || "",
    size: wiki?.profile?.size || fieldSize || "",
    founded: normalizeFounded(wiki?.profile?.founded || ""),
    description: shortDescription,
  };

  const top = dms[0] || null;
  const avgConf = dms.length ? dms.reduce((a, d) => a + d.confidence, 0) / dms.length : 0;
  const confidenceScore = dms.length ? clamp(avgConf * 0.6 + Math.min(100, searchResults.length * 6) * 0.4) : 25;
  const researchQuality = clamp(Math.min(100, pages.length * 12 + searchResults.length * 2) * 0.5 + avgConf * 0.5);

  if (!insights.length) {
    insights = [
      top ? `Best contact: ${top.name}, ${top.title} — score ${top.score}/100. ${top.reasoning}` : "No verified decision-makers found in public sources.",
      `${dms.length} decision-maker${dms.length === 1 ? "" : "s"} identified across ${new Set(dms.flatMap(d => d.sourceUrls)).size} unique sources.`,
      org.size || org.industry ? `Org profile: ${[org.industry, org.size, org.headquarters].filter(Boolean).join(" · ")}.` : "Limited public org profile data - results ranked by source corroboration.",
    ];
  }

  const sections = buildSections(org, dms, top, searchResults);
  const result: OrgResearchResult = {
    type: "organization",
    id: Date.now().toString(),
    query,
    timestamp: new Date().toISOString(),
    organization: org,
    decisionMakers: dms,
    recommendation: {
      top,
      ranked: dms.map((dm, i) => ({ rank: i + 1, name: dm.name, title: dm.title, score: dm.score, confidence: dm.confidence, reasoning: dm.reasoning })),
    },
    confidenceScore,
    researchQuality,
    aiInsights: insights,
    sections,
    person: top
      ? { name: top.name, title: top.title, company: org.name, linkedin: top.linkedin || "", location: org.headquarters, email: top.contacts.find(c => c.type === "email")?.value || null, phone: top.contacts.find(c => c.type === "phone")?.value || null }
      : { name: org.name, title: "Organization", company: org.name, linkedin: "", location: org.headquarters, email: null, phone: null },
    company: { name: org.name, industry: org.industry, size: org.size, revenue: null, founded: org.founded, headquarters: org.headquarters, website: org.website || "", description: org.description },
    contacts: top?.contacts || [],
    citations: dms.flatMap(d => d.evidence).slice(0, 10),
    savedToPipeline: false,
    _sources: searchResults.slice(0, 8),
    _debug: {
      queries,
      searchResults: searchResults.length,
      deepPages: pages.length,
      adapters: pages.map(p => p.adapter),
      scrapers: getScraperCapabilities(),
      rawHits: hits.length,
      durationMs: Date.now() - started,
      aiUsed: !!refined,
    },
  };

  if (confidenceScore > 25) {
    cache.set(cacheKey, { data: result, ts: Date.now() });
    if (cache.size > 100) {
      const first = cache.keys().next().value as string;
      cache.delete(first);
    }
  }
  console.log(`[Org] Done: ${dms.length} decision makers, confidence ${confidenceScore}, ${Date.now() - started}ms`);
  return result;
}

function deriveDomain(results: SearchResult[], orgName: string): string | null {
  const firstWord = orgName.toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "");
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (host.includes(firstWord) && !/linkedin|wikipedia|facebook|twitter|instagram|crunchbase|glassdoor|bloomberg|reuters/.test(host)) return host;
    } catch { /* skip */ }
  }
  return null;
}

function fieldFromCorpus(corpus: { content: string }[], re: RegExp): string {
  for (const p of corpus) {
    const m = (p.content || "").match(re);
    if (m) {
      const v = (m[1] || m[0]).replace(/\s+/g, " ").replace(/^[:\-–\s]+/, "").trim().slice(0, 80);
      if (v.length > 3 && v.length <= 80 && !/[)(\[\]{}\\<>|]|undefined|\{\{|\[\[/.test(v) && /\b[A-Z][a-z]+/.test(v)) return v;
    }
  }
  return "";
}

function pickDescription(wikiDesc: string, results: SearchResult[]): string {
  const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
  if (wikiDesc) {
    const s = clean(wikiDesc);
    if (s.length <= 450) return s;
    const cut = s.slice(0, 450);
    const d = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (d > 120) return cut.slice(0, d + 1);
    const sp = cut.lastIndexOf(" ");
    return sp > 150 ? `${cut.slice(0, sp).trim()}…` : cut.trim();
  }
  const looksNav = /Teams;|Leadership Team\.|person ·|jobs \.\.\.|\d+ open roles|\bUnverified\b/i;
  const isProse = (s: string) =>
    (s || "").length >= 80 &&
    !looksNav.test(s) &&
    /\b(is a|is an|is the|was founded|provides|offers|delivers|specializes|focuses)\b/i.test(s);
  const prose = results.filter(r => isProse(r.snippet));
  const best = prose.find(r => /\.com|\.co|\.io|\.ai|\.org/.test(r.url)) || prose[0];
  if (best) return clean(best.snippet).slice(0, 450);
  const first = results[0]?.snippet || "";
  return clean(first).slice(0, 400);
}

function looksLikePlace(v: string): boolean {
  return !!v && v.length >= 4 && v.length <= 70 && /\b[A-Z][a-z]+/.test(v) && !/[)(\[\]{}\\<>|]/.test(v) && v.split(" ").length <= 9;
}

function titleCase(v: string): string {
  return v.replace(/\b[a-z]/g, c => c.toUpperCase()).trim().slice(0, 80);
}

function hqFromText(text: string): string {
  const m = (text || "").match(/headquartered in ([^.,;]{3,60}(?:,\s*[A-Z][a-z]+)?)/i);
  return m ? m[1].trim() : "";
}

function pickFromResults(results: SearchResult[], re: RegExp): string {
  for (const r of results) {
    const m = `${r.title} ${r.snippet}`.match(re);
    if (m) {
      const idx = `${r.title} ${r.snippet}`.search(re);
      const text = `${r.title} ${r.snippet}`.slice(idx, idx + 90).replace(/\s+/g, " ").trim();
      if (text.length > 12) return text;
    }
  }
  return "";
}

function buildSections(org: OrgProfile, dms: DecisionMaker[], top: DecisionMaker | null, results: SearchResult[]) {
  const sections: any[] = [];
  sections.push({
    title: "Organization Overview",
    items: [
      org.description && { label: "About", value: org.description, sourceUrl: org.website, confidence: 75 },
      org.industry && { label: "Industry", value: org.industry, confidence: 70 },
      org.headquarters && { label: "Headquarters", value: org.headquarters, confidence: 70 },
      org.size && { label: "Size", value: org.size, confidence: 65 },
      org.founded && { label: "Founded", value: org.founded, confidence: 65 },
      org.website && { label: "Website", value: org.website, sourceUrl: org.website, confidence: 80 },
    ].filter(Boolean),
  });
  if (top) {
    sections.push({
      title: "Best Person To Reach",
      items: [
        { label: `${top.name} — ${top.title}`, value: top.reasoning, sourceUrl: top.sourceUrls[0] || null, confidence: top.confidence },
        { label: "Decision score", value: `${top.score}/100 (authority ${top.authorityScore}/100 · reachability ${top.reachScore}/100)`, confidence: top.confidence },
        ...(top.contacts.length ? [{ label: "Contact", value: top.contacts.map(c => `${c.type}: ${c.value} (${c.confidence}%)${c.derived ? " [derived]" : ""}`).join("\n"), confidence: top.reachScore }] : []),
      ],
    });
  }
  sections.push({
    title: "Key Decision Makers",
    items: dms.map((dm, i) => ({
      label: `#${i + 1} ${dm.name} — ${dm.title}`,
      value: [dm.reasoning, dm.bio, dm.contacts.map(c => `${c.type}: ${c.value}`).join(" · ")].filter(Boolean).join("\n"),
      sourceUrl: dm.sourceUrls[0] || null,
      confidence: dm.confidence,
    })),
  });
  if (results.length) {
    sections.push({
      title: "Sources",
      items: results.slice(0, 8).map(r => ({ label: r.title?.slice(0, 70) || r.url, value: r.snippet?.slice(0, 200) || r.url, sourceUrl: r.url, confidence: (r.tier || 3) === 1 ? 90 : 70 })),
    });
  }
  return sections;
}
