// Booking.com scores are 1–10. Bands chosen to match Booking's own wording
// ("Good" starts at 7, below 5 is effectively a complaint).
export type SentimentLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export function sentimentFromScore(score: number): SentimentLabel {
  if (score >= 8) return "POSITIVE";
  if (score >= 6) return "NEUTRAL";
  return "NEGATIVE";
}
