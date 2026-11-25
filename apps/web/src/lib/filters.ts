import { addDays, startOfWeek, todayInSydney, weekRange, type DateRange } from "@azzurro/shared";
import { PROPERTY_OPTIONS } from "./properties";

export type SearchParams = Record<string, string | string[] | undefined>;

export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `?p=slug,slug` → validated slugs (unknown values dropped). Empty = all hotels. */
export function parseProperties(sp: SearchParams): string[] {
  const valid = new Set(PROPERTY_OPTIONS.map((p) => p.slug));
  return (first(sp.p) ?? "").split(",").filter((s) => valid.has(s));
}

export const RANGE_PRESETS = [
  { key: "this-week", label: "This week" },
  { key: "last-week", label: "Last week" },
  { key: "4w", label: "Last 4 weeks" },
  { key: "12w", label: "Last 12 weeks" },
  { key: "6m", label: "Last 6 months" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";

/** Resolve `?range=` preset or `?from=&to=` into concrete Sydney dates. */
export function parseRange(sp: SearchParams, fallback: RangeKey): { key: RangeKey; range: DateRange | null; label: string } {
  const from = first(sp.from);
  const to = first(sp.to);
  if (from && to && DATE.test(from) && DATE.test(to) && from <= to) return { key: "custom", range: { from, to }, label: `${fmtDate(from)} – ${fmtDate(to)}` };
  const key = (RANGE_PRESETS.find((r) => r.key === first(sp.range))?.key ?? fallback) as RangeKey;
  return { key, range: presetRange(key), label: RANGE_PRESETS.find((r) => r.key === key)?.label ?? "Custom" };
}

export function presetRange(key: RangeKey): DateRange | null {
  const today = todayInSydney();
  const thisWeek = weekRange(today);
  switch (key) {
    case "this-week":
      return thisWeek;
    case "last-week":
      return weekRange(addDays(thisWeek.from, -7));
    case "4w":
      return { from: addDays(startOfWeek(today), -21), to: thisWeek.to };
    case "12w":
      return { from: addDays(startOfWeek(today), -77), to: thisWeek.to };
    case "6m":
      return { from: addDays(today, -182), to: today };
    case "12m":
      return { from: addDays(today, -365), to: today };
    default:
      return null;
  }
}

/** Build an href that keeps current params and applies overrides (undefined/"" removes a key). */
export function hrefWith(path: string, sp: SearchParams, overrides: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = first(v);
    if (val) qs.set(k, val);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") qs.delete(k);
    else qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { ...opts, timeZone: "UTC" });
}
