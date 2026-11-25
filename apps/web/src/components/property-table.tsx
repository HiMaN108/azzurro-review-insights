import Link from "next/link";
import type { Overview } from "@/lib/api";
import { fmtPct, fmtScore } from "@/lib/format";
import { propertyColor } from "@/lib/properties";
import { Delta } from "./delta";
import { LowSample } from "./ui";

/** Property-by-property breakdown. Stacks into cards on phones. */
export function PropertyTable({ overview, topIssue }: { overview: Overview; topIssue: Record<string, string | null> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-3">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-semibold">Hotel</th>
            <th className="py-2 pr-3 font-semibold">This week</th>
            <th className="py-2 pr-3 font-semibold">Last week</th>
            <th className="py-2 pr-3 font-semibold">Change</th>
            <th className="py-2 pr-3 font-semibold">Negative</th>
            <th className="py-2 pr-3 font-semibold">Top issue this week</th>
            <th className="py-2 font-semibold" title="Headline score shown on Booking.com">
              Booking.com score
            </th>
          </tr>
        </thead>
        <tbody>
          {overview.properties.map((p) => (
            <tr key={p.slug} className="border-b border-line last:border-0 align-top">
              <td className="py-3 pr-3">
                <Link href={`/reviews?p=${p.slug}&range=this-week`} className="flex items-center gap-2 font-medium text-ink hover:underline">
                  <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: propertyColor(p.slug) }} />
                  {p.name}
                </Link>
              </td>
              <td className="py-3 pr-3 tabular">
                <span className="text-base font-semibold">{fmtScore(p.current.avgScore)}</span>
                <span className="ml-1 text-ink-3">({p.current.reviews})</span>
                {p.current.lowSample && p.current.reviews > 0 && (
                  <div className="mt-1">
                    <LowSample n={p.current.reviews} />
                  </div>
                )}
              </td>
              <td className="py-3 pr-3 tabular text-ink-2">
                {fmtScore(p.previous.avgScore)} <span className="text-ink-3">({p.previous.reviews})</span>
              </td>
              <td className="py-3 pr-3">
                <Delta value={p.change.avgScore} kind="score" suffix="" />
              </td>
              <td className="py-3 pr-3 tabular">{fmtPct(p.current.negativeShare)}</td>
              <td className="py-3 pr-3 text-ink-2">{topIssue[p.slug] ?? <span className="text-ink-3">None flagged</span>}</td>
              <td className="py-3 tabular">
                {p.booking?.overallScore != null ? (
                  <>
                    <span className="font-medium">{p.booking.overallScore.toFixed(1)}</span>
                    <span className="ml-1 text-ink-3">· {p.booking.reviewCount?.toLocaleString()} reviews</span>
                  </>
                ) : (
                  "–"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
