import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { addDays, todayInSydney, weekRange } from "@azzurro/shared";
import { RatingTrend, type RatingPoint } from "@/components/charts/rating-trend";
import { SentimentTrend } from "@/components/charts/sentiment-trend";
import { Delta } from "@/components/delta";
import { FilterBar } from "@/components/filter-bar";
import { PropertyTable } from "@/components/property-table";
import { TopicBars } from "@/components/topic-bars";
import { Card, ErrorState, KpiTile, LowSample, Skeleton } from "@/components/ui";
import { api, ApiError, type Trends } from "@/lib/api";
import { first, fmtDate, hrefWith, parseProperties, type SearchParams } from "@/lib/filters";
import { fmtPct, fmtScore, isStale, scoreWord, timeAgo } from "@/lib/format";
import { PROPERTY_OPTIONS } from "@/lib/properties";

export default function OverviewPage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-14" />}>
        <FilterBar showRange={false} />
      </Suspense>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection(); // live data: always render at request time ("this week" depends on today's date)
  const sp = await searchParams;
  const properties = parseProperties(sp);
  const today = todayInSydney();
  const weekParam = first(sp.week);
  const week = weekRange(weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : today);
  const granularity = first(sp.g) === "month" ? "month" : "week";
  const trendFrom = granularity === "month" ? addDays(week.to, -365) : addDays(week.from, -7 * 11);
  const slugs = properties.length ? properties : PROPERTY_OPTIONS.map((p) => p.slug);

  let data;
  try {
    const [overview, insights, trends, perProperty, urgent] = await Promise.all([
      api.overview({ week: week.from, properties }),
      api.insights({ ...week, properties }),
      api.trends({ from: trendFrom, to: week.to, granularity, properties }),
      Promise.all(slugs.map((s) => api.insights({ ...week, properties: [s] }).then((r) => [s, r] as const))),
      api.reviews({ urgent: "true", from: addDays(today, -13), to: today, properties: properties.join(",") || undefined, pageSize: 5 }),
    ]);
    data = { overview, insights, trends, perProperty, urgent };
  } catch (e) {
    return <ErrorState message={e instanceof ApiError ? e.message : "Unexpected error loading the dashboard."} />;
  }
  const { overview, insights, trends, perProperty, urgent } = data;
  const cur = overview.portfolio.current;
  const prev = overview.portfolio.previous;
  const isThisWeek = week.from === weekRange(today).from;

  const topIssue = Object.fromEntries(
    perProperty.map(([slug, r]) => {
      const t = r.topics.find((x) => x.complaints > 0);
      return [slug, t ? `${t.label} (${t.complaints} review${t.complaints > 1 ? "s" : ""})` : null];
    }),
  );
  const reviewsHref = (topic: string) => hrefWith("/reviews", { p: first(sp.p) }, { topic, polarity: "NEGATIVE", from: week.from, to: week.to });

  return (
    <div className="space-y-5">
      {/* Week header + navigation */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{isThisWeek ? "This week at a glance" : "Week at a glance"}</h1>
          <p className="text-sm text-ink-2">
            {fmtDate(week.from, { weekday: "short", day: "numeric", month: "short" })} – {fmtDate(week.to, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            {overview.isWeekToDate && " · week to date"} · compared with {fmtDate(overview.previousWeek.from)} – {fmtDate(overview.previousWeek.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Freshness at={overview.lastCollectedAt} />
          <nav aria-label="Change week" className="flex overflow-hidden rounded-md border border-line bg-surface">
            <Link href={hrefWith("/", sp, { week: addDays(week.from, -7) })} className="px-3 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
              ← Previous week
            </Link>
            {!isThisWeek && (
              <>
                <Link href={hrefWith("/", sp, { week: undefined })} className="border-l border-line px-3 py-1.5 font-medium text-accent-ink hover:bg-surface-2">
                  This week
                </Link>
                <Link href={hrefWith("/", sp, { week: addDays(week.from, 7) })} className="border-l border-line px-3 py-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
                  Next week →
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Average rating"
          value={fmtScore(cur.avgScore)}
          unit={cur.avgScore !== null ? `/ 10 · ${scoreWord(cur.avgScore)}` : undefined}
          footer={<Delta value={overview.portfolio.change.avgScore} kind="score" />}
          note={cur.lowSample ? <LowSample n={cur.reviews} /> : `Last week ${fmtScore(prev.avgScore)}`}
        />
        <KpiTile
          label="New reviews"
          value={String(cur.reviews)}
          footer={<span className="text-sm text-ink-2">Last week: {prev.reviews}</span>}
          note={overview.isWeekToDate ? "Week still in progress — counts will grow" : undefined}
        />
        <KpiTile
          label="Negative reviews"
          value={fmtPct(cur.negativeShare)}
          unit={`${cur.negative} review${cur.negative === 1 ? "" : "s"} below 6`}
          footer={<Delta value={overview.portfolio.change.negativeShare} kind="pts" betterWhen="down" />}
        />
        <KpiTile
          label="Reviews with a hotel reply"
          value={fmtPct(cur.responseRate)}
          footer={<span className="text-sm text-ink-2">Last week: {fmtPct(prev.responseRate)}</span>}
          note="Hotel replies are often posted days later, so recent weeks fill in over time"
        />
      </div>

      {/* Insights + top complaints */}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="What guests are telling us" subtitle="Automatically generated from this week’s reviews" className="lg:col-span-3">
          {insights.headlines.length ? (
            <ul className="space-y-2">
              {insights.headlines.map((h) => (
                <li key={h} className="flex gap-2 text-sm text-ink">
                  <span aria-hidden className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-accent" />
                  {h}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Not enough reviews yet this week to draw conclusions.</p>
          )}
          <Link href={hrefWith("/insights", { p: first(sp.p) }, { from: week.from, to: week.to })} className="mt-4 inline-block text-sm font-medium text-accent-ink hover:underline">
            See all issues and praise →
          </Link>
        </Card>
        <Card title="Top complaints this week" subtitle="Share of reviews mentioning each issue" className="lg:col-span-2">
          <TopicBars topics={insights.topics} total={insights.totals.reviews} reviewsHref={reviewsHref} limit={5} />
        </Card>
      </div>

      {urgent.total > 0 && (
        <Card
          title="Needs attention"
          subtitle="Reviews from the last 14 days that the AI flagged for a manager (safety, pests, theft, injury, legal or refund threats)"
          action={
            <Link href={hrefWith("/reviews", { p: first(sp.p) }, { urgent: "true" })} className="text-sm font-medium text-accent-ink hover:underline">
              See all {urgent.total} →
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {urgent.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-critical-ink">
                  <span aria-hidden>⚠ </span>
                  {r.urgentReason ?? "Flagged as urgent"}
                </span>
                <span className="text-xs text-ink-3">
                  {r.property.name} · {r.score.toFixed(1)} · {new Date(r.reviewedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Hotel by hotel" subtitle="Average guest score this week vs last week (number of reviews in brackets)">
        <PropertyTable overview={overview} topIssue={topIssue} />
      </Card>

      {/* Trends */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Trends</h2>
        <div role="group" aria-label="Trend granularity" className="flex overflow-hidden rounded-md border border-line bg-surface text-sm">
          {(["week", "month"] as const).map((g) => (
            <Link
              key={g}
              href={hrefWith("/", sp, { g: g === "week" ? undefined : g })}
              aria-current={granularity === g ? "true" : undefined}
              className={`px-3 py-1.5 ${granularity === g ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"} ${g === "month" ? "border-l border-line" : ""}`}
            >
              {g === "week" ? "Weekly (12 weeks)" : "Monthly (12 months)"}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Average rating" subtitle="Guest score out of 10">
          <RatingTrend data={toRatingPoints(trends)} slugs={slugs} />
        </Card>
        <Card title="Positive vs negative reviews" subtitle="Number of reviews by score band">
          <SentimentTrend data={trends.series.map((s) => ({ period: s.period, label: periodLabel(s.period, trends.granularity), positive: s.positive, neutral: s.neutral, negative: s.negative }))} />
        </Card>
      </div>
    </div>
  );
}

function toRatingPoints(t: Trends): RatingPoint[] {
  return t.series.map((s) => ({
    period: s.period,
    label: periodLabel(s.period, t.granularity),
    all: s.avgScore,
    allCount: s.reviews,
    byProperty: Object.fromEntries(Object.entries(s.byProperty).map(([k, v]) => [k, { avg: v.avgScore, n: v.reviews }])),
  }));
}

const periodLabel = (p: string, g: "week" | "month") => (g === "month" ? fmtDate(p, { month: "short", year: "2-digit" }) : fmtDate(p));

/** Data freshness. Stale data is called out so staff don't act on an outdated picture. */
function Freshness({ at }: { at: string | null }) {
  const ago = timeAgo(at);
  const stale = isStale(at);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${stale ? "bg-surface-2 font-medium text-warning-ink" : "text-ink-3"}`}>
      <span aria-hidden>{stale ? "⚠" : "●"}</span>
      {at ? `Reviews updated ${ago}` : "Reviews have not been collected yet"}
      {stale && at && " — may be out of date"}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-56" />
      <Skeleton className="h-64" />
    </div>
  );
}
