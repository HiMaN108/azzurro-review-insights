import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUserMessage, parseResults, type LlmReviewInput } from './llm.classifier.js';
import { chatJson, LlmError, LlmOutputError, LlmRateLimitError } from './llm.client.js';

const batch: LlmReviewInput[] = [
  { id: 'db-1', title: 'Never again', positiveText: 'Great location', negativeText: 'Cockroaches in the kitchen. Staff were rude.', score: 3 },
  { id: 'db-2', title: null, positiveText: 'Muy limpio y tranquilo', negativeText: null, score: 9 },
];

describe('buildUserMessage', () => {
  it('uses short ids so the model never sees database ids', () => {
    const msg = buildUserMessage(batch);
    expect(msg).toContain('"id":"r1"');
    expect(msg).toContain('"id":"r2"');
    expect(msg).not.toContain('db-1');
  });
});

describe('parseResults', () => {
  it('maps short ids back and keeps verified evidence', () => {
    const { results, problems } = parseResults(
      {
        results: [
          {
            id: 'r1',
            topics: [
              { topic: 'CLEANLINESS', polarity: 'NEGATIVE', evidence: 'Cockroaches in the kitchen.' },
              { topic: 'STAFF', polarity: 'NEGATIVE', evidence: 'Staff were rude' },
              { topic: 'LOCATION', polarity: 'POSITIVE', evidence: 'Great location' },
            ],
            urgent: true,
            urgent_reason: 'Pests reported in kitchen',
          },
          { id: 'r2', topics: [{ topic: 'CLEANLINESS', polarity: 'POSITIVE', evidence: 'Muy limpio' }], urgent: false, urgent_reason: '' },
        ],
      },
      batch,
    );
    expect(problems).toEqual([]);
    expect(results[0]).toMatchObject({ reviewId: 'db-1', urgent: true, urgentReason: 'Pests reported in kitchen' });
    expect(results[0].topics.map((t) => [t.topic, t.polarity, t.confidence])).toEqual([
      ['CLEANLINESS', 'NEGATIVE', 0.9],
      ['STAFF', 'NEGATIVE', 0.9],
      ['LOCATION', 'POSITIVE', 0.9],
    ]);
    expect(results[1]).toMatchObject({ reviewId: 'db-2', urgent: false, urgentReason: null });
  });

  it('drops invented evidence but keeps the topic at lower confidence', () => {
    const { results } = parseResults({ results: [{ id: 'r1', topics: [{ topic: 'NOISE', polarity: 'NEGATIVE', evidence: 'The street was very loud' }], urgent: false, urgent_reason: '' }] }, batch);
    expect(results[0].topics[0]).toEqual({ topic: 'NOISE', polarity: 'NEGATIVE', evidence: null, confidence: 0.6 });
  });

  it('rejects unknown ids, topics and polarities and reports missing reviews', () => {
    const { results, problems } = parseResults(
      {
        results: [
          { id: 'r9', topics: [], urgent: false, urgent_reason: '' },
          { id: 'r1', topics: [{ topic: 'PARKING', polarity: 'NEGATIVE', evidence: 'x' }, { topic: 'STAFF', polarity: 'MEH', evidence: 'x' }], urgent: false, urgent_reason: '' },
        ],
      },
      batch,
    );
    expect(results).toHaveLength(1);
    expect(results[0].topics).toEqual([]);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('r9'), expect.stringContaining('PARKING'), expect.stringContaining('missing result for review db-2')]));
  });

  it('handles a malformed response', () => {
    expect(parseResults({ nope: true }, batch).results).toEqual([]);
  });
});

describe('chatJson', () => {
  const cfg = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm' };
  afterEach(() => vi.unstubAllGlobals());

  it('sends a strict json_schema request and parses the JSON content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"results":[]}' }, finish_reason: 'stop' }], usage: { total_tokens: 123 } })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await chatJson(cfg, 'sys', 'user', { type: 'object' });
    expect(res).toEqual({ data: { results: [] }, totalTokens: 123 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(init.headers.authorization).toBe('Bearer k');
  });

  it('turns HTTP 429 into a rate-limit error with the retry-after delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })));
    await expect(chatJson(cfg, 's', 'u', {})).rejects.toMatchObject({ name: 'LlmRateLimitError', retryAfterMs: 7000 });
  });

  it('reports truncated output and auth failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"res' }, finish_reason: 'length' }] }))));
    await expect(chatJson(cfg, 's', 'u', {})).rejects.toThrow(/truncated/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    await expect(chatJson(cfg, 's', 'u', {})).rejects.toBeInstanceOf(LlmError);
  });

  it('treats truncation and json_validate_failed as output errors (→ batch is split and retried)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"json_validate_failed","failed_generation":""}}', { status: 400 })));
    await expect(chatJson(cfg, 's', 'u', {})).rejects.toBeInstanceOf(LlmOutputError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"res' }, finish_reason: 'length' }] }))));
    await expect(chatJson(cfg, 's', 'u', {})).rejects.toBeInstanceOf(LlmOutputError);
  });

  it('sends the output cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] })));
    vi.stubGlobal('fetch', fetchMock);
    await chatJson({ ...cfg, maxTokens: 4096 }, 's', 'u', {});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(4096);
  });

  it('exports the error classes', () => {
    expect(new LlmRateLimitError('x', 1)).toBeInstanceOf(Error);
  });
});
