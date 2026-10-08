import type { VercelRequest, VercelResponse } from "@vercel/node";
import dotenv from "dotenv";
dotenv.config();
import { validateQuery, checkRateLimit } from "./_security.js";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkRateLimit(req, "org")) return res.status(429).json({ error: "Too many organization searches. Please wait a minute." });

  const ct = req.headers["content-type"] || "";
  if (!ct.includes("application/json")) return res.status(400).json({ error: "Content-Type must be application/json" });

  try {
    const query = validateQuery(req.body?.query);
    console.log("[Vercel-Org] Query:", query.slice(0, 80));
    const { researchDecisionMakers } = await import("../server/lib/decision-makers.js");
    const result = await researchDecisionMakers(query);
    return res.status(200).json(result);
  } catch (e: any) {
    console.error("[Vercel-Org] Error:", e);
    const msg = e.message?.includes("Query") || e.message?.includes("Too many") ? e.message : "Organization research failed. Please try a different company name.";
    const status = e.message?.includes("Too many") ? 429 : e.message?.includes("Query") ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
}
