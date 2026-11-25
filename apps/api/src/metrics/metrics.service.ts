import { Injectable } from '@nestjs/common';
import { Prisma } from '@azzurro/db';
import { previousRange, todayInSydney, weekRange, type DateRange } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { LOCAL_TS, num, round, whereSql } from '../common/sql.js';

/** Below this many reviews a weekly average is flagged as low-confidence in the UI. */
export const MIN_RELIABLE_SAMPLE = 5;

interface AggRow {
  slug: string;
  name: string;
  period: 'current' | 'previous';
  n: bigint;
  score_sum: number | null;
  pos: bigint;
  neu: bigint;
  neg: bigint;
  responded: bigint;
}

export interface PeriodStats {
  reviews: number;
  avgScore: number | null;
  positive: number;
  neutral: number;
  negative: number;
  negativeShare: number | null;
  responseRate: number | null;
  lowSample: boolean;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline KPIs: this week (to date) vs previous full week, portfolio + per property. */
  async overview(week = todayInSydney(), properties?: string[]) {
    const current = weekRange(week);
    const previous = previousRange(current);
    const span: DateRange = { from: previous.from, to: current.to };

    const rows = await this.prisma.client.$queryRaw<AggRow[]>`
      SELECT p.slug, p.name,
        CASE WHEN ${LOCAL_TS}::date >= ${current.from}::date THEN 'current' ELSE 'previous' END AS period,
        count(*) AS n, sum(r.score)::float AS score_sum,
        count(*) FILTER (WHERE r.sentiment = 'POSITIVE') AS pos,
        count(*) FILTER (WHERE r.sentiment = 'NEUTRAL') AS neu,
        count(*) FILTER (WHERE r.sentiment = 'NEGATIVE') AS neg,
        count(*) FILTER (WHERE r."propertyResponse" IS NOT NULL) AS responded
      FROM "Review" r JOIN "Property" p ON p.id = r."propertyId"
      WHERE ${whereSql(span, properties)}
      GROUP BY 1, 2, 3`;

    const props = await this.prisma.client.property.findMany({
      where: properties?.length ? { slug: { in: properties } } : undefined,
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 } },
    });

    const pick = (slug: string | null, period: AggRow['period']) => stats(rows.filter((r) => (slug === null || r.slug === slug) && r.period === period));

    const portfolio = { current: pick(null, 'current'), previous: pick(null, 'previous') };
    return {
      week: current,
      previousWeek: previous,
      isWeekToDate: todayInSydney() <= current.to,
      portfolio: { ...portfolio, change: change(portfolio.current, portfolio.previous) },
      properties: props.map((p) => {
        const cur = pick(p.slug, 'current');
        const prev = pick(p.slug, 'previous');
        const snap = p.snapshots[0];
        return {
          slug: p.slug,
          name: p.name,
          current: cur,
          previous: prev,
          change: change(cur, prev),
          booking: snap
            ? { overallScore: snap.overallScore === null ? null : Number(snap.overallScore), reviewCount: snap.reviewCount, subScores: snap.subScores, capturedAt: snap.capturedAt }
            : null,
        };
      }),
      lastCollectedAt: (await this.prisma.client.scrapeRun.aggregate({ where: { status: { in: ['SUCCESS', 'PARTIAL'] } }, _max: { finishedAt: true } }))._max.finishedAt,
    };
  }

  /** Average score and sentiment mix per week/month, portfolio + per property. */
  async trends(range: DateRange, granularity: 'week' | 'month' = 'week', properties?: string[]) {
    const unit = Prisma.raw(granularity === 'month' ? `'month'` : `'week'`);
    const rows = await this.prisma.client.$queryRaw<(Omit<AggRow, 'period' | 'name'> & { bucket: Date })[]>`
      SELECT date_trunc(${unit}, ${LOCAL_TS})::date AS bucket, p.slug,
        count(*) AS n, sum(r.score)::float AS score_sum,
        count(*) FILTER (WHERE r.sentiment = 'POSITIVE') AS pos,
        count(*) FILTER (WHERE r.sentiment = 'NEUTRAL') AS neu,
        count(*) FILTER (WHERE r.sentiment = 'NEGATIVE') AS neg,
        count(*) FILTER (WHERE r."propertyResponse" IS NOT NULL) AS responded
      FROM "Review" r JOIN "Property" p ON p.id = r."propertyId"
      WHERE ${whereSql(range, properties)}
      GROUP BY 1, 2 ORDER BY 1`;

    const buckets = [...new Set(rows.map((r) => r.bucket.toISOString().slice(0, 10)))];
    return {
      range,
      granularity,
      series: buckets.map((period) => {
        const inBucket = rows.filter((r) => r.bucket.toISOString().slice(0, 10) === period);
        return {
          period,
          ...stats(inBucket as unknown as AggRow[]),
          byProperty: Object.fromEntries(inBucket.map((r) => [r.slug, stats([r as unknown as AggRow])])),
        };
      }),
    };
  }
}

function stats(rows: AggRow[]): PeriodStats {
  const reviews = rows.reduce((a, r) => a + num(r.n), 0);
  const sum = rows.reduce((a, r) => a + num(r.score_sum), 0);
  const negative = rows.reduce((a, r) => a + num(r.neg), 0);
  const responded = rows.reduce((a, r) => a + num(r.responded), 0);
  return {
    reviews,
    avgScore: reviews ? round(sum / reviews) : null,
    positive: rows.reduce((a, r) => a + num(r.pos), 0),
    neutral: rows.reduce((a, r) => a + num(r.neu), 0),
    negative,
    negativeShare: reviews ? round(negative / reviews, 3) : null,
    responseRate: reviews ? round(responded / reviews, 3) : null,
    lowSample: reviews < MIN_RELIABLE_SAMPLE,
  };
}

function change(cur: PeriodStats, prev: PeriodStats) {
  return {
    avgScore: cur.avgScore !== null && prev.avgScore !== null ? round(cur.avgScore - prev.avgScore) : null,
    reviews: cur.reviews - prev.reviews,
    negativeShare: cur.negativeShare !== null && prev.negativeShare !== null ? round(cur.negativeShare - prev.negativeShare, 3) : null,
  };
}
