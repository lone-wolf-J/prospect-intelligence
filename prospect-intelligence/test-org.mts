import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: ".env.vercel" });

async function main() {
  const query = process.argv[2] || "Microsoft";
  console.log("Testing org research for:", query);
  const started = Date.now();
  const { researchDecisionMakers } = await import("./server/lib/decision-makers.js");
  const res = await researchDecisionMakers(query);
  console.log("Duration:", Date.now() - started, "ms");
  console.log("Organization:", JSON.stringify(res.organization, null, 2));
  console.log("Confidence:", res.confidenceScore, "| Quality:", res.researchQuality, "| DMs:", res.decisionMakers.length);
  console.log("Insights:", JSON.stringify(res.aiInsights, null, 2));
  if (res.recommendation.top) {
    const t = res.recommendation.top;
    console.log("TOP:", t.name, "-", t.title, "| score", t.score, "| conf", t.confidence);
    console.log("Reasoning:", t.reasoning);
    console.log("Contacts:", JSON.stringify(t.contacts, null, 2));
  }
  console.log("All DMs:");
  for (const dm of res.decisionMakers) {
    console.log(` - ${dm.name} | ${dm.title} | score ${dm.score} | conf ${dm.confidence} | sources ${dm.sourceUrls.length} | contacts ${dm.contacts.map(c => c.type).join(",") || "none"}`);
  }
  console.log("Debug:", JSON.stringify(res._debug, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error("FAILED:", e); process.exit(1); });
