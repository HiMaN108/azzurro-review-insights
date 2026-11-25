// All business dates are Australia/Sydney local dates ("YYYY-MM-DD"). Weeks run Monday–Sunday.
export const BUSINESS_TZ = 'Australia/Sydney';

/** Today's date in Sydney as YYYY-MM-DD. */
export function todayInSydney(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(now);
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, DST-safe). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export interface DateRange {
  from: string; // inclusive
  to: string; // inclusive
}

export function weekRange(date: string): DateRange {
  const from = startOfWeek(date);
  return { from, to: addDays(from, 6) };
}

/** The range of equal length immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Minutes the zone is ahead of UTC at instant `d`. */
function tzOffsetMinutes(d: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** UTC instant of 00:00 Sydney time on `date`. */
export function sydneyMidnightUtc(date: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  let utc = new Date(guess.getTime() - tzOffsetMinutes(guess, BUSINESS_TZ) * 60_000);
  // Second pass corrects the rare case where the guess straddles a DST change.
  utc = new Date(guess.getTime() - tzOffsetMinutes(utc, BUSINESS_TZ) * 60_000);
  return utc;
}

/** [start, endExclusive) UTC bounds for an inclusive local date range. */
export function rangeToUtc(range: DateRange): { gte: Date; lt: Date } {
  return { gte: sydneyMidnightUtc(range.from), lt: sydneyMidnightUtc(addDays(range.to, 1)) };
}
