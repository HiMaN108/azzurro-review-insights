/** Booking's bot protection served a challenge/CAPTCHA we could not pass. Retrying immediately won't help. */
export class BlockedError extends Error {
  readonly name = 'BlockedError';
}

/**
 * The page or the ReviewList response no longer matches what we expect
 * (field renamed, query not fired, etc.). Triggers the DOM fallback strategy.
 */
export class ContractChangedError extends Error {
  readonly name = 'ContractChangedError';
}

/** Network glitch / 5xx / timeout. Safe to retry with backoff. */
export class TransientError extends Error {
  readonly name = 'TransientError';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
