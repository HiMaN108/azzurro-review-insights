import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { sleep } from '../collector/retry.js';
import { buildUserMessage, LLM_CLASSIFIER_VERSION, parseResults, RESPONSE_SCHEMA, SYSTEM_PROMPT, type LlmReviewInput, type LlmReviewResult } from './llm.classifier.js';
import { LlmError, LlmOutputError, LlmRateLimitError, type LlmConfig } from '../llm/llm.client.js';
import { LlmService } from '../llm/llm.service.js';
import { applyUrgentSafetyNet } from './urgent.safety-net.js';

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
    private readonly llmService: LlmService,
  ) {}

  get enabled() {
    return this.llmService.enabled;
  }

  private pendingWhere() {
    return {
      aiCheckedAt: null,
      OR: [{ positiveText: { not: null } }, { negativeText: { not: null } }, { title: { not: null } }],
    };
  }

  /** Put reviews currently flagged urgent back in the queue (e.g. after tightening the criteria). Keeps their tags until re-tagged. */
  async requeueUrgent(): Promise<number> {
    const res = await this.prisma.client.review.updateMany({ where: { urgent: true }, data: { aiCheckedAt: null } });
    return res.count;
  }

  async run({ limit, urgentFirst = false }: { limit?: number; urgentFirst?: boolean } = {}): Promise<AiRunSummary> {
    const db = this.prisma.client;
    const providers = this.llmService.providers;
    const remainingNow = () => db.review.count({ where: this.pendingWhere() });
    if (!providers.length) return { enabled: false, processed: 0, urgent: 0, failedBatches: 0, skipped: 0, models: [], stoppedReason: 'disabled', remaining: await remainingNow() };
    if (this.running) throw new Error('AI classification already running');
    this.running = true;

    const batchSize = Math.max(1, Number(this.config.get('LLM_BATCH_SIZE') ?? 8));
    const maxReviews = limit ?? Number(this.config.get('LLM_MAX_REVIEWS_PER_RUN') ?? 300);
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
            // newest first (what ops staff look at); re-checks of urgent flags go first when requested
            orderBy: urgentFirst ? [{ urgent: 'desc' }, { reviewedAt: 'desc' }] : { reviewedAt: 'desc' },
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
    // The AI may clear a flag the keyword safety net would set (models differ by language); re-apply it.
    summary.urgent += await applyUrgentSafetyNet(db);
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
      response = await this.llmService.callWithRetry(llm, SYSTEM_PROMPT, buildUserMessage(batch), RESPONSE_SCHEMA);
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
}
