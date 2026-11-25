import { Injectable } from '@nestjs/common';
import { daysBetween, previousRange, TOPICS, type DateRange } from '@azzurro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { num, round, whereSql } from '../common/sql.js';

/** Ignore topic movements with fewer mentions than this — avoids "100% up" on 1 → 2 reviews. */
const MIN_MENTIONS = 3;
const MIN_SHIFT = 0.05; // 5 percentage points

interface Totals {
  reviews: number;
  negativeReviews: number;
  positiveReviews: number;
}
interface TopicCounts {
  complaints: number; // reviews with a NEGATIVE mention
  complaintsInNegative: number; // ... among NEGATIVE-sentiment reviews
  praise: number; // reviews with a POSITIVE mention
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async topics(range: DateRange, properties?: string[]) {
    const prev = previousRange(range);
    const [cur, before, byProperty, examples] = await Promise.all([
      this.counts(range, properties),
      this.counts(prev, properties),
      this.complaintsByProperty(range, properties),
      this.examples(range, properties),
    ]);

    const topics = TOPICS.map((t) => {
      const c = cur.topics.get(t.key) ?? { complaints: 0, complaintsInNegative: 0, praise: 0 };
      const p = before.topics.get(t.key) ?? { complaints: 0, complaintsInNegative: 0, praise: 0 };
      const complaintShare = share(c.complaints, cur.totals.reviews);
      const prevComplaintShare = share(p.complaints, before.totals.reviews);
      return {
        topic: t.key,
        label: t.label,
        description: t.description,
        complaints: c.complaints,
        complaintShare, // % of all reviews complaining about this topic
        shareOfNegativeReviews: share(c.complaintsInNegative, cur.totals.negativeReviews),
        praise: c.praise,
        praiseShare: share(c.praise, cur.totals.reviews),
        previous: { complaints: p.complaints, complaintShare: prevComplaintShare },
        complaintShareChange: complaintShare !== null && prevComplaintShare !== null ? round(complaintShare - prevComplaintShare, 3) : null,
        complaintsByProperty: byProperty.get(t.key) ?? {},
        examples: examples.get(t.key) ?? [],
      };
    }).sort((a, b) => b.complaints - a.complaints);

    return {
      range,
      previousRange: prev,
      totals: cur.totals,
      previousTotals: before.totals,
      topics,
      headlines: headlines(range, cur.totals, topics),
      methodology:
        'Topics are detected with keyword rules per sentence. A mention in the guest\'s "Disliked" text counts as a complaint, in the "Liked" text as praise. Negative reviews = score below 6/10.',
    };
  }

  private async counts(range: DateRange, properties?: string[]) {
    const where = whereSql(range, properties);
    const [totals] = await this.prisma.client.$queryRaw<{ n: bigint; neg: bigint; pos: bigint }[]>`
      SELECT count(*) AS n,
        count(*) FILTER (WHERE r.sentiment = 'NEGATIVE') AS neg,
        count(*) FILTER (WHERE r.sentiment = 'POSITIVE') AS pos
      FROM "Review" r JOIN "Property" p ON p.id = r."propertyId" WHERE ${where}`;
    const rows = await this.prisma.client.$queryRaw<{ topic: string; complaints: bigint; complaints_neg: bigint; praise: bigint }[]>`
      SELECT t.topic::text AS topic,
        count(DISTINCT t."reviewId") FILTER (WHERE t.polarity = 'NEGATIVE') AS complaints,
        count(DISTINCT t."reviewId") FILTER (WHERE t.polarity = 'NEGATIVE' AND r.sentiment = 'NEGATIVE') AS complaints_neg,
        count(DISTINCT t."reviewId") FILTER (WHERE t.polarity = 'POSITIVE') AS praise
      FROM "ReviewTopic" t
      JOIN "Review" r ON r.id = t."reviewId" JOIN "Property" p ON p.id = r."propertyId"
      WHERE ${where}
      GROUP BY 1`;
    return {
      totals: { reviews: num(totals?.n), negativeReviews: num(totals?.neg), positiveReviews: num(totals?.pos) } satisfies Totals,
      topics: new Map<string, TopicCounts>(rows.map((r) => [r.topic, { complaints: num(r.complaints), complaintsInNegative: num(r.complaints_neg), praise: num(r.praise) }])),
    };
  }

