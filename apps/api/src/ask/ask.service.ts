import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Prisma } from '@azzurro/db';
import { previousRange, rangeToUtc, sydneyMidnightUtc, todayInSydney, PROPERTIES, TOPICS, type DateRange, type TopicKey } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { InsightsService } from '../insights/insights.service.js';
import { LlmService, NoProviderAvailableError } from '../llm/llm.service.js';
import { resolveRange } from '../common/range.js';
import { ASK_RESPONSE_SCHEMA, ASK_SYSTEM_PROMPT, buildAskMessage, detectTopics, normaliseQuestion, packReviews, REVIEW_TEXT_BUDGET, unverifiedPercentages, validateAnswer, type AskAnswer, type PackReview, type PackStats } from './ask.logic.js';
import { RateLimiter } from './rate-limiter.js';

export interface AskInput {
  question: string;
  from?: string;
  to?: string;
  properties?: string[];
}

const REVIEW_SELECT = { id: true, reviewedAt: true, score: true, positiveText: true, negativeText: true, property: { select: { name: true } } } as const;

@Injectable()
export class AskService {
  private readonly log = new Logger(AskService.name);
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
    private readonly llm: LlmService,
    config: ConfigService,
  ) {
    this.limiter = new RateLimiter(Number(config.get('ASK_RATE_LIMIT_PER_HOUR') ?? 20), 3600_000);
  }

  async ask(input: AskInput, clientKey: string) {
    const question = input.question.trim();
    // "How can we improve" questions need history: default to the last 12 weeks.
    const range = resolveRange(input.from, input.to, 12);
    const properties = (input.properties ?? []).filter((p) => PROPERTIES.some((x) => x.slug === p)).sort();
    const filters = { from: range.from, to: range.to, properties };
    const cacheKey = createHash('sha1').update(JSON.stringify([normaliseQuestion(question), filters, todayInSydney()])).digest('hex');

    const cached = await this.prisma.client.askLog.findFirst({ where: { cacheKey, createdAt: { gte: sydneyMidnightUtc(todayInSydney()) } }, orderBy: { createdAt: 'desc' } });
    if (cached) return { ...this.toDto(cached), cached: true };

    const waitMs = this.limiter.take(clientKey);
    if (waitMs > 0) {
      throw new HttpException(`You've asked a lot of questions in the last hour. Please try again in ${Math.ceil(waitMs / 60_000)} minutes.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.llm.enabled) throw new ServiceUnavailableException('AI is not configured on this server.');

    const stats = await this.buildStats(range, properties);
    if (stats.reviews === 0) {
      return this.save(cacheKey, question, filters, { summary: 'There are no reviews for the selected hotels and period, so there is nothing to analyse. Try a longer period.', recommendations: [], caveats: '', insufficientData: true }, 'none', 0, 0);
    }
    const pack = await this.selectReviews(question, range, properties, stats);

    const message = buildAskMessage(question, stats, pack);
    let res;
    try {
      res = await this.llm.completeJson(ASK_SYSTEM_PROMPT, message, ASK_RESPONSE_SCHEMA, { maxTokens: 2048 });
    } catch (err) {
      if (err instanceof NoProviderAvailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    const { answer, problems } = validateAnswer(res.data, pack);
    const unverified = unverifiedPercentages(answer, message);
    if (unverified.length) {
      answer.unverifiedFigures = unverified;
      problems.push(`unverified figures ${unverified.join(', ')}`);
    }
    if (problems.length) this.log.warn(`Ask answer issues: ${problems.join('; ')}`);
    return this.save(cacheKey, question, filters, answer, res.model, res.totalTokens, pack.length);
  }

  async history(limit = 10) {
    const rows = await this.prisma.client.askLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 50), select: { id: true, question: true, filters: true, createdAt: true } });
    return rows;
  }

  async get(id: string) {
    const row = await this.prisma.client.askLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Answer not found');
    return { ...this.toDto(row), cached: true };
  }

  private async save(cacheKey: string, question: string, filters: object, answer: AskAnswer, model: string, tokensUsed: number, reviewsUsed: number) {
    const row = await this.prisma.client.askLog.create({
      data: { cacheKey, question, filters: filters as Prisma.InputJsonValue, answer: answer as unknown as Prisma.InputJsonValue, model, tokensUsed, reviewsUsed },
    });
    return { ...this.toDto(row), cached: false };
  }

  private toDto(row: { id: string; question: string; filters: unknown; answer: unknown; model: string; reviewsUsed: number; createdAt: Date }) {
    return { id: row.id, question: row.question, filters: row.filters, answer: row.answer as AskAnswer, model: row.model, reviewsUsed: row.reviewsUsed, createdAt: row.createdAt };
  }

  private async buildStats(range: DateRange, properties: string[]): Promise<PackStats> {
    const prev = previousRange(range);
    const scope = properties.length ? { property: { slug: { in: properties } } } : {};
    const [ins, cur, before] = await Promise.all([
      this.insights.topics(range, properties),
      this.prisma.client.review.aggregate({ where: { ...scope, reviewedAt: rangeToUtc(range) }, _avg: { score: true } }),
      this.prisma.client.review.aggregate({ where: { ...scope, reviewedAt: rangeToUtc(prev) }, _avg: { score: true } }),
    ]);
    const avg = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    return {
      period: range,
      previousPeriod: prev,
      hotels: properties.length ? PROPERTIES.filter((p) => properties.includes(p.slug)).map((p) => p.name) : ['all four hotels'],
      reviews: ins.totals.reviews,
      previousReviews: ins.previousTotals.reviews,
      avgScore: avg(cur._avg.score),
      previousAvgScore: avg(before._avg.score),
      negativeShare: ins.totals.reviews ? ins.totals.negativeReviews / ins.totals.reviews : null,
      topics: ins.topics.map((t) => ({ label: t.label, complaints: t.complaints, complaintShare: t.complaintShare, shareOfNegativeReviews: t.shareOfNegativeReviews, praise: t.praise, changePts: t.complaintShareChange })),
    };
  }

  /**
   * Pick the reviews most relevant to the question. Topic questions get reviews about that topic;
   * open questions ("how do we improve?") get complaints about the biggest issues plus the best
   * reviews (what's working). ~75 % of the text budget goes to complaints, ~25 % to praise.
   */
  private async selectReviews(question: string, range: DateRange, properties: string[], stats: PackStats): Promise<PackReview[]> {
    const db = this.prisma.client;
    const base: Prisma.ReviewWhereInput = { reviewedAt: rangeToUtc(range), ...(properties.length ? { property: { slug: { in: properties } } } : {}) };
    const fetch = (where: Prisma.ReviewWhereInput, take: number, orderBy: Prisma.ReviewOrderByWithRelationInput[] = [{ reviewedAt: 'desc' }]) =>
      db.review.findMany({ where: { ...base, ...where }, orderBy, take, select: REVIEW_SELECT });
    const asRows = (rows: Awaited<ReturnType<typeof fetch>>) => rows.map((r) => ({ id: r.id, hotel: r.property.name, reviewedAt: r.reviewedAt, score: Number(r.score), positiveText: r.positiveText, negativeText: r.negativeText }));

    const topics = detectTopics(question);
    let negatives: Awaited<ReturnType<typeof fetch>> = [];
    let positives: Awaited<ReturnType<typeof fetch>> = [];
    if (topics.length) {
      const about = (polarity: 'NEGATIVE' | 'POSITIVE'): Prisma.ReviewWhereInput => ({ topics: { some: { topic: { in: topics as Exclude<TopicKey, 'OTHER'>[] }, polarity } } });
      [negatives, positives] = await Promise.all([fetch(about('NEGATIVE'), 30), fetch(about('POSITIVE'), 10)]);
    } else {
      const labelToKey = new Map(TOPICS.map((t) => [t.label, t.key]));
      const top = stats.topics.filter((t) => t.complaints > 0).slice(0, 4).map((t) => labelToKey.get(t.label)).filter(Boolean) as string[];
      const perTopic = await Promise.all(top.map((k) => fetch({ topics: { some: { topic: k as Exclude<TopicKey, 'OTHER'>, polarity: 'NEGATIVE' } } }, 6)));
      // Round-robin so every big issue is represented even if the budget runs out.
      for (let i = 0; i < 6; i++) for (const list of perTopic) if (list[i]) negatives.push(list[i]);
      negatives.push(...(await fetch({ sentiment: 'NEGATIVE', negativeText: { not: null } }, 8, [{ score: 'asc' }, { reviewedAt: 'desc' }])));
      positives = await fetch({ sentiment: 'POSITIVE', positiveText: { not: null } }, 10, [{ score: 'desc' }, { reviewedAt: 'desc' }]);
    }
    const neg = packReviews(asRows(negatives), REVIEW_TEXT_BUDGET * 0.75);
    const negIds = new Set(neg.map((r) => r.reviewId));
    const pos = packReviews(asRows(positives).filter((r) => !negIds.has(r.id)), REVIEW_TEXT_BUDGET * 0.25);
    return [...neg, ...pos].map((r, i) => ({ ...r, ref: `R${i + 1}` }));
  }
}
