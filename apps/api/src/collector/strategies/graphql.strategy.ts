import type { BookingSession, ReviewListTemplate } from '../booking-session.js';
import { ContractChangedError, IncompleteListError } from '../collector.errors.js';
import type { PropertyMeta, RawReview, StrategyContext, StrategyResult } from '../collector.types.js';
import { withRetry } from '../retry.js';

const PAGE_SIZE = 25;

/* Minimal typing of the fields we read. Everything else is kept in `raw`. */
interface GqlReviewCard {
  reviewUrl?: string;
  reviewScore?: number;
  reviewedDate?: number; // unix seconds
  helpfulVotesCount?: number;
  textDetails?: { title?: string | null; positiveText?: string | null; negativeText?: string | null; lang?: string | null };
  guestDetails?: { username?: string | null; countryName?: string | null; countryCode?: string | null; guestTypeTranslation?: string | null; avatarUrl?: string | null };
  bookingDetails?: { numNights?: number | null; checkinDate?: string | null; checkoutDate?: string | null; roomType?: { name?: string | null } | null };
  partnerReply?: { reply?: string | null } | null;
}
interface GqlReviewList {
  data?: {
    reviewListFrontend?: {
      __typename?: string;
      reviewsCount?: number;
      reviewCard?: GqlReviewCard[];
      ratingScores?: { name: string; translation?: string; value: number }[];
      message?: string;
    };
  };
  errors?: { message: string }[];
}

/**
 * Primary strategy. Replays the page's own ReviewList request (whatever form Booking currently
 * uses: persisted-query hash or full query text) and changes only sort order and paging.
 * Because the template is captured live each run, routine Booking deploys don't break it.
 */
export async function collectViaGraphql(session: BookingSession, ctx: StrategyContext, log: (m: string) => void): Promise<StrategyResult> {
  const template = await session.openReviewsAndCapture();
  if (!template) throw new ContractChangedError('Page did not issue a ReviewList request');

  const input = template.body.variables.input;
  const meta: PropertyMeta = {
    hotelId: typeof input.hotelId === 'number' ? input.hotelId : undefined,
    overallScore: typeof input.hotelScore === 'number' ? input.hotelScore : undefined,
  };

  let skip = 0;
  let pages = 0;
  let seen = 0;
  let total = Infinity;

  while (pages < ctx.maxPages && skip < total) {
    const body = buildBody(template, skip);
    const res = await withRetry(() => session.graphql<GqlReviewList>(template.url, body), {
      onRetry: (e, n) => log(`page ${pages + 1} attempt ${n} failed: ${(e as Error).message}`),
    });
    const list = validate(res);
    pages++;

    if (pages === 1) {
      if (ctx.strictListSize && ctx.expectedListSize && list.reviewsCount !== undefined && list.reviewsCount < ctx.expectedListSize * 0.9) {
        throw new IncompleteListError(`Booking listed ${list.reviewsCount} reviews, expected ~${ctx.expectedListSize}`);
      }
      total = list.reviewsCount ?? Infinity;
      meta.reviewCount = list.reviewsCount;
      meta.subScores = Object.fromEntries((list.ratingScores ?? []).map((s) => [s.translation ?? s.name, round1(s.value)]));
    }

    const cards = list.reviewCard ?? [];
    if (cards.length === 0) return { pagesFetched: pages, reviewsSeen: seen, meta, stoppedReason: 'exhausted' };

    const reviews = cards.map(toRawReview).filter((r): r is RawReview => r !== null);
    seen += reviews.length;
    const known = await ctx.isPageAlreadyKnown(reviews);
    await ctx.onPage(reviews);
    if (known) return { pagesFetched: pages, reviewsSeen: seen, meta, stoppedReason: 'known' };

    skip += cards.length;
    if (skip < total) await ctx.delay();
  }
  return { pagesFetched: pages, reviewsSeen: seen, meta, stoppedReason: skip >= total ? 'exhausted' : 'max-pages' };
}

function buildBody(t: ReviewListTemplate, skip: number) {
  const body = structuredClone(t.body);
  body.variables.input = {
    ...body.variables.input,
    sorter: 'NEWEST_FIRST',
    skip,
    limit: PAGE_SIZE,
    filters: { text: '' }, // never inherit a filter the page may have had
  };
  return body;
}

function validate(res: GqlReviewList) {
  if (res.errors?.length) throw new ContractChangedError(`GraphQL errors: ${res.errors.map((e) => e.message).join('; ')}`);
  const list = res.data?.reviewListFrontend;
  if (!list || !Array.isArray(list.reviewCard)) {
    throw new ContractChangedError(`Unexpected ReviewList shape (${list?.__typename ?? 'no reviewListFrontend'})`);
  }
  return list;
}

function toRawReview(c: GqlReviewCard): RawReview | null {
  if (typeof c.reviewScore !== 'number' || typeof c.reviewedDate !== 'number') return null; // unusable record
  const t = c.textDetails ?? {};
  const g = c.guestDetails ?? {};
  const b = c.bookingDetails ?? {};
  const checkin = b.checkinDate ? new Date(`${b.checkinDate}T00:00:00Z`) : null;
  // Strip avatar URLs (third-party profile links) before storing the raw payload.
  const raw = { ...c, guestDetails: { ...g, avatarUrl: undefined } };
  return {
    externalId: c.reviewUrl ?? null,
    reviewedAt: new Date(c.reviewedDate * 1000),
    score: c.reviewScore,
    title: clean(t.title),
    positiveText: clean(t.positiveText),
    negativeText: clean(t.negativeText),
    language: t.lang ?? null,
    reviewerName: g.username ?? null,
    reviewerCountry: g.countryName ?? null,
    reviewerCountryCode: g.countryCode ?? null,
    travellerType: g.guestTypeTranslation ?? null,
    roomType: b.roomType?.name ?? null,
    nights: b.numNights ?? null,
    checkinDate: checkin,
    checkoutDate: b.checkoutDate ? new Date(`${b.checkoutDate}T00:00:00Z`) : null,
    stayMonth: checkin ? new Date(Date.UTC(checkin.getUTCFullYear(), checkin.getUTCMonth(), 1)) : null,
    propertyResponse: clean(c.partnerReply?.reply),
    helpfulVotes: c.helpfulVotesCount ?? 0,
    raw,
  };
}

const clean = (s?: string | null) => {
  const v = s?.trim();
  return v ? v : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
