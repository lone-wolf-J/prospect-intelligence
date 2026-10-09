import dotenv from "dotenv";
dotenv.config({ path: ".env.vercel" });
dotenv.config();

const { searchProspectHandler, SPEC_SECTIONS, normalizeSectionTitle } = await import("./api/search-handler.js");

const query = process.argv[2] ? process.argv.slice(2).join(" ") : "Satya Nadella Microsoft";
console.log("Query:", query);
const t0 = Date.now();
const r: any = await searchProspectHandler(query);
const secs = Math.round((Date.now() - t0) / 1000);
const titles: string[] = (r.sections || []).map((s: any) => s.title);
console.log("TIME:", secs + "s");
console.log("CONF:", r.confidenceScore, "| QUALITY:", r.researchQuality, "| CITATIONS:", (r.citations || []).length, "| WHYNOW:", (r.whyNow || []).length, "| TIMELINE:", (r.timeline || []).length, "| CACHED:", !!r._cached);
console.log(`SECTIONS (${titles.length}):`);
titles.forEach((t: string, i: number) => {
  const sec = r.sections[i];
  const spec = SPEC_SECTIONS.includes(normalizeSectionTitle(t));
  const stub = (sec.items || []).every((it: any) => /No public information found/.test(it.value || ""));
  console.log(` ${spec ? "SPEC" : "extra"} ${i + 1}. ${t} (${(sec.items || []).length} items)${stub ? " [STUB]" : ""}`);
});
const missing = SPEC_SECTIONS.filter((t: string) => !titles.includes(t));
console.log("MISSING SPEC:", missing.length ? missing.join(" | ") : "none");
const srcApp = r.sections.find((s: any) => s.title === "Source Appendix");
console.log("SOURCE APPENDIX ITEMS:", srcApp ? srcApp.items.length : 0);
console.log("SAMPLE ITEMS:");
for (const s of (r.sections || []).slice(0, 6)) {
  const it = (s.items || [])[0];
  if (it) console.log(`  [${s.title}] ${String(it.label).slice(0, 70)} :: ${String(it.value || "").slice(0, 130).replace(/\n/g, " / ")}`);
}
process.exit(0);
