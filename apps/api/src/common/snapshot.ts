import type { PropertySnapshot } from '@azzurro/db';

/**
 * Latest snapshot whose list size is close to the largest seen. Booking sometimes serves a
 * short review list (see CollectorService.checkListSize); those snapshots are skipped.
 * Expects snapshots ordered newest first.
 */
export function pickSnapshot(snaps: PropertySnapshot[]) {
  const max = Math.max(0, ...snaps.map((s) => s.reviewCount ?? 0));
  const s = snaps.find((x) => !max || (x.reviewCount ?? 0) >= max * 0.9) ?? snaps[0];
  if (!s) return null;
  return { overallScore: s.overallScore === null ? null : Number(s.overallScore), reviewCount: s.reviewCount, subScores: s.subScores, capturedAt: s.capturedAt };
}
