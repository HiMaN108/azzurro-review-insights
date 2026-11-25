import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { sleep } from '../collector/retry.js';
import { buildUserMessage, LLM_CLASSIFIER_VERSION, parseResults, RESPONSE_SCHEMA, SYSTEM_PROMPT, type LlmReviewInput } from './llm.classifier.js';
import { chatJson, LlmError, LlmRateLimitError, type LlmConfig } from './llm.client.js';

export interface AiRunSummary {
  enabled: boolean;
  processed: number;
  urgent: number;
  failedBatches: number;
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

  private get llm(): LlmConfig | null {
    const apiKey = this.config.get<string>('LLM_API_KEY')?.trim();
    if (!apiKey) return null;
    let extraBody: Record<string, unknown> | undefined;
    const extra = this.config.get<string>('LLM_EXTRA_BODY')?.trim();
    if (extra) {
      try {
        extraBody = JSON.parse(extra);
      } catch {
        this.log.warn('LLM_EXTRA_BODY is not valid JSON — ignored');
      }
    }
    return {
      apiKey,
      baseUrl: this.config.get<string>('LLM_BASE_URL') || 'https://api.groq.com/openai/v1',
      model: this.config.get<string>('LLM_MODEL') || 'openai/gpt-oss-120b',
      extraBody,
    };
  }

  get enabled() {
    return this.llm !== null;
  }

  private pendingWhere() {
    return {
      aiCheckedAt: null,
      OR: [{ positiveText: { not: null } }, { negativeText: { not: null } }, { title: { not: null } }],
    };
  }

  async run({ limit }: { limit?: number } = {}): Promise<AiRunSummary> {
    const db = this.prisma.client;
    const llm = this.llm;
    const remainingNow = () => db.review.count({ where: this.pendingWhere() });
    if (!llm) return { enabled: false, processed: 0, urgent: 0, failedBatches: 0, stoppedReason: 'disabled', remaining: await remainingNow() };
    if (this.running) throw new Error('AI classification already running');
    this.running = true;

    const batchSize = Math.max(1, Number(this.config.get('LLM_BATCH_SIZE') ?? 8));
    const maxReviews = limit ?? Number(this.config.get('LLM_MAX_REVIEWS_PER_RUN') ?? 500);
    const tpm = Math.max(1000, Number(this.config.get('LLM_TOKENS_PER_MINUTE') ?? 6000)); // stay under free 8K TPM
    const version = `${LLM_CLASSIFIER_VERSION}:${llm.model}`;
    const summary: AiRunSummary = { enabled: true, processed: 0, urgent: 0, failedBatches: 0, stoppedReason: 'done', remaining: 0 };
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

        let response;
        try {
          response = await this.callWithRetry(llm, batch);
        } catch (err) {
          if (err instanceof LlmRateLimitError) {
            summary.stoppedReason = 'daily-quota';
            this.log.warn('Free-tier quota reached — remaining reviews will be tagged on the next run');
            break;
          }
          summary.failedBatches++;
          consecutiveFailures++;
          this.log.error(`AI batch failed: ${(err as Error).message}`);
          if (err instanceof LlmError && /Authentication/.test(err.message)) {
            summary.stoppedReason = 'error';
            break;
          }
          if (consecutiveFailures >= 3) {
            summary.stoppedReason = 'error';
            break;
          }
          await sleep(10_000);
          continue;
        }
        consecutiveFailures = 0;

        const { results, problems } = parseResults(response.data, batch);
        if (problems.length) this.log.warn(`AI output issues: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3})` : ''}`);
        if (!results.length) {
          summary.failedBatches++;
          if (++consecutiveFailures >= 3) {
            summary.stoppedReason = 'error';
            break;
          }
          continue; // reviews stay pending; retried next run
        }

        const now = new Date();
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
        summary.urgent += results.filter((r) => r.urgent).length;

        // Pace to the tokens-per-minute budget using the tokens this call actually consumed.
        const used = response.totalTokens || 2500;
        await sleep(Math.ceil((used / tpm) * 60_000));
      }
      if (summary.stoppedReason === 'done' && summary.processed >= maxReviews) summary.stoppedReason = 'run-limit';
    } finally {
      this.running = false;
    }
    summary.remaining = await remainingNow();
    this.log.log(`AI tagged ${summary.processed} reviews (${summary.urgent} urgent), ${summary.remaining} still pending [${summary.stoppedReason}]`);
    return summary;
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
        throw err;
      }
    }
  }
}
