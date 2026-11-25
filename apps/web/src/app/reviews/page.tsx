import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/filter-bar";
import { ReviewCard } from "@/components/review-card";
import { ReviewControls } from "@/components/review-controls";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { first, hrefWith, parseProperties, parseRange, type SearchParams } from "@/lib/filters";

export const metadata = { title: "Reviews · Azzurro Review Insights" };

export default function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Read reviews</h1>
        <p className="text-sm text-ink-2">Every Booking.com review, newest first. Filter by hotel, dates, rating or topic.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-28" />}>
        <FilterBar rangeFallback="all">
          <ReviewControls />
        </FilterBar>
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Feed({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection(); // live data: always render at request time ("this week" depends on today's date)
  const sp = await searchParams;
  const { range, label } = parseRange(sp, "all");
  const page = Math.max(1, Number(first(sp.page)) || 1);
  let data;
  try {
    data = await api.reviews({
      properties: parseProperties(sp).join(",") || undefined,
      from: range?.from,
      to: range?.to,
      sentiment: first(sp.sentiment),
      topic: first(sp.topic),
      polarity: first(sp.polarity),
      q: first(sp.q),
      sort: first(sp.sort),
      page,
      pageSize: 20,
    });
  } catch (e) {
    return <ErrorState message={e instanceof ApiError ? e.message : "Unexpected error loading reviews."} />;
  }

  if (!data.total) {
    return (
      <EmptyState title="No reviews match these filters">
        Try a longer period or remove a filter. <Link href="/reviews" className="text-accent-ink underline">Clear all filters</Link>
      </EmptyState>
    );
  }

  return (
    <section aria-label="Reviews" className="space-y-3">
      <p className="text-sm text-ink-2" aria-live="polite">
        <span className="font-semibold text-ink">{data.total.toLocaleString()}</span> review{data.total === 1 ? "" : "s"} · {label}
      </p>
      {data.items.map((r) => (
        <ReviewCard key={r.id} r={r} />
      ))}
      <nav aria-label="Pages" className="flex items-center justify-between pt-2 text-sm">
        {page > 1 ? (
          <Link href={hrefWith("/reviews", sp, { page: String(page - 1) })} className="rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-2">
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        <span className="text-ink-3">
          Page {page} of {data.totalPages}
        </span>
        {page < data.totalPages ? (
          <Link href={hrefWith("/reviews", sp, { page: String(page + 1) })} className="rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-2">
            Older →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </section>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-44" />
      ))}
    </div>
  );
}
