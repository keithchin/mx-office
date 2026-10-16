// The office's /api/health (no sign-in): whether it's up and which build it runs. Waiting for it, with a
// time limit and a way out when the office's process is already gone, and the decision what to do with
// a port: start an office, attach to the one already there, or say the port is someone else's. Pure, with
// the fetch, the clock and the sleep handed in.

export interface Health {
  ok: true;
  sha?: string;
  release?: number | string;
  ahead?: number;
  builtAt?: number;
  startedAt?: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** /api/health's body, when it's the office's. */
export function parseHealth(body: unknown): Health | undefined {
  if (!body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) return undefined;
  const b = body as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out: Health = { ok: true };
  if (typeof b.sha === 'string') out.sha = b.sha;
  if (typeof b.release === 'number' || typeof b.release === 'string') out.release = b.release;
  if (num(b.ahead) !== undefined) out.ahead = num(b.ahead);
  if (num(b.builtAt) !== undefined) out.builtAt = num(b.builtAt);
  if (num(b.startedAt) !== undefined) out.startedAt = num(b.startedAt);
  return out;
}

/** "release 50 (0d92abc)", "release 50 + 3 (0d92abc)", "0d92abc", or "unknown build". */
export function healthLabel(h: Health | undefined): string {
  if (!h) return 'unknown build';
  const sha = h.sha ? h.sha.slice(0, 7) : undefined;
  if (h.release === undefined) return sha ?? 'unknown build';
  return `release ${h.release}${h.ahead ? ` + ${h.ahead}` : ''}${sha ? ` (${sha})` : ''}`;
}

/** One look at /api/health: the office's health, or undefined (down, not the office, too slow). */
export async function fetchHealth(fetchImpl: FetchLike, base: string, timeoutMs = 2000): Promise<Health | undefined> {
  try {
    const r = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? parseHealth(await r.json()) : undefined;
  } catch {
    return undefined;
  }
}

export type WaitResult = { ok: true; health: Health; ms: number } | { ok: false; reason: 'timeout' | 'exited'; ms: number };

export interface WaitOptions {
  fetch: FetchLike;
  base: string;
  timeoutMs: number;
  intervalMs?: number;
  /** Stops the wait early: the office's process is gone. */
  gone?: () => boolean;
  /** A health that doesn't count yet (the office from before a restart): wait for a new one. */
  accept?: (h: Health) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits until /api/health answers (and `accept`s it), the process is gone, or the time is up. */
export async function waitForHealth(o: WaitOptions): Promise<WaitResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const interval = o.intervalMs ?? 250;
  const t0 = now();
  for (;;) {
    if (o.gone?.()) return { ok: false, reason: 'exited', ms: now() - t0 };
    const left = o.timeoutMs - (now() - t0);
    if (left <= 0) return { ok: false, reason: 'timeout', ms: now() - t0 };
    const h = await fetchHealth(o.fetch, o.base, Math.max(100, Math.min(2000, left)));
    if (h && (!o.accept || o.accept(h))) return { ok: true, health: h, ms: now() - t0 };
    if (o.gone?.()) return { ok: false, reason: 'exited', ms: now() - t0 };
    await sleep(Math.min(interval, Math.max(0, o.timeoutMs - (now() - t0))));
  }
}

export type StartDecision = { kind: 'start' } | { kind: 'attach'; health: Health } | { kind: 'ask'; health: Health } | { kind: 'busy' } | { kind: 'refuse'; health: Health };

/**
 * What to do on the port: an office already answering there is attached to (or asked about first),
 * never started again beside it on the same data; a port held by something else is reported; a free
 * port gets an office of its own.
 */
export function decideStart(p: { health?: Health; portOpen: boolean; attach: 'ask' | 'always' | 'never' }): StartDecision {
  if (p.health) return p.attach === 'always' ? { kind: 'attach', health: p.health } : p.attach === 'never' ? { kind: 'refuse', health: p.health } : { kind: 'ask', health: p.health };
  return p.portOpen ? { kind: 'busy' } : { kind: 'start' };
}
