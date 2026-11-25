import type { PrismaClient } from '@azzurro/db';
import { urgentRuleHit } from './urgent.rules.js';

/**
 * Flag reviews whose complaint text clearly describes an urgent issue (pests, theft, broken locks),
 * regardless of whether — or which — AI processed them. Only adds flags, never removes AI flags.
 */
export async function applyUrgentSafetyNet(db: PrismaClient): Promise<number> {
  const candidates = await db.review.findMany({
    where: { urgent: false, OR: [{ negativeText: { not: null } }, { title: { not: null } }] },
    select: { id: true, title: true, negativeText: true },
  });
  const byReason = new Map<string, string[]>();
  for (const r of candidates) {
    const reason = urgentRuleHit(r.title, r.negativeText);
    if (reason) byReason.set(reason, [...(byReason.get(reason) ?? []), r.id]);
  }
  let flagged = 0;
  for (const [reason, ids] of byReason) {
    flagged += (await db.review.updateMany({ where: { id: { in: ids } }, data: { urgent: true, urgentReason: `${reason} (keyword check)` } })).count;
  }
  return flagged;
}
