import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { sleep } from '../collector/retry.js';
import { buildUserMessage, LLM_CLASSIFIER_VERSION, parseResults, RESPONSE_SCHEMA, SYSTEM_PROMPT, type LlmReviewInput, type LlmReviewResult } from './llm.classifier.js';
import { chatJson, LlmError, LlmOutputError, LlmRateLimitError, LlmUnavailableError, type LlmConfig } from './llm.client.js';

export interface AiRunSummary {
  enabled: boolean;
  processed: number;
  urgent: number;
  failedBatches: number;
  skipped: number;
  models: string[];
  stoppedReason: 'done' | 'run-limit' | 'daily-quota' | 'error' | 'disabled';
  remaining: number;
}

/** A 429 asking us to wait longer than this means the daily quota is used up. */
const DAILY_QUOTA_WAIT_MS = 120_000;

/**
 * Optional AI tagging on top of the keyword classifier. Off unless LLM_API_KEY is set.
 * Designed for free tiers: newest reviews first, paces itself to a tokens-per-minute budget,
 * and stops cleanly when the daily quota runs out (the rest are picked up on the next run).
 * Keyword tags remain for every review the AI has not processed.
 */
@Injectable()
export class AiClassifierService {
  private readonly log = new Logger(AiClassifierService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
   * Providers in priority order: primary (LLM_*), then fallback (LLM_FALLBACK_*; defaults to
   * Google Gemini's OpenAI-compatible endpoint using GOOGLE_GEMINI_AI_KEY). Either may be absent.
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

  private pendingWhere() {
    return {
      aiCheckedAt: null,
      OR: [{ positiveText: { not: null } }, { negativeText: { not: null } }, { title: { not: null } }],
    };
  }

  async run({ limit }: { limit?: number } = {}): Promise<AiRunSummary> {
    const db = this.prisma.client;
    const providers = this.providers;
    const remainingNow = () => db.review.count({ where: this.pendingWhere() });
    if (!providers.length) return { enabled: false, processed: 0, urgent: 0, failedBatches: 0, skipped: 0, models: [], stoppedReason: 'disabled', remaining: await remainingNow() };
    if (this.running) throw new Error('AI classification already running');
    this.running = true;

    const batchSize = Math.max(1, Number(this.config.get('LLM_BATCH_SIZE') ?? 8));
    const maxReviews = limit ?? Number(this.config.get('LLM_MAX_REVIEWS_PER_RUN') ?? 500);
    const tpm = Math.max(1000, Number(this.config.get('LLM_TOKENS_PER_MINUTE') ?? 6000)); // stay under free 8K TPM
    let active = 0;
    let llm = providers[active];
    /** Move to the next provider; false when none are left. */
    const switchProvider = (why: string) => {
      if (active + 1 >= providers.length) return false;
      active++;
      llm = providers[active];
      this.log.warn(`${why} → switching to fallback provider ${llm.model}`);
      return true;
    };
    const summary: AiRunSummary = { enabled: true, processed: 0, urgent: 0, failedBatches: 0, skipped: 0, models: [], stoppedReason: 'done', remaining: 0 };
    let consecutiveFailures = 0;

    try {
      while (summary.processed < maxReviews) {
        const batch = (
          await db.review.findMany({
            where: this.pendingWhere(),
            orderBy: { reviewedAt: 'desc' }, // newest first: what ops staff look at
            take: Math.min(batchSize, maxReviews - summary.processed),
            select: { id: true, title: true, positiveText: true, negativeText: true, score: true },
          })
        ).map((r): LlmReviewInput => ({ ...r, score: Number(r.score) }));
        if (!batch.length) break;

        let outcome: Awaited<ReturnType<AiClassifierService['classifyAdaptive']>>;
        try {
          outcome = await this.classifyAdaptive(llm, batch, tpm);
        } catch (err) {
          if (err instanceof LlmRateLimitError) {
            if (switchProvider(`${llm.model}: free quota reached`)) continue;
            summary.stoppedReason = 'daily-quota';
            this.log.warn('Free-tier quota reached on all providers — remaining reviews will be tagged on the next run');
            break;
          }
          summary.failedBatches++;
          consecutiveFailures++;
          this.log.error(`AI batch failed (${llm.model}): ${(err as Error).message}`);
          const authFailed = err instanceof LlmError && /Authentication/.test(err.message);
          if (authFailed || consecutiveFailures >= 3) {
            if (switchProvider(`${llm.model}: ${authFailed ? 'key rejected' : 'repeated failures'}`)) {
              consecutiveFailures = 0;
              continue;
            }
            summary.stoppedReason = 'error';
            break;
          }
          await sleep(10_000);
          continue;
        }
        consecutiveFailures = 0;
        const { results, skipped } = outcome;

        // Reviews the model can't handle even alone keep their keyword tags and leave the queue,
        // so one odd review can never block the rest.
        if (skipped.length) {
          summary.skipped += skipped.length;
          this.log.warn(`AI skipped ${skipped.length} review(s) it could not tag; keyword tags kept`);
          await db.review.updateMany({ where: { id: { in: skipped } }, data: { aiCheckedAt: new Date() } });
        }
        if (!results.length) continue;

        const now = new Date();
        const version = `${LLM_CLASSIFIER_VERSION}:${llm.model}`; // records which provider tagged it
        const ids = results.map((r) => r.reviewId);
        await db.$transaction([
          // AI tags replace keyword tags for these reviews.
          db.reviewTopic.deleteMany({ where: { reviewId: { in: ids } } }),
          db.reviewTopic.createMany({
            data: results.flatMap((r) =>
              r.topics.map((t) => ({ reviewId: r.reviewId, topic: t.topic, polarity: t.polarity, method: 'LLM' as const, confidence: t.confidence, evidence: t.evidence, classifierVersion: version })),
            ),
            skipDuplicates: true,
          }),
          ...results.map((r) =>
            db.review.update({
              where: { id: r.reviewId },
              data: { classifiedAt: now, classifierVersion: version, aiCheckedAt: now, urgent: r.urgent, urgentReason: r.urgentReason },
            }),
          ),
        ]);
        summary.processed += results.length;
        if (!summary.models.includes(llm.model)) summary.models.push(llm.model);
        summary.urgent += results.filter((r) => r.urgent).length;

      }
      if (summary.stoppedReason === 'done' && summary.processed >= maxReviews) summary.stoppedReason = 'run-limit';
    } finally {
      this.running = false;
    }
    summary.remaining = await remainingNow();
    this.log.log(`AI tagged ${summary.processed} reviews (${summary.urgent} urgent) using ${summary.models.join(' + ') || 'no model'}, ${summary.remaining} still pending [${summary.stoppedReason}]`);
    return summary;
  }

  /**
   * Tag a batch; if the model's output is cut off or invalid, split the batch in half and retry
   * (8 → 4 → 2 → 1). Reviews the model omits are retried on their own. Paces every call to the
   * tokens-per-minute budget using the tokens it actually consumed.
   */
  private async classifyAdaptive(llm: LlmConfig, batch: LlmReviewInput[], tpm: number): Promise<{ results: LlmReviewResult[]; skipped: string[] }> {
    let response;
    try {
      response = await this.callWithRetry(llm, batch);
    } catch (err) {
      if (!(err instanceof LlmOutputError)) throw err;
      await sleep(Math.ceil((2000 / tpm) * 60_000)); // failed calls still use quota
      if (batch.length === 1) return { results: [], skipped: [batch[0].id] };
      this.log.warn(`${err.message} — retrying as smaller batches (${batch.length} → ${Math.ceil(batch.length / 2)})`);
      const mid = Math.ceil(batch.length / 2);
      const a = await this.classifyAdaptive(llm, batch.slice(0, mid), tpm);
      const b = await this.classifyAdaptive(llm, batch.slice(mid), tpm);
      return { results: [...a.results, ...b.results], skipped: [...a.skipped, ...b.skipped] };
    }
    await sleep(Math.ceil(((response.totalTokens || 2500) / tpm) * 60_000));

    const { results, problems } = parseResults(response.data, batch);
    if (problems.length) this.log.warn(`AI output issues: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3})` : ''}`);
    const done = new Set(results.map((r) => r.reviewId));
    const missing = batch.filter((r) => !done.has(r.id));
    if (!missing.length) return { results, skipped: [] };
    if (batch.length === 1) return { results, skipped: missing.map((r) => r.id) };
    const retry = await this.classifyAdaptive(llm, missing, tpm);
    return { results: [...results, ...retry.results], skipped: retry.skipped };
  }

  private async callWithRetry(llm: LlmConfig, batch: LlmReviewInput[]) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await chatJson(llm, SYSTEM_PROMPT, buildUserMessage(batch), RESPONSE_SCHEMA);
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
}
