import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser } from 'playwright';
import type { Property } from '@azzurro/db';
import { AiClassifierService } from '../classifier/ai-classifier.service.js';
import { ClassifierService } from '../classifier/classifier.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingSession } from './booking-session.js';
import { BlockedError, ContractChangedError, errorMessage } from './collector.errors.js';
import type { RawReview, StrategyContext, StrategyName, StrategyResult } from './collector.types.js';
import { randomBetween, sleep, withRetry } from './retry.js';
import { toReviewData, validateReview } from './review.normalizer.js';
import { collectViaDom } from './strategies/dom.strategy.js';
import { collectViaGraphql } from './strategies/graphql.strategy.js';

export interface CollectOptions {
  /** Ignore "already known" early-stop and walk every page (first load / backfill). */
  full?: boolean;
  /** Restrict to these property slugs. */
  slugs?: string[];
  /** Force a strategy (testing the fallback). */
  strategy?: StrategyName;
}

export interface PropertyRunSummary {
  property: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  strategy: StrategyName;
  pagesFetched: number;
  reviewsSeen: number;
  reviewsNew: number;
  reviewsUpdated: number;
  rejected: number;
  error?: string;
}

const STALE_RUN_MS = 2 * 60 * 60 * 1000;
/** Incremental runs re-read reviews this recent to catch late hotel replies / guest edits. */
const REFRESH_DAYS = 14;

/**
 * Content-hash matching is only valid when one side lacks a real Booking id (DOM fallback rows).
 * Two id-bearing reviews with identical content (e.g. score-only reviews by guests with the same
 * first name) are genuinely different reviews and must both be kept.
 */
function hashFallbackMatch<T extends { externalId: string; contentHash: string }>(row: { externalId: string; contentHash: string }, existing: T[]): T | undefined {
  const rowHasId = !row.externalId.startsWith('h:');
  return existing.find((e) => e.contentHash === row.contentHash && (!rowHasId || e.externalId.startsWith('h:')));
}

@Injectable()
export class CollectorService {
  private readonly log = new Logger(CollectorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly classifier: ClassifierService,
    private readonly aiClassifier: AiClassifierService,
  ) {}

  get isRunning() {
    return this.running;
  }

  /** Collect reviews for all (or selected) properties, sequentially to stay polite. */
  async collectAll(opts: CollectOptions = {}): Promise<PropertyRunSummary[]> {
    if (this.running) throw new Error('A collection run is already in progress');
    await this.guardAgainstConcurrentRuns();
    this.running = true;

    const db = this.prisma.client;
    const properties = await db.property.findMany({
      where: opts.slugs?.length ? { slug: { in: opts.slugs } } : undefined,
      orderBy: { name: 'asc' },
    });
    if (!properties.length) throw new Error('No properties found. Run `pnpm db:seed` first.');

    const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
    const results: PropertyRunSummary[] = [];
    try {
      for (const [i, property] of properties.entries()) {
        results.push(await this.collectProperty(browser, property, opts));
        if (i < properties.length - 1) await this.delay();
      }
      await this.classifier.classifyPending().catch((e) => this.log.error(`Classification failed: ${errorMessage(e)}`));
      // Optional AI pass (no-op without LLM_API_KEY). Failures never fail the collection run.
      if (this.aiClassifier.enabled) await this.aiClassifier.run().catch((e) => this.log.error(`AI classification failed: ${errorMessage(e)}`));
    } finally {
      await browser.close().catch(() => {});
      this.running = false;
    }
    return results;
  }

