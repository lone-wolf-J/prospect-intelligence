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
  relevance: number;
  department: string;
  departmentLabel: string;
  reasoning: string;
}

export interface DepartmentGroup {
  id: string;
  label: string;
  pillar: string;
  relevance: number;
  personCount: number;
  recommended: { name: string; title: string; score: number } | null;
}

export interface OfferingInference {
  departmentId: string;
  label: string;
  pillar: string;
  reason: string;
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
  offering: OfferingInference;
  departments: DepartmentGroup[];
  recommendation: {
    top: DecisionMaker | null;
    ranked: { rank: number; name: string; title: string; department: string; score: number; confidence: number; reasoning: string }[];
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
    `site:linkedin.com/in ${n} CIO OR CTO OR "head of" OR "vice president" OR director`,
    `${n} "chief information officer" OR "head of shared services" OR "head of data"`,
    `site:theorg.com ${n}`,
    `${n} executive team management`,
    org.domain ? `${n} site:${org.domain} team` : `${n} about us team`,
    `${n} CEO CTO CFO COO founders`,
    `${n} key people board of directors`,
    `${n} leadership press release appointment`,
    `${n} contact email phone address`,
  ];
}

// ---------- Title classification ----------

interface TitleRule { pattern: RegExp; score: number; seniority: string; authority: string }

