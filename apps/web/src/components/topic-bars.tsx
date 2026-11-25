import Link from "next/link";
import type { TopicInsight } from "@/lib/api";
import { fmtPct } from "@/lib/format";

/**
 * Horizontal bars: share of reviews complaining about each topic. Plain HTML so every bar is a
 * link straight into the matching reviews. Change vs previous period is spelled out in words.
 */
export function TopicBars({ topics, reviewsHref, limit = 10, total }: { topics: TopicInsight[]; reviewsHref: (topic: string) => string; limit?: number; total: number }) {
  const rows = topics.filter((t) => t.complaints > 0).slice(0, limit);
  if (!rows.length) return <p className="text-sm text-ink-2">No complaints matched any topic in this period.</p>;
  // Floor the scale at 25% so a handful of 1-in-9 mentions don't render as full-width bars.
  const max = Math.max(...rows.map((r) => r.complaintShare ?? 0), 0.25);
  return (
    <ul className="space-y-3">
      {rows.map((t) => {
        const ch = t.complaintShareChange;
        const showChange = ch !== null && Math.abs(ch) >= 0.02 && t.previous.complaints + t.complaints >= 3;
        return (
          <li key={t.topic}>
            <Link href={reviewsHref(t.topic)} className="group block rounded-md p-1 -m-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink group-hover:underline">{t.label}</span>
                <span className="text-ink-2 tabular">
                  <span className="font-semibold text-ink">{fmtPct(t.complaintShare)}</span> · {t.complaints} of {total} reviews
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full rounded-full bg-surface-2">
                <div className="h-2.5 rounded-full" style={{ width: `${((t.complaintShare ?? 0) / max) * 100}%`, background: "var(--neg)" }} />
              </div>
              {showChange && (
                <p className={`mt-1 text-xs ${ch! > 0 ? "text-critical-ink" : "text-good-ink"}`}>
                  <span aria-hidden>{ch! > 0 ? "▲" : "▼"}</span> {ch! > 0 ? "Up" : "Down"} from {fmtPct(t.previous.complaintShare)} in the previous period
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
