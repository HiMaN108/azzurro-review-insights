import { TOPIC_KEYS, TOPICS } from '@azzurro/shared';

export const LLM_CLASSIFIER_VERSION = 'llm-2'; // llm-2: stricter urgent criteria

export interface LlmReviewInput {
  id: string; // database id
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  score: number;
}

export interface LlmTopicHit {
  topic: (typeof TOPIC_KEYS)[number];
  polarity: 'POSITIVE' | 'NEGATIVE';
  evidence: string | null;
  confidence: number;
}

export interface LlmReviewResult {
  reviewId: string;
  topics: LlmTopicHit[];
  urgent: boolean;
  urgentReason: string | null;
}

/** Stable system prompt (kept byte-identical across calls so providers can cache it). */
export const SYSTEM_PROMPT = `You tag hotel guest reviews for an operations team.

Each review has a "liked" part, a "disliked" part, an optional title and a score out of 10. Reviews can be in any language.

For every review, list the operational topics the guest clearly mentions:
${TOPICS.map((t) => `- ${t.key}: ${t.label} (${t.description})`).join('\n')}

Rules:
- polarity is NEGATIVE when the guest complains about the topic, POSITIVE when they praise it. Usually complaints are in "disliked" and praise in "liked", but judge the meaning (e.g. "liked: nothing, the room was filthy" is a NEGATIVE cleanliness mention).
- evidence must be copied exactly from the review text (same words and language, at most 25 words). It is shown to staff as proof, so never paraphrase or translate it.
- Only tag what the guest actually says. "Nothing", "N/A" or empty text means no topics. A topic can appear at most once per polarity.
- urgent is true only when the guest describes a specific incident a manager should act on today:
  pests (cockroaches, bed bugs, rats or mice); theft or missing belongings; broken locks, doors that don't secure, or other security failures; fire, gas or electrical hazards; injury or illness caused by the stay; harassment, abuse or discrimination; or an explicit refund, chargeback or legal threat.
  NOT urgent on their own: general dirtiness, mould, bad smells, noise, worn or broken furniture, rude staff, overpricing — unless the guest says it made them ill or hurt them.
  Watch for slang: "robo", "rip-off", "daylight robbery" or "steal" about the price is a value complaint, not theft. Small flies or a single insect in a positive review is not urgent.
- urgent_reason: one short sentence in English when urgent is true, otherwise an empty string.
- Return one result per review id, in the same order.`;

/** JSON schema for structured output (strict mode: every property required, no extras). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'topics', 'urgent', 'urgent_reason'],
        properties: {
          id: { type: 'string' },
          topics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['topic', 'polarity', 'evidence'],
              properties: {
                topic: { type: 'string', enum: [...TOPIC_KEYS] },
                polarity: { type: 'string', enum: ['POSITIVE', 'NEGATIVE'] },
                evidence: { type: 'string' },
              },
            },
          },
          urgent: { type: 'boolean' },
          urgent_reason: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Reviews are sent with short ids (r1, r2…) to save tokens; this maps them back. */
export function buildUserMessage(batch: LlmReviewInput[]) {
  const items = batch.map((r, i) => ({
    id: `r${i + 1}`,
    score: r.score,
    title: r.title ?? '',
    liked: r.positiveText ?? '',
    disliked: r.negativeText ?? '',
  }));
  return `Tag these ${items.length} reviews:\n${JSON.stringify(items)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"']/g, '').trim();

/**
 * Validate and normalise the model output. Never trust it blindly:
 * - unknown ids, topics or polarities are dropped
 * - evidence must appear in the review text; otherwise it is discarded and confidence lowered
 *   (the topic is kept — models sometimes trim punctuation — but staff never see invented quotes)
 */
export function parseResults(raw: unknown, batch: LlmReviewInput[]): { results: LlmReviewResult[]; problems: string[] } {
  const problems: string[] = [];
  const byShortId = new Map(batch.map((r, i) => [`r${i + 1}`, r]));
  const list = (raw as { results?: unknown })?.results;
  if (!Array.isArray(list)) return { results: [], problems: ['response has no results array'] };

  const results: LlmReviewResult[] = [];
  const seenIds = new Set<string>();
  for (const item of list as Record<string, unknown>[]) {
    const review = byShortId.get(String(item?.id));
    if (!review || seenIds.has(review.id)) {
      problems.push(`unknown or duplicate id ${String(item?.id)}`);
      continue;
    }
    seenIds.add(review.id);
    const haystack = norm([review.title, review.positiveText, review.negativeText].filter(Boolean).join(' \n '));
    const topics = new Map<string, LlmTopicHit>();
    for (const t of Array.isArray(item.topics) ? (item.topics as Record<string, unknown>[]) : []) {
      const topic = String(t?.topic) as LlmTopicHit['topic'];
      const polarity = t?.polarity === 'POSITIVE' || t?.polarity === 'NEGATIVE' ? t.polarity : null;
      if (!(TOPIC_KEYS as readonly string[]).includes(topic) || !polarity) {
        problems.push(`invalid topic/polarity ${String(t?.topic)}/${String(t?.polarity)}`);
        continue;
      }
      const ev = typeof t.evidence === 'string' ? t.evidence.trim() : '';
      const verified = ev.length > 0 && haystack.includes(norm(ev));
      const key = `${topic}:${polarity}`;
      if (!topics.has(key)) {
        topics.set(key, { topic, polarity, evidence: verified ? ev.slice(0, 300) : null, confidence: verified ? 0.9 : 0.6 });
      }
    }
    const urgent = item.urgent === true;
    const reason = typeof item.urgent_reason === 'string' ? item.urgent_reason.trim().slice(0, 300) : '';
    results.push({ reviewId: review.id, topics: [...topics.values()], urgent, urgentReason: urgent ? reason || 'Flagged as urgent' : null });
  }
  for (const r of batch) if (!seenIds.has(r.id)) problems.push(`missing result for review ${r.id}`);
  return { results, problems };
}
