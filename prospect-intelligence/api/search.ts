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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkRateLimit(req, "search")) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  // Validate content-type
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("application/json")) {
    return res.status(400).json({ error: "Content-Type must be application/json" });
  }

  try {
    const rawQuery = req.body?.query;
    const query = validateQuery(rawQuery);
    const candidate = req.body?.candidate || null;
    // Validate candidate if provided (from disambiguation manual refine)
    let refinedCandidate: any = null;
    if (candidate && typeof candidate === "object") {
      refinedCandidate = {
        name: typeof candidate.name === "string" ? candidate.name.slice(0, 80) : "",
        company: typeof candidate.company === "string" ? candidate.company.slice(0, 80) : "",
        location: typeof candidate.location === "string" ? candidate.location.slice(0, 80) : "",
        linkedin: typeof candidate.url === "string" ? candidate.url.slice(0, 200) : typeof candidate.linkedin === "string" ? candidate.linkedin.slice(0, 200) : "",
        title: typeof candidate.title === "string" ? candidate.title.slice(0, 80) : "",
      };
    }

    console.log("[Vercel-Search] GROQ_API_KEY:", process.env.GROQ_API_KEY ? "SET" : "MISSING");
    console.log("[Vercel-Search] Query:", query.slice(0, 80), refinedCandidate ? `+ candidate ${refinedCandidate.name}` : "");

    const { searchProspectHandler } = await import("./search-handler.js");
    const result = await searchProspectHandler(query, refinedCandidate);

    return res.status(200).json(result);
  } catch (e: any) {
    console.error("[Vercel-Search] Error:", e);
    // Don't leak stack traces or internal details to client
    const msg = e.message?.includes("Query") || e.message?.includes("Too many") ? e.message : "Search failed. Please try a different query.";
    const status = e.message?.includes("Too many") ? 429 : e.message?.includes("Query") ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
}
