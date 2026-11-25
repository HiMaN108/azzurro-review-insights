import { describe, expect, it } from 'vitest';
import { classifyKeywords } from './keyword.classifier.js';

const topics = (hits: ReturnType<typeof classifyKeywords>) => hits.map((h) => `${h.topic}:${h.polarity}`).sort();

describe('classifyKeywords', () => {
  it('uses the Disliked text for negative and Liked text for positive mentions', () => {
    const hits = classifyKeywords('Great location, friendly staff.', 'Room was dirty and the aircon very loud.', null);
    expect(topics(hits)).toEqual(['CLEANLINESS:NEGATIVE', 'LOCATION:POSITIVE', 'NOISE:NEGATIVE', 'ROOM_CONDITION:NEGATIVE', 'STAFF:POSITIVE'].sort());
  });

  it('ignores empty complaints like "Nothing"', () => {
    expect(classifyKeywords('Clean room', 'Nothing.', null)).toEqual([expect.objectContaining({ topic: 'CLEANLINESS', polarity: 'POSITIVE' })]);
  });

  it('matches hyphen/space variants and word suffixes', () => {
    const hits = classifyKeywords(null, 'Check in took ages. The wi-fi kept dropping. Cleaning was poor.', null);
    expect(topics(hits)).toEqual(['CHECK_IN:NEGATIVE', 'CLEANLINESS:NEGATIVE', 'WIFI:NEGATIVE']);
  });

  it('returns the matching sentence as evidence', () => {
    const [hit] = classifyKeywords(null, 'Lovely view. The shower was broken.', null);
    expect(hit.evidence).toBe('The shower was broken.');
  });
});
