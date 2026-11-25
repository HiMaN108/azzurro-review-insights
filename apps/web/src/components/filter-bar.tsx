"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { PROPERTY_OPTIONS, propertyColor } from "@/lib/properties";
import { RANGE_PRESETS, type RangeKey } from "@/lib/filters";

interface Props {
  /** Show the date-range control (Overview uses a week picker instead). */
  showRange?: boolean;
  rangeFallback?: RangeKey;
  /** Hide presets that make no sense on a page (e.g. "All time" on insights). */
  rangeOptions?: RangeKey[];
  children?: ReactNode;
}

/** One row of filters above the content. All state lives in the URL, so views can be bookmarked and shared. */
/** Update URL search params in a transition (keeps the old view visible while the new one loads). */
export function useUrlUpdate() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const update = (changes: Record<string, string | null>, { resetPage = true } = {}) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return { sp, update, pending };
}

export function FilterBar({ showRange = true, rangeFallback = "this-week", rangeOptions, children }: Props) {
  const { sp, update, pending } = useUrlUpdate();
  const selected = (sp.get("p") ?? "").split(",").filter(Boolean);
  const isCustom = !!(sp.get("from") && sp.get("to"));
  const rangeKey = isCustom ? "custom" : (sp.get("range") ?? rangeFallback);

  const toggleProperty = (slug: string) => {
    const set = new Set(selected);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    update({ p: set.size && set.size < PROPERTY_OPTIONS.length ? [...set].join(",") : null });
  };

  const presets = RANGE_PRESETS.filter((r) => !rangeOptions || rangeOptions.includes(r.key));

  return (
    <div className="z-10 -mx-4 sm:sticky sm:top-0 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface sm:px-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Hotels</span>
        <button
          type="button"
          onClick={() => update({ p: null })}
          aria-pressed={selected.length === 0}
          className={chip(selected.length === 0)}
        >
          All hotels
        </button>
        {PROPERTY_OPTIONS.map((p) => {
          const on = selected.includes(p.slug);
          return (
            <button key={p.slug} type="button" onClick={() => toggleProperty(p.slug)} aria-pressed={on} className={chip(on)}>
              <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: propertyColor(p.slug) }} />
              {p.name}
            </button>
          );
        })}
      </div>

      {(showRange || children) && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {showRange && (
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Period
              <select
                value={rangeKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") update({ range: null, from: sp.get("from") ?? null, to: sp.get("to") ?? null });
                  else update({ range: v === rangeFallback ? null : v, from: null, to: null });
                }}
                className={field}
              >
                {presets.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
                <option value="custom">Custom dates…</option>
              </select>
            </label>
          )}
          {showRange && rangeKey === "custom" && <CustomDates from={sp.get("from") ?? ""} to={sp.get("to") ?? ""} onApply={(from, to) => update({ from, to, range: null })} />}
          {children}
          {pending && <span className="pb-2 text-xs text-ink-3">Updating…</span>}
        </div>
      )}
    </div>
  );
}

function CustomDates({ from, to, onApply }: { from: string; to: string; onApply: (from: string, to: string) => void }) {
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const f = String(fd.get("from"));
        const t = String(fd.get("to"));
        if (f && t && f <= t) onApply(f, t);
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        From
        <input type="date" name="from" defaultValue={from} required className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        To
        <input type="date" name="to" defaultValue={to} required className={field} />
      </label>
      <button type="submit" className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-white hover:opacity-90">
        Apply
      </button>
    </form>
  );
}

export const field = "h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink focus:outline-2 focus:outline-accent";
const chip = (on: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
    on ? "border-accent bg-accent/10 text-ink font-medium" : "border-line bg-surface text-ink-2 hover:text-ink"
  }`;
