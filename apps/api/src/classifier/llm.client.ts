/**
 * Minimal client for any OpenAI-compatible chat-completions endpoint
 * (Groq free tier by default; also OpenRouter, Ollama's /v1, OpenAI, …).
 * Provider is chosen purely by LLM_BASE_URL / LLM_MODEL / LLM_API_KEY.
 */

export class LlmRateLimitError extends Error {
  readonly name = 'LlmRateLimitError';
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}
export class LlmError extends Error {
  readonly name: string = 'LlmError';
}

/** Provider temporarily overloaded or erroring (5xx, network) — retry after a pause. */
export class LlmUnavailableError extends LlmError {
  readonly name = 'LlmUnavailableError';
}

/** The model's output was cut off or not valid JSON — usually fixed by sending fewer reviews. */
export class LlmOutputError extends LlmError {
  readonly name = 'LlmOutputError';
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional provider-specific extras, e.g. {"reasoning_effort":"low"} for Groq gpt-oss. */
  extraBody?: Record<string, unknown>;
  /** Output cap. Reasoning models spend part of it thinking, so keep it generous. */
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmJsonResponse {
  data: unknown;
  totalTokens: number;
}

export async function chatJson(cfg: LlmConfig, system: string, user: string, schema: object): Promise<LlmJsonResponse> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: cfg.maxTokens ?? 8192,
        response_format: { type: 'json_schema', json_schema: { name: 'review_tags', strict: true, schema } },
        ...cfg.extraBody,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
    });
  } catch (err) {
    throw new LlmUnavailableError(`Network error: ${(err as Error).message}`);
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const body = await res.text().catch(() => '');
    throw new LlmRateLimitError(`Rate limited: ${body.slice(0, 200)}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 30_000);
  }
  if (res.status === 401 || res.status === 403) throw new LlmError(`Authentication failed (HTTP ${res.status}) — check LLM_API_KEY`);
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    // Groq returns 400 json_validate_failed when the generation didn't match the schema (often truncated).
    if (res.status === 400 && /json_validate_failed|failed_generation/.test(text)) throw new LlmOutputError(`Invalid JSON from model: ${text.slice(0, 120)}`);
    // e.g. Gemini free tier: 503 "experiencing high demand"
    if (res.status >= 500) throw new LlmUnavailableError(`HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
    throw new LlmError(`HTTP ${res.status}: ${text}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { total_tokens?: number } };
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new LlmOutputError('Response truncated (finish_reason=length)');
  const content = choice?.message?.content;
  if (!content) throw new LlmOutputError('Empty response');
  try {
    return { data: JSON.parse(content), totalTokens: body.usage?.total_tokens ?? 0 };
  } catch {
    throw new LlmOutputError('Response was not valid JSON');
  }
}