  private async complaintsByProperty(range: DateRange, properties?: string[]) {
    const rows = await this.prisma.client.$queryRaw<{ topic: string; slug: string; n: bigint }[]>`
      SELECT t.topic::text AS topic, p.slug, count(DISTINCT t."reviewId") AS n
      FROM "ReviewTopic" t JOIN "Review" r ON r.id = t."reviewId" JOIN "Property" p ON p.id = r."propertyId"
      WHERE t.polarity = 'NEGATIVE' AND ${whereSql(range, properties)}
      GROUP BY 1, 2`;
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) out.set(r.topic, { ...out.get(r.topic), [r.slug]: num(r.n) });
    return out;
  }

  /** Three most recent complaint snippets per topic — lets staff see "what exactly" at a glance. */
  private async examples(range: DateRange, properties?: string[]) {
    const rows = await this.prisma.client.$queryRaw<{ topic: string; evidence: string; property: string; reviewed_at: Date; review_id: string }[]>`
      SELECT topic, evidence, property, reviewed_at, review_id FROM (
        SELECT t.topic::text AS topic, t.evidence, p.name AS property, r."reviewedAt" AS reviewed_at, r.id AS review_id,
          row_number() OVER (PARTITION BY t.topic ORDER BY r."reviewedAt" DESC) AS rn
        FROM "ReviewTopic" t JOIN "Review" r ON r.id = t."reviewId" JOIN "Property" p ON p.id = r."propertyId"
        WHERE t.polarity = 'NEGATIVE' AND t.evidence IS NOT NULL AND ${whereSql(range, properties)}
      ) x WHERE rn <= 3`;
    const out = new Map<string, { evidence: string; property: string; reviewedAt: Date; reviewId: string }[]>();
    for (const r of rows) out.set(r.topic, [...(out.get(r.topic) ?? []), { evidence: r.evidence, property: r.property, reviewedAt: r.reviewed_at, reviewId: r.review_id }]);
    return out;
  }
}

const share = (n: number, d: number) => (d > 0 ? round(n / d, 3) : null);
const pct = (v: number) => `${Math.round(v * 100)}%`;

type TopicRow = {
  topic: string;
  label: string;
  complaints: number;
  complaintShare: number | null;
  shareOfNegativeReviews: number | null;
  praise: number;
  praiseShare: number | null;
  previous: { complaintShare: number | null };
  complaintShareChange: number | null;
};

/** Plain-English sentences for the ops team, ordered by usefulness. Never claims more than the sample supports. */
function headlines(range: DateRange, totals: Totals, topics: TopicRow[]): string[] {
  const period = daysBetween(range.from, range.to) <= 7 ? 'this week' : 'in this period';
  const out: string[] = [];
  if (totals.reviews === 0) return [`No reviews were published ${period}.`];

  const topNeg = [...topics].filter((t) => t.shareOfNegativeReviews).sort((a, b) => b.shareOfNegativeReviews! - a.shareOfNegativeReviews!)[0];
  if (topNeg && totals.negativeReviews >= MIN_MENTIONS) {
    out.push(`${pct(topNeg.shareOfNegativeReviews!)} of negative reviews ${period} mentioned ${topNeg.label.toLowerCase()} issues (${totals.negativeReviews} negative reviews in total).`);
  }

  const topComplaint = topics[0];
  if (topComplaint && topComplaint.complaints >= MIN_MENTIONS && topComplaint !== topNeg) {
    out.push(`${topComplaint.label} was the most common complaint ${period}, raised in ${pct(topComplaint.complaintShare!)} of all reviews.`);
  }

  const rising = topics
    .filter((t) => t.complaints >= MIN_MENTIONS && (t.complaintShareChange ?? 0) >= MIN_SHIFT)
    .sort((a, b) => b.complaintShareChange! - a.complaintShareChange!)[0];
  if (rising) {
    out.push(`${rising.label} complaints rose from ${pct(rising.previous.complaintShare ?? 0)} to ${pct(rising.complaintShare!)} of reviews compared with the previous period.`);
  }
  const falling = topics
    .filter((t) => (t.complaintShareChange ?? 0) <= -MIN_SHIFT && (t.previous.complaintShare ?? 0) > 0)
    .sort((a, b) => a.complaintShareChange! - b.complaintShareChange!)[0];
  if (falling) {
    out.push(`${falling.label} complaints fell from ${pct(falling.previous.complaintShare!)} to ${pct(falling.complaintShare ?? 0)} of reviews — an improvement.`);
  }

  const praised = [...topics].sort((a, b) => b.praise - a.praise)[0];
  if (praised && praised.praise >= MIN_MENTIONS) {
    out.push(`Guests most often praised ${praised.label.toLowerCase()} (${pct(praised.praiseShare!)} of reviews).`);
  }

  if (totals.reviews < 10) out.push(`Note: only ${totals.reviews} review${totals.reviews === 1 ? '' : 's'} ${period} — percentages can swing a lot with small numbers.`);
  return out;
}


