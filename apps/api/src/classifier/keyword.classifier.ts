import { TOPICS, type TopicKey } from '@azzurro/shared';

export const KEYWORD_CLASSIFIER_VERSION = 'kw-1';

export interface TopicHit {
  topic: Exclude<TopicKey, 'OTHER'>;
  polarity: 'POSITIVE' | 'NEGATIVE';
  evidence: string; // sentence fragment that matched, shown in the UI
  confidence: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pre-compiled matchers. Terms match at a word start; single words also match common suffixes
 * ("clean" → "cleaned", "cleaning"), multi-word phrases tolerate hyphen/space variants.
 */
const MATCHERS = TOPICS.map((t) => ({
  key: t.key as TopicHit['topic'],
  regex: new RegExp(
    `\\b(?:${t.keywords
      .map((k) => escape(k).replace(/\\-|\s+/g, '[\\s-]?'))
      .sort((a, b) => b.length - a.length)
      .join('|')})\\w*`,
    'i',
  ),
}));

/** Phrases that look negative but aren't complaints ("nothing", "n/a", "all good"). */
const EMPTY_COMPLAINT = /^(nothing|none|n\/?a|no complaints?|all good|nothing to dislike|nothing really|-+|\.+)[.!\s]*$/i;

/**
 * Booking splits each review into "Liked" and "Disliked" text, which gives polarity for free:
 * a topic mentioned in the Disliked text is a NEGATIVE mention, in the Liked text a POSITIVE one.
 * Sentence-level matching keeps the evidence snippet short and relevant.
 */
export function classifyKeywords(positiveText: string | null, negativeText: string | null, title: string | null): TopicHit[] {
  const hits = new Map<string, TopicHit>();
  const scan = (text: string | null, polarity: TopicHit['polarity']) => {
    if (!text || EMPTY_COMPLAINT.test(text.trim())) return;
    for (const sentence of splitSentences(text)) {
      for (const m of MATCHERS) {
        const key = `${m.key}:${polarity}`;
        if (hits.has(key)) continue;
        if (m.regex.test(sentence)) hits.set(key, { topic: m.key, polarity, evidence: trim(sentence), confidence: 0.7 });
      }
    }
  };
  scan(negativeText, 'NEGATIVE');
  scan(positiveText, 'POSITIVE');
  // Title polarity is ambiguous; only use it to add topics not found in the body.
  if (title) {
    for (const m of MATCHERS) {
      if ([...hits.values()].some((h) => h.topic === m.key)) continue;
      if (m.regex.test(title)) {
        const polarity = negativeText && !positiveText ? 'NEGATIVE' : 'POSITIVE';
        hits.set(`${m.key}:${polarity}`, { topic: m.key, polarity, evidence: trim(title), confidence: 0.4 });
      }
    }
  }
  return [...hits.values()];
}

function splitSentences(text: string) {
  return text.split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const trim = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s);
