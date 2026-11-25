import type { ReactNode } from "react";

export function Card({ title, subtitle, action, children, className = "" }: { title?: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function KpiTile({ label, value, unit, footer, note }: { label: string; value: string; unit?: string; footer?: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-ink tabular">{value}</span>
        {unit && <span className="text-sm text-ink-3">{unit}</span>}
      </p>
      {footer && <div className="mt-2">{footer}</div>}
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

/** Shown when a figure rests on very few reviews — protects staff from over-reading noise. */
export function LowSample({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-warning-ink" title="Few reviews — this number can swing a lot">
      <span aria-hidden>⚠</span> Only {n} review{n === 1 ? "" : "s"}
    </span>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface p-6 text-center">
      <p className="text-base font-semibold text-critical-ink">
        <span aria-hidden>⚠ </span>Couldn’t load this section
      </p>
      <p className="mt-1 text-sm text-ink-2">{message}</p>
    </div>
  );
}

export function Skeleton({ className = "h-32" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-surface-2 ${className}`} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
    </div>
  );
}
