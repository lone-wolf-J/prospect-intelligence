import { BaseProvider, AIProvider, GenerateOptions, QuotaStatus } from "../ai-providers.js";

let GroqClass: any = null;

async function loadGroq() {
  if (!GroqClass) {
    const mod = await import("groq-sdk");
    GroqClass = mod.Groq || mod.default?.Groq || mod.default;
  }
  return GroqClass;
}

export class GroqProvider extends BaseProvider implements AIProvider {
  name = "groq";
  private client: any = null;
  private model = "openai/gpt-oss-20b";

  private async getClient(): Promise<any> {
    if (!this.client) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("GROQ_API_KEY not set");
      const Groq = await loadGroq();
      this.client = new Groq({ apiKey: key });
      console.log("[GroqProvider] Client created on first use");
    }
    return this.client;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.isAvailable()) throw new Error("Groq unavailable");

    const isRateLimit = (e: any) => {
      const msg = e?.message || String(e);
      return msg.includes("429") || /rate|quota|tpm/i.test(msg) || e?.status === 429;
    };

    try {
      const promptTokens = Math.ceil(prompt.length / 3.3);
      const requested = options?.maxTokens ?? 8192;
      // Free-tier TPM is 8000 tokens counted as prompt + max_tokens; keep the
      // whole request inside the window or Groq 429s before generating.
      const maxTokens = Math.max(1500, Math.min(requested, 7600 - promptTokens));
      console.log("[GroqProvider] Prompt length:", prompt.length, "chars, max_tokens:", maxTokens);
      console.log("[GroqProvider] Generating with model:", this.model);
      const client = await this.getClient();
      const call = () => client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature ?? 0.3,
        max_tokens: maxTokens,
      });
      let res: any;
      try {
        res = await call();
      } catch (first: any) {
        if (!isRateLimit(first)) {
          this.recordFailure(first.message || String(first));
          console.warn("[GroqProvider] Generation failed:", first.message);
          throw first;
        }
        // Rolling TPM window resets in seconds — wait it out, retry once.
        console.warn("[GroqProvider] Rate limit hit:", first.message, "| waiting 8s then retrying once");
        await new Promise((r) => setTimeout(r, 8000));
        try {
          res = await call();
        } catch (second: any) {
          this.recordFailure("QUOTA_EXCEEDED");
          console.warn("[GroqProvider] Rate limit persists after retry");
          throw new Error("QUOTA_EXCEEDED");
        }
      }
      const text = res.choices[0]?.message?.content;
      if (!text) throw new Error("Empty response");
      this.recordSuccess();
      console.log("[GroqProvider] Generation successful, usage:", res.usage);
      return text;
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg === "QUOTA_EXCEEDED") throw e;
      const isRate = msg.includes("429") || /rate|quota|tpm/i.test(msg) || e.status === 429;
      if (isRate) {
        this.recordFailure("QUOTA_EXCEEDED");
        throw new Error("QUOTA_EXCEEDED");
      }
      this.recordFailure(msg);
      console.warn("[GroqProvider] Generation failed:", msg);
      throw e;
    }
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    try {
      await this.getClient();
      return { available: this.isAvailable() };
    } catch {
      return { available: false, error: "GROQ_API_KEY not set" };
    }
  }
}