  private async collectProperty(browser: Browser, property: Property, opts: CollectOptions): Promise<PropertyRunSummary> {
    const db = this.prisma.client;
    const tag = `[${property.slug}]`;
    const counters = { reviewsNew: 0, reviewsUpdated: 0, rejected: 0, pagesSaved: 0 };
    let strategy: StrategyName = opts.strategy ?? 'graphql';
    const run = await db.scrapeRun.create({ data: { propertyId: property.id, strategy } });
    this.log.log(`${tag} start (${opts.full ? 'full' : 'incremental'}, ${strategy})`);

    let escalated = false;
    const storedCount = await db.review.count({ where: { propertyId: property.id } });
    const ctx: StrategyContext = {
      // Incremental runs normally stop after 1–2 pages; the cap only bounds a pathological run.
      maxPages: opts.full
        ? Number(this.config.get('SCRAPE_MAX_PAGES_FULL') ?? 400)
        : Number(this.config.get('SCRAPE_MAX_PAGES_PER_PROPERTY') ?? 40),
      // Keep paging through the last REFRESH_DAYS even when reviews are known, so late hotel
      // replies and guest edits are picked up; stop at the first fully-known page older than that.
      isPageAlreadyKnown: async (page) => {
        if (opts.full || escalated) return false;
        const cutoff = Date.now() - REFRESH_DAYS * 86_400_000;
        if (page.some((r) => r.reviewedAt.getTime() >= cutoff)) return false;
        return this.allKnown(property.id, page);
      },
      onPage: async (page) => {
        const r = await this.persistPage(property.id, page, strategy);
        counters.reviewsNew += r.created;
        counters.reviewsUpdated += r.updated;
        counters.rejected += r.rejected;
        counters.pagesSaved++;
      },
      delay: () => this.delay(),
      expectedListSize: await this.largestListSize(property.id),
      strictListSize: true,
      // Gap detection: Booking sometimes serves a ~60 % subset of reviews per session, so an
      // earlier run may have missed some. If Booking lists clearly more reviews than we store,
      // walk the whole list now instead of stopping at the first known page.
      onListSize: (count) => {
        if (opts.full || escalated || count <= storedCount * 1.05) return;
        escalated = true;
        ctx.maxPages = Number(this.config.get('SCRAPE_MAX_PAGES_FULL') ?? 400);
        this.log.warn(`${tag} Booking lists ${count} reviews but ${storedCount} are stored → switching to a full walk`);
      },
    };
    const ATTEMPTS = 3;

    try {
      // Whole-property retry handles bot challenges / network errors / short list variants
      // with a fresh browser context. The last attempt accepts a short list (flagged PARTIAL below).
      const result = await withRetry(
        async (attempt) => {
          ctx.strictListSize = attempt < ATTEMPTS;
          const session = await BookingSession.open(browser, property.bookingUrl);
          try {
            if (strategy === 'graphql') {
              try {
                return await collectViaGraphql(session, ctx, (m) => this.log.warn(`${tag} ${m}`));
              } catch (err) {
                if (!(err instanceof ContractChangedError) || opts.strategy) throw err;
                this.log.warn(`${tag} GraphQL contract changed (${err.message}) → falling back to DOM`);
                strategy = 'dom';
                await db.scrapeRun.update({ where: { id: run.id }, data: { strategy: 'graphql→dom' } });
              }
            }
            return await collectViaDom(session, ctx, (m) => this.log.warn(`${tag} ${m}`));
          } finally {
            await session.close();
          }
        },
        { attempts: ATTEMPTS, baseMs: 5000, onRetry: (e, n) => this.log.warn(`${tag} attempt ${n} failed: ${errorMessage(e)}`) },
      );

      const warning = await this.checkListSize(property.id, result.meta.reviewCount);
      await this.saveMeta(property, result);
      const status = warning ? 'PARTIAL' : 'SUCCESS';
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { status, finishedAt: new Date(), pagesFetched: result.pagesFetched, reviewsSeen: result.reviewsSeen, reviewsNew: counters.reviewsNew, reviewsUpdated: counters.reviewsUpdated, errorMessage: warning },
      });
      if (warning) this.log.warn(`${tag} ${warning}`);
      this.log.log(`${tag} done: ${result.reviewsSeen} seen, ${counters.reviewsNew} new, ${counters.reviewsUpdated} updated, ${counters.rejected} rejected (${result.stoppedReason})`);
      return { property: property.slug, status, strategy, pagesFetched: result.pagesFetched, reviewsSeen: result.reviewsSeen, ...counters, ...(warning ? { error: warning } : {}) };
    } catch (err) {
      // Pages saved before the failure are kept → PARTIAL rather than FAILED.
      const status = counters.pagesSaved > 0 ? 'PARTIAL' : 'FAILED';
      const msg = errorMessage(err);
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { status, finishedAt: new Date(), pagesFetched: counters.pagesSaved, reviewsNew: counters.reviewsNew, reviewsUpdated: counters.reviewsUpdated, errorMessage: msg.slice(0, 1000) },
      });
      this.log.error(`${tag} ${status}: ${msg}${err instanceof BlockedError ? ' (bot protection — try later or from another network)' : ''}`);
      return { property: property.slug, status, strategy, pagesFetched: counters.pagesSaved, reviewsSeen: 0, ...counters, error: msg };
    }
  }

  /** True when every review on the page is already stored (same matching rules as persistPage). */
  private async allKnown(propertyId: string, page: RawReview[]): Promise<boolean> {
    if (!page.length) return true;
    const data = page.map((r) => toReviewData(r, propertyId, 'graphql'));
    const existing = await this.prisma.client.review.findMany({
      where: { propertyId, OR: [{ externalId: { in: data.map((d) => d.externalId) } }, { contentHash: { in: data.map((d) => d.contentHash) } }] },
      select: { externalId: true, contentHash: true },
    });
    const ids = new Set(existing.map((e) => e.externalId));
    return data.every((d) => ids.has(d.externalId) || hashFallbackMatch(d, existing));
  }

  /**
   * Idempotent upsert of one page.
   * - match by Booking id, else by content hash (DOM-collected rows have no id)
   * - unchanged → bump lastSeenAt; edited → update + clear topics for reclassification
   * - DOM row later seen via GraphQL → upgraded to the real id and richer fields
   */
  private async persistPage(propertyId: string, page: RawReview[], source: StrategyName) {
    const db = this.prisma.client;
    let rejected = 0;
    const rows = page.flatMap((r) => {
      const problem = validateReview(r);
      if (problem) {
        rejected++;
        this.log.warn(`rejected review (${problem})`);
        return [];
      }
      return [toReviewData(r, propertyId, source)];
    });
    if (!rows.length) return { created: 0, updated: 0, rejected };

    const existing = await db.review.findMany({
      where: { propertyId, OR: [{ externalId: { in: rows.map((r) => r.externalId) } }, { contentHash: { in: rows.map((r) => r.contentHash) } }] },
      select: { id: true, externalId: true, contentHash: true, propertyResponse: true, helpfulVotes: true },
    });
    const byId = new Map(existing.map((e) => [e.externalId, e]));
    const toCreate: typeof rows = [];
    const unchangedIds: string[] = [];
    let updated = 0;
    const now = new Date();

    for (const row of rows) {
      const match = byId.get(row.externalId) ?? hashFallbackMatch(row, existing);
      if (!match) {
        toCreate.push(row);
        continue;
      }
      const upgrade = match.externalId.startsWith('h:') && !row.externalId.startsWith('h:');
      const edited = match.contentHash !== row.contentHash;
      // Reply/vote changes don't alter the guest's text, so topics are kept.
      const metaChanged = source === 'graphql' && (match.propertyResponse !== row.propertyResponse || match.helpfulVotes !== row.helpfulVotes);
      if (upgrade || edited || metaChanged) {
        // A DOM-sourced row must not overwrite richer GraphQL data.
        if (!upgrade && source === 'dom' && !match.externalId.startsWith('h:')) {
          unchangedIds.push(match.id);
          continue;
        }
        await db.$transaction([
          db.review.update({ where: { id: match.id }, data: { ...row, lastSeenAt: now, ...(edited ? { classifiedAt: null, aiCheckedAt: null, urgent: false, urgentReason: null } : {}) } }),
          ...(edited ? [db.reviewTopic.deleteMany({ where: { reviewId: match.id } })] : []),
        ]);
        updated++;
      } else {
        unchangedIds.push(match.id);
      }
    }

    if (unchangedIds.length) await db.review.updateMany({ where: { id: { in: unchangedIds } }, data: { lastSeenAt: now } });
    const created = toCreate.length ? (await db.review.createMany({ data: toCreate, skipDuplicates: true })).count : 0;
    return { created, updated, rejected };
  }

  /**
   * Completeness guard. Booking occasionally serves a ReviewList variant that silently returns a
   * subset of reviews (observed: 74 instead of 129). A list size well below the largest we've seen
   * means this run may have missed reviews, so it is flagged rather than reported as a clean success.
   */
  private async checkListSize(propertyId: string, reviewCount?: number): Promise<string | null> {
    if (reviewCount === undefined) return null;
    const max = await this.largestListSize(propertyId);
    if (max && reviewCount < max * 0.9) {
      return `Booking reported ${reviewCount} listable reviews, previously ${max}: list may be filtered, some reviews could be missing. Re-run later.`;
    }
    return null;
  }

  private async largestListSize(propertyId: string): Promise<number | undefined> {
    const best = await this.prisma.client.propertySnapshot.aggregate({ where: { propertyId }, _max: { reviewCount: true } });
    return best._max.reviewCount ?? undefined;
  }

  private async saveMeta(property: Property, result: StrategyResult) {
    const { meta } = result;
    const db = this.prisma.client;
    if (meta.hotelId && meta.hotelId !== property.bookingHotelId) {
      await db.property.update({ where: { id: property.id }, data: { bookingHotelId: meta.hotelId } });
    }
    if (meta.overallScore !== undefined || meta.reviewCount !== undefined || meta.subScores) {
      await db.propertySnapshot.create({
        data: { propertyId: property.id, overallScore: meta.overallScore, reviewCount: meta.reviewCount, subScores: meta.subScores },
      });
    }
  }

  /** Cross-process guard (cron + manual CLI): refuse if another run is active; expire abandoned runs. */
  private async guardAgainstConcurrentRuns() {
    const db = this.prisma.client;
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    await db.scrapeRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Abandoned (process exited before finishing)' },
    });
    const active = await db.scrapeRun.count({ where: { status: 'RUNNING', startedAt: { gte: cutoff } } });
    if (active) throw new Error('Another collection run is in progress (see ScrapeRun table)');
  }

  private async delay() {
    const min = Number(this.config.get('SCRAPE_DELAY_MS_MIN') ?? 2500);
    const max = Number(this.config.get('SCRAPE_DELAY_MS_MAX') ?? 6000);
    await sleep(randomBetween(min, max));
  }
}
