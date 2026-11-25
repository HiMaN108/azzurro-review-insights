import type { Review } from "@/lib/api";
import { fmtReviewDate, scoreWord } from "@/lib/format";
import { propertyColor } from "@/lib/properties";

const TOPIC_LABEL: Record<string, string> = {
  CLEANLINESS: "Cleanliness",
  CHECK_IN: "Check-in",
  STAFF: "Staff",
  NOISE: "Noise",
  FACILITIES: "Facilities",
  LOCATION: "Location",
  ROOM_CONDITION: "Room condition",
  VALUE: "Value",
  COMFORT: "Comfort",
  WIFI: "Wi-Fi",
};

function ScoreBadge({ score, sentiment }: { score: number; sentiment: Review["sentiment"] }) {
  const bg = sentiment === "POSITIVE" ? "var(--pos)" : sentiment === "NEGATIVE" ? "var(--neg)" : "var(--text-3)";
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 text-sm font-bold text-white tabular" style={{ background: bg }}>
        {score.toFixed(1)}
      </span>
      <span className="text-xs text-ink-2">{scoreWord(score)}</span>
    </div>
  );
}

export function ReviewCard({ r }: { r: Review }) {
  const stay = [r.roomType, r.nights ? `${r.nights} night${r.nights > 1 ? "s" : ""}` : null, r.travellerType].filter(Boolean).join(" · ");
  return (
    <article className={`rounded-xl border bg-surface p-4 sm:p-5 ${r.urgent ? "border-[var(--neg)]" : "border-line"}`}>
      {r.urgent && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-critical-ink">
          <span aria-hidden>⚠</span>
          <span>
            Needs attention{r.urgentReason ? `: ${r.urgentReason}` : ""}
          </span>
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium text-ink-2">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: propertyColor(r.property.slug) }} />
            {r.property.name} · {fmtReviewDate(r.reviewedAt)}
          </p>
          <h3 className="mt-1 text-base font-semibold text-ink">{r.title ?? <span className="text-ink-3 font-normal">No title</span>}</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {[r.reviewerName, r.reviewerCountry].filter(Boolean).join(", ")}
            {stay && ` — ${stay}`}
          </p>
        </div>
        <ScoreBadge score={r.score} sentiment={r.sentiment} />
      </header>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            <span aria-hidden>👍 </span>Liked
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">{r.positiveText ?? <span className="text-ink-3">—</span>}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            <span aria-hidden>👎 </span>Disliked
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">{r.negativeText ?? <span className="text-ink-3">—</span>}</p>
        </div>
      </div>

      {r.topics.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Topics mentioned">
          {r.topics.map((t) => (
            <li
              key={`${t.topic}-${t.polarity}`}
              title={t.evidence ?? undefined}
              className={`rounded-full border px-2 py-0.5 text-xs ${t.polarity === "NEGATIVE" ? "border-[var(--neg)] text-critical-ink" : "border-[var(--pos)] text-accent-ink"}`}
            >
              {t.polarity === "NEGATIVE" ? "− " : "+ "}
              {TOPIC_LABEL[t.topic] ?? t.topic}
            </li>
          ))}
          <li className="text-xs text-ink-3" title={r.classifierVersion?.startsWith("llm") ? "Topics tagged by an AI model" : "Topics tagged by keyword rules"}>
            · {r.classifierVersion?.startsWith("llm") ? "AI-tagged" : "keyword-tagged"}
          </li>
        </ul>
      )}

      {r.propertyResponse && (
        <details className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">Hotel replied</summary>
          <p className="mt-2 whitespace-pre-line text-ink-2">{r.propertyResponse}</p>
        </details>
      )}
    </article>
  );
}
