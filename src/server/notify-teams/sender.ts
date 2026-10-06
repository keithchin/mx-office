// Posting one message to the Teams webhook: a few tries with exponential backoff (the workflow engine's
// backoffMs and transientError) on a dropped connection, a 429 or a 5xx, then give up and say why. It
// never throws, and its result never carries the URL (its signature is the secret).

import { backoffMs, transientError } from '../flow/retry.js';
import type { TeamsMessage } from './cards.js';

export interface PostOptions {
  /** Tries in all (4: the first and three more). */
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  timeoutMs?: number;
  /** For tests: a fetch, a wait and a random of their own. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface PostResult {
  ok: boolean;
  /** Why it didn't get through: never the URL or its query. */
  error?: string;
  status?: number;
  attempts: number;
}

/** Teams refuses a message over 28 KB. */
export const MAX_BYTES = 28 * 1024;

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/** Takes anything that looks like a URL or a signature out of an error before it's logged or shown. */
export const scrub = (s: string) =>
  s
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\bsig=[^&\s]+/gi, 'sig=[redacted]')
    .slice(0, 200);

/** A Retry-After header in ms, when Teams sent a sensible one. */
function retryAfter(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.min(60_000, Math.max(0, s * 1000));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.min(60_000, Math.max(0, at - Date.now())) : undefined;
}

export async function postToTeams(url: string, msg: TeamsMessage, opts: PostOptions = {}): Promise<PostResult> {
  const tries = Math.max(1, opts.tries ?? 4);
  const doFetch = opts.fetch ?? fetch;
  const wait = opts.sleep ?? sleepFor;
  const body = JSON.stringify(msg);
  if (Buffer.byteLength(body) > MAX_BYTES) return { ok: false, error: 'The card is over Teams’ 28 KB limit', attempts: 0 };
  let last: PostResult = { ok: false, error: 'Not sent', attempts: 0 };
  for (let attempt = 1; attempt <= tries; attempt++) {
    let again: number | undefined;
    try {
      const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
      // A Workflows trigger answers 202 Accepted; anything 2xx is fine.
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      const why = scrub((await res.text().catch(() => '')).replace(/\s+/g, ' ').trim() || res.statusText);
      last = { ok: false, status: res.status, error: `Teams answered ${res.status}${why ? `: ${why}` : ''}`, attempts: attempt };
      if (res.status === 429 || res.status >= 500) again = retryAfter(res) ?? backoffMs({ maxAttempts: tries, baseMs: opts.baseMs ?? 2000, maxMs: opts.maxMs ?? 30_000 }, attempt, opts.random);
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const detail = e.cause?.code ?? e.cause?.message ?? e.message;
      const timedOut = e.name === 'TimeoutError';
      last = { ok: false, error: timedOut ? 'Teams did not answer in time' : `Couldn't reach Teams: ${scrub(detail)}`, attempts: attempt };
      if (timedOut || transientError(new Error(`${detail} ${e.message}`)) || /fetch failed/i.test(e.message)) again = backoffMs({ maxAttempts: tries, baseMs: opts.baseMs ?? 2000, maxMs: opts.maxMs ?? 30_000 }, attempt, opts.random);
    }
    if (again === undefined || attempt === tries) break;
    await wait(again);
  }
  return last;
}
