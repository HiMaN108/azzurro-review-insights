export const fmtScore = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(1));
export const fmtPct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(dp)}%`);
export const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} pts`;

/** Human label for Booking's 1–10 scale, matching Booking's own wording bands. */
export function scoreWord(score: number | null) {
  if (score === null) return "";
  if (score >= 9) return "Superb";
  if (score >= 8) return "Very good";
  if (score >= 7) return "Good";
  if (score >= 6) return "Pleasant";
  return "Below expectations";
}

export function timeAgo(iso: string | null, now = Date.now()) {
  if (!iso) return null;
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtReviewDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });
}

/** Data older than this is flagged as possibly out of date (daily collection + slack). */
export function isStale(iso: string | null, maxHours = 36, now = Date.now()) {
  return !iso || now - Date.parse(iso) > maxHours * 3600_000;
}
