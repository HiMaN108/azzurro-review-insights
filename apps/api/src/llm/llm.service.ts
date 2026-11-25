import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../collector/retry.js';
import { chatJson, LlmError, LlmOutputError, LlmRateLimitError, LlmUnavailableError, type LlmConfig, type LlmJsonResponse } from './llm.client.js';

/** A 429 asking us to wait longer than this means the daily quota is used up. */
export const DAILY_QUOTA_WAIT_MS = 120_000;

export class NoProviderAvailableError extends Error {
  readonly name = 'NoProviderAvailableError';
}

/**
 * Shared AI provider configuration (primary + fallback chain) used by review tagging and
 * "Ask the reviews". Every provider is an OpenAI-compatible chat endpoint.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);

  constructor(private readonly config: ConfigService) {}

  private parseExtra(name: string): Record<string, unknown> | undefined {
    const raw = this.config.get<string>(name)?.trim();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      this.log.warn(`${name} is not valid JSON — ignored`);
      return undefined;
    }
  }

  /**
   * Providers in priority order: primary (LLM_*), then the fallback chain (LLM_FALLBACK_*;
   * defaults to Google Gemini's OpenAI-compatible endpoint using GOOGLE_GEMINI_AI_KEY).
   */
  get providers(): LlmConfig[] {
    const maxTokens = Number(this.config.get('LLM_MAX_OUTPUT_TOKENS') ?? 4096); // Groq counts this against TPM
    const list: LlmConfig[] = [];
    const primaryKey = this.config.get<string>('LLM_API_KEY')?.trim();
    if (primaryKey) {
      list.push({
        apiKey: primaryKey,
        baseUrl: this.config.get<string>('LLM_BASE_URL') || 'https://api.groq.com/openai/v1',
        model: this.config.get<string>('LLM_MODEL') || 'openai/gpt-oss-120b',
        maxTokens,
        extraBody: this.parseExtra('LLM_EXTRA_BODY'),
      });
    }
    const fallbackKey = (this.config.get<string>('LLM_FALLBACK_API_KEY') || this.config.get<string>('GOOGLE_GEMINI_AI_KEY'))?.trim();
    if (fallbackKey) {
      // Comma-separated list = a chain: if one model is overloaded or out of quota, try the next.
      const models = (this.config.get<string>('LLM_FALLBACK_MODEL') || 'gemini-3.5-flash,gemini-flash-lite-latest')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      for (const model of models) {
        list.push({
          apiKey: fallbackKey,
          baseUrl: this.config.get<string>('LLM_FALLBACK_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta/openai',
          model,
          maxTokens,
          extraBody: this.parseExtra('LLM_FALLBACK_EXTRA_BODY') ?? { reasoning_effort: 'low' },
        });
      }
    }
    return list;
  }

  get enabled() {
    return this.providers.length > 0;
  }

  /** One provider, with waits for short rate limits and temporary outages. */
  async callWithRetry(llm: LlmConfig, system: string, user: string, schema: object): Promise<LlmJsonResponse> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await chatJson(llm, system, user, schema);
      } catch (err) {
        // Short waits = per-minute limit: wait and retry. Long waits = daily quota: give up for today.
        if (err instanceof LlmRateLimitError && err.retryAfterMs <= DAILY_QUOTA_WAIT_MS && attempt < 4) {
          await sleep(err.retryAfterMs + 1000);
          continue;
        }
        // Temporary overload / server error: back off 5s, 15s, 45s before counting it as a failure.
        if (err instanceof LlmUnavailableError && attempt < 4) {
          this.log.warn(`${llm.model} unavailable (${err.message.slice(0, 80)}) — retrying in ${5 * 3 ** (attempt - 1)}s`);
          await sleep(5000 * 3 ** (attempt - 1));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Single request with automatic fallback through the provider chain — for interactive use
   * (Ask). Returns the response and which model answered.
   */
  async completeJson(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}): Promise<LlmJsonResponse & { model: string }> {
    const providers = this.providers;
    if (!providers.length) throw new NoProviderAvailableError('AI is not configured (set LLM_API_KEY or GOOGLE_GEMINI_AI_KEY)');
    let lastError: unknown;
    for (const p of providers) {
      try {
        const res = await this.callWithRetry({ ...p, maxTokens: opts.maxTokens ?? p.maxTokens }, system, user, schema);
        return { ...res, model: p.model };
      } catch (err) {
        lastError = err;
        const reason = err instanceof LlmRateLimitError ? 'quota reached' : err instanceof LlmOutputError ? 'invalid output' : err instanceof LlmError ? err.message.slice(0, 80) : String(err);
        this.log.warn(`${p.model} failed (${reason}) — trying next provider`);
      }
    }
    throw new NoProviderAvailableError(
      lastError instanceof LlmRateLimitError
        ? 'The free AI quota is used up for today. Please try again tomorrow.'
        : 'The AI service is not available right now. Please try again in a few minutes.',
    );
  }
}
