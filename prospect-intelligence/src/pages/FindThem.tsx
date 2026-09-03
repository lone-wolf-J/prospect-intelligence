import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Crosshair,
  Globe,
  Building2,
  User,
  Linkedin,
  ExternalLink,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Shield,
  MapPin,
  Briefcase,
  Newspaper,
  TrendingUp,
  AlertTriangle,
  FileText,
  Award,
  Activity,
  Star,
  Target,
  Brain,
  Users,
  BarChart3,
  MessageCircle,
  HelpCircle,
  Send,
  AlertCircle,
  CheckCircle,
  Zap,
  ArrowRight,
} from "lucide-react";
import { GlassCard, Panel, GlowRing, TypeWriter, DataStream } from "@/components/ui/primitives";

interface IntelSection {
  title: string;
  items: { label: string; value: string; confidence?: number }[];
}

interface CaseData {
  id: string;
  query: string;
  timestamp: string;
  person: {
    name: string;
    title: string;
    company: string;
    linkedin: string;
    location: string;
    email?: string;
    phone?: string | null;
  };
  contacts?: { type: string; value: string; confidence: number; source?: string }[];
  company: {
    name: string;
    industry: string;
    size: string;
    revenue: string;
    founded: string;
    headquarters: string;
    website: string;
    description: string;
  };
  sections: IntelSection[];
  aiInsights: string[];
  confidenceScore: number;
  savedToPipeline: boolean;
}

const SECTION_ICONS: Record<string, any> = {
  "Executive Summary": FileText,
  "Executive Profile": User,
  "Career Progression": Briefcase,
  "Current Role & Responsibilities": Target,
  "Organization Intelligence": Building2,
  "Recent Public Activity": Newspaper,
  "Thought Leadership Analysis": Brain,
  "Professional Interests": Star,
  "Technology Landscape": Zap,
  "Business Priorities": BarChart3,
  "Buying Signal Analysis": Target,
  "Business Challenges": AlertCircle,
  "Stakeholder & Influence Assessment": Users,
  "Relationship Indicators": MessageCircle,
  "Strategic Sales Assessment": TrendingUp,
  "Personalized Conversation Starters": MessageCircle,
  "Discovery Questions": HelpCircle,
  "Recommended Outreach Strategy": Send,
  "Risks & Unknowns": AlertTriangle,
  "Confidence Assessment": CheckCircle,
  "Career History": Briefcase,
  "Key Achievements": Award,
  "Digital Presence": Globe,
  "Industry Influence": TrendingUp,
  "Identity": User,
  "Digital Footprint": Activity,
  "Google Results": Search,
};

