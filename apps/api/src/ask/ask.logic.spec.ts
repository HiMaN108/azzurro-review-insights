import { describe, expect, it } from 'vitest';
import { buildAskMessage, detectTopics, normaliseQuestion, packReviews, unverifiedPercentages, validateAnswer, type PackStats } from './ask.logic.js';
import { RateLimiter } from './rate-limiter.js';

const row = (id: string, neg: string, pos = '', score = 4) => ({ id, hotel: 'Potts Point', reviewedAt: new Date('2026-11-20T03:00:00Z'), score, positiveText: pos || null, negativeText: neg || null });

describe('detectTopics', () => {
  it('finds topics by label or keyword', () => {
    expect(detectTopics('How can we improve check-in?')).toEqual(['CHECK_IN']);
    expect(detectTopics('Why do guests say the rooms are dirty and noisy?')).toEqual(expect.arrayContaining(['CLEANLINESS', 'NOISE']));
    expect(detectTopics('What do guests think of the wifi')).toEqual(['WIFI']);
  });
  it('returns nothing for open questions', () => {
    expect(detectTopics('How can we improve our rating?')).toEqual([]);
  });
});

describe('packReviews', () => {
  it('assigns refs in priority order, skips empty and duplicate reviews', () => {
    const pack = packReviews([row('a', 'Dirty sheets'), row('b', ''), row('a', 'Dirty sheets'), row('c', 'Loud street')]);
    expect(pack.map((p) => [p.ref, p.reviewId])).toEqual([
      ['R1', 'a'],
      ['R2', 'c'],
    ]);
    expect(pack[0]).toMatchObject({ hotel: 'Potts Point', date: '2026-11-20', score: 4, disliked: 'Dirty sheets' });
  });
  it('stops at the text budget and clips long reviews', () => {
    const long = 'x'.repeat(2000);
    const pack = packReviews(Array.from({ length: 50 }, (_, i) => row(String(i), long)), 2000);
    expect(pack.length).toBe(4); // each review clipped to ~420 chars + overhead
    expect(pack[0].disliked.length).toBeLessThanOrEqual(420);
  });
});

describe('buildAskMessage', () => {
  it('includes the question, statistics and labelled reviews', () => {
    const stats: PackStats = {
      period: { from: '2026-09-01', to: '2026-11-29' },
      previousPeriod: { from: '2026-06-04', to: '2026-08-31' },
      hotels: ['Potts Point'],
      reviews: 120,
      previousReviews: 100,
      avgScore: 6.4,
      previousAvgScore: 6.8,
      negativeShare: 0.4,
      topics: [{ label: 'Cleanliness', complaints: 30, complaintShare: 0.25, shareOfNegativeReviews: 0.5, praise: 10, changePts: 0.05 }],
    };
    const msg = buildAskMessage('How to improve?', stats, packReviews([row('a', 'Dirty sheets')]));
    expect(msg).toContain('QUESTION: How to improve?');
    expect(msg).toContain('Average score: 6.4/10 (previous 6.8)');
    expect(msg).toContain('Cleanliness: complaints in 30 reviews (25% of all reviews, 50% of negative reviews; share of reviews complaining up 5 percentage points vs previous period); praise in 10 reviews');
    expect(msg).toContain('[R1] Potts Point · 2026-11-20 · score 4/10');
  });
});

describe('validateAnswer', () => {
  const pack = packReviews([row('a', 'Dirty sheets'), row('b', 'Rude reception')]);
  it('keeps only refs that were sent and attaches the real review text', () => {
    const { answer, problems } = validateAnswer(
      {
        summary: 'Cleanliness is the main issue.',
        recommendations: [{ title: 'Fix housekeeping', action: 'Daily linen checks', why: '25% of reviews', evidence: ['R1', '[R2]', 'R9'] }],
        caveats: '',
        insufficient_data: false,
      },
      pack,
    );
    expect(answer.recommendations[0].evidence.map((e) => [e.ref, e.reviewId, e.quote])).toEqual([
      ['R1', 'a', 'Dirty sheets'],
      ['R2', 'b', 'Rude reception'],
    ]);
    expect(problems).toEqual(['unknown ref R9']);
  });
  it('recovers refs the model wrote into the text and strips them from it', () => {
    const { answer } = validateAnswer({ summary: 's', recommendations: [{ title: 'Clean', action: 'Linen checks', why: 'Guests mention sheets (R1, R2).', evidence: [] }], caveats: '', insufficient_data: false }, pack);
    expect(answer.recommendations[0].evidence.map((e) => e.ref)).toEqual(['R1', 'R2']);
    expect(answer.recommendations[0].why).toBe('Guests mention sheets.');
  });

  it('flags percentages that are not in the statistics', () => {
    const { answer } = validateAnswer({ summary: 'Cleanliness is in 25% of reviews; 17% of guests left.', recommendations: [], caveats: '', insufficient_data: true }, pack);
    expect(unverifiedPercentages(answer, 'Cleanliness: 25% of all reviews (17 reviews)')).toEqual(['17%']);
  });

  it('survives malformed output', () => {
    const { answer } = validateAnswer(null, pack);
    expect(answer.summary).toBe('No answer was produced.');
    expect(answer.recommendations).toEqual([]);
  });
});

describe('normaliseQuestion', () => {
  it('ignores case and punctuation for caching', () => {
    expect(normaliseQuestion('How can we improve?? ')).toBe(normaliseQuestion('how can we  improve'));
  });
});

describe('RateLimiter', () => {
  it('allows N requests per window, then reports the wait', () => {
    const rl = new RateLimiter(2, 60_000);
    expect(rl.take('ip', 0)).toBe(0);
    expect(rl.take('ip', 1000)).toBe(0);
    expect(rl.take('ip', 2000)).toBe(58_000);
    expect(rl.take('other', 2000)).toBe(0);
    expect(rl.take('ip', 61_000)).toBe(0);
  });
});
