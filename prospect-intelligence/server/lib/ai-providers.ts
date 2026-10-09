export interface AIProvider {
  name: string;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateJSON<T>(prompt: string, options?: GenerateOptions): Promise<T>;
  getQuotaStatus(): Promise<QuotaStatus>;
  isAvailable(): boolean;
  getStatus(): { name: string; available: boolean; consecutiveFailures: number; lastError: string | null };
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface QuotaStatus {
  available: boolean;
  remaining?: number;
  resetTime?: Date;
  error?: string;
}

export abstract class BaseProvider implements AIProvider {
  abstract name: string;
  protected available = true;
  protected lastError: string | null = null;
  protected consecutiveFailures = 0;
  protected lastFailureTime: number = 0;
  protected readonly maxConsecutiveFailures = 3;
  protected readonly circuitBreakerTimeout = 5 * 60 * 1000; // 5 minutes

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    throw new Error("Not implemented");
  }

  async generateJSON<T>(prompt: string, options?: GenerateOptions): Promise<T> {
    const text = await this.generate(prompt, options);
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(raw);
  }

  abstract getQuotaStatus(): Promise<QuotaStatus>;

  isAvailable(): boolean {
    if (!this.available) return false;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      if (Date.now() - this.lastFailureTime > this.circuitBreakerTimeout) {
        this.resetCircuitBreaker();
        return true;
      }
      return false;
    }
    return true;
  }

  protected recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.available = true;
  }

  protected recordFailure(error: string): void {
    this.consecutiveFailures++;
    this.lastError = error;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.available = false;
    }
  }

  protected resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.available = true;
  }

  getStatus() {
    return {
      name: this.name,
      available: this.isAvailable(),
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
    };
  }
}