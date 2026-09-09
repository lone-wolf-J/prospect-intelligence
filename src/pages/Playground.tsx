import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Plus, Trash2, RotateCcw, Download, Eye, EyeOff, Zap, GitCompare, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Panel, SectionTitle } from "@/components/ui/primitives";
import { sfx } from "@/lib/sound";

// ─── Types ───
interface Provider {
  id: string; name: string; website: string; api_endpoint: string;
  auth_type: string; models: string[]; rate_limit_rpm: number | null; notes: string;
}
interface Message { role: "user" | "assistant" | "system"; content: string; model?: string; time?: number; }

// ─── Local Storage Helpers ───
function loadKey(pid: string): string { return localStorage.getItem(`pi_key_${pid}`) || ""; }
function saveKey(pid: string, k: string) { localStorage.setItem(`pi_key_${pid}`, k); }

// ─── ChatPanel: Single chat with one model ───
function ChatPanel({ providers }: { providers: Provider[] }) {
  const [provId, setProvId] = useState(providers[0]?.id || "");
  const [model, setModel] = useState(providers[0]?.models[0] || "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saveKeyEnabled, setSaveKeyEnabled] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const prov = providers.find(p => p.id === provId);

  useEffect(() => {
    if (prov) {
      setModel(prov.models[0] || "");
      const saved = loadKey(provId);
      if (saved) { setApiKey(saved); setSaveKeyEnabled(true); }
    }
  }, [provId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async () => {
    if (!input.trim() || loading) return;
    if (!apiKey) { setError("Enter your API key below"); return; }

    if (saveKeyEnabled) saveKey(provId, apiKey);
    else localStorage.removeItem(`pi_key_${provId}`);

    const userMsg: Message = { role: "user", content: input.trim() };
    const allMsgs = [...messages, userMsg];
    if (systemPrompt.trim()) allMsgs.unshift({ role: "system", content: systemPrompt.trim() });

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setError("");
    setLoading(true);
    sfx.verify();

    const start = Date.now();
    try {
      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ provider: provId, model, messages: allMsgs, stream: true }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" })) as any;
        setError(err.error || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setError("No response stream"); setLoading(false); return; }

      const decoder = new TextDecoder();
      let assistant = "";
      let buffer = "";

      setMessages(prev => [...prev, { role: "assistant", content: "", model, time: 0 }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistant += delta;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant", content: assistant, model,
                  time: Date.now() - start,
                };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [input, apiKey, provId, model, messages, systemPrompt, loading]);

  const clearChat = () => { setMessages([]); setError(""); };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Config Bar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={provId}
          onChange={e => setProvId(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none"
        >
          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none max-w-[240px]"
        >
          {prov?.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="API Key"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 pr-16 focus:border-cyan focus:outline-none"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono cursor-pointer">
          <input
            type="checkbox"
            checked={saveKeyEnabled}
            onChange={e => setSaveKeyEnabled(e.target.checked)}
            className="accent-cyan"
          />
          SAVE KEY
        </label>
        <button onClick={clearChat} className="chip border-slate-600/40 text-slate-500 hover:text-red-400 text-[10px]">
          <Trash2 size={10} /> CLEAR
        </button>
      </div>

      {/* System Prompt */}
      <details className="mb-2">
        <summary className="text-[10px] font-mono text-slate-600 cursor-pointer hover:text-slate-400">SYSTEM PROMPT</summary>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder="Optional system instructions..."
          rows={2}
          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-300 focus:border-cyan focus:outline-none resize-none"
        />
      </details>

      {/* Error */}
      {error && (
        <div className="mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 font-mono flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs font-mono">
            Select a provider, enter your API key, and start chatting
          </div>
        )}
        <AnimatePresence>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs font-mono leading-relaxed ${
                m.role === "user"
                  ? "bg-cyan/10 border border-cyan/20 text-slate-200"
                  : "bg-slate-800/80 border border-slate-700/50 text-slate-300"
              }`}>
                {m.role === "assistant" && m.model && (
                  <div className="text-[9px] text-slate-600 mb-1">{m.model}{m.time ? ` · ${(m.time / 1000).toFixed(1)}s` : ""}</div>
                )}
                <div className="whitespace-pre-wrap">{m.content || (loading && i === messages.length - 1 ? <span className="animate-pulse">▊</span> : "")}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none resize-none"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="btn-neon px-4 py-2 disabled:opacity-30"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── ComparePanel: Side-by-side two models ───
function ComparePanel({ providers }: { providers: Provider[] }) {
  const [provA, setProvA] = useState(providers[0]?.id || "");
  const [modelA, setModelA] = useState(providers[0]?.models[0] || "");
  const [keyA, setKeyA] = useState(loadKey(providers[0]?.id || ""));
  const [provB, setProvB] = useState(providers[1]?.id || providers[0]?.id || "");
  const [modelB, setModelB] = useState(providers[1]?.models[0] || providers[0]?.models[0] || "");
  const [keyB, setKeyB] = useState(loadKey(providers[1]?.id || providers[0]?.id || ""));
  const [prompt, setPrompt] = useState("");
  const [resA, setResA] = useState("");
  const [resB, setResB] = useState("");
  const [timeA, setTimeA] = useState(0);
  const [timeB, setTimeB] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const provListA = providers.find(p => p.id === provA);
  const provListB = providers.find(p => p.id === provB);

  const runCompare = async () => {
    if (!prompt.trim() || loading) return;
    if (!keyA || !keyB) { setError("Enter API keys for both providers"); return; }
    setError(""); setLoading(true);
    saveKey(provA, keyA); saveKey(provB, keyB);
    setResA(""); setResB(""); setTimeA(0); setTimeB(0);

    const runSide = async (
      pid: string, model: string, key: string,
      setRes: (v: string) => void, setTime: (v: number) => void
    ) => {
      const start = Date.now();
      try {
        const res = await fetch("/api/playground/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": key },
          body: JSON.stringify({ provider: pid, model, messages: [{ role: "user", content: prompt }], stream: true }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); setRes(`Error: ${(e as any).error || res.status}`); return; }
        const reader = res.body?.getReader();
        if (!reader) return;
        const dec = new TextDecoder();
        let buf = "", text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6).trim();
            if (d === "[DONE]") continue;
            try {
              const p = JSON.parse(d) as any;
              const delta = p.choices?.[0]?.delta?.content;
              if (delta) { text += delta; setRes(text); }
            } catch {}
          }
        }
        setTime(Date.now() - start);
      } catch (e: unknown) { setRes(`Error: ${e instanceof Error ? e.message : "Unknown"}`); }
    };

    await Promise.all([
      runSide(provA, modelA, keyA, setResA, setTimeA),
      runSide(provB, modelB, keyB, setResB, setTimeB),
    ]);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <div className="mb-3">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Enter a prompt to compare both models..."
          rows={2}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none resize-none"
        />
        {error && <div className="mt-1 text-[10px] text-red-400 font-mono flex items-center gap-1"><AlertCircle size={10} /> {error}</div>}
        <button onClick={runCompare} disabled={loading || !prompt.trim()} className="btn-neon mt-2 text-[11px] disabled:opacity-30">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} COMPARE
        </button>
      </div>
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Side A */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <select value={provA} onChange={e => setProvA(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none">
              {providers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={modelA} onChange={e => setModelA(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none max-w-[160px]">
              {provListA?.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="password" value={keyA} onChange={e => setKeyA(e.target.value)} placeholder="API Key" className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none w-32" />
          </div>
          <div className="flex-1 bg-slate-900/50 border border-slate-700/30 rounded-lg p-3 overflow-y-auto min-h-[200px]">
            {resA ? (
              <div className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                {resA}
                {loading && <span className="animate-pulse text-cyan">▊</span>}
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 font-mono">Response will appear here</div>
            )}
          </div>
          {timeA > 0 && <div className="text-[9px] text-slate-600 font-mono mt-1 text-right">{(timeA / 1000).toFixed(1)}s</div>}
        </div>

        <div className="w-px bg-slate-700/50 shrink-0" />

        {/* Side B */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <select value={provB} onChange={e => setProvB(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none">
              {providers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={modelB} onChange={e => setModelB(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none max-w-[160px]">
              {provListB?.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="password" value={keyB} onChange={e => setKeyB(e.target.value)} placeholder="API Key" className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-200 focus:border-cyan focus:outline-none w-32" />
          </div>
          <div className="flex-1 bg-slate-900/50 border border-slate-700/30 rounded-lg p-3 overflow-y-auto min-h-[200px]">
            {resB ? (
              <div className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                {resB}
                {loading && <span className="animate-pulse text-cyan">▊</span>}
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 font-mono">Response will appear here</div>
            )}
          </div>
          {timeB > 0 && <div className="text-[9px] text-slate-600 font-mono mt-1 text-right">{(timeB / 1000).toFixed(1)}s</div>}
        </div>
      </div>
    </div>
  );
}

// ─── ImagePanel: Image generation test ───
function ImagePanel({ providers }: { providers: Provider[] }) {
  const orProv = providers.find(p => p.id === "openrouter-free");
  const [model, setModel] = useState(orProv?.models[0] || "");
  const [apiKey, setApiKey] = useState(loadKey("openrouter-free"));
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!prompt.trim() || loading || !apiKey) return;
    setError(""); setLoading(true); setResult(null);
    saveKey("openrouter-free", apiKey);
    try {
      const res = await fetch("/api/playground/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ provider: "openrouter-free", model, prompt }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error || "Failed"); }
      else { setResult(data); }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Unknown error"); }
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={model} onChange={e => setModel(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none">
          {orProv?.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="OpenRouter API Key" className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none flex-1 min-w-[200px]" />
      </div>
      <div className="flex gap-2 mb-3">
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") generate(); }}
          placeholder="Describe the image to generate..."
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-cyan focus:outline-none"
        />
        <button onClick={generate} disabled={loading || !prompt.trim()} className="btn-neon px-4 py-2 disabled:opacity-30">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
        </button>
      </div>
      {error && <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 font-mono flex items-center gap-2"><AlertCircle size={12} /> {error}</div>}
      {result && (
        <div className="bg-slate-900/50 border border-slate-700/30 rounded-lg p-4">
          <pre className="text-[10px] font-mono text-slate-400 overflow-auto max-h-96">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Main Playground Page ───
export default function Playground() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tab, setTab] = useState<"chat" | "compare" | "image">("chat");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/playground/providers")
      .then(r => r.json())
      .then((d: any) => setProviders(d.providers || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { key: "chat" as const, label: "CHAT", icon: <Send size={11} /> },
    { key: "compare" as const, label: "COMPARE", icon: <GitCompare size={11} /> },
    { key: "image" as const, label: "IMAGE GEN", icon: <ImageIcon size={11} /> },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8">
      <SectionTitle
        kicker="INTERACTIVE"
        title="PLAYGROUND"
        right={<span className="text-[10px] font-mono text-slate-500">{providers.length} PROVIDERS LOADED</span>}
      />

      <Panel className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500 text-xs font-mono">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading providers...
          </div>
        ) : (
          <>
            {/* Tab Bar */}
            <div className="flex gap-1 mb-4 border-b border-slate-700/50 pb-2">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono tracking-wider transition-colors ${
                    tab === t.key
                      ? "bg-cyan/10 text-cyan border border-cyan/30"
                      : "text-slate-500 hover:text-slate-300 border border-transparent"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {tab === "chat" && <ChatPanel providers={providers} />}
            {tab === "compare" && <ComparePanel providers={providers} />}
            {tab === "image" && <ImagePanel providers={providers} />}
          </>
        )}
      </Panel>

      {/* Info */}
      <div className="mt-4 text-[10px] font-mono text-slate-600 space-y-1">
        <p>API keys are stored in your browser's localStorage and sent directly to the provider via our proxy. They are never stored on our servers.</p>
        <p>Get free API keys from: Groq (console.groq.com), OpenRouter (openrouter.ai/keys), Cerebras (cloud.cerebras.ai), Google AI Studio (aistudio.google.com)</p>
      </div>
    </div>
  );
}
