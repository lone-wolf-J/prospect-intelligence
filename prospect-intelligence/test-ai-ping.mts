import dotenv from "dotenv";
dotenv.config({ path: ".env.vercel" });
dotenv.config();
const { aiRegistry } = await import("./server/lib/ai-registry.js");
try {
  const { result, provider } = await aiRegistry.generateJSON('Return ONLY JSON: {"ok": true, "n": 1}', { temperature: 0, maxTokens: 4000 });
  console.log("PROVIDER:", provider, "RESULT:", JSON.stringify(result));
} catch (e: any) {
  console.log("ERR:", e?.message || e);
}
