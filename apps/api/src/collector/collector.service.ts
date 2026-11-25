import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser } from 'playwright';
import type { Property } from '@azzurro/db';
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

    const ctx: StrategyContext = {
      // Incremental runs normally stop after 1–2 pages; the cap only bounds a pathological run.
      maxPages: opts.full
        ? Number(this.config.get('SCRAPE_MAX_PAGES_FULL') ?? 400)
        : Number(this.config.get('SCRAPE_MAX_PAGES_PER_PROPERTY') ?? 40),
      isPageAlreadyKnown: (page) => (opts.full ? Promise.resolve(false) : this.allKnown(property.id, page)),
      onPage: async (page) => {
        const r = await this.persistPage(property.id, page, strategy);
        counters.reviewsNew += r.created;
        counters.reviewsUpdated += r.updated;
        counters.rejected += r.rejected;
        counters.pagesSaved++;
      },
      delay: () => this.delay(),
    };

    try {
      // Whole-property retry handles bot challenges / network errors with a fresh browser context.
      const result = await withRetry(
        async () => {
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
        { attempts: 3, baseMs: 5000, onRetry: (e, n) => this.log.warn(`${tag} attempt ${n} failed: ${errorMessage(e)}`) },
      );

      await this.saveMeta(property, result);
      await db.scrapeRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), pagesFetched: result.pagesFetched, reviewsSeen: result.reviewsSeen, reviewsNew: counters.reviewsNew, reviewsUpdated: counters.reviewsUpdated },
      });
      this.log.log(`${tag} done: ${result.reviewsSeen} seen, ${counters.reviewsNew} new, ${counters.reviewsUpdated} updated, ${counters.rejected} rejected (${result.stoppedReason})`);
      return { property: property.slug, status: 'SUCCESS', strategy, pagesFetched: result.pagesFetched, reviewsSeen: result.reviewsSeen, ...counters };
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
      select: { id: true, externalId: true, contentHash: true },
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
      if (upgrade || edited) {
        // A DOM-sourced row must not overwrite richer GraphQL data.
        if (!upgrade && source === 'dom' && !match.externalId.startsWith('h:')) {
          unchangedIds.push(match.id);
          continue;
        }
        await db.$transaction([
          db.review.update({ where: { id: match.id }, data: { ...row, lastSeenAt: now } }),
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
