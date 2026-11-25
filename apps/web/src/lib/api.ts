// Typed client for the NestJS API. Server-side only (used from Server Components).
import "server-only";

const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {}

async function get<T>(path: string, params: Record<string, string | number | undefined | null> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = `${API}${path}${qs.size ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError("The reviews service is not reachable right now. Please try again in a minute.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new ApiError(msg ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface PeriodStats {
  reviews: number;
  avgScore: number | null;
  positive: number;
  neutral: number;
  negative: number;
  negativeShare: number | null;
  responseRate: number | null;
  lowSample: boolean;
}
export interface Change {
  avgScore: number | null;
  reviews: number;
  negativeShare: number | null;
}
export interface BookingSnapshot {
  overallScore: number | null;
  reviewCount: number | null;
  subScores: Record<string, number> | null;
  capturedAt: string;
}
export interface Overview {
  week: { from: string; to: string };
  previousWeek: { from: string; to: string };
  isWeekToDate: boolean;
  portfolio: { current: PeriodStats; previous: PeriodStats; change: Change };
  properties: { slug: string; name: string; current: PeriodStats; previous: PeriodStats; change: Change; booking: BookingSnapshot | null }[];
  lastCollectedAt: string | null;
}
export interface Trends {
  range: { from: string; to: string };
  granularity: "week" | "month";
  series: (PeriodStats & { period: string; byProperty: Record<string, PeriodStats> })[];
}
export interface TopicInsight {
  topic: string;
  label: string;
  description: string;
  complaints: number;
  complaintShare: number | null;
  shareOfNegativeReviews: number | null;
  praise: number;
  praiseShare: number | null;
  previous: { complaints: number; complaintShare: number | null };
  complaintShareChange: number | null;
  complaintsByProperty: Record<string, number>;
  examples: { evidence: string; property: string; reviewedAt: string; reviewId: string }[];
}
export interface Insights {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  totals: { reviews: number; negativeReviews: number; positiveReviews: number };
  previousTotals: { reviews: number; negativeReviews: number; positiveReviews: number };
  topics: TopicInsight[];
  headlines: string[];
  methodology: string;
}
export interface Review {
  id: string;
  externalId: string;
  reviewedAt: string;
  score: number;
  sentiment: Sentiment;
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  language: string | null;
  reviewerName: string | null;
  reviewerCountry: string | null;
  travellerType: string | null;
  roomType: string | null;
  nights: number | null;
  checkinDate: string | null;
  stayMonth: string | null;
  propertyResponse: string | null;
  property: { slug: string; name: string };
  topics: { topic: string; polarity: "POSITIVE" | "NEGATIVE"; evidence: string | null }[];
}
export interface ReviewPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: Review[];
}
export interface Property {
  slug: string;
  name: string;
  bookingUrl: string;
  storedReviews: number;
  booking: BookingSnapshot | null;
}

const csv = (v?: string[]) => (v?.length ? v.join(",") : undefined);

export const api = {
  properties: () => get<Property[]>("/properties"),
  overview: (o: { week?: string; properties?: string[] }) => get<Overview>("/metrics/overview", { week: o.week, properties: csv(o.properties) }),
  trends: (o: { from?: string; to?: string; granularity?: "week" | "month"; properties?: string[] }) =>
    get<Trends>("/metrics/trends", { from: o.from, to: o.to, granularity: o.granularity, properties: csv(o.properties) }),
  insights: (o: { from?: string; to?: string; properties?: string[] }) => get<Insights>("/insights/topics", { from: o.from, to: o.to, properties: csv(o.properties) }),
  reviews: (o: Record<string, string | number | undefined>) => get<ReviewPage>("/reviews", o),
};
