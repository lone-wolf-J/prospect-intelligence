# Research Engine Audit — Diagnosis (before remediation)

**Date:** 2025-09-02
**Scope:** `prospect-intelligence/` — `src/pages/FindThem.tsx` → `api/search.ts` → `api/search-handler.ts` → `server/lib/ai-registry.ts` → `server/lib/providers/*` → `api/candidates.ts`

## Current flow (actual code)

1. **Frontend** `FindThem.tsx: handleSearch` → `POST /api/candidates` (if ambiguous) else `POST /api/search {query, candidate}`. `runSearch` calls `/api/search` with raw string.
2. **Backend** `api/search.ts:35` validates `query` (2-200 chars) → `search-handler.ts: searchProspectHandler(query, candidate)` .
3. **Tier 1 search** (`search-handler.ts: crawler`): If `candidate.name` present, builds 4-6 queries: `[query, name+company, name+levelshift, name bio..., name social..., name email...]` (slice 0-6). Else 3 queries: `[query, query+bio, query social]`. Each via `fetchSerper` (Serper 2,500/mo) → if Serper <3 results, tries Tavily etc., plus DDG HTML + AllOrigins. Merges, dedupes by URL, slice 12.
4. **Tier 2 deep**: Top 3-5 URLs by domain diversity, rotated `Firecrawl/Scrape.do/Jina/ScrapingBee/ZenRows` (hash %5). No redirect limit, no 50KB cap originally, no private IP check before this audit (now added SSRF via `_security.ts`).
5. **Tier 3 enrich**: `Explorium`, `Tinyfish`, `PublicAPIs` in parallel.
6. **LLM**: `analyzeWithAI` builds prompt with `webResults (8) + deepContent (5*1500) + contacts + lineageNote + enrich` → `aiRegistry.generateJSON` (Groq `openai/gpt-oss-20b`, fallback Gemini, fallback deterministic). Prompt instructs "GROUND in web + deep" but feeds raw snippets, no structured facts.
7. **Parsing**: `ai-registry.ts: parseJsonRobust` with repair, per-provider retry.
8. **BuildCase**: Returns `person, company, sections (Summary,Contact,Career...), aiInsights, confidenceScore` plus `_sources, _deepPages`. No per-fact citations, no dates, no source tier, no timeline.
9. **Candidates**: `api/candidates.ts: getCandidates` does Serper 10 + Tavily fallback + Wikipedia, then heuristic confidence (title contains query →75, snippet→60, wiki→85) and optional Groq refine. No identity confidence, no company/title disambiguation.
10. **Caching**: `Map` in `search-handler.ts:4` with 7-day TTL, key `query::company::location` lowercased, bounded 200 entries, per warm function only (ephemeral).
11. **Storage**: `localStorage:pi_cases/pi_pitches` per-browser, plus ephemeral `api/cases.ts` Map.

## Why worse than Google

- **One-shot, not iterative:** `query → one batch → summary`. Human researcher does 15-20 targeted queries (`"John Smith" Acme CEO` + `John Smith interview` + `Acme funding` etc.) and follows new entities (previous employer, podcast, product). Current does 2-3 queries, not discovery-driven expansion.
- **No identity resolution:** `validateQuery` is length/charset only. `"Michael Johnson"` mixes Microsoft/Deloitte/Google without `company/title/LinkedIn/email` disambiguation. No confidence score, no `multiple matches → ask for identifier` gate. Merge by URL only, not by person.
- **No source quality:** All sources equal. `theorg.com` (Tier 3 aggregator) and `linkedin.com` (Tier 1 official) weighted same. Tier 4 SEO farms can establish facts.
- **No fact extraction:** LLM reads raw `Title/Snippet` and hallucinates biography. No structured `{claim, source, sourceType, publishedAt, evidence, confidence}` intermediate.
- **No deduplication of events:** Same press release via `levelshift.com`, `PR Newswire`, `news` counted as 3 web results, not `1 event, 4 sources, very high confidence`.
- **No temporal analysis:** No date parsing (`publishedAt`, `retrievedAt`), no `30/90/180d` weighting, no timeline. 2019 article = 2026 signal.
- **No signal detection / why now:** No `new role, funding, expansion, AI initiative` detection; `aiInsights` are generic (`AI transformation is tied to security governance`).
- **No citation:** Sections have `label/value` but no `source URL` per claim; UI cannot inspect source. Fake URLs not created, but citations not shown.
- **No ranking:** `relevance = search-engine order` (Serper rank), not `30% identity + 20% quality + 15% recency + 15% directness + 10% corroboration + 10% role relevance`.
- **Company context shallow:** Company section built from snippets only, not dedicated `company news/funding/hiring/product` searches after identifying company.
- **Sparse handling weak:** If `serper 0`, falls back to `Web Results` with `confidence 30`, not sparse template with `verified identity + company signals + sources searched`.

## Required new model (to be implemented)

Implement `SearchProvider {search, fetch}` abstraction, then pipeline: Identity resolution → Query expansion matrix (15-20 queries, dynamic) → Multi-query discovery (primary Serper, secondary Tavily/Brave, fallback free) → Source collection (20+ types) → Source quality tier 1-4 → Fact extraction (structured, with evidence/confidence/date) → Identity validation (confidence threshold, never merge same-name-different-person) → Deduplication (event-level) → Signal detection (why now) → Temporal analysis (timeline) → Intelligence synthesis (cited, fact vs inference labeled) → Cited brief with research quality score + debug.

Preserve: `POST /api/search {query, candidate}`, `POST /api/candidates`, `localStorage` per-user, existing env vars, styling.
