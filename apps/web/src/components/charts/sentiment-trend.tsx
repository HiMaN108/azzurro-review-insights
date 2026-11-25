"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Legend, TooltipBox } from "./chart-tooltip";

export interface SentimentPoint {
  period: string;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
}

const SERIES = [
  { key: "positive", label: "Positive (8–10)", color: "var(--pos)" },
  { key: "neutral", label: "Mixed (6–7.9)", color: "var(--neu)" },
  { key: "negative", label: "Negative (below 6)", color: "var(--neg)" },
] as const;

/** Positive / mixed / negative review counts per period (stacked, 2px surface gap between segments). */
export function SentimentTrend({ data }: { data: SentimentPoint[] }) {
  return (
    <div>
      <Legend items={SERIES.map((s) => ({ color: s.color, label: s.label }))} />
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barCategoryGap="25%">
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--text-3)", fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as SentimentPoint;
                const total = p.positive + p.neutral + p.negative;
                return (
                  <TooltipBox
                    title={p.label}
                    rows={[...SERIES].reverse().map((s) => ({ color: s.color, label: s.label, value: `${p[s.key]} (${total ? Math.round((p[s.key] / total) * 100) : 0}%)` }))}
                    footer={`${total} reviews`}
                  />
                );
              }}
            />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="s"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={1}
                radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">Show as table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 font-medium">Period</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.period} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                <td className="py-1">{d.positive}</td>
                <td className="py-1">{d.neutral}</td>
                <td className="py-1">{d.negative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
