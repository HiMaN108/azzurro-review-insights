/** Strategy-agnostic review shape. Both strategies produce this; the normaliser maps it to Prisma. */
export interface RawReview {
  externalId: string | null; // Booking review id (GraphQL). DOM fallback has none.
  reviewedAt: Date;
  score: number;
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  language: string | null;
  reviewerName: string | null;
  reviewerCountry: string | null;
  reviewerCountryCode: string | null;
  travellerType: string | null;
  roomType: string | null;
  nights: number | null;
  checkinDate: Date | null;
  checkoutDate: Date | null;
  stayMonth: Date | null;
  propertyResponse: string | null;
  helpfulVotes: number;
  raw: unknown;
}

/** Headline data captured alongside reviews (stored as a PropertySnapshot). */
export interface PropertyMeta {
  hotelId?: number;
  overallScore?: number;
  reviewCount?: number;
  subScores?: Record<string, number>;
}

export interface StrategyContext {
  /** Max review pages to fetch for this property. */
  maxPages: number;
  /** Incremental mode: return true when a page holds only reviews we already store. */
  isPageAlreadyKnown: (page: RawReview[]) => Promise<boolean>;
  /** Called per page so reviews are persisted progressively (a crash keeps earlier pages). */
  onPage: (page: RawReview[]) => Promise<void>;
  /** Random polite delay between requests. */
  delay: () => Promise<void>;
}

export interface StrategyResult {
  pagesFetched: number;
  reviewsSeen: number;
  meta: PropertyMeta;
  stoppedReason: 'exhausted' | 'known' | 'max-pages';
}

export type StrategyName = 'graphql' | 'dom';
