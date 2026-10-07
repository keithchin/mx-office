// The live performance warnings in the real office (index.ts): the event-loop watch started with the
// office and the page reports' throttle, installed by server.ts after the incidents.

import type { Ctx } from '../office/context.js';
import { raise } from '../incidents/index.js';
import { PERF_WATCH, pageDetection, throttle, watchEventLoop, type PageReport } from './index.js';

let pageAllow = throttle(PERF_WATCH.throttleMs);
let ctxRef: Ctx | undefined;

export function installPerfWatch(ctx: Ctx): () => void {
  ctxRef = ctx;
  pageAllow = throttle(PERF_WATCH.throttleMs);
  return watchEventLoop((d) => {
    console.warn(`agent-office: ${d.title}`);
    raise(d);
  });
}

/** A page's report (POST /api/perf/longtask): an incident, unless the same view reported within the throttle. True when it raised one. */
export function reportPage(r: PageReport, who: string): boolean {
  if (!pageAllow(`${r.floor ?? ''}:${r.view}`)) return false;
  raise(pageDetection(r, who, !!r.floor && !!ctxRef?.floors.has(r.floor)));
  return true;
}
