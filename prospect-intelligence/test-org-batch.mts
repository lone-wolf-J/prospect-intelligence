import dotenv from "dotenv";
dotenv.config({ path: ".env.vercel" });
dotenv.config();

const ORGS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "Adobe", "NVIDIA", "IBM", "OpenAI", "Shopify", "HubSpot", "Cloudflare", "Databricks", "Ford", "Novartis",
];

const { researchDecisionMakers } = await import("./server/lib/decision-makers.js");

let pass = 0;
const rows: string[] = [];

for (const org of ORGS) {
  const t0 = Date.now();
  try {
    const r: any = await researchDecisionMakers(org);
    const secs = Math.round((Date.now() - t0) / 1000);
    const top = r.recommendation?.top;
    const dms = r.decisionMakers || [];
    const hasLinkedIn = dms.filter((d: any) => (d.contacts || []).some((c: any) => c.type === "linkedin")).length;
    const junk = dms.filter((d: any) => /^[a-z ]{1,3}$/i.test(d.name) || /share|intent|undefined|http/i.test(d.name)).length;
    const ok = dms.length >= 3 && top && top.confidence >= 50 && junk === 0 && r.confidenceScore >= 40;
    if (ok) pass++;
    rows.push(
      `${ok ? "PASS" : "FAIL"} | ${org.padEnd(11)} | dms ${String(dms.length).padStart(2)} | conf ${String(Math.round(r.confidenceScore)).padStart(2)} | qual ${String(Math.round(r.researchQuality)).padStart(2)} | li ${String(hasLinkedIn).padStart(2)} | junk ${junk} | ${secs}s | top ${top ? `${top.name} (${top.title}) c${top.confidence}` : "none"} | hq "${r.organization?.headquarters || ""}" | ind "${r.organization?.industry || ""}"`
    );
  } catch (e: any) {
    rows.push(`FAIL | ${org.padEnd(11)} | error: ${e?.message || e}`);
  }
}

console.log("\n===== ORG BATCH RESULTS =====");
rows.forEach(r => console.log(r));
console.log(`\n${pass}/${ORGS.length} passed`);
process.exit(pass === ORGS.length ? 0 : 1);
