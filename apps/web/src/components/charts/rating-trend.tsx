"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { propertyColor, propertyName } from "@/lib/properties";
import { Legend, TooltipBox } from "./chart-tooltip";

export interface RatingPoint {
  period: string;
  label: string;
  all: number | null;
  allCount: number;
  byProperty: Record<string, { avg: number | null; n: number }>;
}

/** Average rating over time. Portfolio line by default; "Compare hotels" adds one line per hotel. */
export function RatingTrend({ data, slugs }: { data: RatingPoint[]; slugs: string[] }) {
  const [compare, setCompare] = useState(slugs.length > 1 && slugs.length < 4);
  const rows = data.map((d) => ({ ...d, ...Object.fromEntries(slugs.map((s) => [s, d.byProperty[s]?.avg ?? null])) }));
  const values = rows.flatMap((r) => [r.all, ...(compare ? slugs.map((s) => r.byProperty[s]?.avg ?? null) : [])]).filter((v): v is number => v !== null);
  const lo = values.length ? Math.max(0, Math.floor(Math.min(...values) - 0.5)) : 0;

  const legend = [{ color: "var(--series-all)", label: "All selected hotels" }, ...(compare ? slugs.map((s) => ({ color: propertyColor(s), label: propertyName(s) })) : [])];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={legend} />
        {slugs.length > 1 && (
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Compare hotels
          </label>
        )}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis domain={[lo, 10]} tick={{ fill: "var(--text-3)", fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: "var(--text-3)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as RatingPoint;
                return (
                  <TooltipBox
                    title={p.label}
                    rows={[
                      { color: "var(--series-all)", label: `All (${p.allCount} reviews)`, value: p.all?.toFixed(1) ?? "–" },
                      ...(compare ? slugs.map((s) => ({ color: propertyColor(s), label: `${propertyName(s)} (${p.byProperty[s]?.n ?? 0})`, value: p.byProperty[s]?.avg?.toFixed(1) ?? "–" })) : []),
                    ]}
                    footer="Average guest score out of 10"
                  />
                );
              }}
            />
            {compare &&
              slugs.map((s) => (
                <Line key={s} type="monotone" dataKey={s} stroke={propertyColor(s)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls isAnimationActive={false} />
              ))}
            <Line type="monotone" dataKey="all" stroke="var(--series-all)" strokeWidth={compare ? 2.5 : 2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">Show as table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 font-medium">All</th>
              {slugs.map((s) => (
                <th key={s} className="py-1 font-medium">
                  {propertyName(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.period} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                <td className="py-1">
                  {d.all?.toFixed(1) ?? "–"} <span className="text-ink-3">({d.allCount})</span>
                </td>
                {slugs.map((s) => (
                  <td key={s} className="py-1">
                    {d.byProperty[s]?.avg?.toFixed(1) ?? "–"} <span className="text-ink-3">({d.byProperty[s]?.n ?? 0})</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
