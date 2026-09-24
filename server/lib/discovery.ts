import { j, logEvent, upsertResource, addEvidence, registerAlias, ghRepoPath, slugify } from "./upsert";
import { parseFeed, sha256Hex, normalizePage } from "./feed";
import { scoreGithubRepo, scoreDiscoveredPage, isOsi } from "./score";
import { extractPricingFromText, suggestProductUrls, extractCapabilities, llmAvailable, llmJson } from "./llm";

export interface EnvLike {
  DB: any;
  GITHUB_TOKEN?: string;
  GEMINI_API_KEY?: string;
}

export const CAPABILITY_TAXONOMY = [
  "llm-inference", "agent-framework", "mcp", "ocr-document-parsing", "database",
  "vector-database", "workflow-automation", "hosting-deploy", "monitoring-observability",
  "speech-audio", "image-generation", "video-generation", "web-scraping",
  "hr-recruiting", "design", "productivity", "developer-tool", "authentication"
];

const UA = { "User-Agent": "FreeIntelBot/1.0 (+https://free-intel.dev; discovery bot)", Accept: "*/*" };

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { ...UA };
  h.Accept = "application/vnd.github+json";
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const GITHUB_SEARCH_QUERIES: Array<{ q: string; label: string; category: string }> = [
  // MCP / Agent Ecosystem
  { q: "mcp server", label: "MCP servers", category: "MCP" },
  { q: "model context protocol", label: "Model Context Protocol", category: "MCP" },
  { q: "awesome mcp servers", label: "MCP server lists", category: "MCP" },
  { q: "ai agent framework", label: "Agent frameworks", category: "AI" },
  { q: "multi-agent orchestration", label: "Multi-agent systems", category: "AI" },
  { q: "ai coding agent", label: "AI coding agents", category: "AI" },
  { q: "autonomous agent llm", label: "Autonomous agents", category: "AI" },
  { q: "agent tool use", label: "Agent tool-use", category: "AI" },
  { q: "crewai alternative", label: "CrewAI alternatives", category: "AI" },
  { q: "langchain alternative", label: "LangChain alternatives", category: "AI" },
  { q: "autogen alternative", label: "AutoGen alternatives", category: "AI" },
  { q: "llamaindex alternative", label: "LlamaIndex alternatives", category: "AI" },
  // LLM / Inference
  { q: "local llm inference", label: "Local LLM runtimes", category: "AI" },
  { q: "free llm api", label: "Free LLM APIs", category: "AI" },
  { q: "llm serving self-hosted", label: "Self-hosted LLM serving", category: "AI" },
  { q: "ollama plugin", label: "Ollama plugins", category: "AI" },
  { q: "vllm alternative", label: "vLLM alternatives", category: "AI" },
  { q: "llm gateway open source", label: "LLM gateways", category: "AI" },
  { q: "openai api alternative", label: "OpenAI API alternatives", category: "AI" },
  { q: "claude api alternative", label: "Claude API alternatives", category: "AI" },
  { q: "gemini alternative", label: "Gemini alternatives", category: "AI" },
  { q: "deepseek alternative", label: "DeepSeek alternatives", category: "AI" },
  // RAG / Vector / Search
  { q: "rag framework", label: "RAG frameworks", category: "AI" },
  { q: "vector database", label: "Vector databases", category: "Databases" },
  { q: "semantic search open source", label: "Semantic search", category: "AI" },
  { q: "embedding model self-hosted", label: "Embedding models", category: "AI" },
  { q: "knowledge graph open source", label: "Knowledge graphs", category: "Databases" },
  // Alternatives / Free Tools
  { q: "open source alternative to", label: "OSS SaaS alternatives", category: "Alternatives" },
  { q: "self-hosted alternative", label: "Self-hosted alternatives", category: "Alternatives" },
  { q: "free alternative to", label: "Free alternatives", category: "Alternatives" },
  { q: "open source replacement", label: "OSS replacements", category: "Alternatives" },
  { q: "self hosted saas alternative", label: "Self-hosted SaaS", category: "Alternatives" },
  { q: "free tier api", label: "Free API tiers", category: "APIs" },
  { q: "free ai tools", label: "Free AI tools", category: "AI" },
  { q: "free credit ai", label: "Free AI credits", category: "Deals" },
  // HR / Recruiting
  { q: "ocr engine", label: "OCR engines", category: "AI" },
  { q: "resume parser", label: "Resume parsing", category: "HR" },
  { q: "open source ats recruiting", label: "Recruiting tools", category: "HR" },
  { q: "applicant tracking system open source", label: "ATS open source", category: "HR" },
  { q: "talent intelligence ai", label: "Talent intelligence", category: "HR" },
  { q: "recruiting automation", label: "Recruiting automation", category: "HR" },
  // Workflow / Automation
  { q: "workflow automation self-hosted", label: "Workflow automation", category: "Automation" },
  { q: "zapier alternative open source", label: "Zapier alternatives", category: "Automation" },
  { q: "n8n workflow", label: "n8n workflows", category: "Automation" },
  { q: "make.com alternative", label: "Make alternatives", category: "Automation" },
  { q: "ifttt alternative self-hosted", label: "IFTTT alternatives", category: "Automation" },
  // Infrastructure / DevOps
  { q: "uptime monitoring self-hosted", label: "Uptime monitoring", category: "Infrastructure" },
  { q: "open source headless cms", label: "Headless CMS", category: "Developer tools" },
  { q: "free api gateway", label: "API gateways", category: "Infrastructure" },
  { q: "open source paas", label: "PaaS alternatives", category: "Infrastructure" },
  { q: "open source crm", label: "CRM alternatives", category: "Business" },
  { q: "open source helpdesk", label: "Helpdesk alternatives", category: "Support" },
  { q: "open source email marketing", label: "Email marketing", category: "Marketing" },
  { q: "open source analytics", label: "Analytics alternatives", category: "Analytics" },
  { q: "open source bi dashboard", label: "BI dashboards", category: "Analytics" },
  { q: "open source project management", label: "PM alternatives", category: "PM" },
  // Creative / Media
  { q: "text to speech open source", label: "Speech synthesis", category: "AI" },
  { q: "image generation self-hosted", label: "Image generation", category: "AI" },
  { q: "video generation open source", label: "Video generation", category: "AI" },
  { q: "music generation ai", label: "Music generation", category: "AI" },
  { q: "stable diffusion webui", label: "Stable Diffusion UIs", category: "AI" },
  { q: "comfyui workflow", label: "ComfyUI workflows", category: "AI" },
  { q: "flux image model", label: "Flux models", category: "AI" },
  // Coding / Developer
  { q: "ai code editor open source", label: "AI code editors", category: "Developer tools" },
  { q: "cursor alternative open source", label: "Cursor alternatives", category: "Developer tools" },
  { q: "github copilot alternative free", label: "Copilot alternatives", category: "Developer tools" },
  { q: "ai code review", label: "AI code review", category: "Developer tools" },
  { q: "ai documentation generator", label: "AI documentation", category: "Developer tools" },
  { q: "terminal ai assistant", label: "Terminal AI", category: "Developer tools" },
  // Free SaaS alternatives
  { q: "awesome open source alternatives", label: "OSS alternatives mega-list", category: "Alternatives" },
  { q: "free forever saas", label: "Free forever SaaS", category: "Alternatives" },
  { q: "awesome free tools", label: "Free tools lists", category: "Alternatives" },
  { q: "self hosted free", label: "Self-hosted free tools", category: "Alternatives" },
  // Audio / Voice / Music
  { q: "tts open source", label: "TTS engines", category: "AI" },
  { q: "voice cloning open source", label: "Voice cloning", category: "AI" },
  { q: "speech recognition open source", label: "Speech recognition", category: "AI" },
  { q: "music generation open source", label: "Music generation OSS", category: "AI" },
  // Design / Creative
  { q: "open source figma alternative", label: "Figma alternatives", category: "Design" },
  { q: "open source canva alternative", label: "Canva alternatives", category: "Design" },
  { q: "open source video editor", label: "Video editors OSS", category: "Design" },
  { q: "open source 3d modeling", label: "3D modeling OSS", category: "Design" },
  // Security / Auth
  { q: "open source password manager", label: "Password managers OSS", category: "Security" },
  { q: "open source sso", label: "SSO solutions OSS", category: "Security" },
  { q: "open source firewall", label: "Firewalls OSS", category: "Security" },
  { q: "open source antivirus", label: "Antivirus OSS", category: "Security" },
  // Business / SaaS
  { q: "open source invoicing", label: "Invoicing tools OSS", category: "Business" },
  { q: "open source erp", label: "ERP systems OSS", category: "Business" },
  { q: "open source ecommerce", label: "E-commerce OSS", category: "Business" },
  { q: "open source form builder", label: "Form builders OSS", category: "Business" },
];

