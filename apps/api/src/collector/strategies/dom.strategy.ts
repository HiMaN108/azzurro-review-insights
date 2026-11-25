import { SEL, type BookingSession } from '../booking-session.js';
import { ContractChangedError } from '../collector.errors.js';
import type { RawReview, StrategyContext, StrategyResult } from '../collector.types.js';
import { sleep } from '../retry.js';

interface DomCard {
  name: string | null;
  country: string | null;
  room: string | null;
  nights: string | null;
  stayDate: string | null;
  traveller: string | null;
  reviewDate: string | null;
  title: string | null;
  score: string | null;
  positive: string | null;
  negative: string | null;
}

/**
 * Fallback strategy: read the review cards a visitor sees and click "Next page".
 * Slower and less complete (no review id, month-level stay date) but independent of the
 * GraphQL contract. Dedupe relies on the content hash.
 */
export async function collectViaDom(session: BookingSession, ctx: StrategyContext, log: (m: string) => void): Promise<StrategyResult> {
  const { page } = session;
  if (!(await page.locator(SEL.reviewCard).count())) {
    await page.locator(SEL.openReviews).first().click({ timeout: 15_000 }).catch(() => {});
  }
  const found = await page.waitForSelector(SEL.reviewCard, { timeout: 20_000 }).catch(() => null);
  if (!found) throw new ContractChangedError('No review cards rendered');

  const newestFirst = await trySortNewest(session);
  if (!newestFirst) log('could not switch sort to newest; scanning all pages without early stop');

  let pages = 0;
  let seen = 0;
  while (pages < ctx.maxPages) {
    const cards = await readCards(session);
    pages++;
    const reviews = cards.map(toRawReview).filter((r): r is RawReview => r !== null);
    if (cards.length && !reviews.length) throw new ContractChangedError('Review cards found but none could be parsed');
    seen += reviews.length;

    const known = newestFirst && (await ctx.isPageAlreadyKnown(reviews));
    await ctx.onPage(reviews);
    if (known) return { pagesFetched: pages, reviewsSeen: seen, meta: {}, stoppedReason: 'known' };

    const next = page.locator(SEL.nextPage).first();
    if (!(await next.count()) || (await next.isDisabled())) {
      return { pagesFetched: pages, reviewsSeen: seen, meta: {}, stoppedReason: 'exhausted' };
    }
    const firstBefore = cards[0]?.title ?? cards[0]?.positive ?? '';
    await ctx.delay();
    await next.click();
    await waitForChange(session, firstBefore);
  }
  return { pagesFetched: pages, reviewsSeen: seen, meta: {}, stoppedReason: 'max-pages' };
}

async function trySortNewest(session: BookingSession): Promise<boolean> {
  const { page } = session;
  try {
    const sorter = page.locator(SEL.sorter).first();
    if (!(await sorter.count())) return false;
    const select = sorter.locator('select');
    if (await select.count()) {
      await select.selectOption({ label: 'Newest first' });
    } else {
      await sorter.click();
      await page.getByRole('option', { name: /newest first/i }).or(page.getByText(/^Newest first$/i)).first().click({ timeout: 5000 });
    }
    await sleep(2500);
    return true;
  } catch {
    return false;
  }
}

async function waitForChange(session: BookingSession, firstBefore: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const cards = await readCards(session).catch(() => []);
    const first = cards[0]?.title ?? cards[0]?.positive ?? '';
    if (cards.length && first !== firstBefore) return;
  }
}

function readCards(session: BookingSession): Promise<DomCard[]> {
  return session.page.$$eval(SEL.reviewCard, (els) =>
    els.map((el) => {
      const txt = (id: string) => {
        const n = el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        const v = n?.innerText?.replace(/\s+/g, ' ').trim();
        return v || null;
      };
      const avatar = el.querySelector('[data-testid="review-avatar"]') as HTMLElement | null;
      const lines = (avatar?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      return {
        name: lines[0] ?? null,
        country: lines[1] ?? null,
        room: txt('review-room-name'),
        nights: txt('review-num-nights'),
        stayDate: txt('review-stay-date'),
        traveller: txt('review-traveler-type'),
        reviewDate: txt('review-date'),
        title: txt('review-title'),
        score: txt('review-score'),
        positive: txt('review-positive-text'),
        negative: txt('review-negative-text'),
      };
    }),
  );
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Reviewed: 25 November 2026" → Date (UTC midnight) */
function parseDayMonthYear(s: string | null): Date | null {
  const m = s?.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  return mi < 0 ? null : new Date(Date.UTC(+m[3], mi, +m[1]));
}

/** "November 2026" → first day of month */
function parseMonthYear(s: string | null): Date | null {
  const m = s?.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : new Date(Date.UTC(+m[2], mi, 1));
}

function toRawReview(c: DomCard): RawReview | null {
  const reviewedAt = parseDayMonthYear(c.reviewDate);
  const score = Number(c.score?.match(/(\d+(?:\.\d+)?)/)?.[1]);
  if (!reviewedAt || !Number.isFinite(score)) return null;
  return {
    externalId: null,
    reviewedAt,
    score,
    title: c.title,
    positiveText: c.positive,
    negativeText: c.negative,
    language: null,
    reviewerName: c.name,
    reviewerCountry: c.country,
    reviewerCountryCode: null,
    travellerType: c.traveller,
    roomType: c.room,
    nights: Number(c.nights?.match(/\d+/)?.[0]) || null,
    checkinDate: null,
    checkoutDate: null,
    stayMonth: parseMonthYear(c.stayDate),
    propertyResponse: null,
    helpfulVotes: 0,
    raw: c,
  };
}
