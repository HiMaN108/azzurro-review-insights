import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AskForm } from "@/components/ask-form";
import { FilterBar } from "@/components/filter-bar";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { api, ApiError, type AskResult } from "@/lib/api";
import { first, fmtDate, hrefWith, type SearchParams } from "@/lib/filters";
import { propertyColor, propertyName } from "@/lib/properties";

export const metadata = { title: "Ask · Azzurro Review Insights" };

export default function AskPage({ searchParams }: PageProps<"/ask">) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ask the reviews</h1>
        <p className="text-sm text-ink-2">Ask a question in plain English. The answer is built from your guests’ reviews, with the quotes behind every suggestion.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-28" />}>
        <FilterBar rangeFallback="12w" rangeOptions={["4w", "12w", "6m", "12m"]} />
      </Suspense>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Suspense fallback={<Skeleton className="h-48" />}>
            <AskForm />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <AnswerSection searchParams={searchParams} />
          </Suspense>
        </div>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <History searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function AnswerSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const sp = await searchParams;
  const id = first(sp.id);
  if (!id) return null;
  let result: AskResult;
  try {
    result = await api.askResult(id);
  } catch (e) {
    return <ErrorState message={e instanceof ApiError ? e.message : "Could not load this answer."} />;
  }
  return <Answer r={result} />;
}

function Answer({ r }: { r: AskResult }) {
  const { answer, filters } = r;
  const hotels = filters.properties.length ? filters.properties.map(propertyName).join(", ") : "All hotels";
  return (
    <article className="rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="answer-q">
      <header className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Question</p>
        <h2 id="answer-q" className="mt-1 text-lg font-semibold text-ink">
          {r.question}
        </h2>
        <p className="mt-1 text-xs text-ink-3">
          {hotels} · {fmtDate(filters.from)} – {fmtDate(filters.to, { day: "numeric", month: "short", year: "numeric" })} · answered{" "}
          {new Date(r.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" })}
          {r.reviewsUsed > 0 && ` · read ${r.reviewsUsed} relevant reviews plus statistics for all reviews in the period`}
        </p>
      </header>

      <p className={`text-base leading-relaxed ${answer.insufficientData ? "text-ink-2" : "text-ink"}`}>{answer.summary}</p>

      {!!answer.unverifiedFigures?.length && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-warning-ink">
          <span aria-hidden>⚠ </span>
          Some figures in this answer ({answer.unverifiedFigures.join(", ")}) don’t match our statistics. Check them against the Issues &amp; praise page before using them.
        </p>
      )}

      {answer.recommendations.length > 0 && (
        <ol className="mt-5 space-y-4">
          {answer.recommendations.map((rec, i) => (
            <li key={i} className="rounded-lg border border-line p-4">
              <h3 className="flex gap-2 text-base font-semibold text-ink">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">{i + 1}</span>
                {rec.title}
              </h3>
              {rec.action && (
                <p className="mt-2 text-sm text-ink">
                  <span className="font-medium">What to do: </span>
                  {rec.action}
                </p>
              )}
              {rec.why && (
                <p className="mt-1 text-sm text-ink-2">
                  <span className="font-medium text-ink">Why: </span>
                  {rec.why}
                </p>
              )}
              {rec.evidence.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-l-2 border-line pl-3" aria-label="What guests said">
                  {rec.evidence.map((e) => (
                    <li key={e.reviewId} className="text-sm">
                      <span className="text-ink-2">“{e.quote.length > 220 ? `${e.quote.slice(0, 219)}…` : e.quote}”</span>{" "}
                      <Link
                        href={`/reviews?p=${filters.properties.length === 1 ? filters.properties[0] : ""}&from=${e.date}&to=${e.date}`}
                        className="whitespace-nowrap text-xs text-accent-ink hover:underline"
                      >
                        — {e.hotel}, {fmtDate(e.date)}, {e.score}/10
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {answer.caveats && <p className="mt-4 text-sm text-ink-3">Note: {answer.caveats}</p>}
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
        Written by AI ({r.model}) from your review data. Suggestions are a starting point. The quotes are real guest words, so read them before acting.
      </p>
    </article>
  );
}

async function History({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const sp = await searchParams;
  let items;
  try {
    items = await api.askHistory(8);
  } catch {
    return null; // history is a convenience; never block the page on it
  }
  const current = first(sp.id);
  return (
    <Card title="Recent questions" subtitle="Answers are saved, so reopening one is instant">
      {items.length === 0 ? (
        <p className="text-sm text-ink-2">No questions yet. Try one of the suggestions.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((h) => (
            <li key={h.id}>
              <Link
                href={hrefWith("/ask", {}, { id: h.id, p: h.filters.properties.join(",") || undefined, from: h.filters.from, to: h.filters.to })}
                aria-current={h.id === current ? "true" : undefined}
                className={`block rounded-md px-2 py-1.5 text-sm hover:bg-surface-2 ${h.id === current ? "bg-surface-2 font-medium text-ink" : "text-ink-2"}`}
              >
                <span className="line-clamp-2">{h.question}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                  {h.filters.properties.length ? (
                    h.filters.properties.map((p) => <span key={p} aria-hidden className="inline-block size-2 rounded-full" style={{ background: propertyColor(p) }} />)
                  ) : (
                    <span>All hotels</span>
                  )}
                  <span>· {new Date(h.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