const AWESOME_LISTS: Array<{ raw: string; label: string; category: string }> = [
  { raw: "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md", label: "awesome-mcp-servers", category: "MCP" },
  { raw: "https://raw.githubusercontent.com/e2b-dev/awesome-ai-agents/main/README.md", label: "awesome-ai-agents", category: "AI" },
  { raw: "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master/README.md", label: "awesome-rss-feeds", category: "Developer tools" },
  { raw: "https://raw.githubusercontent.com/OiiOAI/awesome-ai-agents/main/README.md", label: "awesome-ai-agents-2", category: "AI" },
  { raw: "https://raw.githubusercontent.com/caramaschiHG/awesome-ai-agents-2026/main/README.md", label: "awesome-ai-agents-2026", category: "AI" },
  { raw: "https://raw.githubusercontent.com/hmaverickadams/awesome-ai-startups/main/README.md", label: "awesome-ai-startups", category: "AI" },
  { raw: "https://raw.githubusercontent.com/zukixa/cool-ai-stuff/main/README.md", label: "cool-ai-stuff", category: "AI" },
  { raw: "https://raw.githubusercontent.com/AstraPolyglot/awesome-free-ai-tools/main/README.md", label: "awesome-free-ai", category: "Alternatives" },
  { raw: "https://raw.githubusercontent.com/cheahjs/open-source-alternatives/main/README.md", label: "open-source-alternatives", category: "Alternatives" },
  { raw: "https://raw.githubusercontent.com/nicehash/WhatMiner/main/README.md", label: "local-inference-tools", category: "AI" },
  { raw: "https://raw.githubusercontent.com/mpepping/awesome-ai-tools/main/README.md", label: "awesome-ai-tools", category: "AI" },
  { raw: "https://raw.githubusercontent.com/sheriffadel/awesome-llm-tools/main/README.md", label: "awesome-llm-tools", category: "AI" },
  { raw: "https://raw.githubusercontent.com/steven2358/awesome-creative-ai/main/README.md", label: "awesome-creative-ai", category: "AI" },
  { raw: "https://raw.githubusercontent.com/dair-ai/Prompt-Engineering-Guide/main/README.md", label: "prompt-engineering-guide", category: "AI" },
  { raw: "https://raw.githubusercontent.com/jbhuang0604/awesome-computer-vision/main/README.md", label: "awesome-computer-vision", category: "AI" },
  { raw: "https://raw.githubusercontent.com/hellodword/awesome-open-source-alternatives/main/README.md", label: "awesome-open-source-alternatives", category: "Alternatives" },
  { raw: "https://raw.githubusercontent.com/ToyB0x/awesome-open-source-alternatives/main/README.md", label: "awesome-oss-alternatives-v2", category: "Alternatives" },
  { raw: "https://raw.githubusercontent.com/RunPri/awesome-free-ai-tools/main/README.md", label: "awesome-free-ai-tools", category: "AI" },
  { raw: "https://raw.githubusercontent.com/mandrozd/awesome-selfhosted-ai/main/README.md", label: "awesome-selfhosted-ai", category: "AI" },
  { raw: "https://raw.githubusercontent.com/zukixa/cool-ai-stuff/main/README.md", label: "cool-ai-stuff", category: "AI" },
  { raw: "https://raw.githubusercontent.com/Awesome-LLM/Awesome-LLM/main/README.md", label: "awesome-llm", category: "AI" },
  { raw: "https://raw.githubusercontent.com/Hannibal046/Awesome-LLM-Inference/main/README.md", label: "awesome-llm-inference", category: "AI" },
  { raw: "https://raw.githubusercontent.com/tuhinmallick/Awesome-ChatGPT-Prompts/main/README.md", label: "awesome-chatgpt-prompts", category: "AI" },
  { raw: "https://raw.githubusercontent.com/dair-ai/Prompt-Engineering-Guide/main/README.md", label: "prompt-engineering-guide", category: "AI" },
  { raw: "https://raw.githubusercontent.com/Shubhamsaboo/awesome-llm-apps/main/README.md", label: "awesome-llm-apps", category: "AI" },
  { raw: "https://raw.githubusercontent.com/e2b-dev/awesome-ai-agents/main/README.md", label: "awesome-ai-agents-v2", category: "AI" },
  { raw: "https://raw.githubusercontent.com/caramaschiHG/awesome-ai-agents-2026/main/README.md", label: "awesome-ai-agents-2026", category: "AI" },
  { raw: "https://raw.githubusercontent.com/OiiOAI/awesome-ai-agents/main/README.md", label: "awesome-ai-agents-oio", category: "AI" },
  { raw: "https://raw.githubusercontent.com/open-free-llm-api/awesome-freellm-apis/main/README.md", label: "awesome-free-llm-apis", category: "AI" },
  { raw: "https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/reference/PROVIDER_REFERENCE.md", label: "omniroute-provider-reference", category: "AI" },
  { raw: "https://raw.githubusercontent.com/diegosouzapw/OmniRoute/main/docs/reference/FREE_TIERS.md", label: "omniroute-free-tiers", category: "AI" },
  { raw: "https://raw.githubusercontent.com/r2hu1/freerouter/main/README.md", label: "freerouter-free-ai-gateway", category: "AI" },
  { raw: "https://raw.githubusercontent.com/MrFadiAi/free-llm-gateway/main/README.md", label: "free-llm-gateway", category: "AI" },
  { raw: "https://raw.githubusercontent.com/zaber-dev/free-ai-gateway/main/README.md", label: "free-ai-gateway", category: "AI" },
  { raw: "https://raw.githubusercontent.com/leethesebas/OmniKey-AI-Unified-Key-Manager/main/README.md", label: "omnikey-ai-unified-key", category: "AI" },
  { raw: "https://raw.githubusercontent.com/AngusChiang/freellmapi/main/README.md", label: "freellmapi", category: "AI" },
];

