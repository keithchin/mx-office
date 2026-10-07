// The live performance warnings in the real office (index.ts): the event-loop watch started with the
// office and the page reports' throttle, installed by server.ts after the incidents.

import type { Ctx } from '../office/context.js';
import { raise } from '../incidents/index.js';
import { PERF_WATCH, pageDetection, recordStalls, throttle, watchEventLoop, type PageReport, type StallRecord } from './index.js';
import { testModeOf } from '../testmode.js';

let pageAllow = throttle(PERF_WATCH.throttleMs);
let ctxRef: Ctx | undefined;
let stallLog: ReturnType<typeof recordStalls> | undefined;

export function installPerfWatch(ctx: Ctx): () => void {
  ctxRef = ctx;
  pageAllow = throttle(PERF_WATCH.throttleMs);
  // A test office keeps every block over 100 ms with its time, for the journey's server budget.
  stallLog?.stop();
  stallLog = testModeOf().on ? recordStalls() : undefined;
  const stop = watchEventLoop((d) => {
    console.warn(`agent-office: ${d.title}`);
    raise(d);
  });
  return () => {
    stop();
    stallLog?.stop();
    stallLog = undefined;
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
