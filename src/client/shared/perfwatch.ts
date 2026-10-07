// The live performance warning from the page's side (server/perfwatch/): a task that runs longer than
// half a second is reported to POST /api/perf/longtask with the view it happened on and, where the
// browser says (long animation frames' scripts), which scripts took the time. At most one report a
// minute per view, and nothing at all while the tab is hidden (a background tab's timers are throttled
// into long tasks that aren't anyone's freeze). The flat views and the home page install it.

const REPORT_MS = 500;
const EVERY_MS = 60_000;

interface Script {
  duration: number;
  invoker?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
}

/** Which view the page is on: its path and the ?tab= it shows (what the incident names). */
export function viewName(loc: Pick<Location, 'pathname' | 'search'> = location): string {
  const tab = new URLSearchParams(loc.search).get('tab');
  const page = loc.pathname.replace(/\.html$/, '').replace(/^\/+/, '') || 'office';
  return tab ? `${page} › ${tab}` : page;
}

/** The scripts of a long frame as short lines, longest first. */
export function scriptLines(scripts: readonly Script[]): string[] {
  return [...scripts]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((s) => {
      const file = (s.sourceURL ?? '').split('?')[0].split('/').pop() ?? '';
      const at = file ? ` ${file}${(s.sourceCharPosition ?? -1) >= 0 ? `@${s.sourceCharPosition}` : ''}` : '';
      return `${Math.round(s.duration)} ms ${s.invoker || 'script'}${s.sourceFunctionName ? ` ${s.sourceFunctionName}` : ''}${at}`;
    });
}

let installed = false;

/** Starts watching this page's long tasks. `floor` says which floor it's on, when it's on one. */
export function watchLongTasks(floor: () => string | undefined = () => new URLSearchParams(location.search).get('floor') ?? undefined) {
  if (installed || typeof PerformanceObserver === 'undefined') return;
  installed = true;
  const sent = new Map<string, number>();
  let frames: { start: number; end: number; scripts: Script[] }[] = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { scripts?: Script[] })[])
        if (e.duration >= REPORT_MS) frames = [...frames.slice(-9), { start: e.startTime, end: e.startTime + e.duration, scripts: e.scripts ?? [] }];
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {
    // Not in this browser: reports go without scripts.
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < REPORT_MS || document.visibilityState !== 'visible') continue;
        const view = viewName();
        const now = Date.now();
        if (now - (sent.get(view) ?? -Infinity) < EVERY_MS) continue;
        sent.set(view, now);
        // The long frame's scripts arrive a moment after the task: send then.
        setTimeout(() => {
          const f = frames.find((x) => x.start <= e.startTime + 5 && x.end >= e.startTime + e.duration - 5);
          const body = { view, ms: Math.round(e.duration), floor: floor(), stack: f ? scriptLines(f.scripts) : [], url: location.pathname + location.search };
          void fetch('/api/perf/longtask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
        }, 200);
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // No long-task timing here: nothing to report.
  }
}
