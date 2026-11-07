// The asked → visible timer of an Expert-mode session (docs/mockups: the north-star number): a prompt
// submitted (the session's UserPromptSubmit hook) starts it, the next model change (a PostToolUse that ran a
// model-writing command: mxcli exec or apply, the toolkit's bin/exec.sh; or the .mpr or its mprcontents changing
// while the session works: ./stamp.ts) arms it, and the first served reload of the
// preview after that change (the live app serving a new build, or a hot reload it confirmed) stops it. A
// prompt asked while one is still timing keeps the first one's start: the change answers the first ask.
// Samples are kept per Claude session (the median is over that session); a timing that never sees a change
// or a reload within LOOP_GIVE_UP_MS is dropped rather than counted. Pure: the clock comes in with each event.

import type { LoopSample, LoopView } from '../../shared/expert.js';

/** A timing older than this without a reload is dropped (the change never showed, or the app was off). */
export const LOOP_GIVE_UP_MS = 30 * 60_000;
/** Samples kept per session. */
export const LOOP_KEEP = 200;
/** Samples the sparkline shows. */
const RECENT = 12;

/** A command that changes the model: the toolkit's exec script, or mxcli executing a script or statements. */
export const MODEL_CHANGE = /(?:^|[;&|(]\s*|\b(?:bash|sh)\s+)(?:[^\s;&|]*[/\\])?exec\.sh(?![.\w])|\bmxcli(?:\.exe)?\b[^|;&\n]*?\s(?:exec|execute|apply)\b|\bmxcli(?:\.exe)?\b[^|;&\n]*?\s-c\s+['"]?\s*(?:create|alter|drop|rename|move|grant|revoke)\b/i;

export function isModelChange(command: string): boolean {
  return MODEL_CHANGE.test(command);
}

export interface LoopState {
  session?: string;
  samples: LoopSample[];
  pending?: { askedAt: number; changedAt?: number };
}

export const newLoop = (): LoopState => ({ samples: [] });

export type LoopEvent =
  | { kind: 'prompt'; at: number; session?: string }
  | { kind: 'change'; at: number }
  /** The preview served something new at `at` (a build came up or a hot reload was applied). */
  | { kind: 'served'; at: number };

/** The state after `ev`, and the sample it finished, if it finished one. Changes `s` in place. */
export function loopStep(s: LoopState, ev: LoopEvent): LoopSample | undefined {
  if (s.pending && ev.at - s.pending.askedAt > LOOP_GIVE_UP_MS) s.pending = undefined;
  if (ev.kind === 'prompt') {
    // Another session (a /clear, a fresh start): its median starts over.
    if (ev.session && ev.session !== s.session) {
      if (s.session) s.samples = [];
      s.session = ev.session;
    }
    s.pending ??= { askedAt: ev.at };
    return undefined;
  }
  if (ev.kind === 'change') {
    if (s.pending && s.pending.changedAt === undefined) s.pending.changedAt = ev.at;
    return undefined;
  }
  const p = s.pending;
  if (!p || p.changedAt === undefined || ev.at < p.changedAt) return undefined;
  const sample: LoopSample = { askedAt: p.askedAt, changedAt: p.changedAt, visibleAt: ev.at, ms: ev.at - p.askedAt };
  s.samples.push(sample);
  if (s.samples.length > LOOP_KEEP) s.samples.splice(0, s.samples.length - LOOP_KEEP);
  s.pending = undefined;
  return sample;
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

export function loopView(s: LoopState, now = Date.now()): LoopView {
  const ms = s.samples.map((x) => x.ms);
  const p = s.pending && now - s.pending.askedAt <= LOOP_GIVE_UP_MS ? s.pending : undefined;
  return {
    ...(s.session ? { session: s.session } : {}),
    ...(ms.length ? { lastMs: ms[ms.length - 1], medianMs: median(ms) } : {}),
    count: ms.length,
    ...(p ? { pending: { askedAt: p.askedAt, changed: p.changedAt !== undefined } } : {}),
    recent: ms.slice(-RECENT),
  };
}

/** A saved state read back; anything odd is left out. */
export function readLoop(v: unknown): LoopState {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<LoopState>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const samples = Array.isArray(o.samples) ? o.samples.filter((x): x is LoopSample => !!x && num(x.askedAt) && num(x.changedAt) && num(x.visibleAt) && num(x.ms)).slice(-LOOP_KEEP) : [];
  return { ...(typeof o.session === 'string' ? { session: o.session.slice(0, 100) } : {}), samples };
}