const TITLE_RULES: TitleRule[] = [
  { pattern: /\b(co[\s-]?founder|founder|owner|proprietor)\b/i, score: 100, seniority: "Founder", authority: "Founder / owner - ultimate decision authority" },
  { pattern: /\b(chief executive officer|chief exec|ceo|managing director|chief physician)\b/i, score: 96, seniority: "C-suite (CEO)", authority: "CEO - final budget and strategy authority" },
  { pattern: /\b(chief [a-z]+ officer|c[teofmripgs]o|chief [a-z]+)\b/i, score: 91, seniority: "C-suite", authority: "C-suite - owns a major budget function" },
  { pattern: /\b(executive vice president|evp|senior vice president|svp)\b/i, score: 85, seniority: "SVP / EVP", authority: "Senior executive - large budget influence" },
  { pattern: /\b(vice president|vp of|vp,|vp\b|head of|global head|director|general manager|gm)\b/i, score: 75, seniority: "VP / Director", authority: "VP / Director - departmental budget owner" },
  { pattern: /\b(chairman|chairwoman|chairperson|president)\b/i, score: 94, seniority: "President / Chair", authority: "President / Chair - top executive authority" },
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

// ---------- Department mapping (LevelShift offering -> buyer function) ----------

export interface DepartmentDef {
  id: string;
  label: string;
  pillar: string;
  match: RegExp;
  signals: RegExp;
}

// Match order: specific function patterns first, executive catch-all last.
const DEPARTMENTS: DepartmentDef[] = [
  {
    id: "sales-crm",
    label: "Sales, CRM & Revenue Operations",
    pillar: "Salesforce Services (implementation, optimization, AI in CRM)",
    match: /\b(salesforce|crm|revenue operations|revops|sales operations|sales ops|commercial operations|chief commercial|commercial officer|cpq|head of sales|sales director|vp of sales|vice president, sales|chief revenue|cro)\b/i,
    signals: /\b(salesforce|crm|revops|sales operations|cpq|sales cloud|service cloud|commercial operations)\b/i,
  },
  {
    id: "business-apps",
    label: "Business Applications, ERP & Finance Systems",
    pillar: "Dynamics 365 Services (ERP/CRM modernization with AI)",
    match: /\b(dynamics\s?365|microsoft dynamics|erp|business applications?|finance systems?|financial systems|financial operations|netsuite|sap|head of erp|erp director)\b/i,
    signals: /\b(dynamics\s?365|dynamics|erp|netsuite|sap|finance transformation|business central)\b/i,
  },
  {
    id: "integration",
    label: "Enterprise Integration & Architecture",
    pillar: "Enterprise Integration (Boomi, MuleSoft, Azure integration with AI automation)",
    match: /\b(integration|enterprise architect|architecture|architect|middleware|\bapi\b|boomi|mulesoft|systems integration|esb|head of architecture)\b/i,
    signals: /\b(boomi|mulesoft|middleware|api integration|system integration|\besb\b|integration platform|ipaas)\b/i,
  },
  {
    id: "ai-innovation",
    label: "AI, Analytics & Innovation",
    pillar: "AI Transformation (embedding AI across functions)",
    match: /\b(chief ai|head of ai|artificial intelligence|machine learning|data science|innovation|digital transformation|chief digital|ai platform|ml ops|mlops|\bresearch\b)\b/i,
    signals: /\b(artificial intelligence|machine learning|generative ai|ai[- ]first|ai transformation|ai strategy|llm)\b/i,
  },
  {
    id: "hr-staffing",
    label: "HR, Staffing & Talent",
    pillar: "BPS / Staffing Services (workforce, talent operations)",
    match: /\b(chro|chief people|chief human|human resources|\bhr\b|people operations|people ops|talent|staffing|workforce|recruiting|talent acquisition|chief learning|head of people)\b/i,
    signals: /\b(staffing|workforce|recruiting|talent acquisition|contingent workforce|staff augmentation|peo)\b/i,
  },
  {
    id: "shared-services",
    label: "Shared Services, BPO & Operations",
    pillar: "Business Process Services (ITES/BPO, managed operations)",
    match: /\b(shared services|bpo|business process|ites|outsourcing|global capability|\bgcc\b|\bgbs\b|service delivery|business operations|operations center|global business services|coo|chief operating)\b/i,
    signals: /\b(bpo|shared services|outsourcing|ites|business process services|contact center|managed services|back office)\b/i,
  },
  {
    id: "procurement",
    label: "Procurement & Vendor Management",
    pillar: "Procurement / vendor approval (budget sign-off for outsourced services)",
    match: /\b(procurement|strategic sourcing|sourcing|vendor (management|relations|selection)|purchasing|supply chain|head of procurement|vendor management office)\b/i,
    signals: /\b(procurement|vendor management|strategic sourcing|purchase order|supplier management)\b/i,
  },
  {
    id: "it-data",
    label: "IT, Data & Cloud Infrastructure",
    pillar: "Data Modernization (Microsoft Fabric, Azure, Power BI, Databricks)",
    match: /\b(cio|chief information|chief technology|chief data|information technology|\bit\b|head of it|infrastructure|cloud|data(?!s\b)|analytics|platform engineering|enterprise applications?|engineering|devops|head of technology|technology director|data engineering|systems director)\b/i,
    signals: /\b(azure|microsoft fabric|power bi|databricks|snowflake|data warehouse|data platform|cloud migration|cloud native|data engineering|analytics platform)\b/i,
  },
  {
    id: "bu-leadership",
    label: "Business Unit & Division Leadership",
    pillar: "Division-specific engagement (BU heads approve local spend)",
    match: /\b(business unit|\bbu\b|division|general manager|regional|country manager|managing director|head of|svp|evp|senior vice president|executive vice president|business head|vertical head)\b/i,
    signals: /\b(business units?|divisions?|subsidiaries|business lines|profit center|verticals?)\b/i,
  },
  {
    id: "exec-sponsor",
    label: "Executive Sponsors (CEO / President / Chair)",
    pillar: "Executive sponsorship & escalation (rarely the day-to-day buyer)",
    match: /\b(founder|co[\s-]?founder|chief executive|ceo|president|chair|owner|proprietor)\b/i,
    signals: /$^/,
  },
];

const DEFAULT_PRIORITY = ["it-data", "sales-crm", "shared-services", "business-apps", "integration", "ai-innovation", "procurement", "hr-staffing", "bu-leadership", "exec-sponsor"];
// Only these map to a service we actually sell — structural groups (BU heads, exec sponsors) and
// approver roles (procurement) never drive the offering.
const OFFERING_CANDIDATES = ["it-data", "sales-crm", "shared-services", "business-apps", "integration", "ai-innovation", "hr-staffing"];

const DEPT_BY_ID = new Map(DEPARTMENTS.map(d => [d.id, d]));

export function classifyDepartment(title: string, authorityScore: number, orgName?: string): DepartmentDef {
  let t = title || "";
  if (orgName) {
    const esc = orgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\b${esc}\\b`, "gi"), " ");
  }
  t = t.replace(/\s+/g, " ").trim();
  for (const d of DEPARTMENTS) {
    if (d.match.test(t)) return d;
  }
  return DEPT_BY_ID.get(authorityScore >= 91 ? "exec-sponsor" : "bu-leadership")!;
}

export function inferOffering(text: string, orgIndustry: string, description: string): OfferingInference {
  const hay = (text || "").toLowerCase().slice(0, 400000);
  const primary = `${orgIndustry || ""} ${description || ""}`.toLowerCase();
  const counts: Record<string, number> = {};
  for (const d of DEPARTMENTS) {
    const re = new RegExp(d.signals.source, "gi");
    const rest = hay.match(re)?.length || 0;
    const head = primary.match(re)?.length || 0;
    counts[d.id] = rest + head * 3;
  }
  const ranked = OFFERING_CANDIDATES
    .map(id => DEPT_BY_ID.get(id)!)
    .filter(Boolean)
    .map(d => ({ d, count: counts[d.id] || 0, idx: (() => { const i = DEFAULT_PRIORITY.indexOf(d.id); return i === -1 ? 99 : i; })() }))
    .sort((a, b) => b.count - a.count || a.idx - b.idx);
  const best = ranked[0];
  const useDefault = !best || best.count < 3;
  const chosen = useDefault ? DEPT_BY_ID.get("it-data")! : best.d;
  const evidence = ranked.filter(r => r.count >= 3).slice(0, 3).map(r => `${r.d.label} x${r.count}`);
  const reason = useDefault
    ? `No strong buying-signal found in public data — defaulting to our primary pillar: ${chosen.pillar}.`
    : `Prospect signals in research: ${evidence.join(", ")}. ${chosen.label} is most likely to own this purchase.`;
  return { departmentId: chosen.id, label: chosen.label, pillar: chosen.pillar, reason };
}

function departmentOrder(offering: OfferingInference): string[] {
  const ids = DEPARTMENTS.map(d => d.id).filter(id => id !== offering.departmentId);
  const withIdx = ids
    .map(id => ({ id, idx: (() => { const i = DEFAULT_PRIORITY.indexOf(id); return i === -1 ? 99 : i; })() }))
    .sort((a, b) => a.idx - b.idx);
  return [offering.departmentId, ...withIdx.map(x => x.id)];
}

function computeRelevance(dm: DecisionMaker, deptIndex: number): number {
  // Exec sponsors are shown last but ranked as a mid-tier department: present, never top.
  const effIndex = dm.department === "exec-sponsor" ? Math.min(deptIndex, 5) : deptIndex;
  const deptWeight = Math.max(45, 100 - effIndex * 6);
  let rel = 0.42 * deptWeight + 0.28 * dm.authorityScore + 0.18 * dm.confidence + 0.12 * dm.reachScore;
  if (/\b(former|previously with|retired|emeritus)\b/i.test(dm.title) || /^(?:ex|past|prior)\b/i.test(dm.title.trim())) rel = Math.min(rel, 55);
  if (dm.confidence < 50) rel = Math.min(rel, 66);
  return clamp(rel);
}

const NAME_TOKEN = `[A-Z][A-Za-z'’\\.\\-]{1,20}`;
const NAME_RE = new RegExp(`\\b(${NAME_TOKEN}(?:\\s+(?:${NAME_TOKEN}|de|van|von|da|di|la|der|den)){1,2})\\b`, "g");

function looksLikePersonName(name: string): boolean {
  if (!name || name.length < 4 || name.length > 45) return false;
  let fixed = name.trim().replace(/\s+/g, " ");
  if (/\.\s/.test(fixed)) return false;
  const STOP_FIRST = /^(new|los|san|as|of|the|and|or|on|at|in|to|for|our|we|team|board|directors?|officers?|leadership|executive|profile|contact|about|read|more|learn|view|see|meet|back|top|next|previous|page|home|senior|chief|chair|former|vice|head|global|our)$/i;
  const STOP_TAIL = /^(york|angeles|francisco|jersey|vegas|orleans|quin|unknown|inc|llc)$/i;
  const comma = fixed.match(/^([A-Za-z'’\.\-]{2,25}),\s+([A-Z][A-Za-z'’\.\-]{1,20})$/);
  if (comma) fixed = `${comma[2]} ${comma[1]}`;
  const words = fixed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (!/^[A-Z]/.test(fixed)) return false;
  if (STOP_FIRST.test(words[0])) return false;
  if (STOP_TAIL.test(words[words.length - 1])) return false;
  if (/^(vice|senior|chief|executive|head|director|managing|general|deputy|global|regional|former|acting|interim|president|founder|co|partner|manager|team|associate|assistant|principal|officer|financial|marketing|operating|technology|information|people|commercial|strategy|revenue|product|legal|security|medical|engineering|growth|digital|data|analytics|customer|communications|administrative)\b/i.test(fixed)) return false;
  if (/\b(inc|llc|ltd|corp|corp|corporation|incorporated|holdings|globally|internationally|the|and|of|at|for|ceo|usa|uk|llp|accounts|services|solutions|department|division|business|executive|president|officer|director|founder|headquarters|insurance|financial|investments?)\b/i.test(fixed)) return false;
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
  let s = (name || "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
  const comma = s.match(/^([A-Za-z'’\.\-]{2,25}),\s+([A-Z][A-Za-z'’\.\-]{1,20})$/);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  let words = s.split(" ");
  const TITLEISH = /^(founder|co[- ]?founder|chief|executive|officer|president|chairwoman|chairman|chairperson|chair|trustee|director|vice|senior|svp|evp|ceo|cto|cfo|coo|cmo|cro|cio|cpo|ciso|global|head|manager|partner|owner|exec|staff|department|corporation|inc|llc|ltd|company|holdings|president|internationally|globally)$/i;
  let guard = 0;
  while (words.length > 1 && TITLEISH.test(words[0]) && guard++ < 3) words.shift();
  const cut = words.findIndex((w, i) => i >= 2 && TITLEISH.test(w));
  if (cut > 0) words = words.slice(0, cut);
  return words.join(" ");
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
  let v = value
    .replace(/\{\{\s*Start date(?:\s*and\s*age)?\|(\d{4})(?:\|\d{1,2})?(?:\|\d{1,2})?[^}]*\}\}/gi, "$1")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (let i = 0; i < 6 && /\{\{/.test(v); i++) v = v.replace(/\{\{[^{}]*\}\}/g, " ");
  v = v
    .replace(/\{\{|\}\}/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^)]{0,80})\)/g, " ")
    .replace(/[\[\]|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,?\s*\.{2,}.*$/, "")
    .replace(/\s+in$/, "")
    .trim();
  return v;
}

function sanitizeHQ(v: string): string {
  let s = (v || "").trim();
  s = s.replace(/^(?:headquartered|based|located)\s+(?:in|at)\s+/i, "");
  s = s.replace(/\{\{[^}]*\}\}/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]{0,80}\)/g, " ");
  s = s.replace(/\s+/g, " ").replace(/\.\s+[A-Za-z].*$/, "").replace(/,?\s*\.{2,}\s*$/, "").replace(/[\s,;]+$/, "").trim();
  const words = s.split(" ");
  if (words.length > 8) s = words.slice(0, 8).join(" ").replace(/,?\s*$/, "");
  return s.length >= 3 && /[A-Za-z]/.test(s) && !/[{}[\]]/.test(s) ? s : "";
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
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const orgNormFull = norm(orgName);
    const orgLower = orgName.toLowerCase();
    const rankTitle = (t: string) => {
      const n = norm(t);
      if (n === orgNormFull) return 4;
      if (orgNormFull.length >= 4 && n.startsWith(orgNormFull)) return n.length - orgNormFull.length <= 6 ? 3 : 1;
      if (orgNormFull.length >= 4 && n.includes(orgNormFull)) return 1;
      return 0;
    };
    const COMPANY_RE = /\b(company|corporation|inc\.?|incorporated|multinational|startup|software|technolog(?:y|ies)|founded|headquartered|subsidiary|enterprise|provider|vendor|privately held|publicly traded|firm)\b/i;
    const buildFromPage = (page: any) => {
      if (!page || page.missing) return null;
      const wikitext: string = page.revisions?.[0]?.slots?.main?.["*"] || "";
      const extract: string = page.extract || "";
      const title: string = page.title || "";
      if (!extract || !wikitext) return null;
      const titleNorm = norm(title);
      const titleMatch = titleNorm === orgNormFull || (orgNormFull.length >= 4 && titleNorm.startsWith(orgNormFull));
      const looksCompany = COMPANY_RE.test(extract.slice(0, 400)) && !/disambiguation|may refer to|pages?\s+with\s+no\s+arguments/i.test(extract.slice(0, 250));
      const valid = looksCompany && (titleMatch || extract.slice(0, 120).toLowerCase().includes(orgLower));
      if (!valid) {
        console.log("[Org] Wikipedia: reject page", title, "for", orgName);
        return null;
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
        pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      };
    };

    const PROPS = "prop=extracts|revisions&exintro=1&explaintext=1&rvprop=content&rvslots=main";
    const probes = [orgName, `${orgName} Inc.`, `${orgName} Corporation`, `${orgName} Ltd`, `${orgName} Group`, `${orgName} (company)`];
    const probeData: any = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&${PROPS}&titles=${encodeURIComponent(probes.join("|"))}&redirects=1&format=json&origin=*`);
    const probePages: any[] = Object.values(probeData?.query?.pages || {}).filter((p: any) => p && !p.missing);
    probePages.sort((a: any, b: any) => rankTitle(b.title) - rankTitle(a.title));
    for (const p of probePages) {
      const res = buildFromPage(p);
      if (res) return res;
    }

    const searchData: any = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`"${orgName}"`)}&format=json&srlimit=6&origin=*`);
    const raw: string[] = (searchData?.query?.search || []).map((s: any) => s.title);
    if (!raw.length) {
      console.log("[Org] Wikipedia: no exact-phrase page for", orgName);
      return null;
    }
    const candidates = [...raw].sort((a, b) => rankTitle(b) - rankTitle(a));
    for (const candidate of candidates.slice(0, 4)) {
      const pageData: any = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&${PROPS}&titles=${encodeURIComponent(candidate)}&format=json&origin=*`);
      const page: any = Object.values(pageData?.query?.pages || {})[0];
      const res = buildFromPage(page);
      if (res) return res;
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
  const tierBoost = dm.evidence.some(e => e.tier === 1) ? 18 : dm.evidence.some(e => e.tier === 2) ? 10 : 0;
  const evidenceScore = clamp(Math.min(100, sourceCount * 30 + tierBoost) + (dm.linkedin ? 15 : 0));
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
  const ownLinkedIn = !!(dm.linkedin || dm.sourceUrls.some(u => u.includes("linkedin.com/in/")));
  if (dm.confidence < 52 && dm.authorityScore >= 85 && sourceCount >= 1 && ownLinkedIn) dm.confidence = 52;

  let score = dm.authorityScore * 0.45 + dm.reachScore * 0.35 + dm.confidence * 0.2;
  const t = dm.title.toLowerCase();
  if (/\b(sales|revenue|commercial|marketing|growth|partnership|business development|chief revenue|cro|cmo)\b/.test(t)) score += 8;
  else if (/\b(operations|product|strategy|general management|president)\b/.test(t)) score += 5;
  else if (/\b(engineering|technology|information|data|security|research)\b/.test(t)) score += 2;
  if (/\b(founder|ceo|chief executive)\b/.test(t) && !orgSizeKnown) score += 6;
  if (/\b(manager|analyst|assistant|intern)\b/.test(t)) score -= 15;
  if (/\b(former|previously with|retired|emeritus)\b/.test(t) || /^(?:ex|past|prior)\b/i.test(dm.title.trim())) {
    score -= 30;
    dm.authorityScore = clamp(dm.authorityScore - 30);
    dm.confidence = clamp(dm.confidence - 10);
  }
  dm.score = clamp(score);
}

function buildReasoning(dm: DecisionMaker, orgName: string, rank: number, offering?: OfferingInference): string {
  const rule = classifyTitle(dm.title);
  const dept = DEPT_BY_ID.get(dm.department);
  const domains = [...new Set(dm.sourceUrls.map(u => {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
  }))];
  const corroboration = domains.length
    ? `Corroborated by ${dm.sourceUrls.length} source${dm.sourceUrls.length === 1 ? "" : "s"} (${domains.slice(0, 4).join(", ")})`
    : "Single-source mention";
  const direct = dm.linkedin && dm.contacts.some(c => c.type === "email")
    ? "Direct contact available: LinkedIn + email"
    : dm.linkedin
      ? "LinkedIn profile verified - best outreach path"
      : dm.contacts.length
        ? `Contact found: ${dm.contacts.map(c => c.type).join(", ")}`
        : "No direct contact found yet - use company channels";
  const role = rule ? rule.authority : "Executive-level authority";
  const owns = dept && dm.department !== "exec-sponsor"
    ? `Owns ${dept.label.toLowerCase()} - the team that evaluates ${dept.pillar.toLowerCase()}`
    : dept
      ? `Senior sponsor in ${dept.label.toLowerCase()} - escalation path, not the day-to-day buyer`
      : `Function owner (${dm.departmentLabel})`;
  const placement = rank === 1
    ? dm.department === "exec-sponsor"
      ? `Ranked #1: senior sponsor at ${orgName} - useful for escalation, not the day-to-day buyer of ${offering ? offering.pillar : "our offering"}.`
      : `Top pick for ${offering && dm.department === offering.departmentId ? offering.pillar : dept ? dept.pillar : "our offering"}: this role controls that purchase at ${orgName}.`
    : `Ranked #${rank} in ${dm.departmentLabel}.`;
  return `${dm.title} at ${orgName} - ${role}. ${owns}. ${corroboration}. ${direct}. ${placement}`;
}