const STARTER_SOURCES: Array<{ name: string; url: string; type: string; category: string; tier: number }> = [
  // ── COMMUNITY / EARLY WARNING ──
  { name: "Hacker News front page", url: "https://hnrss.org/frontpage", type: "rss", category: "community", tier: 2 },
  { name: "Hacker News: free", url: "https://hnrss.org/frontpage?q=free+OR+open+source+OR+alternative", type: "rss", category: "deals", tier: 1 },
  { name: "Hacker News: AI", url: "https://hnrss.org/frontpage?q=AI+OR+LLM+OR+agent+OR+MCP", type: "rss", category: "community", tier: 1 },
  { name: "Reddit r/selfhosted", url: "https://www.reddit.com/r/selfhosted/.rss", type: "rss", category: "deals", tier: 1 },
  { name: "Reddit r/LocalLLaMA", url: "https://www.reddit.com/r/LocalLLaMA/.rss", type: "rss", category: "deals", tier: 1 },
  { name: "Reddit r/OpenAI", url: "https://www.reddit.com/r/OpenAI/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/ClaudeAI", url: "https://www.reddit.com/r/ClaudeAI/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/ChatGPT", url: "https://www.reddit.com/r/ChatGPT/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/SaaS", url: "https://www.reddit.com/r/SaaS/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/MachineLearning", url: "https://www.reddit.com/r/MachineLearning/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/artificial", url: "https://www.reddit.com/r/artificial/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/AI_Agents", url: "https://www.reddit.com/r/AI_Agents/.rss", type: "rss", category: "deals", tier: 1 },
  { name: "Reddit r/StableDiffusion", url: "https://www.reddit.com/r/StableDiffusion/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/comfyui", url: "https://www.reddit.com/r/comfyui/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/ClaudeCode", url: "https://www.reddit.com/r/ClaudeCode/.rss", type: "rss", category: "deals", tier: 2 },
  { name: "Reddit r/cursor", url: "https://www.reddit.com/r/cursor/.rss", type: "rss", category: "deals", tier: 2 },

  // ── MAINSTREAM AI NEWS ──
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", type: "rss", category: "news", tier: 1 },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", type: "rss", category: "news", tier: 1 },
  { name: "Ars Technica AI", url: "https://feeds.arstechnica.com/arstechnica/technology-lab", type: "rss", category: "news", tier: 2 },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", type: "rss", category: "news", tier: 1 },
  { name: "MIT Technology Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed", type: "rss", category: "news", tier: 2 },
  { name: "Reuters Technology", url: "https://www.reuters.com/technology/rss", type: "rss", category: "news", tier: 2 },
  { name: "Wired AI", url: "https://www.wired.com/feed/tag/ai/latest/rss", type: "rss", category: "news", tier: 2 },
  { name: "SiliconANGLE AI", url: "https://siliconangle.com/category/artificial-intelligence/feed/", type: "rss", category: "news", tier: 2 },
  { name: "MarkTechPost", url: "https://www.marktechpost.com/feed/", type: "rss", category: "news", tier: 2 },
  { name: "The Decoder", url: "https://the-decoder.com/feed/", type: "rss", category: "news", tier: 2 },
  { name: "Axios AI", url: "https://www.axios.com/technology/ai/rss", type: "rss", category: "news", tier: 2 },
  { name: "The Guardian AI", url: "https://www.theguardian.com/technology/artificialintelligenceai/rss", type: "rss", category: "news", tier: 2 },

  // ── AI NEWSLETTERS / INDEPENDENT ANALYSTS ──
  { name: "Ben's Bites", url: "https://bensbites.beehiiv.com/rss", type: "rss", category: "newsletter", tier: 1 },
  { name: "The Rundown AI", url: "https://www.rundown.ai/feed", type: "rss", category: "newsletter", tier: 1 },
  { name: "TLDR AI", url: "https://tldr.tech/ai/rss", type: "rss", category: "newsletter", tier: 1 },
  { name: "Latent Space", url: "https://www.latent.space/feed", type: "rss", category: "newsletter", tier: 1 },
  { name: "Import AI", url: "https://importai.substack.com/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "The Batch (DeepLearning.AI)", url: "https://www.deeplearning.ai/the-batch/feed/", type: "rss", category: "newsletter", tier: 1 },
  { name: "Last Week in AI", url: "https://lastweekinai.substack.com/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "Interconnects", url: "https://www.interconnects.ai/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "One Useful Thing", url: "https://www.oneusefulthing.org/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "AlphaSignal", url: "https://alphasignal.ai/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "The Neuron", url: "https://www.theneurondaily.com/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "Superhuman AI", url: "https://www.superhuman.ai/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "AI Breakfast", url: "https://aibreakfast.com/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "AI Tidbits", url: "https://aitidbits.ai/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "The Sequence", url: "https://thesequence.substack.com/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "Exponential View", url: "https://www.exponentialview.co/feed", type: "rss", category: "newsletter", tier: 2 },
  { name: "Mindstream", url: "https://www.mindstream.news/feed", type: "rss", category: "newsletter", tier: 2 },

  // ── PRIMARY AI COMPANY BLOGS ──
  { name: "OpenAI News", url: "https://openai.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Anthropic News", url: "https://www.anthropic.com/rss.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Meta AI Blog", url: "https://ai.meta.com/blog/rss/", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Microsoft AI Blog", url: "https://blogs.microsoft.com/ai/feed/", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "NVIDIA Developer Blog", url: "https://developer.nvidia.com/blog/feed/", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Mistral News", url: "https://mistral.ai/feed.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Cohere Blog", url: "https://cohere.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "xAI News", url: "https://x.ai/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Qwen Blog", url: "https://qwenlm.github.io/blog/atom.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "DeepSeek Blog", url: "https://www.deepseek.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Stability AI News", url: "https://stability.ai/news/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Black Forest Labs Blog", url: "https://blackforestlabs.ai/blog/rss/", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "ElevenLabs Blog", url: "https://elevenlabs.io/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Suno Blog", url: "https://suno.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },

  // ── AI RESEARCH FEEDS ──
  { name: "arXiv cs.AI", url: "https://rss.arxiv.org/rss/cs.AI", type: "rss", category: "research", tier: 2 },
  { name: "arXiv cs.LG", url: "https://rss.arxiv.org/rss/cs.LG", type: "rss", category: "research", tier: 2 },
  { name: "arXiv cs.CL", url: "https://rss.arxiv.org/rss/cs.CL", type: "rss", category: "research", tier: 2 },
  { name: "arXiv cs.CV", url: "https://rss.arxiv.org/rss/cs.CV", type: "rss", category: "research", tier: 2 },
  { name: "Hugging Face Papers", url: "https://huggingface.co/papers/rss", type: "rss", category: "research", tier: 1 },
  { name: "Papers With Code", url: "https://paperswithcode.com/rss", type: "rss", category: "research", tier: 2 },

  // ── VENDOR BLOGS / CHANGELOGS ──
  { name: "GitHub Blog", url: "https://github.blog/feed/", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Ollama Blog", url: "https://ollama.com/blog/feed.xml", type: "rss", category: "vendor-blog", tier: 1 },
  { name: "Supabase Changelog", url: "https://supabase.com/changelog/rss.xml", type: "rss", category: "vendor-changelog", tier: 1 },
  { name: "n8n Blog", url: "https://blog.n8n.io/rss/", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Grafana Blog", url: "https://grafana.com/blog/news.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "PostHog Changelog", url: "https://posthog.com/changelog/feed.xml", type: "rss", category: "vendor-changelog", tier: 1 },
  { name: "Indie Hackers", url: "https://www.indiehackers.com/feed", type: "rss", category: "deals", tier: 2 },
  { name: "Product Hunt: AI", url: "https://www.producthunt.com/feed", type: "rss", category: "deals", tier: 1 },
  { name: "BetaList", url: "https://betalist.com/rss", type: "rss", category: "deals", tier: 2 },

  // ── OPENROUTER / FREE API TRACKING ──
  { name: "OpenRouter: Free Models", url: "https://openrouter.ai/rss", type: "rss", category: "deals", tier: 1 },
  { name: "Groq Blog", url: "https://groq.com/feed/", type: "rss", category: "vendor-blog", tier: 2 },

  // ── AI AGENT / MCP ECOSYSTEM ──
  { name: "LangChain Blog", url: "https://blog.langchain.dev/rss/", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "CrewAI Blog", url: "https://www.crewai.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Dify Blog", url: "https://dify.ai/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Flowise Blog", url: "https://flowiseai.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "OpenHands Blog", url: "https://www.all-hands.dev/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Aider Blog", url: "https://aider.chat/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Cline Blog", url: "https://cline.bot/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },

  // ── AI IMAGE / VIDEO / AUDIO ──
  { name: "Replicate Blog", url: "https://replicate.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Runway Blog", url: "https://runwayml.com/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Leonardo AI Blog", url: "https://leonardo.ai/blog/rss.xml", type: "rss", category: "vendor-blog", tier: 2 },
  { name: "Civitai RSS", url: "https://civitai.com/rss", type: "rss", category: "deals", tier: 2 },
  // ── FREE LLM API TRACKERS ──
  { name: "FreeLLM.net Updates", url: "https://freellm.net/rss.xml", type: "rss", category: "community", tier: 1 },
  { name: "LLM Cloud Hub News", url: "https://llmcloudhub.com/news/rss/", type: "rss", category: "community", tier: 2 }
];

// ── WEB SCRAPE SOURCES (non-RSS, need HTML parsing) ──
const WEB_SCRAPE_SOURCES: Array<{ name: string; url: string; category: string; selectors: { title: string; link: string; description?: string } }> = [
  // ============================================================
  // MAJOR AI DIRECTORIES
  // ============================================================
  { name: "There's An AI For That", url: "https://theresanaiforthat.com/", category: "ai-directory", selectors: { title: "h2, h3, .tool-name", link: "a[href*='/']", description: "p, .description" } },
  { name: "Toolify", url: "https://www.toolify.ai/", category: "ai-directory", selectors: { title: "h3, .tool-title", link: "a[href*='tool']", description: "p" } },
  { name: "Futurepedia", url: "https://www.futurepedia.io/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href*='tool']", description: "p" } },
  { name: "AITopTools", url: "https://aitoptools.com/", category: "ai-directory", selectors: { title: "h3, .entry-title", link: "a[href]", description: "p" } },
  { name: "TopAI.tools", url: "https://topai.tools/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "FutureTools", url: "https://www.futuretools.io/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Easy With AI", url: "https://easywithai.com/", category: "ai-directory", selectors: { title: "h3, .entry-title", link: "a[href]", description: "p" } },
  { name: "AI Mojo", url: "https://aimojo.io/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI-Hunter", url: "https://ai-hunter.io/", category: "ai-directory", selectors: { title: "h3", link: "a[href]", description: "p" } },
  { name: "What's the Big Data", url: "https://whatsthebigdata.com/", category: "ai-directory", selectors: { title: "h3, h2", link: "a[href]", description: "p" } },
  { name: "Best of AI", url: "https://bestofai.com/", category: "ai-directory", selectors: { title: "h3", link: "a[href]", description: "p" } },
  { name: "AI Tools Directory", url: "https://aitoolsdirectory.com/", category: "ai-directory", selectors: { title: "h3", link: "a[href]", description: "p" } },
  { name: "AIxploria", url: "https://www.aixploria.com/en/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Insidr AI Tools", url: "https://www.insidr.ai/ai-tools/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "GenAI Works", url: "https://genai.works/applications", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "WaytoAGI", url: "https://www.waytoagi.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI Agent Store", url: "https://aiagentstore.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "The Rundown AI Tools", url: "https://www.rundown.ai/tools", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Product Hunt AI", url: "https://www.producthunt.com/topics/artificial-intelligence", category: "ai-directory", selectors: { title: "h3, .post-item-title", link: "a[href*='/posts/']", description: "p" } },
  { name: "BetaList", url: "https://betalist.com/", category: "ai-directory", selectors: { title: "h3, .startup-name", link: "a[href]", description: "p" } },
  { name: "Launching Next", url: "https://www.launchingnext.com/", category: "ai-directory", selectors: { title: "h3, .startup-name", link: "a[href]", description: "p" } },
  { name: "AI Tools Ground", url: "https://aitoolsground.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI CentralHub", url: "https://aicentralhub.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AIToolsBox", url: "https://aitoolsbox.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AIGather", url: "https://aigather.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI Master Tools", url: "https://aimastertools.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "SwitchTools", url: "https://switchtools.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Flocci AI Tools", url: "https://flocciai.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI Match", url: "https://aimatch.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "I Love Free", url: "https://ilovefree.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // FREE-AI-SPECIFIC DIRECTORIES
  // ============================================================
  { name: "AI Free Tools", url: "https://aifreetools.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "SpotFreeAI", url: "https://spotfreeai.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "ScriptByAI", url: "https://scriptbyai.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "A.I. Maniacs", url: "https://aimaniacs.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Dat4 Free AI Tools", url: "https://dat4.ai/free-ai-tools/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "TechReel Free AI Tools", url: "https://techreel.com/free-ai-tools/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "There Is An AI Tool", url: "https://thereisanaitool.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "NavioHQ Free AI Tools", url: "https://naviohq.com/free-ai-tools/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "ProAI Tools", url: "https://proaitools.com/", category: "free-ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // SUBMISSION / STARTUP DIRECTORIES
  // ============================================================
  { name: "Dang AI", url: "https://dang.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AI Tools by Neil Patel", url: "https://neilpatel.com/ai-tools/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Find An AI Tool", url: "https://findanaitool.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Find My AI Tool", url: "https://findmyaitool.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Every AI", url: "https://everyai.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Elite AI Tools", url: "https://eliteaitools.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Good AI Tools", url: "https://goodaitools.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Fazier", url: "https://fazier.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "ToolScout", url: "https://toolscout.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // LLM MODEL CATALOGS / INFRASTRUCTURE
  // ============================================================
  { name: "OpenRouter Models", url: "https://openrouter.ai/models", category: "model-catalog", selectors: { title: "[class*='model-name'], h3, h4", link: "a[href*='/models/']", description: "[class*='description'], p" } },
  { name: "Hugging Face Trending Models", url: "https://huggingface.co/models?sort=trending", category: "model-catalog", selectors: { title: "h3, .model-name, a[class*='title']", link: "a[href*='/']", description: "p" } },
  { name: "Hugging Face Spaces", url: "https://huggingface.co/spaces", category: "model-catalog", selectors: { title: "h3, .space-name", link: "a[href*='/']", description: "p" } },
  { name: "Hugging Face Papers", url: "https://huggingface.co/papers", category: "research", selectors: { title: "h3, .paper-title", link: "a[href*='/papers/']", description: "p" } },
  { name: "Ollama Library", url: "https://ollama.com/library", category: "model-catalog", selectors: { title: "h3, .library-name", link: "a[href*='/library/']", description: "p" } },
  { name: "LM Studio Models", url: "https://lmstudio.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Replicate Models", url: "https://replicate.com/explore", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href*='/']", description: "p" } },
  { name: "Together AI Models", url: "https://www.together.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Fireworks AI Models", url: "https://fireworks.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Groq Models", url: "https://console.groq.com/docs/models", category: "model-catalog", selectors: { title: "h3, h4, td:first-child", link: "a[href]", description: "p" } },
  { name: "Cerebras Inference", url: "https://www.cerebras.ai/inference", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "DeepInfra Models", url: "https://deepinfra.com/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "NVIDIA NIM Catalog", url: "https://build.nvidia.com/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href*='/']", description: "p" } },
  { name: "Google AI Studio", url: "https://aistudio.google.com/", category: "model-catalog", selectors: { title: "h3", link: "a[href]", description: "p" } },
  { name: "Google AI Models", url: "https://ai.google.dev/gemini-api/docs/models", category: "model-catalog", selectors: { title: "h3, h4", link: "a[href]", description: "p" } },
  { name: "Mistral Models", url: "https://mistral.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Cohere Models", url: "https://cohere.com/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Hugging Face Inference Providers", url: "https://huggingface.co/inference-api", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  // ============================================================
  // MCP / AGENT ECOSYSTEM
  // ============================================================
  { name: "MCP Registry", url: "https://registry.modelcontextprotocol.io/", category: "mcp-directory", selectors: { title: "h3, .server-name", link: "a[href]", description: "p" } },
  { name: "MCP.so", url: "https://mcp.so/", category: "mcp-directory", selectors: { title: "h3, .server-name", link: "a[href]", description: "p" } },
  { name: "Smithery", url: "https://smithery.ai/", category: "mcp-directory", selectors: { title: "h3, .server-name", link: "a[href]", description: "p" } },
  { name: "Glama MCP", url: "https://glama.ai/mcp", category: "mcp-directory", selectors: { title: "h3, .server-name", link: "a[href]", description: "p" } },
  { name: "MCP Market", url: "https://mcpmarket.com/", category: "mcp-directory", selectors: { title: "h3, .server-name", link: "a[href]", description: "p" } },
  { name: "LangChain", url: "https://www.langchain.com/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "LangGraph", url: "https://www.langchain.com/langgraph", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "CrewAI", url: "https://www.crewai.com/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "AutoGen", url: "https://microsoft.github.io/autogen/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "LlamaIndex", url: "https://www.llamaindex.ai/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Dify", url: "https://dify.ai/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Flowise", url: "https://flowiseai.com/", category: "agent-framework", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "OpenHands", url: "https://www.all-hands.dev/", category: "coding-agent", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "OpenCode", url: "https://opencode.ai/", category: "coding-agent", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Aider", url: "https://aider.chat/", category: "coding-agent", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Cline", url: "https://cline.bot/", category: "coding-agent", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Roo Code", url: "https://roocode.com/", category: "coding-agent", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // FREE API / PRICING INTELLIGENCE
  // ============================================================
  { name: "OpenRouter Free Models", url: "https://openrouter.ai/models?pricing=free", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "Groq Pricing", url: "https://groq.com/pricing/", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "Together AI Pricing", url: "https://www.together.ai/pricing", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "Fireworks AI Pricing", url: "https://fireworks.ai/pricing", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "DeepInfra Pricing", url: "https://deepinfra.com/pricing", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "Google AI Pricing", url: "https://ai.google.dev/gemini-api/docs/pricing", category: "pricing", selectors: { title: "h3, h4", link: "a[href]", description: "p" } },
  { name: "Cloudflare Workers AI", url: "https://developers.cloudflare.com/workers-ai/", category: "free-api", selectors: { title: "h3, h4", link: "a[href]", description: "p" } },
  { name: "Mistral API", url: "https://console.mistral.ai/", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "Cohere API", url: "https://cohere.com/pricing", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  // ============================================================
  // BENCHMARKS / MODEL INTELLIGENCE
  // ============================================================
  { name: "LMArena Leaderboard", url: "https://arena.ai/leaderboard", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "Artificial Analysis", url: "https://artificialanalysis.ai/leaderboards/models", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "LiveBench", url: "https://livebench.ai/", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "Vellum LLM Leaderboard", url: "https://www.vellum.ai/llm-leaderboard", category: "benchmark", selectors: { title: "td:first-child, h3", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "HF Open LLM Leaderboard", url: "https://huggingface.co/open-llm-leaderboard", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "Scale AI SEAL", url: "https://scale.com/leaderboard", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "SWE-bench", url: "https://www.swebench.com/", category: "benchmark", selectors: { title: "td:first-child, .model-name", link: "a[href]", description: "td:nth-child(2)" } },
  { name: "Papers With Code", url: "https://paperswithcode.com/", category: "research", selectors: { title: "h3, .paper-title", link: "a[href]", description: "p" } },
  // ============================================================
  // AI IMAGE / VIDEO / AUDIO
  // ============================================================
  { name: "Civitai", url: "https://civitai.com/", category: "ai-directory", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Krea", url: "https://www.krea.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Leonardo AI", url: "https://leonardo.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Ideogram", url: "https://ideogram.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Luma AI", url: "https://lumalabs.ai/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Pika", url: "https://pika.art/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Kling AI", url: "https://klingai.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Hailuo AI", url: "https://hailuoai.video/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "ElevenLabs", url: "https://elevenlabs.io/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Suno", url: "https://suno.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Udio", url: "https://www.udio.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Fish Audio", url: "https://fish.audio/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Runway", url: "https://runwayml.com/", category: "ai-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // FREE LLM API AGGREGATORS
  // ============================================================
  { name: "freellm.net", url: "https://freellm.net/models/", category: "free-api", selectors: { title: "h3, .model-name, .provider-name", link: "a[href*='/models/']", description: "p, .rate-limit, .context" } },
  { name: "freellm.net - compare", url: "https://freellm.net/compare/", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "freellm.net - API keys", url: "https://freellm.net/free-llm-api-keys/", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "LLM Cloud Hub", url: "https://llmcloudhub.com/", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "LLM Cloud Hub - providers", url: "https://llmcloudhub.com/providers/", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href*='/providers/']", description: "p" } },
  { name: "LLM Endpoint", url: "https://llmendpoint.com/", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "FindLLM - models", url: "https://findllm.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "FindLLM - pricing", url: "https://findllm.ai/pricing", category: "pricing", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "WhereToAI - API relays", url: "https://wheretoai.org/api-relays", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "AIHubMix - free models", url: "https://aihubmix.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  // ============================================================
  // LLM API GATEWAYS / ROUTERS (TokenRouter-like)
  // ============================================================
  { name: "TokenRouter - models", url: "https://www.tokenrouter.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "TokenRouter - blog", url: "https://www.tokenrouter.com/blog", category: "provider-update", selectors: { title: "h3, .post-title", link: "a[href*='/blog/']", description: "p" } },
  { name: "OmniRoute - catalog", url: "https://omniroute.online/", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "LLM Gateway - models", url: "https://llmgateway.io/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "LLM Gateway - rankings", url: "https://llmgateway.io/rankings", category: "benchmark", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "LLM Gateway - pricing", url: "https://llmgateway.io/pricing", category: "pricing", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "LLM Gateway - providers", url: "https://llmgateway.io/providers", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href*='/providers/']", description: "p" } },
  { name: "FreeLLMAPI - models", url: "https://freellmapi.co/models.html", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "LiteLLM - docs", url: "https://docs.litellm.ai/docs/providers", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href]", description: "p" } },
  { name: "Portkey - models", url: "https://portkey.ai/docs/product/model-support", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Gratisfy - benchmarks", url: "https://gratisfy.xyz/", category: "benchmark", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Foreverse - price table", url: "https://foreverse.app/labs/price-table", category: "pricing", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Ramp Router - models", url: "https://ramp.com/blog/best-llm-gateways", category: "provider-update", selectors: { title: "h3, .gateway-name", link: "a[href]", description: "p" } },
  // ============================================================
  // MCP DIRECTORIES
  // ============================================================
  { name: "OpenTools MCP Registry", url: "https://opentools.com/", category: "mcp-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "Smithery MCP", url: "https://smithery.ai/", category: "mcp-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  { name: "MCP Hub", url: "https://mcp.so/", category: "mcp-directory", selectors: { title: "h3, .tool-name", link: "a[href]", description: "p" } },
  // ============================================================
  // CODING AGENTS & AI ASSISTANTS
  // ============================================================
  { name: "OpenRouter Models", url: "https://openrouter.ai/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "NVIDIA NIM Catalog", url: "https://build.nvidia.com/nim", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "HuggingFace Models", url: "https://huggingface.co/models", category: "model-catalog", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  // ============================================================
  // FREE LLM API DIRECTORIES & AGGREGATORS (new)
  // ============================================================
  { name: "freellm.net - providers", url: "https://freellm.net/providers", category: "free-api", selectors: { title: "h3, .provider-name", link: "a[href*='/providers/']", description: "p" } },
  { name: "freellm.net - use cases", url: "https://freellm.net/use-cases", category: "free-api", selectors: { title: "h3, .use-case", link: "a[href]", description: "p" } },
  { name: "Gratisfy - free models", url: "https://gratisfy.xyz/", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "api-hub.ai - models", url: "https://www.api-hub.ai/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Proxifai AI Gateway", url: "https://proxifai.com/ai-gateway", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "1vy - models", url: "https://1vy.ai/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "AIKVIST - models", url: "https://www.aikvist.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "AnyAPI - models", url: "https://anyapi.ai/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "ModelGates - models", url: "https://modelgates.ai/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "FreeAPIHub - models", url: "https://freeapihub.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "NVIDIA NIM catalog", url: "https://build.nvidia.com/nim", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "GitHub Models", url: "https://github.com/marketplace/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "ModelScope - free", url: "https://modelscope.cn/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href*='/models/']", description: "p" } },
  { name: "OVHcloud AI Endpoints", url: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Cloudflare Workers AI", url: "https://developers.cloudflare.com/workers-ai/models/", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Cohere models", url: "https://cohere.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "AI21 Labs models", url: "https://www.ai21.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "xAI models", url: "https://docs.x.ai/docs/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Alibaba Model Studio", url: "https://modelstudio.console.aliyun.com", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Nebius Studio", url: "https://studio.nebius.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  { name: "Nscale models", url: "https://nscale.com/models", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
  // ============================================================
  // KIE.AI — UNIFIED VIDEO / IMAGE / AUDIO / LLM API MARKETPLACE
  // ============================================================
  { name: "KIE Market - AI API models", url: "https://kie.ai/market", category: "model-catalog", selectors: { title: "h3, h4, .model-name", link: "a[href*='/market/']", description: "p" } },
  { name: "KIE Pricing", url: "https://kie.ai/pricing", category: "pricing", selectors: { title: "h3, .plan-name", link: "a[href]", description: "p" } },
  { name: "KIE Docs - quickstart", url: "https://docs.kie.ai/market/quickstart", category: "provider-update", selectors: { title: "h3, h4", link: "a[href]", description: "p" } },
  // ============================================================
  // FREEBUFF — 100% FREE CODING AGENT (AD-FUNDED)
  // ============================================================
  { name: "Freebuff - free coding agent", url: "https://freebuff.com/", category: "coding-agent", selectors: { title: "h3, .product-name", link: "a[href]", description: "p" } },
  { name: "Freebuff Blog", url: "https://freebuff.com/blog", category: "provider-update", selectors: { title: "h3, .post-title", link: "a[href*='/blog/']", description: "p" } },
  // ============================================================
  // HUGGING FACE — INFERENCE PROVIDERS / PLAYGROUND
  // ============================================================
  { name: "HF Inference Playground", url: "https://huggingface.co/playground", category: "free-api", selectors: { title: "h3, .model-name", link: "a[href]", description: "p" } },
];

export async function enqueue(db: any, kind: string, payload: any, priority = 5) {
  await db
    .prepare("INSERT INTO crawl_tasks (kind,payload,priority) VALUES (?,?,?)")
    .bind(kind, JSON.stringify(payload), priority)
    .run();
}

let sourcesSeeded = false;

export async function seedSourceRegistry(db: any) {
  if (sourcesSeeded) return;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM sources").first();
  if (!row?.n) {
    for (const s of STARTER_SOURCES) {
      let domain: string | null = null;
      try { domain = new URL(s.url).hostname; } catch { /* skip */ }
      await db
        .prepare(
          `INSERT OR IGNORE INTO sources (name,url,domain,type,category,tier,frequency_hours,parser,reliability)
           VALUES (?,?,?,?,?,?,?,?,70)`
        )
        .bind(s.name, s.url, domain, s.type, s.category, s.tier, s.tier === 1 ? 12 : 48, "rss-generic")
        .run();
    }
  }
  const tasks = await db.prepare("SELECT COUNT(*) AS n FROM crawl_tasks").first();
  if (!tasks?.n) {
    for (const q of GITHUB_SEARCH_QUERIES)
      await enqueue(db, "github_search", { q: q.q, label: q.label, category: q.category }, 3);
    for (const a of AWESOME_LISTS)
      await enqueue(db, "awesome_mine", { raw_url: a.raw, label: a.label, category: a.category }, 3);
    const srcs = await db.prepare("SELECT id FROM sources WHERE active=1").all();
    for (const s of srcs.results || []) await enqueue(db, "rss_fetch", { source_id: Number((s as any).id) }, 4);
    // Enqueue web scrape tasks for non-RSS sources
    for (const ws of WEB_SCRAPE_SOURCES) {
      await enqueue(db, "web_scrape", { source_name: ws.name, url: ws.url, category: ws.category }, 5);
    }
  }
  sourcesSeeded = true;
}

async function upsertGithubRepo(db: any, env: EnvLike, full_name: string): Promise<{ created: boolean; slug: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${full_name}`, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (res.status === 403 || res.status === 429) throw new Error("GITHUB_RATE_LIMIT");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github http ${res.status}`);
  const d: any = await res.json();
  const spdx = d.license?.spdx_id && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : null;
  const { components, total } = scoreGithubRepo(spdx, d.pushed_at);
  const slug = String(d.full_name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const topics: string[] = Array.isArray(d.topics) ? d.topics.slice(0, 10) : [];
  const desc = String(d.description || "").slice(0, 400);

  const altMatch = desc.match(/alternative (to|for)\s+([A-Za-z0-9_. -]{2,40})/i);
  const selfHosted = /self[- ]host|on[- ]premise/i.test(desc) || topics.includes("self-hosted");

  const category = guessCategoryFromTopics(topics, `${d.name} ${desc}`);

  const { id, created } = await upsertResource(db, {
    slug,
    name: d.name,
    description: desc,
    category,
    tags: topics,
    capabilities: guessCapabilities(`${d.name} ${desc} ${topics.join(" ")}`),
    url: d.html_url,
    docs_url: typeof d.homepage === "string" && /^https?:\/\//.test(d.homepage) ? d.homepage : null,
    github_url: d.html_url,
    resource_type: "repo",
    free_types: isOsi(spdx) ? ["open_source"] : [],
    personal_use: "yes",
    commercial_use: spdx ? "yes" : "unknown",
    license: spdx,
    card_required: "no",
    self_hostable: "yes",
    infrastructure_note: selfHosted ? "Explicitly designed for self-hosting." : null,
    alt_of: altMatch ? altMatch[2].trim().toLowerCase() : null,
    alt_kind: altMatch ? (selfHosted ? "open_source_alt" : "partial") : null,
    free_score: total,
    free_score_components: components,
    confidence_score: isOsi(spdx) ? 60 : 45,
    popularity: d.stargazers_count ?? null,
    forks: d.forks_count ?? null,
    github_last_push: d.pushed_at ?? null,
    origin: "crawler"
  });

  if (created) {
    await addEvidence(db, id, `${d.name} is licensed ${spdx || "without identifiable license"}`, d.html_url, `GitHub API: license=${spdx || "none"}, stars=${d.stargazers_count}, pushed=${String(d.pushed_at || "").slice(0, 10)}`, "github_api", 85);
    if (altMatch) {
      await addEvidence(db, id, `Positions itself as an alternative to ${altMatch[2].trim()}`, d.html_url, `Repository description states: "${desc}"`, "github_api", 75);
    }
    if (created && topics.length) await db.prepare("INSERT OR IGNORE INTO product_aliases (alias_lower,resource_id) VALUES (?,?)").bind(slug, id).run();
    await logEvent(db, "discovery", "GITHUB REPOSITORY DISCOVERED", `${d.full_name} — ${d.stargazers_count} stars · license ${spdx || "unknown"} · pushed ${String(d.pushed_at || "").slice(0, 10)}`, id);

    if (created && llmAvailable(env) && d.default_branch) {
      try {
        const readmeUrl = `https://raw.githubusercontent.com/${full_name}/${d.default_branch}/README.md`;
        const readmeRes = await fetch(readmeUrl, { headers: UA, signal: AbortSignal.timeout(8000) });
        if (readmeRes.ok) {
          const readmeText = (await readmeRes.text()).slice(0, 4000);
          const summaryRes = await llmJson(env, `You are a technical writer. Summarize this README in 2-3 sentences for a non-developer. Focus on: what it does, who it's for, key benefits. No jargon.\n\nProject: ${d.name}\nTopics: ${topics.join(", ")}\n\nREADME:\n${readmeText}\n\nRespond with JSON: {"summary":"..."}`, 300);
          if (summaryRes && typeof summaryRes.summary === "string" && summaryRes.summary.length > 30) {
            const betterDesc = summaryRes.summary.slice(0, 300);
            await db.prepare("UPDATE resources SET description=? WHERE id=?").bind(betterDesc, id).run();
            await addEvidence(db, id, "LLM-summarized description from README", readmeUrl, betterDesc.slice(0, 400), "llm_summarize", 70);
          }
        }
      } catch { /* README fetch/LLM failure is non-fatal */ }
    }
  }
  return { created, slug };
}

function guessCategoryFromTopics(topics: string[], text: string): string {
  const t = `${topics.join(" ")} ${text}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/mcp|model.context.protocol/, "MCP"],
    [/\bagent|agentic|crew|swarm|autogen|langgraph/, "AI Agents"],
    [/\bllm|\bgpt\b|inference|language.model|ollama|vllm|gguf|llama|mistral|openai|anthropic|claude|gemini|deepseek/, "LLM / AI Assistant"],
    [/ocr|pdf|document.pars|invoice|receipt/, "OCR / Document Processing"],
    [/vector|embedding.store|pgvector|qdrant|weaviate|milvus|chromadb/, "Vector Database"],
    [/postgres|mysql|sqlite|mongodb|database|supabase|firebase/, "Database"],
    [/workflow|automation|zapier|n8n|make\.com|rpa|etl|pipeline/, "Workflow Automation"],
    [/hosting|deploy|paas|serverless|edge|docker|kubernetes|k8s/, "Infrastructure"],
    [/uptime|monitoring|observab|grafana|prometheus|datadog|sentry|alerting/, "Monitoring"],
    [/text.to.speech|tts|speech|transcri|whisper|stt|voice|audio|music|suno|elevenlabs/, "Audio / Speech"],
    [/image.generat|stable.diffusion|flux\b|text.to.image|midjourney|dall.?e|diffusion|comfyui|civitai/, "Image Generation"],
    [/video.generat|text.to.video|runway|pika|luma|kling|sora/, "Video Generation"],
    [/scrap|crawl(er|ing)|puppeteer|playwright|browser.automation|headless/, "Web Scraping"],
    [/recruit|applicant.tracking|\bats\b|hiring|resume|talent|hr\b/, "HR / Recruiting"],
    [/design.tool|figma|vector.graphics|whiteboard|diagram|ui|ux/, "Design"],
    [/todo|notes|knowledge.base|second.brain|productivity|calendar|notion|obsidian/, "Productivity"],
    [/crm|customer.relationship|sales|pipeline|lead/, "CRM"],
    [/email|newsletter|mailing|smtp|sendgrid|mailgun/, "Email Marketing"],
    [/analytics|metrics|telemetry|insights|tracking|plausible|matomo/, "Analytics"],
    [/security|auth|identity|oauth|sso|vault|password|encrypt/, "Security / Auth"],
    [/chat|messaging|slack|discord|matrix|irc|xmpp|websocket/, "Communication"],
    [/video|streaming|zoom|meet|webrtc|rtc|telephon/, "Video Conferencing"],
    [/ci.?cd|github.actions|gitlab.ci|jenkins|drone|build|test|deploy|release/, "CI / CD"],
    [/code.editor|ide|vscode|intellij|vim|neovim|emacs/, "Code Editor"],
    [/coding|code.completion|copilot|code.review|lint|format|debug/, "Code Assistant"],
    [/transformer|diffusion|reinforcement|deep.learning|neural|torch|tensorflow|pytorch|jax/, "ML Framework"],
    [/huggingface|hugging.face|model.hub|pretrain|finetun|lora|qlora/, "ML Platform"],
    [/alternative|replace|self.hosted|open.source.alternative/, "Alternatives"],
    [/free.tier|free.api|free.credits|free.plan|pricing/, "APIs"],
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  if (topics.length > 0) return "Developer Tools";
  return "Tool";
}

function guessCapabilities(text: string): string[] {
  const t = text.toLowerCase();
  const caps: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/mcp|model context protocol/, "mcp"],
    [/\bagent|agentic|crew|swarm/, "agent-framework"],
    [/\bllm|\bgpt\b|inference|language model|ollama|vllm|gguf/, "llm-inference"],
    [/ocr|pdf|document pars|invoice|receipt/, "ocr-document-parsing"],
    [/vector|embedding store|pgvector|qdrant|weaviate|milvus|chromadb/, "vector-database"],
    [/postgres|mysql|sqlite|mongodb|database/, "database"],
    [/workflow|automation|zapier|n8n|make\.com|rpa/, "workflow-automation"],
    [/hosting|deploy|paas|serverless|edge/, "hosting-deploy"],
    [/uptime|monitoring|observab|grafana|prometheus|datadog/, "monitoring-observability"],
    [/text.to.speech|tts|speech recognition|transcri|whisper|stt/, "speech-audio"],
    [/image generat|stable diffusion|flux\b|text.to.image/, "image-generation"],
    [/video generat|text.to.video/, "video-generation"],
    [/scrap|crawl(er|ing)|puppeteer|playwright|browser automation/, "web-scraping"],
    [/recruit|applicant tracking|\bats\b|hiring pipeline|resume screen/, "hr-recruiting"],
    [/design tool|figma|vector graphics|whiteboard|diagram/, "design"],
    [/todo|notes|knowledge base|second brain|productivity|calendar/, "productivity"]
  ];
  for (const [re, cap] of map) if (re.test(t)) caps.push(cap);
  return caps.slice(0, 3);
}

async function taskGithubSearch(db: any, env: EnvLike, p: any) {
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(p.q)}&sort=stars&order=desc&per_page=15`,
    { headers: ghHeaders(env.GITHUB_TOKEN) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[github-search] HTTP ${res.status} body: ${body.slice(0, 250)}`);
    throw new Error(`GITHUB_RATE_LIMIT|status=${res.status}|${body.slice(0, 180)}`);
  }
  const data: any = await res.json();
  let found = 0;
  for (const item of data.items || []) {
    if (/^awesome[-_]/i.test(String(item.name))) continue;
    if (/^list-of|^curated/i.test(String(item.name))) continue;
    const r = await upsertGithubRepo(db, env, item.full_name);
    if (r?.created) found++;
  }
  await logEvent(db, "discovery", `GITHUB SWEEP COMPLETE: ${String(p.label).toUpperCase()}`, `${(data.items || []).length} examined · ${found} new resources published to database.`, null);
}

async function taskAwesomeMine(db: any, env: EnvLike, p: any) {
  const res = await fetch(p.raw_url, { headers: UA });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const md = await res.text();
  const seen = new Set<string>();
  const re = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  let queued = 0;
  while ((m = re.exec(md)) && queued < 60) {
    const full = m[1].replace(/\.git$/, "");
    if (seen.has(full)) continue;
    seen.add(full);
    if (/^(topics|collections|about)/i.test(full)) continue;
    const dupe = await db.prepare("SELECT id FROM resources WHERE github_url LIKE ?").bind(`%${full}%`).first();
    if (dupe) continue;
    await enqueue(db, "github_repo", { full_name: full, via: p.label, category: p.category }, 6);
    queued++;
  }
  await logEvent(db, "system", `SOURCE MINED: ${String(p.label).toUpperCase()}`, `${queued} new repository candidates queued for verification.`, null);
}

async function taskGithubRepo(db: any, env: EnvLike, p: any) {
  await upsertGithubRepo(db, env, p.full_name);
}

async function taskRssFetch(db: any, env: EnvLike, p: any) {
  void env;
  const src = await db.prepare("SELECT * FROM sources WHERE id=?").bind(p.source_id).first();
  if (!src) return;
  try {
    const res = await fetch(src.url, { headers: UA });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const items = parseFeed(await res.text());
    let signals = 0;
    for (const it of items.slice(0, 20)) {
      const text = `${it.title} ${it.summary}`;
      if (!/\bfree\b|open.?source|credits?|free tier|no cost|promotion|alternative|self.?host/i.test(text)) continue;
      signals++;

      const isCredit = /\bcredit|free.?tier|\bfree\b/i.test(text);
      const isLimited = /\bpromotion|limited.?time|special.?offer|discount|sale/i.test(text);
      const isOSS = /open.?source|self.?host|github\.com/i.test(text);
      const freeTypes: string[] = [];
      if (isCredit) freeTypes.push("free_tier");
      if (isLimited) freeTypes.push("limited_promotion");
      if (isOSS) freeTypes.push("open_source");

      const gh = it.summary.match(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
      let slug: string | null = null;
      if (gh) {
        slug = gh[1].toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const dupe = await db.prepare("SELECT id FROM resources WHERE slug=? OR github_url LIKE ?").bind(slug, `%${gh[1]}%`).first();
        if (!dupe) {
          await upsertResource(db, {
            slug, name: it.title.slice(0, 80), description: it.summary?.slice(0, 300) || undefined,
            url: it.link, github_url: `https://github.com/${gh[1]}`, category: src.category || "Tool",
            resource_type: "repo", free_types: freeTypes.length ? freeTypes : ["free_tier"],
            free_score: 75, origin: "rss"
          });
        } else {
          slug = null;
        }
      } else {
        const itemSlug = slugify(it.title?.slice(0, 60) || "unknown");
        const dupe = await db.prepare("SELECT id FROM resources WHERE slug=?").bind(itemSlug).first();
        if (!dupe) {
          await upsertResource(db, {
            slug: itemSlug, name: it.title?.slice(0, 80) || "Unknown", description: it.summary?.slice(0, 300) || undefined,
            url: it.link, category: src.category || "Tool", resource_type: "article",
            free_types: freeTypes.length ? freeTypes : ["free_tier"], free_score: 65, origin: "rss"
          });
          slug = itemSlug;
        }
      }

      if (slug) await logEvent(db, "discovery", "DEAL DISCOVERED VIA RSS", `"${it.title.slice(0, 110)}" — ${it.link}`, null);
      else await logEvent(db, /credit|promotion|limited/i.test(text) ? "promotion" : "discovery", "FREE SIGNAL IN MONITORED SOURCE", `"${it.title.slice(0, 110)}" — ${it.link}`, null);
    }
    await db.prepare("UPDATE sources SET last_checked=datetime('now'), error_count=0, reliability=MIN(100,reliability+1) WHERE id=?").bind(src.id).run();
    if (!signals) await logEvent(db, "system", "SOURCE CHECKED — NO NEW SIGNALS", `${src.name}: ${items.length} items scanned, none matched free-resource criteria.`, null);
  } catch (e: any) {
    await db.prepare("UPDATE sources SET last_checked=datetime('now'), error_count=error_count+1, last_error=?, reliability=MAX(0,reliability-5), status=CASE WHEN error_count+1>=8 THEN 'failing' ELSE status END WHERE id=?").bind(String(e?.message || e).slice(0, 200), src.id).run();
    throw e;
  }
}

function extractPriceSnippets(text: string): string[] {
  const out: string[] = [];
  const priceRe = /[^\n.]{0,140}(?:\$|USD\s?)\s?\d+(?:[.,]\d+)?(?:\s*\/?\s*(?:mo|month|user|seat|per month))?[^.\n]{0,100}/gi;
  const matches = text.match(priceRe) || [];
  for (const m of matches.slice(0, 8)) out.push(m.trim());
  const freeRe = /[^\n.]{0,120}\bfree(?:\s+\w+){0,6}[^\n.]{0,80}/gi;
  for (const m of (text.match(freeRe) || []).slice(0, 5)) out.push(m.trim());
  return out;
}

async function taskPricingCheck(db: any, env: EnvLike, p: any) {
  const r = await db.prepare("SELECT * FROM resources WHERE slug=?").bind(p.slug).first();
  if (!r?.pricing_url) return;
  const res = await fetch(r.pricing_url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`pricing page http ${res.status}`);
  const raw = await res.text();
  const norm = normalizePage(raw);
  const hash = await sha256Hex(norm);
  const changed = !!r.content_hash && r.content_hash !== hash;

  await db.prepare("UPDATE resources SET content_hash=?, price_last_checked=datetime('now'), updated_at=datetime('now') WHERE id=?").bind(hash, r.id).run();

  if (changed) {
    await logEvent(db, "promotion", "PRICING PAGE CHANGED", `${r.name} pricing content differs from previous crawl. Stored pricing claims downgraded to UNVERIFIED until re-extraction.`, r.id, "warn");
    await db.prepare("UPDATE resources SET plans_json=NULL WHERE id=?").bind(r.id).run();
  }

  let extracted: any = null;
  if (llmAvailable(env)) {
    extracted = await extractPricingFromText(env, norm.replace(/\s+/g, " "));
  }
  const snippets = extractPriceSnippets(norm);

  if (extracted && Array.isArray(extracted.plans) && extracted.plans.length) {
    const cleanPlans = extracted.plans
      .filter((pl: any) => pl && typeof pl.name === "string")
      .slice(0, 8)
      .map((pl: any) => ({
        name: String(pl.name).slice(0, 60),
        price_month: typeof pl.price_month === "number" ? pl.price_month : null,
        billing: pl.billing ?? null,
        has_free_tier: !!pl.has_free_tier
      }));
    await db.prepare("UPDATE resources SET plans_json=? WHERE id=?").bind(JSON.stringify(cleanPlans), r.id).run();
    const conf = Math.min(75, Number(extracted.confidence) || 55);
    await addEvidence(db, r.id, `Extracted ${cleanPlans.length} plan(s) from official pricing page`, r.pricing_url, JSON.stringify(cleanPlans).slice(0, 500), "llm_extract", conf);
    for (const q of (extracted.quotes || []).slice(0, 3)) {
      if (typeof q === "string" && q.length > 10) await addEvidence(db, r.id, "Verbatim quote from pricing page", r.pricing_url, q, "http", conf);
    }
    const freeTierPlan = cleanPlans.some((pl: any) => pl.has_free_tier || pl.price_month === 0);
    if (freeTierPlan && !(j<string[]>(r.free_types, [])).includes("free_tier")) {
      const ft = j<string[]>(r.free_types, []);
      ft.push("free_tier");
      await db.prepare("UPDATE resources SET free_types=? WHERE id=?").bind(JSON.stringify(ft), r.id).run();
      await logEvent(db, "discovery", "FREE TIER CONFIRMED", `${r.name} pricing page shows a free plan/allowance.`, r.id);
    }
  }

  for (const s of snippets.slice(0, 6)) {
    await addEvidence(db, r.id, changed ? "Pricing page snippet captured after detected change" : "Verbatim snippet from official pricing page", r.pricing_url, s, "http", 45);
  }

  if (!changed && !snippets.length && !extracted) {
    await addEvidence(db, r.id, "Page reachable; no machine-readable pricing patterns found", r.pricing_url, null, "http", 30);
  }
}

async function taskVerifyResource(db: any, env: EnvLike, p: any) {
  const r = await db.prepare("SELECT * FROM resources WHERE slug=?").bind(p.slug).first();
  if (!r) return;
  if (r.github_url) {
    const path = ghRepoPath(r.github_url);
    if (!path) return;
    const res = await fetch(`https://api.github.com/repos/${path}`, { headers: ghHeaders(env.GITHUB_TOKEN) });
    if (res.status === 403 || res.status === 429) throw new Error("GITHUB_RATE_LIMIT");
    if (res.status === 404) {
      await db.prepare("UPDATE resources SET verification_status='expired', updated_at=datetime('now') WHERE id=?").bind(r.id).run();
      await logEvent(db, "expiration", "REPOSITORY GONE (404)", `${r.name} no longer exists on GitHub. Moved out of active listings; record retained.`, r.id, "critical");
      return;
    }
    if (!res.ok) throw new Error(`github http ${res.status}`);
    const d: any = await res.json();
    const spdx = d.license?.spdx_id && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : null;
    await db.prepare("UPDATE resources SET popularity=?, forks=?, github_last_push=?, license=COALESCE(?,license), last_verified=datetime('now'), confidence_score=MIN(90,confidence_score+6), verification_status=CASE WHEN verification_status='discovered' THEN 'verified' ELSE verification_status END, updated_at=datetime('now') WHERE id=?")
      .bind(d.stargazers_count ?? null, d.forks_count ?? null, d.pushed_at ?? null, spdx, r.id).run();
    await addEvidence(db, r.id, `Live check: license ${spdx || "unidentified"}, ${d.stargazers_count} stars`, d.html_url, `pushed ${String(d.pushed_at || "").slice(0, 10)}${d.archived ? " · ARCHIVED" : ""}`, "github_api", 80);
    if (d.archived) await logEvent(db, "expiration", "REPOSITORY ARCHIVED UPSTREAM", `${r.name} marked archived by maintainers — maintenance risk.`, r.id, "warn");
    return;
  }
  if (r.url) {
    const res = await fetch(r.url, { headers: UA, redirect: "follow" });
    if (res.status === 404 || res.status === 410) {
      await db.prepare("UPDATE resources SET verification_status='expired', updated_at=datetime('now') WHERE id=?").bind(r.id).run();
      await logEvent(db, "expiration", "RESOURCE PAGE GONE", `${r.name} returned HTTP ${res.status}. Removed from active listings; record retained.`, r.id, "critical");
      return;
    }
    await db.prepare("UPDATE resources SET last_verified=datetime('now'), confidence_score=MIN(90,confidence_score+?), verification_status=CASE WHEN verification_status='discovered' THEN 'verified' ELSE verification_status END, updated_at=datetime('now') WHERE id=?")
      .bind(res.ok ? 5 : -5, r.id).run();
    await addEvidence(db, r.id, `HTTP ${res.status} at verification time`, r.url, null, "http", 50);
  }
}

async function taskWebScrape(db: any, env: EnvLike, p: any) {
  const src = WEB_SCRAPE_SOURCES.find(s => s.name === p.source_name);
  if (!src) return;
  try {
    const res = await fetch(src.url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const html = await res.text();
    const norm = normalizePage(html);

    // Extract links and titles from the HTML
    const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{3,120})<\/a>/gi;
    let m: RegExpExecArray | null;
    let found = 0;
    const seen = new Set<string>();

    while ((m = linkRe.exec(html)) && found < 30) {
      const href = m[1];
      const text = m[2].trim();
      if (!text || text.length < 3 || text.length > 120) continue;
      if (/^(Home|About|Contact|Login|Sign|Menu|Nav|FAQ|Privacy|Terms)/i.test(text)) continue;

      let fullUrl = href;
      if (href.startsWith("/")) {
        try { fullUrl = new URL(href, src.url).href; } catch { continue; }
      }
      if (!fullUrl.startsWith("http")) continue;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      // Filter for tool-like links (not navigation)
      const isToolLink = /tool|app|model|agent|server|platform|service|api|library|framework|alternative|free|open/i.test(text) ||
                         /github\.com|producthunt\.com|huggingface\.co/i.test(fullUrl);
      if (!isToolLink && src.category !== "pricing") continue;

      const slug = slugify(text.slice(0, 60));
      const dupe = await db.prepare("SELECT id FROM resources WHERE slug=? OR url=?").bind(slug, fullUrl).first();
      if (dupe) continue;

      // Check if it's a GitHub repo
      const ghMatch = fullUrl.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
      if (ghMatch) {
        const ghSlug = ghMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const ghDupe = await db.prepare("SELECT id FROM resources WHERE slug=? OR github_url LIKE ?").bind(ghSlug, `%${ghMatch[1]}%`).first();
        if (!ghDupe) {
          await enqueue(db, "github_repo", { full_name: ghMatch[1], via: src.name, category: src.category }, 5);
          found++;
        }
      } else {
        await upsertResource(db, {
          slug,
          name: text.slice(0, 80),
          description: `Discovered from ${src.name} directory listing.`,
          url: fullUrl,
          category: src.category,
          resource_type: "saas",
          free_types: ["free_tier"],
          free_score: 60,
          origin: "web-scrape"
        });
        found++;
      }
    }

    await db.prepare("UPDATE sources SET last_checked=datetime('now'), error_count=0, reliability=MIN(100,reliability+1) WHERE name=?").bind(src.name).run();
    if (found) await logEvent(db, "discovery", `WEB SCRAPE COMPLETE: ${src.name.toUpperCase()}`, `${found} new resources discovered from ${src.url}`, null);
    else await logEvent(db, "system", "WEB SCRAPE — NO NEW SIGNALS", `${src.name}: ${seen.size} links examined, none matched free-resource criteria.`, null);
  } catch (e: any) {
    await db.prepare("UPDATE sources SET last_checked=datetime('now'), error_count=error_count+1, last_error=?, reliability=MAX(0,reliability-5) WHERE name=?")
      .bind(String(e?.message || e).slice(0, 200), src.name).run();
    throw e;
  }
}

async function verifyStaleChunk(db: any, env: EnvLike, budget: number): Promise<number> {
  const rows = await db.prepare(
    `SELECT slug FROM resources
     WHERE verification_status != 'expired'
       AND (url IS NOT NULL OR github_url IS NOT NULL)
       AND (last_verified IS NULL OR last_verified < datetime('now','-7 days'))
     ORDER BY last_verified IS NOT NULL, confidence_score ASC LIMIT ?`
  ).bind(budget).all();
  let done = 0;
  for (const row of rows.results || []) {
    try {
      await taskVerifyResource(db, env, { slug: (row as any).slug });
      done++;
    } catch (e: any) {
      if (/RATE_LIMIT/.test(String(e?.message))) break;
    }
  }
  return done;
}

async function runExpirationSweep(db: any): Promise<number> {
  const due = await db.prepare(
    `SELECT id, name, slug FROM resources
     WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND verification_status != 'expired'`
  ).all();
  for (const r of due.results || []) {
    await db.prepare("UPDATE resources SET verification_status='expired', updated_at=datetime('now') WHERE id=?").bind(r.id).run();
    await logEvent(db, "expiration", "OFFER EXPIRED", `${r.name} passed its FREE UNTIL date. Removed from active opportunities; historical record retained.`, r.id, "critical");
  }
  return (due.results || []).length;
}

export async function enqueueInitialDiscovery(db: any, env: EnvLike) {
  void env;
  await seedSourceRegistry(db);
  const stats = await db.prepare("SELECT COUNT(*) AS n FROM crawl_tasks WHERE status='pending'").first();
  return { pending: Number(stats?.n || 0) };
}

export async function processCrawlBatch(
  env: EnvLike,
  opts: { maxFetches?: number; delayMs?: number } = {}
): Promise<{ processed: number; discovered: number; verified: number; expired: number; errors: string[] }> {
  const db = env.DB;
  const maxFetches = opts.maxFetches ?? 25;
  const delayMs = opts.delayMs ?? 0;
  const wait = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  let fetchBudget = maxFetches;
  let processed = 0;
  const errors: string[] = [];
  let discovered = 0;
  let verified = 0;
  let expired = 0;
  let githubBlocked = false;

  await seedSourceRegistry(db);
  expired += await runExpirationSweep(db);

  while (fetchBudget > 0) {
    const task = await db
      .prepare("SELECT * FROM crawl_tasks WHERE status='pending' ORDER BY priority ASC, id ASC LIMIT 1")
      .first();
    if (!task) break;

    await db.prepare("UPDATE crawl_tasks SET status='running', attempts=attempts+1 WHERE id=?").bind(task.id).run();

    const payload = j<any>(task.payload, {});
    try {
      switch (task.kind) {
        case "github_search": {
          if (githubBlocked) throw new Error("deferred");
          const before = await countResources(db);
          await taskGithubSearch(db, env, payload);
          discovered += Math.max(0, (await countResources(db)) - before);
          break;
        }
        case "awesome_mine":
          await taskAwesomeMine(db, env, payload);
          break;
        case "github_repo": {
          if (githubBlocked) throw new Error("deferred");
          const before = await countResources(db);
          await taskGithubRepo(db, env, payload);
          if ((await countResources(db)) > before) discovered++;
          break;
        }
        case "rss_fetch":
          await taskRssFetch(db, env, payload);
          break;
        case "pricing_check":
          await taskPricingCheck(db, env, payload);
          break;
        case "verify_resource": {
          const before = await countVerified(db);
          await taskVerifyResource(db, env, payload);
          verified += Math.max(0, (await countVerified(db)) - before);
          break;
        }
        case "web_scrape": {
          const before = await countResources(db);
          await taskWebScrape(db, env, payload);
          discovered += Math.max(0, (await countResources(db)) - before);
          break;
        }
        default:
          throw new Error(`unknown task kind ${task.kind}`);
      }
      await db.prepare("UPDATE crawl_tasks SET status='done', completed_at=datetime('now') WHERE id=?").bind(task.id).run();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/GITHUB_RATE_LIMIT/.test(msg)) {
        githubBlocked = true;
        await db.prepare("UPDATE crawl_tasks SET status='pending', last_error='rate limited' WHERE id=?").bind(task.id).run();
        errors.push("GitHub rate limit reached — remaining GitHub tasks deferred to next batch.");
      } else if (msg === "deferred") {
        await db.prepare("UPDATE crawl_tasks SET status='pending' WHERE id=?").bind(task.id).run();
        break;
      } else {
        errors.push(`${task.kind}: ${msg.slice(0, 120)}`);
        const attempts = Number(task.attempts || 1);
        await db
          .prepare("UPDATE crawl_tasks SET status=?, last_error=?, completed_at=CASE WHEN ?>=3 THEN datetime('now') ELSE NULL END WHERE id=?")
          .bind(attempts >= 3 ? "error" : "pending", msg.slice(0, 200), attempts, task.id)
          .run();
      }
    }
    fetchBudget--;
    processed++;
    await wait();
  }

  if (fetchBudget > 0) {
    verified += await verifyStaleChunk(db, env, fetchBudget);
  }

  if (processed > 0 || expired > 0) {
    await db.prepare(
      `INSERT INTO scans (kind,status,finished_at,tasks_done,discovered,verified,expired,notes)
       VALUES ('batch','complete',datetime('now'),?,?,?,?,?)`
    )
      .bind(processed, discovered, verified, expired, errors.length ? errors.join(" | ").slice(0, 400) : null)
      .run();
  }

  return { processed, discovered, verified, expired, errors };
}

async function countResources(db: any) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM resources").first();
  return Number(r?.n || 0);
}
async function countVerified(db: any) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM resources WHERE verification_status='verified'").first();
  return Number(r?.n || 0);
}

export async function resolveProductUrls(
  db: any,
  env: EnvLike,
  productName: string
): Promise<{ resource_id: number | null; resolved: boolean; blocked?: boolean }> {
  const lower = productName.toLowerCase();
  const alias = await db.prepare("SELECT resource_id FROM product_aliases WHERE alias_lower=?").bind(lower).first();
  if (alias) return { resource_id: Number(alias.resource_id), resolved: true };
  const like = await db.prepare(
    `SELECT id FROM resources WHERE LOWER(name)=? OR slug=? LIMIT 1`
  ).bind(lower, lower).first();
  if (like) return { resource_id: Number(like.id), resolved: true };

  const candidates = await suggestProductUrls(env, productName);
  let sawBlock = false;

  for (const cand of candidates) {
    for (const url of [cand.pricing, cand.site]) {
      if (!url) continue;
      try {
        const res = await fetch(url, { headers: { ...UA, Accept: "text/html" }, redirect: "follow" });
        if (res.status === 403 || res.status === 429 || res.status === 503) {
          sawBlock = true;
          continue;
        }
        if (!res.ok) continue;
        const finalUrl = res.url || url;
        const html = await res.text();
        const title = html.match(/<title[^>]*>([^<]{3,120})/i)?.[1]?.trim() || productName;
        const norm = normalizePage(html);
        const hasPricingSignals = /\bfree\b|\bpricing\b|\bplan\b|\$\d/.test(norm.slice(0, 20000));
        const pricingUrl = /pricing|plans/i.test(finalUrl) ? finalUrl : cand.pricing || null;
        const { id } = await upsertResource(db, {
          slug: slugify(productName),
          name: productName.charAt(0).toUpperCase() + productName.slice(1),
          description: `Commercial product resolved via official site (${finalUrl}). Pricing claims pending page verification.`,
          url: finalUrl,
          pricing_url: pricingUrl,
          category: "SaaS",
          resource_type: "saas",
          origin: "resolver"
        });
        await registerAlias(db, productName, id);
        await addEvidence(db, id, `Official site reachable at ${finalUrl}`, finalUrl, `Page title: "${title}"${hasPricingSignals ? " · pricing language detected" : ""}`, "http", 65);
        await logEvent(db, "discovery", "PRODUCT RESOLVED FOR COST ANALYSIS", `${productName} → ${finalUrl}`, id);
        return { resource_id: id, resolved: true };
      } catch { /* try next candidate */ }
    }
  }
  return { resource_id: null, resolved: false, blocked: sawBlock };
}

export async function autoVerifySlug(db: any, env: EnvLike, slug: string) {
  const before = await countVerified(db);
  await taskVerifyResource(db, env, { slug });
  return { verifiedDelta: (await countVerified(db)) - before };
}
