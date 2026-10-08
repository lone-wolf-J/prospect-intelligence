import { motion } from "framer-motion";
import {
  Building2,
  Users,
  Target,
  FileText,
  ExternalLink,
  Plus,
  Sparkles,
  MapPin,
  Briefcase,
  Linkedin,
  TrendingUp,
  Globe,
  CheckCircle,
  ArrowRight,
} from "lucide-react";

export interface OrgContact {
  type: string;
  value: string;
  confidence: number;
  source?: string;
  derived?: boolean;
}

export interface OrgDecisionMaker {
  name: string;
  title: string;
  seniority: string;
  authority: string;
  bio: string;
  location?: string;
  linkedin: string | null;
  contacts: OrgContact[];
  evidence: { claim: string; sourceUrl: string; sourceTitle: string; tier: number }[];
  sourceUrls: string[];
  confidence: number;
  score: number;
  authorityScore: number;
  reachScore: number;
  reasoning: string;
  department?: string;
  departmentLabel?: string;
  relevance?: number;
}

export interface OrgDepartmentGroup {
  id: string;
  label: string;
  pillar: string;
  relevance: number;
  personCount: number;
  recommended: { name: string; title: string; score: number } | null;
}

export interface OrgOffering {
  departmentId: string;
  label: string;
  pillar: string;
  reason: string;
}

export interface OrgCaseData {
  type: "organization";
  id: string;
  query: string;
  timestamp: string;
  organization: {
    name: string;
    website: string | null;
    domain: string | null;
    industry: string;
    headquarters: string;
    size: string;
    founded: string;
    description: string;
  };
  decisionMakers: OrgDecisionMaker[];
  offering?: OrgOffering;
  departments?: OrgDepartmentGroup[];
  recommendation: {
    top: OrgDecisionMaker | null;
    ranked: { rank: number; name: string; title: string; department?: string; score: number; confidence: number; reasoning: string }[];
  };
  confidenceScore: number;
  researchQuality: number;
  aiInsights: string[];
  sections: { title: string; items: { label: string; value: string; sourceUrl?: string | null; confidence?: number }[] }[];
  savedToPipeline: boolean;
  person?: any;
  company?: any;
}

