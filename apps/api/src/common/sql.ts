import { Prisma } from '@azzurro/db';
import { rangeToUtc, type DateRange } from '@azzurro/shared';

/** Review timestamp as a Sydney local timestamp (columns are stored as UTC). */
export const LOCAL_TS = Prisma.raw(`(r."reviewedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney')`);

/** WHERE fragment for date range + properties. Expects aliases r (Review) and p (Property). */
export function whereSql(range: DateRange, properties?: string[]) {
  const { gte, lt } = rangeToUtc(range);
  const parts = [Prisma.sql`r."reviewedAt" >= ${gte}`, Prisma.sql`r."reviewedAt" < ${lt}`];
  if (properties?.length) parts.push(Prisma.sql`p.slug IN (${Prisma.join(properties)})`);
  return Prisma.join(parts, ' AND ');
}

export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
