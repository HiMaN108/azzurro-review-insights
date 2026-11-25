import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/filter-bar";
import { TopicBars } from "@/components/topic-bars";
import { Card, ErrorState, KpiTile, Skeleton } from "@/components/ui";
import { api, ApiError, type TopicInsight } from "@/lib/api";
import { first, fmtDate, hrefWith, parseProperties, parseRange, type SearchParams } from "@/lib/filters";
import { fmtPct } from "@/lib/format";
import { propertyColor, propertyName } from "@/lib/properties";

export const metadata = { title: "Issues & praise · Azzurro Review Insights" };

export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Issues & praise</h1>
        <p className="text-sm text-ink-2">What guests complain about and what they love, grouped into operational topics.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-28" />}>
        <FilterBar rangeFallback="this-week" rangeOptions={["this-week", "last-week", "4w", "12w", "6m", "12m"]} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <InsightsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function InsightsContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection(); // live data: always render at request time ("this week" depends on today's date)
  const sp = await searchParams;
  const { range, label } = parseRange(sp, "this-week");
  const properties = parseProperties(sp);
  let data;
  try {
    data = await api.insights({ from: range?.from, to: range?.to, properties });
  } catch (e) {
    return <ErrorState message={e instanceof ApiError ? e.message : "Unexpected error loading insights."} />;
  }
  const { totals } = data;
  const reviewsHref = (topic: string, polarity = "NEGATIVE") => hrefWith("/reviews", { p: first(sp.p) }, { topic, polarity, from: data.range.from, to: data.range.to });

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-2">
        {label}: {fmtDate(data.range.from)} – {fmtDate(data.range.to, { day: "numeric", month: "short", year: "numeric" })}, compared with {fmtDate(data.previousRange.from)} –{" "}
        {fmtDate(data.previousRange.to)}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Reviews in period" value={totals.reviews.toLocaleString()} footer={<span className="text-sm text-ink-2">Previous period: {data.previousTotals.reviews}</span>} />
        <KpiTile
          label="Negative reviews (below 6)"
          value={totals.negativeReviews.toLocaleString()}
          unit={totals.reviews ? `${fmtPct(totals.negativeReviews / totals.reviews)} of reviews` : undefined}
          footer={<span className="text-sm text-ink-2">Previous period: {data.previousTotals.negativeReviews}</span>}
        />
        <KpiTile label="Positive reviews (8+)" value={totals.positiveReviews.toLocaleString()} unit={totals.reviews ? `${fmtPct(totals.positiveReviews / totals.reviews)} of reviews` : undefined} />
      </div>

      <Card title="Key findings">
        <ul className="space-y-2">
          {data.headlines.map((h) => (
            <li key={h} className="flex gap-2 text-sm text-ink">
              <span aria-hidden className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-accent" />
              {h}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Most common complaints" subtitle="Share of all reviews whose “Disliked” text mentions the topic">
          <TopicBars topics={data.topics} total={totals.reviews} reviewsHref={(t) => reviewsHref(t)} />
        </Card>
        <Card title="What guests praise" subtitle="Share of all reviews whose “Liked” text mentions the topic">
          <PraiseList topics={data.topics} total={totals.reviews} href={(t) => reviewsHref(t, "POSITIVE")} />
        </Card>
      </div>

      <Card title="Topic details" subtitle="Click a topic to read the reviews behind it">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Topic</th>
                <th className="py-2 pr-3 font-semibold">Complaints</th>
                <th className="py-2 pr-3 font-semibold" title="Of reviews scored below 6, how many mention this topic as a dislike">
                  In negative reviews
                </th>
                <th className="py-2 pr-3 font-semibold">By hotel</th>
                <th className="py-2 font-semibold">Recent examples</th>
              </tr>
            </thead>
            <tbody>
              {data.topics.map((t) => (
                <tr key={t.topic} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3">
                    <Link href={reviewsHref(t.topic)} className="font-medium text-ink hover:underline">
                      {t.label}
                    </Link>
                    <p className="text-xs text-ink-3">{t.description}</p>
                  </td>
                  <td className="py-3 pr-3 tabular">
                    {t.complaints} <span className="text-ink-3">({fmtPct(t.complaintShare)})</span>
                  </td>
                  <td className="py-3 pr-3 tabular">{fmtPct(t.shareOfNegativeReviews)}</td>
                  <td className="py-3 pr-3">
                    <ByHotel counts={t.complaintsByProperty} />
                  </td>
                  <td className="py-3">
                    {t.examples.length ? (
                      <ul className="space-y-1">
                        {t.examples.map((e) => (
                          <li key={e.reviewId + e.evidence} className="text-ink-2">
                            “{e.evidence}” <span className="text-xs text-ink-3">— {e.property}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How topics are detected">
        <div className="space-y-2 text-sm text-ink-2">
          <p>{data.methodology}</p>
          <p>
            Booking.com asks guests what they liked and disliked separately, so we know whether a topic was a complaint or praise without guessing. Each topic has a list of
            keywords (for example <em>dirty, stain, smell, cockroach</em> for cleanliness). The “Recent examples” column shows the exact sentence that matched.
          </p>
          <p>
            <strong className="text-ink">Limitations:</strong> keyword matching can miss unusual wording, sarcasm or non-English reviews, and occasionally tags a sentence that
            mentions a word in another context. Percentages based on fewer than ~10 reviews should be treated as a signal to read the reviews, not a conclusion.
          </p>
        </div>
      </Card>
    </div>
  );
}

function PraiseList({ topics, total, href }: { topics: TopicInsight[]; total: number; href: (t: string) => string }) {
  const rows = [...topics].filter((t) => t.praise > 0).sort((a, b) => b.praise - a.praise).slice(0, 8);
  if (!rows.length) return <p className="text-sm text-ink-2">No praise matched any topic in this period.</p>;
  const max = Math.max(...rows.map((r) => r.praiseShare ?? 0), 0.25);
  return (
    <ul className="space-y-3">
      {rows.map((t) => (
        <li key={t.topic}>
          <Link href={href(t.topic)} className="group -m-1 block rounded-md p-1 hover:bg-surface-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-ink group-hover:underline">{t.label}</span>
              <span className="text-ink-2 tabular">
                <span className="font-semibold text-ink">{fmtPct(t.praiseShare)}</span> · {t.praise} of {total}
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full rounded-full bg-surface-2">
              <div className="h-2.5 rounded-full" style={{ width: `${((t.praiseShare ?? 0) / max) * 100}%`, background: "var(--pos)" }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ByHotel({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="text-ink-3">—</span>;
  return (
    <ul className="w-48 space-y-0.5">
      {entries.map(([slug, n]) => (
        <li key={slug} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-1.5 text-ink-2">
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: propertyColor(slug) }} />
          <span>{propertyName(slug)}</span>
          <span className="font-medium tabular text-ink">{n}</span>
        </li>
      ))}
    </ul>
  );
}
