// How long to wait before a step's next try, and which errors are worth one. Exponential backoff with
// jitter: base, base×2, base×4… up to a ceiling, each nudged up or down at random so steps that failed
// together don't all try again in the same second.

import type { RetryPolicy } from './types.js';

/** The wait before try `attempt + 1`, after `attempt` tries failed. `random` is Math.random unless a test gives one. */
export function backoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const base = policy.baseMs ?? 1000;
  const raw = Math.min(policy.maxMs ?? 30_000, base * (policy.factor ?? 2) ** Math.max(0, attempt - 1));
  const jitter = policy.jitter ?? 0.2;
  return Math.max(0, Math.round(raw * (1 + jitter * (random() * 2 - 1))));
}

/** Waits `ms`, or less if `signal` aborts (then it rejects). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * The errors that tend to go away on their own: the network, GitHub's rate limits and 5xx, git's
 * dropped connections, a download that broke off (mxbuild, mxcli). Not a command that ran out of
 * time (the next try would take as long) and not a command that said no.
 */
const TRANSIENT =
  /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)\b|socket hang up|could not resolve host|connection (timed out|reset|refused|closed)|unable to access|early EOF|RPC failed|remote end hung up|TLS (handshake|connection)|HTTP (429|5\d\d)|\b(502|503|504) (bad gateway|service unavailable|gateway time-?out)|rate limit|temporarily unavailable|try again later|download(ing)? failed/i;

export const transientError = (err: Error): boolean => TRANSIENT.test(err.message ?? '') && !/took longer than/.test(err.message ?? '');