function ScanAnimation({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="glass-bright rounded-xl p-8 text-center"
    >
      <GlowRing size={150} color="cyan" className="mx-auto -mt-4" />
      <div className="relative z-10">
        <div className="h-16 w-16 mx-auto mb-4 rounded-full border-2 border-cyan/30 border-t-cyan animate-spin" />
        <h3 className="text-lg font-bold text-slate-100 mb-2">
          Scanning Intelligence Networks
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          <TypeWriter text={`Analyzing: "${query}"`} speed={25} />
        </p>
        <DataStream className="h-8" />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {["Web Search", "AI Analysis", "Industry Data", "Company Intel", "Role Mapping"].map(
            (src, i) => (
              <motion.span
                key={src}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.5 }}
                className="chip border-cyan/20 text-cyan/70"
              >
                <span className="h-1 w-1 rounded-full bg-cyan animate-pulse" />
                {src}
              </motion.span>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}

function IntelSectionCard({ section, index }: { section: IntelSection; index: number }) {
  const [expanded, setExpanded] = useState(index < 5);
  const Icon = SECTION_ICONS[section.title] || Star;
  const isHighPriority = index < 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div className={`glass-card overflow-hidden ${isHighPriority ? "border-l-2 border-l-cyan/40" : ""}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`h-8 w-8 rounded-md flex items-center justify-center ${
              isHighPriority
                ? "bg-cyan/10 border border-cyan/30"
                : "bg-slate-800/50 border border-slate-700/30"
            }`}>
              <Icon size={14} className={isHighPriority ? "text-cyan" : "text-slate-400"} />
            </div>
            <div>
              <span className="font-mono text-xs uppercase tracking-[0.15em] text-slate-300">
                {section.title}
              </span>
              <span className="ml-2 text-[10px] text-slate-600 font-mono">
                {section.items.length} {section.items.length === 1 ? "item" : "items"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isHighPriority && (
              <span className="chip border-cyan/30 text-cyan text-[9px]">KEY</span>
            )}
            {expanded ? (
              <ChevronUp size={14} className="text-slate-500" />
            ) : (
              <ChevronDown size={14} className="text-slate-500" />
            )}
          </div>
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {section.items.map((item, i) => (
                  <div key={i} className="group">
                    <div className="flex items-start gap-3">
                      <span className="text-cyan/60 mt-1 shrink-0 text-[10px]">&#9656;</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                          {item.label}
                        </div>
                        <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                          {item.value}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function CaseDossier({ data, onSave }: { data: CaseData; onSave: () => void }) {
  const handleDownloadPdf = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const html = `
      <html><head><title>${data.person.name} - Intelligence Report</title>
      <style>body{font-family:Inter, sans-serif; padding:32px; color:#0f172a; max-width:800px; margin:0 auto;} h1{font-size:28px; margin-bottom:4px;} h2{font-size:14px; text-transform:uppercase; letter-spacing:0.12em; color:#7c3aed; margin-top:28px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;} .meta{color:#64748b; font-size:13px; margin-bottom:18px;} .chip{display:inline-block; border:1px solid #e2e8f0; border-radius:9999px; padding:4px 10px; font-size:11px; margin-right:6px;} .section{margin-bottom:18px;} .item{margin:8px 0;} .label{font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; margin-bottom:2px;} .value{font-size:13px; line-height:1.6;}</style>
      </head><body>
        <h1>${data.person.name}</h1>
        <div class="meta">${data.person.title || ""} ${data.person.company ? "— " + data.person.company : ""} | ${data.person.location || ""} | Confidence ${data.confidenceScore}%</div>
        <div>${data.company.description ? `<p style="font-size:13px; background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">${data.company.description}</p>` : ""}</div>
        ${data.sections.map(s => `<div class="section"><h2>${s.title}</h2>${s.items.map(it => `<div class="item"><div class="label">${it.label} ${it.confidence ? `· ${it.confidence}%` : ""}</div><div class="value">${it.value}</div></div>`).join("")}</div>`).join("")}
        <hr style="margin-top:32px; border:none; border-top:1px solid #e2e8f0;"/><p style="font-size:11px; color:#94a3b8; text-align:center;">Generated by Prospect Intelligence • ${new Date().toLocaleString()} • Confidence ${data.confidenceScore}%</p>
      </body></html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 400);
  };

  const handleShareLink = async () => {
    try {
      const shareData = { ...data, sharedAt: new Date().toISOString() };
      localStorage.setItem(`pi_share_${data.id}`, JSON.stringify(shareData));
      const url = `${window.location.origin}/find?share=${data.id}`;
      await navigator.clipboard.writeText(url);
      alert(`Share link copied!\n${url}\n\nAnyone with this link can view this report (stored per-browser).`);
    } catch {
      const url = `${window.location.origin}/find?share=${data.id}`;
      prompt("Copy this share link:", url);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6"
    >
      {/* Header Card */}
      <div className="glass-bright rounded-2xl p-6 holo-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-[hsl(280,85%,55%)]/20 to-[hsl(320,85%,55%)]/20 border border-[hsl(280,85%,55%)]/20 flex items-center justify-center">
              <User size={24} className="text-[hsl(280,85%,55%)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>{data.person.name}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {data.person.title}
                {data.person.company && ` — ${data.person.company}`}
              </p>
              {data.contacts && data.contacts.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {data.contacts.map((c: any, i: number) => {
                    const icon = c.type === "email" ? "✉️" : c.type === "phone" ? "📞" : c.type === "linkedin" ? "in" : c.type === "twitter" ? "𝕏" : c.type === "github" ? "gh" : c.type === "instagram" ? "📸" : c.type === "facebook" ? "fb" : c.type === "youtube" ? "▶️" : "🔗";
                    return (
                      <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border max-w-[220px] truncate ${c.confidence > 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.confidence > 40 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        <span className="shrink-0">{icon}</span> <span className="truncate">{c.value}</span> <span className="opacity-60 shrink-0">· {c.confidence}%</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Confidence</span>
              <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${data.confidenceScore}%` }}
                  transition={{ duration: 1, delay: 0.5 }}
                  className={`h-full rounded-full ${data.confidenceScore > 70 ? "bg-emerald-500" : data.confidenceScore > 40 ? "bg-amber-500" : "bg-red-500"}`}
                />
              </div>
              <span className="font-sans text-xs font-bold text-slate-700 dark:text-slate-300">{data.confidenceScore}%</span>
            </div>
            <button onClick={handleShareLink} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              <ExternalLink size={12} /> SHARE LINK
            </button>
            <button onClick={handleDownloadPdf} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              <FileText size={12} /> PDF
            </button>
            {!data.savedToPipeline ? (
              <button onClick={onSave} className="btn-neon text-xs px-4 py-2">
                <Plus size={12} />
                SAVE TO PIPELINE
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                IN PIPELINE
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.person.linkedin && (
            <a href={data.person.linkedin} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50">
              <Linkedin size={12} /> LinkedIn <ExternalLink size={10} />
            </a>
          )}
          {data.person.location && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              <MapPin size={12} /> {data.person.location}
            </span>
          )}
          {data.company.industry && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(280,85%,55%)/0.08] border border-[hsl(280,85%,55%)/20] px-3 py-1.5 text-xs text-[hsl(280,85%,55%)]">
              <Briefcase size={12} /> {data.company.industry}
            </span>
          )}
          {data.person.email && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700">
              ✉️ {data.person.email}
            </span>
          )}
        </div>
      </div>

      {/* AI Insights */}
      {data.aiInsights.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={14} className="text-[hsl(280,85%,55%)]" />
            <span className="font-sans text-xs font-bold uppercase tracking-[0.14em] text-[hsl(280,85%,55%)]">
              AI Strategic Insights
            </span>
          </div>
          <div className="space-y-3">
            {data.aiInsights.map((insight, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-xl bg-[hsl(280,85%,55%)/0.04] border border-[hsl(280,85%,55%)/0.08]"
              >
                <span className="text-[hsl(280,85%,55%)] mt-0.5 shrink-0 text-xs font-bold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Single Clean Report - holistic view, not collapsible duplicates */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-sans text-sm font-bold tracking-wide text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
            <FileText size={14} className="text-[hsl(280,85%,55%)]" />
            Intelligence Report — Holistic View
          </h3>
          <div className="flex gap-2">
            <button onClick={handleDownloadPdf} className="text-xs font-medium text-[hsl(280,85%,55%)] hover:underline">Download PDF</button>
            <span className="text-slate-300">·</span>
            <button onClick={handleShareLink} className="text-xs font-medium text-[hsl(280,85%,55%)] hover:underline">Copy share link</button>
          </div>
        </div>
        <div className="p-6 space-y-8">
          {data.sections.map((section, i) => (
            <div key={i} className="space-y-3">
              <h4 className="font-sans text-sm font-bold uppercase tracking-[0.12em] text-slate-900 dark:text-white border-l-2 border-[hsl(280,85%,55%)] pl-3" style={{ fontFamily: "Montserrat, sans-serif" }}>
                {section.title}
                <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">· {section.items.length} item{section.items.length !== 1 ? "s" : ""}</span>
              </h4>
              <div className="space-y-4 pl-3">
                {section.items.map((item, j) => (
                  <div key={j}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      {item.label} {item.confidence ? <span className="normal-case font-normal">· {item.confidence}% confidence</span> : null}
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 text-center">
          <span className="text-[10px] font-sans uppercase tracking-widest text-slate-400">Generated by Prospect Intelligence • Confidence {data.confidenceScore}% • {new Date(data.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </motion.div>
  );
}

interface Candidate {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  snippet: string;
  url: string;
  source: string;
  confidence: number;
  contacts?: { type: "email" | "phone" | "linkedin"; value: string; confidence: number }[];
}

export default function FindThem() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<CaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [resolving, setResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const autoSaveToDeck = (data: CaseData) => {
    try {
      const pipelineCase = {
        ...data,
        stage: "new" as const,
        tags: (data as any).tags || [],
        savedToPipeline: true,
      };
      const raw = localStorage.getItem("pi_cases");
      const existing = raw ? JSON.parse(raw) : [];
      if (!existing.find((c: any) => c.id === pipelineCase.id)) {
        existing.unshift(pipelineCase);
        localStorage.setItem("pi_cases", JSON.stringify(existing.slice(0, 50)));
        window.dispatchEvent(new Event("pi_cases_updated"));
      }
    } catch {}
  };

  // Handle share link: /find?share=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (!shareId) return;
    try {
      const shareRaw = localStorage.getItem(`pi_share_${shareId}`);
      if (shareRaw) {
        setResult(JSON.parse(shareRaw));
        return;
      }
      const casesRaw = localStorage.getItem("pi_cases");
      if (casesRaw) {
        const cases = JSON.parse(casesRaw);
        const found = cases.find((c: any) => c.id === shareId);
        if (found) setResult(found);
      }
    } catch {}
  }, []);

  const runSearch = async (finalQuery: string, candidateObj: any = null) => {
    setSearching(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: finalQuery, candidate: candidateObj }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Search failed (${res.status})`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ ...data, savedToPipeline: true });
      // Automated: every find automatically creates a record in Intel Deck with glimpse
      autoSaveToDeck(data);
    } catch (err: any) {
      const msg = err.message || "Search failed. Is the backend server running?";
      if (msg.includes("QUOTA") || msg.includes("limit") || msg.includes("exhausted")) {
        setError("AI quota temporarily exhausted (Groq 8000 tokens/min). Retrying with fallback... Please try again in 30s or try a more specific query (name + company).");
      } else {
        setError(msg);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResult(null);
    setError(null);
    setCandidates(null);

    try {
      // Step 1: Get disambiguation candidates (lightweight, saves deep scrape credits)
      setResolving(true);
      const candRes = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      setResolving(false);
      if (candRes.ok) {
        const candData = await candRes.json();
        const cands: Candidate[] = candData.candidates || [];
        // Only show popup if ambiguous: multiple candidates and top confidence not decisive
        if (cands.length > 1) {
          const top = cands[0]?.confidence || 0;
          const second = cands[1]?.confidence || 0;
          const isAmbiguous = top < 85 || (top - second) < 20;
          if (isAmbiguous) {
            setCandidateQuery(q);
            setCandidates(cands);
            setSearching(false);
            return;
          }
        }
        if (cands.length === 1 && cands[0].confidence >= 85) {
          // Single high-confidence match - use its name directly
          await runSearch(cands[0].name + (cands[0].company ? ` ${cands[0].company}` : ""));
          return;
        }
      }
    } catch (e) {
      console.log("Candidates failed, falling back to direct search", e);
      setResolving(false);
    }
    // Fallback: direct search
    await runSearch(q);
  };

  const handleCandidateSelect = async (c: Candidate) => {
    // Comprehensive: pass candidate object so backend does holistic crawl across all sources, not just chosen link
    const refined = `${c.name}${c.company ? ` ${c.company}` : ""} ${c.location ? ` ${c.location}` : ""}`.trim();
    setCandidates(null);
    setQuery(c.name);
    await runSearch(refined, c);
  };

  const handleSaveToPipeline = async () => {
    if (!result) return;
    // Build pipeline case (per-user localStorage is source of truth for sharing)
    const pipelineCase = {
      ...result,
      stage: "new" as const,
      tags: (result as any).tags || [],
      savedToPipeline: true,
    };
    // 1) Try server (best-effort, ephemeral on Vercel)
    try {
      await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pipelineCase),
      });
    } catch {}
    // 2) Always persist to localStorage so Intel Deck + Action Center see it per-browser
    try {
      const raw = localStorage.getItem("pi_cases");
      const existing = raw ? JSON.parse(raw) : [];
      // Avoid duplicates by id
      if (!existing.find((c: any) => c.id === pipelineCase.id)) {
        existing.unshift(pipelineCase);
        localStorage.setItem("pi_cases", JSON.stringify(existing));
        // Notify other tabs/pages in same browser
        window.dispatchEvent(new Event("pi_cases_updated"));
      }
    } catch {}
    setResult({ ...result, savedToPipeline: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <section className="relative min-h-[50vh] flex flex-col items-center justify-center px-6 pt-20 pb-8 overflow-hidden">
        <GlowRing size={500} color="cyan" className="top-0 left-1/2 -translate-x-1/2 opacity-10" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 text-center mb-8 max-w-3xl"
        >
          <div className="mono-label mb-4 flex items-center justify-center gap-2 text-[hsl(280,85%,55%)] dark:text-[hsl(280,85%,65%)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(280,85%,55%)] animate-pulse-dot" />
            INTELLIGENCE SCANNER
          </div>
          <h1 className="lusion-display text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem] text-slate-900 dark:text-white mb-4">
            Find <span className="lusion-gradient italic">Them.</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-xl mx-auto font-medium leading-relaxed">
            Enter a name, company, role, or LinkedIn URL. AI scans the internet to build a
            complete 20+ section intelligence dossier.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="relative z-10 w-full max-w-2xl"
        >
          <div className="glass-bright rounded-2xl p-2 sm:p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 holo-border">
            <div className="flex-1 flex items-center gap-3 px-3 min-w-0">
              <Search size={18} className="text-[hsl(280,85%,55%)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder='e.g. "Satya Nadella Microsoft" or "linkedin.com/in/johndoe"'
                className="flex-1 min-w-0 bg-transparent outline-none text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-sans text-sm py-3"
                style={{ opacity: 1 }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || searching}
              className="btn-neon w-full sm:w-auto px-6 py-3.5 sm:py-3 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
            >
              {searching ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  SCANNING
                </span>
              ) : (
                <>
                  <Crosshair size={14} />
                  SCAN
                </>
              )}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {["Person name + company", "LinkedIn URL", "Company + role", "Email address"].map(
              (hint) => (
                <span key={hint} className="text-[10px] font-sans font-medium text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1">
                  {hint}
                </span>
              )
            )}
          </div>

        </motion.div>
      </section>

      {/* Disambiguation Popup - saves scrape credits */}
      <AnimatePresence>
        {candidates && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setCandidates(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] overflow-hidden bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col"
            >
              <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-[hsl(280,60%,97%)] to-white dark:from-slate-800 dark:to-slate-900 shrink-0">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
                  <Users size={18} className="text-[hsl(280,85%,55%)] shrink-0" />
                  <span className="truncate">Which {candidateQuery} did you mean?</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  Multiple matches found. Pick the right profile to run deep intelligence (saves scrape credits).
                </p>
              </div>
              <div className="overflow-y-auto flex-1 p-3 sm:p-4 space-y-3 bg-slate-50/50 dark:bg-slate-800/50 min-h-0">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleCandidateSelect(c)}
                    className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-xl hover:border-[hsl(280,85%,55%)]/30 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-3 flex-1 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[hsl(280,85%,55%)]/15 to-[hsl(320,85%,55%)]/15 border border-slate-200 dark:border-slate-600 flex items-center justify-center shrink-0">
                          <User size={16} className="text-[hsl(280,85%,55%)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</div>
                          <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{c.title}{c.company ? ` — ${c.company}` : ""}</div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {c.location && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-[10px] font-medium text-slate-600 dark:text-slate-300"><MapPin size={10} />{c.location}</span>}
                            {c.url && <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate max-w-[150px] sm:max-w-[180px]"><Globe size={10} />{new URL(c.url).hostname}</span>}
                          </div>
                          {c.snippet && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 leading-relaxed">{c.snippet}</div>}
                          {c.contacts && c.contacts.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {c.contacts.map((ct: any, i: number) => (
                                <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${ct.confidence > 70 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : ct.confidence > 40 ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200 text-slate-600"}`}>
                                  {ct.type === "email" ? "✉️" : ct.type === "linkedin" ? "in" : "📞"} {ct.value} <span className="opacity-60">· {ct.confidence}%</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold ${c.confidence > 70 ? "text-emerald-600" : c.confidence > 40 ? "text-amber-600" : "text-slate-400"}`}>{c.confidence}%</div>
                        <div className="text-[10px] text-slate-400 font-medium uppercase">match</div>
                        <ArrowRight size={14} className="text-slate-400 group-hover:text-[hsl(280,85%,55%)] ml-auto mt-2 transition-colors" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {/* Manual refine - narrow to right individual */}
              <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shrink-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white mb-2">Not seeing the right person? Add details to narrow search:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <input id="manual-company" placeholder="Company name" className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-3 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-500 focus:border-[hsl(280,85%,55%)] focus:ring-2 focus:ring-[hsl(280,85%,55%)]/20 outline-none min-h-[44px]" />
                  <input id="manual-location" placeholder="Location (e.g., San Francisco, CA)" className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-3 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-500 focus:border-[hsl(280,85%,55%)] focus:ring-2 focus:ring-[hsl(280,85%,55%)]/20 outline-none min-h-[44px]" />
                  <input id="manual-linkedin" placeholder="LinkedIn URL" className="col-span-1 sm:col-span-2 w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-3 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-500 focus:border-[hsl(280,85%,55%)] focus:ring-2 focus:ring-[hsl(280,85%,55%)]/20 outline-none min-h-[44px]" />
                  <input id="manual-extra" placeholder="Any other info (role, email, etc.)" className="col-span-1 sm:col-span-2 w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-3 text-xs font-medium text-slate-900 dark:text-white placeholder-slate-500 focus:border-[hsl(280,85%,55%)] focus:ring-2 focus:ring-[hsl(280,85%,55%)]/20 outline-none min-h-[44px]" />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button type="button" onClick={() => setCandidates(null)} className="flex-1 px-4 py-3 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 bg-white dark:bg-slate-800 min-h-[44px] cursor-pointer relative z-10">CANCEL</button>
                  <button
                    type="button"
                    onClick={() => {
                      const company = (document.getElementById("manual-company") as HTMLInputElement)?.value || "";
                      const location = (document.getElementById("manual-location") as HTMLInputElement)?.value || "";
                      const linkedin = (document.getElementById("manual-linkedin") as HTMLInputElement)?.value || "";
                      const extra = (document.getElementById("manual-extra") as HTMLInputElement)?.value || "";
                      const parts = [candidateQuery, company, location, extra].filter(Boolean).join(" ").trim();
                      const manualCandidate: any = { name: candidateQuery, company, location, url: linkedin, title: extra, linkedin };
                      setCandidates(null);
                      runSearch(parts, manualCandidate);
                    }}
                    className="flex-1 px-4 py-3 rounded-full bg-[hsl(280,85%,55%)] text-white text-xs font-bold hover:bg-[hsl(280,85%,50%)] shadow-md min-h-[44px] cursor-pointer relative z-10"
                  >
                    REFINE & SEARCH
                  </button>
                  <button
                    type="button"
                    onClick={() => { const q = candidateQuery; setCandidates(null); runSearch(q); }}
                    className="flex-1 px-4 py-3 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 bg-white dark:bg-slate-800 min-h-[44px] cursor-pointer relative z-10"
                  >
                    SEARCH ANYWAY
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resolving indicator */}
      {resolving && (
        <div className="max-w-4xl mx-auto px-6 pb-4">
          <div className="glass rounded-xl p-4 flex items-center justify-center gap-3">
            <span className="h-4 w-4 rounded-full border-2 border-violet-neon/30 border-t-violet-neon animate-spin" />
            <span className="text-xs font-mono text-slate-400">Finding matching profiles...</span>
          </div>
        </div>
      )}

      <section className="max-w-4xl mx-auto px-6 pb-24">
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass rounded-xl p-6 border border-red-neon/20 mb-6"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className="text-red-neon" />
              <div>
                <div className="text-sm font-bold text-red-neon">Search Failed</div>
                <div className="text-xs text-slate-400 mt-1">{error}</div>
              </div>
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {searching && <ScanAnimation key="scan" query={query} />}
          {result && !searching && (
            <CaseDossier key="result" data={result} onSave={handleSaveToPipeline} />
          )}
        </AnimatePresence>
      </section>
    </motion.div>
  );
}
