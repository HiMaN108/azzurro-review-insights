import { createHash } from 'node:crypto';
import { sentimentFromScore } from '@azzurro/shared';
import type { RawReview, StrategyName } from './collector.types.js';

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Strategy-independent fingerprint of a review's content. Uses only fields both strategies
 * can read identically (dates are excluded: the DOM shows a localised day, GraphQL a timestamp).
 * Used to (a) dedupe DOM-collected reviews that have no Booking id and (b) detect edits.
 */
export function contentHash(r: RawReview): string {
  return createHash('sha1')
    .update([r.score.toFixed(1), norm(r.reviewerName), norm(r.title), norm(r.positiveText), norm(r.negativeText)].join('|'))
    .digest('hex');
}

/** Data-quality gate: reject records that would pollute the dashboard. */
export function validateReview(r: RawReview): string | null {
  if (!Number.isFinite(r.score) || r.score < 1 || r.score > 10) return `score out of range: ${r.score}`;
  if (Number.isNaN(r.reviewedAt.getTime())) return 'invalid review date';
  if (r.reviewedAt.getTime() > Date.now() + 2 * 86_400_000) return 'review date in the future';
  if (r.reviewedAt.getUTCFullYear() < 2010) return 'review date implausibly old';
  return null;
}

export function toReviewData(r: RawReview, propertyId: string, source: StrategyName) {
  const hash = contentHash(r);
  return {
    propertyId,
    externalId: r.externalId ?? `h:${hash}`,
    contentHash: hash,
    reviewedAt: r.reviewedAt,
    stayMonth: r.stayMonth,
    checkinDate: r.checkinDate,
    checkoutDate: r.checkoutDate,
    nights: r.nights,
    score: r.score,
    title: r.title,
    positiveText: r.positiveText,
    negativeText: r.negativeText,
    language: r.language,
    reviewerName: r.reviewerName,
    reviewerCountry: r.reviewerCountry,
    reviewerCountryCode: r.reviewerCountryCode,
    travellerType: r.travellerType,
    roomType: r.roomType,
    propertyResponse: r.propertyResponse,
    helpfulVotes: r.helpfulVotes,
    sentiment: sentimentFromScore(r.score),
    source,
    raw: JSON.parse(JSON.stringify(r.raw ?? {})),
  };
}
