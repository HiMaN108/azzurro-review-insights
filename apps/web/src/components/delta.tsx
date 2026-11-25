/**
 * Week-on-week change. Status colour always ships with an arrow and words, never colour alone.
 * `betterWhen` decides whether up is good (rating) or bad (share of negative reviews).
 */
export function Delta({
  value,
  kind,
  betterWhen = "up",
  suffix = "vs last week",
}: {
  value: number | null;
  kind: "score" | "pts" | "count";
  betterWhen?: "up" | "down";
  suffix?: string;
}) {
  if (value === null) return <span className="text-sm text-ink-3">No comparison available</span>;
  const threshold = kind === "score" ? 0.05 : kind === "pts" ? 0.005 : 0.5;
  const flat = Math.abs(value) < threshold;
  const good = flat ? null : betterWhen === "up" ? value > 0 : value < 0;
  const text =
    kind === "score" ? `${value > 0 ? "+" : ""}${value.toFixed(1)}` : kind === "pts" ? `${value > 0 ? "+" : ""}${Math.round(value * 100)} pts` : `${value > 0 ? "+" : ""}${value}`;
  const tone = good === null ? "text-ink-2" : good ? "text-good-ink" : "text-critical-ink";
  const arrow = flat ? "→" : value > 0 ? "▲" : "▼";
  const word = flat ? "No change" : good ? "Better" : "Worse";
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 text-sm ${tone}`}>
      <span aria-hidden>{arrow}</span>
      <span className="font-semibold tabular">{flat ? "±0" : text}</span>
      <span className="font-medium">{word}</span>
      <span className="text-ink-3">{suffix}</span>
    </span>
  );
}
