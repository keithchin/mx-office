// The live app's hot path, the parts app.ts doesn't need to hold: what `mxcli run --watch` says about a
// change it picked up (seen on mxcli nightly-20261003: "Change detected, rebuilding (build #2)...", then
// "build #2 applied via reload in 4.387s, …" or "build failed: …"), and the clock that times each phase of
// a start or an update for the Live app tab ("Updated in 9 s (hot reload)", shared/liveapp/speed.ts).
//
// A hot apply counts only once mxcli says it applied it and the app then answers below 400 (a failed watch
// build leaves it answering 404 at /). Anything else (a failed build, mxcli gone, no word within the time)
// is a hot reload that didn't confirm, and app.ts restarts.

import http from 'node:http';
import type { LiveTimingPhase, LiveUpdate } from '../../shared/protocol.js';

export type WatchSaid =
  | { kind: 'detected'; build?: number }
  | { kind: 'applied'; how: 'reload' | 'restart'; build?: number; secs?: number }
  | { kind: 'failed'; why: string }
  | { kind: 'exited' };

/** What a line of `mxcli run --watch` output says about a change, if anything. */
export function watchLine(line: string): WatchSaid | undefined {
  const l = line.trim();
  let m = /change detected,?\s*rebuilding(?:\s*\(build #(\d+)\))?/i.exec(l);
  if (m) return { kind: 'detected', ...(m[1] ? { build: Number(m[1]) } : {}) };
  m = /(?:build #(\d+)\s+)?applied via (reload|restart)(?: in ([\d.]+)\s*s)?/i.exec(l);
  if (m) return { kind: 'applied', how: m[2].toLowerCase() as 'reload' | 'restart', ...(m[1] ? { build: Number(m[1]) } : {}), ...(m[3] ? { secs: Number(m[3]) } : {}) };
  m = /^(?:build(?: #\d+)? failed|apply failed|reload failed)[:\s]+(.*)$/i.exec(l);
  if (m) return { kind: 'failed', why: m[1].trim() || 'the build failed' };
  return undefined;
}

export type HotOutcome = { ok: true; secs?: number } | { ok: false; why: string };

/** How long a hot apply may take: for mxcli's watch to see the move, then for its build and reload. */
export interface HotTimes {
  detectMs: number;
  applyMs: number;
}
export const HOT_TIMES: HotTimes = { detectMs: 20_000, applyMs: 90_000 };

/**
 * What mxcli's watch says about the change the office is about to move in: applied, failed, or nothing in
 * time. `hook` is handed the listener for the lines (undefined again once it's settled); `alive` turns
 * false when a stop moved on.
 */
export function watchFor(times: HotTimes, alive: () => boolean, hook: (on: ((said: WatchSaid) => void) | undefined) => void): Promise<HotOutcome> {
  return new Promise((resolve) => {
    let seen = false;
    let done = false;
    const finish = (o: HotOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(tick);
      hook(undefined);
      resolve(o);
    };
    let timer = setTimeout(() => finish({ ok: false, why: `mxcli's watch didn't pick the change up within ${Math.round(times.detectMs / 1000)} s` }), times.detectMs);
    const tick = setInterval(() => !alive() && finish({ ok: false, why: 'stopped' }), 250);
    hook((said) => {
      if (said.kind === 'detected' && !seen) {
        seen = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ok: false, why: `the hot reload didn't finish within ${Math.round(times.applyMs / 1000)} s` }), times.applyMs);
      } else if (said.kind === 'applied') finish({ ok: true, ...(said.secs ? { secs: said.secs } : {}) });
      else if (said.kind === 'failed') finish({ ok: false, why: said.why });
      else if (said.kind === 'exited') finish({ ok: false, why: 'mxcli exited' });
    });
  });
}

/** Times a start or an update phase by phase. */
export class UpdateClock {
  readonly t0 = Date.now();
  private last = this.t0;
  private phases: { name: LiveTimingPhase; ms: number }[] = [];
  fallback?: string;
  commits?: number;
  included?: { sha: string; subject?: string }[];
  from?: string;
  to?: string;

  constructor(
    public mode: LiveUpdate['mode'],
    public reason: string,
  ) {}

  /** The phase that ended now (one that runs twice, like build after a fallback, adds up). */
  lap(name: LiveTimingPhase) {
    const now = Date.now();
    const had = this.phases.find((p) => p.name === name);
    if (had) had.ms += now - this.last;
    else this.phases.push({ name, ms: now - this.last });
    this.last = now;
  }

  /** Whether that phase was timed already. */
  has(name: LiveTimingPhase): boolean {
    return this.phases.some((p) => p.name === name);
  }

  done(ok: boolean, at = Date.now()): LiveUpdate {
    return {
      mode: this.mode,
      reason: this.reason,
      ok,
      at,
      totalMs: at - this.t0,
      phases: this.phases.map((p) => ({ ...p })),
      ...(this.from ? { from: this.from } : {}),
      ...(this.to ? { to: this.to } : {}),
      ...(this.commits ? { commits: this.commits } : {}),
      ...(this.included?.length ? { included: this.included } : {}),
      ...(this.fallback ? { fallback: this.fallback } : {}),
    };
  }

  /** "fetch 0.3s, classify 0.1s, apply 7.9s" for the log. */
  line(): string {
    return this.phases.map((p) => `${p.name} ${(p.ms / 1000).toFixed(1)}s`).join(', ');
  }
}

/** Whether the app answers HTTP on the port; `strict` wants a page (below 400), else anything but a gateway error. */
export function answers(port: number, strict = false): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5_000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < (strict ? 400 : 500));
    });
    req.once('timeout', () => req.destroy());
    req.once('error', () => resolve(false));
  });
}

/** Asks until it answers (strictly) or `ms` went by. */
export async function answersWithin(port: number, ms: number, alive: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (alive()) {
    if (await answers(port, true)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
