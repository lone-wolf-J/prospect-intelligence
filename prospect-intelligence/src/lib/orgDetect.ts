const ORG_SUFFIX_RE = /\b(incorporated|inc|corp|corporation|llc|ltd|limited|gmbh|plc|pvt|co|company|group|holdings|partners|ventures|capital|technologies|systems|solutions|labs|studio|studios|agency|consulting|university|college|foundation|institute|bank|fund|enterprises|industries|logistics|healthcare|pharma)\b/i;
const ORG_HINT_RE = /\b(leadership team|executive team|decision makers?|key people|org chart|organization|organisation|company|firm|startup|business|corporate)\b/i;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const KNOWN_ORGS = ["levelshift", "preludesys", "demandblue", "demanddynamics", "microsoft", "google", "amazon", "apple", "openai", "anthropic", "nvidia", "meta", "ibm", "oracle", "salesforce", "adobe", "dell", "cisco", "intel", "tesla", "netflix", "uber", "airbnb", "stripe", "shopify", "databricks", "snowflake", "palantir", "crowdstrike", "cloudflare", "atlassian", "github", "gitlab", "figma", "notion", "slack", "zoom", "hubspot", "zendesk", "servicenow", "workday", "sap", "accenture", "deloitte", "mckinsey", "jpmorgan", "goldman sachs", "morgan stanley", "boeing", "ford", "toyota"];

export function looksLikeOrganization(query: string): boolean {
  const q = (query || "").trim();
  if (!q) return false;
  if (DOMAIN_RE.test(q)) return true;
  if (ORG_HINT_RE.test(q)) return true;
  if (ORG_SUFFIX_RE.test(q)) return true;
  const lower = q.toLowerCase();
  for (const org of KNOWN_ORGS) {
    if (lower === org || lower.includes(org)) return true;
  }
  const words = q.split(/\s+/);
  if (words.length === 1 && !/^(the|and|of)$/i.test(words[0])) return true;
  return false;
}
