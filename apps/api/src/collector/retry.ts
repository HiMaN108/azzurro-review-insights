import { BlockedError, ContractChangedError } from './collector.errors.js';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function randomBetween(min: number, max: number) {
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

/**
 * Retry with exponential backoff + jitter. Contract changes are not retried
 * (they need the fallback strategy, not another attempt).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  { attempts = 3, baseMs = 2000, onRetry }: { attempts?: number; baseMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err instanceof ContractChangedError || attempt === attempts) break;
      onRetry?.(err, attempt);
      // Blocks get a longer cool-down than ordinary network errors.
      const factor = err instanceof BlockedError ? 4 : 1;
      await sleep(baseMs * factor * 2 ** (attempt - 1) + randomBetween(0, 1000));
    }
  }
  throw lastErr;
}