function rankDecisionMakers(dms: DecisionMaker[], order: string[], orgName?: string): DecisionMaker[] {
  const idxOf = new Map(order.map((id, i) => [id, i]));
  return dms
    .map(dm => {
      const dept = classifyDepartment(dm.title, dm.authorityScore, orgName);
      dm.department = dept.id;
      dm.departmentLabel = dept.label;
      dm.relevance = computeRelevance(dm, idxOf.get(dept.id) ?? order.length - 1);
      dm.score = dm.relevance;
      return dm;
    })
    .sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence || b.authorityScore - a.authorityScore);
}

function capDepartments(dms: DecisionMaker[]): DecisionMaker[] {
  const limits: Record<string, number> = { "exec-sponsor": 4 };
  const seen = new Map<string, number>();
  return dms.filter(dm => {
    const c = (seen.get(dm.department) || 0) + 1;
    seen.set(dm.department, c);
    return c <= (limits[dm.department] ?? 5);
  });
}

// ---------- AI refinement ----------

async function refineWithAI(orgName: string, dms: DecisionMaker[], offering: OfferingInference): Promise<{ decisionMakers: DecisionMaker[]; insights: string[] } | null> {
  if (!dms.length) return null;
  const hasKey = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
  if (!hasKey) return null;
  const lines = dms.slice(0, 12).map((dm, i) => {
    const contacts = dm.contacts.map(c => `${c.type}=${c.value}${c.derived ? "(derived)" : ""}`).join(", ") || "none";
    const ev = dm.evidence.slice(0, 2).map(e => sanitizeForPrompt(e.claim)).join(" | ") || "n/a";
    return `${i + 1}. ${dm.name} — ${dm.title} | function: ${dm.departmentLabel} | confidence ${dm.confidence} | sources ${dm.sourceUrls.length} | contacts: ${contacts} | evidence: ${ev}`;
  }).join("\n");

  const prompt = `You are a B2B prospect researcher. Organization: "${orgName}".
We sell: ${offering.pillar}. Likely buyer function at this prospect: ${offering.label}.
Candidate decision-makers found on the open web (LinkedIn, company pages, directories, news):
${lines}

Rules:
- Drop false positives: people who do NOT work at ${orgName} (e.g. CEOs of OTHER companies who merely sit on this board), journalists/analysts, generic org names, hobby clubs.
- Keep real decision-makers at ALL levels: functional heads, directors, VPs, heads of shared services/BPO/ITES, procurement leads, BU heads — not just the C-suite. The day-to-day buyer matters more than the CEO.
- Fix titles (e.g. "Chief Executive Officer (CEO)" -> "CEO"). Use the person's actual function title as found in evidence.
- bio: ONE factual sentence max, only from the evidence given. No invented facts.
- confidence: 0-100, how sure you are this person works at ${orgName} in this role (evidence corroboration).
- reasoning: ONE specific sentence saying which function/department this person owns and whether they would evaluate ${offering.pillar} for ${orgName}. No fluff.
- insights: 2-3 short observations about this company's buying structure (who owns what, gaps).

Return ONLY JSON:
{"decisionMakers":[{"name":"...","title":"...","bio":"...","confidence":0,"reasoning":"..."}],"insights":["...","...","..."]}`;

  try {
    const { result } = await aiRegistry.generateJSON<any>(prompt, { temperature: 0.2, maxTokens: 3000 });
    if (!result || !Array.isArray(result.decisionMakers)) return null;
    const byName = new Map<string, any>();
    for (const r of result.decisionMakers) {
      if (r && typeof r.name === "string") byName.set(r.name.toLowerCase().replace(/[^a-z]/g, ""), r);
    }
    const merged = dms.map(dm => {
      const r = byName.get(dm.name.toLowerCase().replace(/[^a-z]/g, ""));
      if (!r) return { ...dm, confidence: Math.min(dm.confidence, 45) };
      return {
        ...dm,
        title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 70) : dm.title,
        bio: typeof r.bio === "string" ? r.bio.slice(0, 300) : dm.bio,
        confidence: typeof r.confidence === "number" ? clamp(r.confidence) : dm.confidence,
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
  const wikiSite = siteHost(wiki?.profile?.website);
  const nameDomain = deriveDomain(searchResults, identity.name);
  const firstToken = identity.name.toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "");
  const nameMatches = (d: string | null): d is string => !!d && d.split(".")[0].includes(firstToken);
  const earlyDomain = identity.domain || (nameMatches(nameDomain) ? nameDomain : wikiSite && nameMatches(wikiSite) ? wikiSite : null) || nameDomain || wikiSite;

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

  const orgDomain = identity.domain || (nameMatches(nameDomain) ? nameDomain : wikiSite && nameMatches(wikiSite) ? wikiSite : null) || earlyDomain || nameDomain;
  const textCorpus = [...pages, ...searchResults.map(r => ({ url: r.url, content: `${r.title}\n${r.snippet}` }))];
  const allCompanyEmails = collectCompanyEmails(textCorpus, orgDomain);
  const offering = inferOffering(
    textCorpus.map(p => p.content).join("\n"),
    wiki?.profile?.industry || "",
    wiki?.profile?.description || ""
  );
  const deptOrder = departmentOrder(offering);
  console.log("[Org] Offering inferred:", offering.departmentId, "|", offering.reason.slice(0, 90));

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
    const evidence: EvidenceItem = { claim: cleanClaim(h.snippet || h.title), sourceUrl: h.url, sourceTitle: h.sourceTitle, tier: h.tier };
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
        relevance: 0,
        department: "bu-leadership",
        departmentLabel: "Business Unit & Division Leadership",
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
  dms = rankDecisionMakers(dms, deptOrder, identity.name).slice(0, 16);

  let insights: string[] = [];
  const refined = await refineWithAI(identity.name, dms, offering);
  if (refined) {
    dms = refined.decisionMakers;
    insights = refined.insights;
    console.log("[Org] AI refined", dms.length);
  }
  dms = rankDecisionMakers(dms, deptOrder, identity.name);
  dms = capDepartments(dms).slice(0, 12);
  dms.forEach((dm, i) => {
    const deptDef = DEPT_BY_ID.get(dm.department);
    const pillar = dm.department === offering.departmentId ? offering.pillar : deptDef?.pillar || offering.pillar;
    const placement = i === 0
      ? dm.department === "exec-sponsor"
        ? `Ranked #1: senior sponsor at ${identity.name} — useful for escalation, not the day-to-day buyer of ${offering.pillar}.`
        : `Top pick for ${pillar}: this role controls that purchase at ${identity.name}.`
      : `Ranked #${i + 1} in ${dm.departmentLabel}.`;
    if (!refined || !dm.reasoning) {
      dm.reasoning = buildReasoning(dm, identity.name, i + 1, offering);
    } else {
      dm.reasoning = dm.reasoning.replace(/Ranked #\d+[^.]*(?:\.|$)/, placement);
    }
  });

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
    headquarters: (() => { const h = sanitizeHQ(hqFromText(wiki?.profile?.description || "") || wiki?.profile?.headquarters || fieldHQ || hqFallback || ""); return looksLikePlace(h) ? h : ""; })(),
    size: wiki?.profile?.size || fieldSize || "",
    founded: normalizeFounded(wiki?.profile?.founded || ""),
    description: shortDescription,
  };

  const top = dms[0] || null;
  const avgConf = dms.length ? dms.reduce((a, d) => a + d.confidence, 0) / dms.length : 0;
  const confidenceScore = dms.length ? clamp(avgConf * 0.6 + Math.min(100, searchResults.length * 6) * 0.4) : 25;
  const researchQuality = clamp(Math.min(100, pages.length * 12 + searchResults.length * 2) * 0.5 + avgConf * 0.5);

  const departments: DepartmentGroup[] = [];
  for (let i = 0; i < deptOrder.length; i++) {
    const id = deptOrder[i];
    const def = DEPT_BY_ID.get(id);
    if (!def) continue;
    const members = dms.filter(dm => dm.department === id);
    if (!members.length) continue;
    departments.push({
      id,
      label: def.label,
      pillar: def.pillar,
      relevance: Math.max(45, 100 - i * 6),
      personCount: members.length,
      recommended: members[0] ? { name: members[0].name, title: members[0].title, score: members[0].score } : null,
    });
  }

  if (!insights.length) {
    insights = [
      top ? `Best contact: ${top.name}, ${top.title} — owns ${top.departmentLabel}. ${top.reasoning}` : "No verified decision-makers found in public sources.",
      `Targeting ${offering.pillar}. ${offering.reason}`,
      `${dms.length} decision-makers across ${departments.length} departments and ${new Set(dms.flatMap(d => d.sourceUrls)).size} unique sources.`,
    ];
  }

  const sections = buildSections(org, dms, top, searchResults, offering, departments);
  const result: OrgResearchResult = {
    type: "organization",
    id: Date.now().toString(),
    query,
    timestamp: new Date().toISOString(),
    organization: org,
    decisionMakers: dms,
    offering,
    departments,
    recommendation: {
      top,
      ranked: dms.map((dm, i) => ({ rank: i + 1, name: dm.name, title: dm.title, department: dm.departmentLabel, score: dm.score, confidence: dm.confidence, reasoning: dm.reasoning })),
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
      offering: offering.departmentId,
      departments: departments.map(d => `${d.id}:${d.personCount}`),
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

function siteHost(website?: string | null): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

function deriveDomain(results: SearchResult[], orgName: string): string | null {
  const firstWord = orgName.toLowerCase().split(" ")[0].replace(/[^a-z0-9]/g, "");
  const blocked = /linkedin|wikipedia|facebook|twitter|instagram|crunchbase|glassdoor|bloomberg|reuters|youtube|zoominfo|rocketreach|peopleai|owler|dnb\.com|forbes/;
  const regs: string[] = [];
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (blocked.test(host)) continue;
      const reg = host.split(".").slice(-2).join(".");
      if (reg.includes(".") && !regs.includes(reg)) regs.push(reg);
    } catch { /* skip */ }
  }
  return regs.find(g => g.split(".")[0] === firstWord) || regs.find(g => g.split(".")[0].includes(firstWord)) || null;
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

function cleanClaim(s: string): string {
  return (s || "")
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function looksLikePlace(v: string): boolean {
  if (!v || v.length < 4 || v.length > 70) return false;
  if (/[)(\[\]{}\\<>|]/.test(v)) return false;
  if (/\d/.test(v)) return false;
  if (/\b(from|until|between|since|during|which|was|were|has|have)\b/i.test(v)) return false;
  if (v.split(" ").length > 8) return false;
  return /\b[A-Z][a-z]+/.test(v);
}

function titleCase(v: string): string {
  return v.replace(/\b[a-z]/g, c => c.toUpperCase()).trim().slice(0, 80);
}

function hqFromText(text: string): string {
  if (!text) return "";
  const tail = `(?:,\\s*[A-Z][\\w.\\-]+(?:\\s+[A-Z][\\w.\\-]+)*)?`;
  const m = text.match(new RegExp(`headquartered in ([^.,;]{3,60}${tail})`, "i")) || text.match(new RegExp(`based in ([^.,;]{3,60}${tail})`, "i"));
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

function buildSections(org: OrgProfile, dms: DecisionMaker[], top: DecisionMaker | null, results: SearchResult[], offering: OfferingInference, departments: DepartmentGroup[]) {
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
  sections.push({
    title: "Target Offering (auto-inferred)",
    items: [
      { label: offering.label, value: `Offering we lead with: ${offering.pillar}\n${offering.reason}`, confidence: 70 },
      { label: "Buying committee mapped", value: departments.map(d => `${d.label} — ${d.personCount} person/people${d.recommended ? ` (reach: ${d.recommended.name}, ${d.recommended.title})` : ""}`).join("\n") || "No department groups resolved.", confidence: 65 },
    ],
  });
  if (top) {
    sections.push({
      title: "Best Person To Reach",
      items: [
        { label: `${top.name} — ${top.title} (${top.departmentLabel})`, value: top.reasoning, sourceUrl: top.sourceUrls[0] || null, confidence: top.confidence },
        { label: "Decision score", value: `${top.score}/100 (function fit ${top.authorityScore}/100 · reachability ${top.reachScore}/100)`, confidence: top.confidence },
        ...(top.contacts.length ? [{ label: "Contact", value: top.contacts.map(c => `${c.type}: ${c.value} (${c.confidence}%)${c.derived ? " [derived]" : ""}`).join("\n"), confidence: top.reachScore }] : []),
      ],
    });
  }
  if (departments.length) {
    sections.push({
      title: "Decision Makers by Department",
      items: departments.map(d => {
        const members = dms.filter(dm => dm.department === d.id);
        return {
          label: `${d.label} — buys: ${d.pillar}`,
          value: members.map((m, i) => `${i === 0 && d.recommended ? "→ REACH: " : "   "}${m.name} — ${m.title} (score ${m.score}, conf ${m.confidence}%)${m.contacts.length ? ` [${m.contacts.map(c => c.type).join(", ")}]` : ""}`).join("\n"),
          confidence: d.relevance,
        };
      }),
    });
  }
  sections.push({
    title: "Key Decision Makers",
    items: dms.map((dm, i) => ({
      label: `#${i + 1} ${dm.name} — ${dm.title} · ${dm.departmentLabel}`,
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