function ContactChip({ c }: { c: OrgContact }) {
  const icon = c.type === "email" ? "✉️" : c.type === "phone" ? "📞" : c.type === "linkedin" ? "in" : c.type === "twitter" ? "𝕏" : "🔗";
  const color =
    c.confidence > 70
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : c.confidence > 40
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-600 border-slate-200";
  const isLink = c.value.startsWith("http");
  const inner = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border max-w-[240px] truncate ${color}`}>
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{c.value.replace(/^https?:\/\/(www\.)?/, "")}</span>
      <span className="opacity-60 shrink-0">
        · {c.confidence}%{c.derived ? " derived" : ""}
      </span>
    </span>
  );
  return isLink ? (
    <a href={c.value} target="_blank" rel="noopener" className="hover:opacity-80 transition-opacity">
      {inner}
    </a>
  ) : (
    inner
  );
}

function ScoreBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>}
      <div className="w-20 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8 }}
          className={`h-full rounded-full ${value > 70 ? "bg-emerald-500" : value > 40 ? "bg-amber-500" : "bg-red-400"}`}
        />
      </div>
      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{value}%</span>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join("");
}

export default function OrgDossier({ data, onSave }: { data: OrgCaseData; onSave: () => void }) {
  const top = data.recommendation?.top || data.decisionMakers?.[0] || null;

  const handleDownloadPdf = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const html = `
      <html><head><title>${data.organization.name} - Decision Maker Report</title>
      <style>body{font-family:Inter,sans-serif;padding:32px;color:#0f172a;max-width:820px;margin:0 auto;} h1{font-size:26px;margin-bottom:4px;} h2{font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#7c3aed;margin-top:26px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;} .meta{color:#64748b;font-size:13px;margin-bottom:16px;} .dm{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:10px 0;} .dm .n{font-weight:700;font-size:15px;} .dm .t{color:#64748b;font-size:12px;margin-bottom:6px;} .dm .r{font-size:13px;line-height:1.6;} .label{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;}</style>
      </head><body>
        <h1>${data.organization.name}</h1>
        <div class="meta">${[data.organization.industry, data.organization.headquarters, data.organization.size].filter(Boolean).join(" · ")} | Overall confidence ${data.confidenceScore}%${data.offering ? ` | Target offering: ${data.offering.pillar}` : ""}</div>
        ${data.organization.description ? `<p style="font-size:13px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">${data.organization.description}</p>` : ""}
        ${data.offering ? `<p style="font-size:13px;background:#f5f3ff;padding:12px;border-radius:8px;border:1px solid #ddd6fe;margin-top:8px;"><b>Auto-inferred offering:</b> ${data.offering.label} — ${data.offering.pillar}<br/>${data.offering.reason}</p>` : ""}
        ${top ? `<h2>Best person to reach</h2><div class="dm"><div class="n">${top.name} — ${top.title}</div><div class="t">${top.departmentLabel || ""}</div><div class="r">${top.reasoning}</div><div class="r" style="margin-top:6px;"><span class="label">Contacts:</span> ${top.contacts.map(c => `${c.type}: ${c.value} (${c.confidence}%)`).join(" · ") || "none found"}</div></div>` : ""}
        ${data.departments && data.departments.length ? `<h2>Buying committee by department</h2>${data.departments.map(d => `<div class="dm"><div class="n">${d.label} <span style="font-weight:400;color:#64748b;">(${d.personCount} person/people)</span></div><div class="t">Buys: ${d.pillar}</div>${d.recommended ? `<div class="r"><span class="label">Reach:</span> ${d.recommended.name} — ${d.recommended.title} (${d.recommended.score}/100)</div>` : ""}</div>`).join("")}` : ""}
        <h2>Key decision makers (${data.decisionMakers.length})</h2>
        ${data.decisionMakers.map((dm, i) => `<div class="dm"><div class="n">#${i + 1} ${dm.name} — ${dm.title}</div><div class="t">Decision score ${dm.score}/100 · Confidence ${dm.confidence}% · ${dm.departmentLabel || dm.authority}</div><div class="r">${dm.reasoning}</div>${dm.contacts.length ? `<div class="r" style="margin-top:6px;"><span class="label">Contacts:</span> ${dm.contacts.map(c => `${c.type}: ${c.value} (${c.confidence}%)`).join(" · ")}</div>` : ""}</div>`).join("")}
        <h2>AI insights</h2>${data.aiInsights.map((i, idx) => `<div style="margin:6px 0;font-size:13px;"><b>${idx + 1}.</b> ${i}</div>`).join("")}
        ${data.sections.map(s => `<h2>${s.title}</h2>${s.items.map(it => `<div style="margin:8px 0;"><div class="label">${it.label} ${it.confidence ? `· ${it.confidence}%` : ""}</div><div style="font-size:13px;line-height:1.6;">${it.value}</div></div>`).join("")}`).join("")}
        <hr style="margin-top:30px;border:none;border-top:1px solid #e2e8f0;"/><p style="font-size:11px;color:#94a3b8;text-align:center;">Generated by Prospect Intelligence · ${new Date().toLocaleString()} · Confidence ${data.confidenceScore}%</p>
      </body></html>`;
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
      alert(`Share link copied!\n${url}`);
    } catch {
      prompt("Copy this share link:", `${window.location.origin}/find?share=${data.id}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-6"
    >
      {/* Organization header */}
      <div className="glass-bright rounded-2xl p-6 holo-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[hsl(280,85%,55%)]/20 to-[hsl(320,85%,55%)]/20 border border-[hsl(280,85%,55%)]/20 flex items-center justify-center shrink-0">
              <Building2 size={24} className="text-[hsl(280,85%,55%)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate" style={{ fontFamily: "Montserrat, sans-serif" }}>
                  {data.organization.name}
                </h2>
                <span className="chip border-[hsl(280,85%,55%)]/30 text-[hsl(280,85%,55%)] text-[9px]">ORGANIZATION</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {data.decisionMakers.length} decision-maker{data.decisionMakers.length !== 1 ? "s" : ""} mapped · {data.organization.industry || "Industry n/a"}
                {data.offering ? ` · Leading with: ${data.offering.pillar}` : ""}
              </p>
              {data.offering && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{data.offering.reason}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScoreBar value={data.confidenceScore} label="Confidence" />
            <button onClick={handleShareLink} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              <ExternalLink size={12} /> SHARE
            </button>
            <button onClick={handleDownloadPdf} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              <FileText size={12} /> PDF
            </button>
            {!data.savedToPipeline ? (
              <button onClick={onSave} className="btn-neon text-xs px-4 py-2">
                <Plus size={12} /> SAVE
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> IN PIPELINE
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.organization.website && (
            <a href={data.organization.website} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50">
              <Globe size={12} /> {data.organization.website.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
            </a>
          )}
          {data.organization.headquarters && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              <MapPin size={12} /> {data.organization.headquarters}
            </span>
          )}
          {data.organization.size && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              <Users size={12} /> {data.organization.size}
            </span>
          )}
          {data.organization.industry && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(280,85%,55%)/0.08] border border-[hsl(280,85%,55%)/20] px-3 py-1.5 text-xs text-[hsl(280,85%,55%)]">
              <Briefcase size={12} /> {data.organization.industry}
            </span>
          )}
          {data.organization.founded && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              <TrendingUp size={12} /> Founded {data.organization.founded}
            </span>
          )}
        </div>
      </div>

      {/* Best person to reach */}
      {top && (
        <div className="bg-white dark:bg-slate-900 border-2 border-[hsl(280,85%,55%)]/30 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-[hsl(280,85%,55%)]/0.08 to-transparent flex items-center justify-between gap-3">
            <h3 className="font-sans text-sm font-bold tracking-wide text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
              <Target size={14} className="text-[hsl(280,85%,55%)]" />
              BEST PERSON TO REACH
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(280,85%,55%)] text-white text-xs font-bold px-3 py-1">
              {top.score}/100
            </span>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[hsl(280,85%,55%)]/20 to-[hsl(320,85%,55%)]/20 border border-[hsl(280,85%,55%)]/25 flex items-center justify-center shrink-0 font-bold text-[hsl(280,85%,55%)]">
                {initials(top.name)}
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold text-slate-900 dark:text-white">{top.name}</div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{top.title} — {data.organization.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{top.authority}</div>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-[hsl(280,85%,55%)/0.04] border border-[hsl(280,85%,55%)/0.12]">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[hsl(280,85%,55%)] mb-1.5">Why this person</div>
              <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{top.reasoning}</div>
              {top.bio && <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">{top.bio}</div>}
            </div>
            <div className="flex flex-wrap gap-4">
              <ScoreBar value={top.score} label="Reach score" />
              <ScoreBar value={top.confidence} label="Confidence" />
              <ScoreBar value={top.authorityScore} label="Authority" />
              <ScoreBar value={top.reachScore} label="Reachability" />
            </div>
            {top.contacts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {top.contacts.map((c, i) => (
                  <ContactChip key={i} c={c} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Buying committee by department */}
      {data.departments && data.departments.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
            <h3 className="font-sans text-sm font-bold tracking-wide text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
              <Target size={14} className="text-[hsl(280,85%,55%)]" />
              Buying Committee by Department
            </h3>
            <span className="text-[10px] font-sans uppercase tracking-widest text-slate-400">{data.departments.length} department{data.departments.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.departments.map((dept, i) => (
              <motion.div
                key={dept.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`p-4 rounded-xl border ${i === 0 ? "bg-[hsl(280,85%,55%)/0.05] border-[hsl(280,85%,55%)]/30" : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700"}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{dept.label}</span>
                  <span className={`chip text-[9px] ${i === 0 ? "border-[hsl(280,85%,55%)]/40 text-[hsl(280,85%,55%)]" : "border-slate-200 dark:border-slate-700 text-slate-500"}`}>
                    {dept.personCount} {dept.personCount === 1 ? "PERSON" : "PEOPLE"}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">Buys: {dept.pillar}</div>
                {dept.recommended && (
                  <div className="text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Reach: {dept.recommended.name}</span>
                    <span className="text-slate-500 dark:text-slate-400"> — {dept.recommended.title}</span>
                    <span className="ml-1 font-bold text-[hsl(280,85%,55%)]">{dept.recommended.score}/100</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* All decision makers */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-sans text-sm font-bold tracking-wide text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
            <Users size={14} className="text-[hsl(280,85%,55%)]" />
            Key Decision Makers — ranked by who to reach
          </h3>
          <span className="text-[10px] font-sans uppercase tracking-widest text-slate-400">{data.decisionMakers.length} found</span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.decisionMakers.map((dm, i) => (
            <motion.div
              key={`${dm.name}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 text-center w-10">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm border ${i === 0 ? "bg-[hsl(280,85%,55%)]/15 border-[hsl(280,85%,55%)]/40 text-[hsl(280,85%,55%)]" : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                    {initials(dm.name)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 mt-1">#{i + 1}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">{dm.name}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-300">{dm.title}</span>
                    {dm.departmentLabel && (
                      <span className="chip border-[hsl(320,85%,55%)]/40 text-[hsl(320,85%,55%)] text-[9px]">{dm.departmentLabel}</span>
                    )}
                    <span className="chip border-slate-200 dark:border-slate-700 text-slate-500 text-[9px]">{dm.seniority}</span>
                    {i === 0 && <span className="chip border-emerald-300 text-emerald-600 text-[9px]">TOP PICK</span>}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{dm.authority}</div>
                  {dm.bio && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{dm.bio}</div>}
                  <div className="text-sm text-slate-700 dark:text-slate-200 mt-2 leading-relaxed">{dm.reasoning}</div>
                  <div className="flex flex-wrap items-center gap-3 mt-2.5">
                    <ScoreBar value={dm.score} label="Score" />
                    <ScoreBar value={dm.confidence} label="Conf." />
                    {dm.linkedin && (
                      <a href={dm.linkedin} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-[#0a66c2] hover:underline">
                        <Linkedin size={12} /> LinkedIn <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                  {dm.contacts.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {dm.contacts.map((c, j) => (
                        <ContactChip key={j} c={c} />
                      ))}
                    </div>
                  )}
                  {dm.evidence.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {dm.evidence.slice(0, 3).map((e, j) =>
                        e.sourceUrl ? (
                          <a key={j} href={e.sourceUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-[hsl(280,85%,55%)] max-w-[220px] truncate">
                            <ArrowRight size={9} /> {e.sourceTitle?.slice(0, 45) || e.sourceUrl} <ExternalLink size={8} />
                          </a>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {data.decisionMakers.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No verified decision-makers found in public sources. Try the full company name or add a country/domain.
            </div>
          )}
        </div>
      </div>

      {/* AI insights */}
      {data.aiInsights?.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={14} className="text-[hsl(280,85%,55%)]" />
            <span className="font-sans text-xs font-bold uppercase tracking-[0.14em] text-[hsl(280,85%,55%)]">AI Analyst Notes</span>
          </div>
          <div className="space-y-3">
            {data.aiInsights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[hsl(280,85%,55%)/0.04] border border-[hsl(280,85%,55%)/0.08]">
                <span className="text-[hsl(280,85%,55%)] mt-0.5 shrink-0 text-xs font-bold">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report sections */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
          <h3 className="font-sans text-sm font-bold tracking-wide text-slate-900 dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
            <FileText size={14} className="text-[hsl(280,85%,55%)]" />
            Intelligence Report
          </h3>
          <div className="flex gap-2">
            <button onClick={handleDownloadPdf} className="text-xs font-medium text-[hsl(280,85%,55%)] hover:underline">Download PDF</button>
            <span className="text-slate-300">·</span>
            <button onClick={handleShareLink} className="text-xs font-medium text-[hsl(280,85%,55%)] hover:underline">Copy share link</button>
          </div>
        </div>
        <div className="p-6 space-y-8">
          {data.sections?.map((section, i) => (
            <div key={i} className="space-y-3">
              <h4 className="font-sans text-sm font-bold uppercase tracking-[0.12em] text-slate-900 dark:text-white border-l-2 border-[hsl(280,85%,55%)] pl-3" style={{ fontFamily: "Montserrat, sans-serif" }}>
                {section.title}
                <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">
                  · {section.items.length} item{section.items.length !== 1 ? "s" : ""}
                </span>
              </h4>
              <div className="space-y-4 pl-3">
                {section.items.map((item, j) => (
                  <div key={j}>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      {item.label} {item.confidence ? <span className="normal-case font-normal">· {item.confidence}% confidence</span> : null}
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {item.value}
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 ml-2 text-xs text-[hsl(280,85%,55%)] hover:underline">
                          <ExternalLink size={10} /> source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 text-center">
          <span className="text-[10px] font-sans uppercase tracking-widest text-slate-400 flex items-center justify-center gap-1">
            <CheckCircle size={10} /> Generated by Prospect Intelligence · Decision-maker research · {new Date(data.timestamp).toLocaleString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
