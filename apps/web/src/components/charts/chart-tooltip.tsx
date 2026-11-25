"use client";
import type { ReactNode } from "react";

export function TooltipBox({ title, rows, footer }: { title: string; rows: { color: string; label: string; value: string }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="font-medium text-ink tabular">{r.value}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1 text-xs text-ink-3">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color, height: i.dashed ? 2 : 3 }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
