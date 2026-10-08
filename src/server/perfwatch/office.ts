// The live performance warnings in the real office (index.ts): the event-loop watch started with the
// office and the page reports' throttle, installed by server.ts after the incidents. A stall that comes
// back soon after another starts a CPU profile of the office's own main thread (profile.ts), at most
// once an hour, that runs until the next stall has been caught (or a few minutes): its file and the
// functions that blocked the loop go on the stall's incident, so the cause can be read off it later
// without attaching anything to the running office.

import path from 'node:path';
import type { Ctx } from '../office/context.js';
import { addNote, raise } from '../incidents/index.js';
import { PERF_WATCH, pageDetection, recordStalls, throttle, watchEventLoop, type PageReport, type StallRecord } from './index.js';
import { profiling, recordProfile, summaryText, type ProfileSummary } from './profile.js';
import { testModeOf } from '../testmode.js';

export const SELF_PROFILE = {
  /** A second stall within this long of the first starts one. */
  repeatWithinMs: 30 * 60_000,
  /** At most one automatic profile per this long. */
  everyMs: 60 * 60_000,
  /** It runs at most this long… */
  maxMs: 5 * 60_000,
  /** …or until this long after the next stall was seen. */
  afterStallMs: 2_000,
} as const;

const ACTOR = { kind: 'office' as const, name: 'Performance watch' };

let pageAllow = throttle(PERF_WATCH.throttleMs);
let ctxRef: Ctx | undefined;
let stallLog: ReturnType<typeof recordStalls> | undefined;

/** Where the office keeps the profiles it records of itself. */
export const profileDir = (dataDir: string) => path.join(dataDir, 'perf', 'profiles');

/**
 * Decides when a stall should start a self-profile, and ends one once the next stall is in it.
 * `start(until)` records a profile until `until` resolves; it gets the incident to note it on.
 */
export function selfProfiler(start: (until: Promise<void>) => Promise<unknown>, opts: { now?: () => number; busy?: () => boolean } = {}) {
  const now = opts.now ?? Date.now;
  let lastStall = -Infinity;
  let lastAuto = -Infinity;
  let caught: (() => void) | undefined;
  return {
    /** A stall seen (unthrottled). True when it started a profile. */
    onStall(): boolean {
      const t = now();
      const repeat = t - lastStall <= SELF_PROFILE.repeatWithinMs;
      lastStall = t;
      if (caught) {
        // The stall the running profile waited for: stop it a moment later, with the block inside it.
        const done = caught;
        caught = undefined;
        setTimeout(done, SELF_PROFILE.afterStallMs).unref();
        return false;
      }
      if (!repeat || t - lastAuto < SELF_PROFILE.everyMs || opts.busy?.()) return false;
      lastAuto = t;
      const until = new Promise<void>((r) => (caught = r));
      void start(until).finally(() => (caught = undefined));
      return true;
    },
  };
}

let auto: ReturnType<typeof selfProfiler> | undefined;
/** The serverStall incident the watch last raised into, for the profile's note. */
let stallIncident: string | undefined;

/** Records a profile of the office now (an admin's ask, or the automatic one); notes it on `incident` when given. */
export async function profileOffice(ctx: Ctx, ms: number, opts: { until?: Promise<unknown>; label?: string; incident?: string } = {}): Promise<ProfileSummary> {
  const s = await recordProfile(profileDir(ctx.cfg.dataDir), ms, opts);
  console.warn(`agent-office: ${summaryText(s).split('\n').slice(0, 6).join(' | ')}`);
  if (opts.incident) addNote(opts.incident, summaryText(s), ACTOR);
  return s;
}

export function installPerfWatch(ctx: Ctx): () => void {
  ctxRef = ctx;
  pageAllow = throttle(PERF_WATCH.throttleMs);
  // A test office keeps every block over 100 ms with its time, for the journey's server budget.
  stallLog?.stop();
  stallLog = testModeOf().on ? recordStalls() : undefined;
  auto = selfProfiler(
    (until) =>
      profileOffice(ctx, SELF_PROFILE.maxMs, { until, label: 'stall', incident: stallIncident }).catch((e) => console.warn(`agent-office: the self-profile failed: ${(e as Error).message}`)),
    { busy: profiling },
  );
  const stop = watchEventLoop(
    (d) => {
      console.warn(`agent-office: ${d.title}`);
      stallIncident = raise(d)?.id ?? stallIncident;
    },
    {
      onStall: () => {
        if (auto?.onStall()) console.warn('agent-office: the server stalled again: recording a CPU profile until the next stall');
      },
      onSleep: (ms) => console.log(`agent-office: the computer seems to have slept for ${Math.round(ms / 1000)} s (not counted as a server stall)`),
    },
  );
  return () => {
    stop();
    stallLog?.stop();
    stallLog = undefined;
    auto = undefined;
  };
}

/** The event-loop blocks recorded since `since` (epoch ms); undefined outside test mode. */
export function recordedStalls(since = 0): StallRecord[] | undefined {
  return stallLog?.list(since);
}

/** A page's report (POST /api/perf/longtask): an incident, unless the same view reported within the throttle. True when it raised one. */
export function reportPage(r: PageReport, who: string): boolean {
  if (!pageAllow(`${r.floor ?? ''}:${r.view}`)) return false;
  raise(pageDetection(r, who, !!r.floor && !!ctxRef?.floors.has(r.floor)));
  return true;
}
