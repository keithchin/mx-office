// Changing floors on a flat view (the floor picker, a "waiting on" button, ?floor=, a Needs-you link)
// and the page's first floor: the loading overlay with how far the page really is. A load starts when
// the page sends floor.go (or a floor arrives it didn't ask for, the first one included, timed from
// the page's start), and moves on as each thing the view waits for comes in: the floor itself, its
// workers, then what the view fetches for it (the team, the summary, the budget, the setup panel, the
// Coordinator's console), and last the page drawn with it. Changing floor again cancels the load.
// After FLOOR_LIMITS.slowMs it says it's still loading, and after maxMs it goes away regardless.
//
// Every step is a performance mark (`ao:floor:<step>`, detail { floor, ms }) and every load a measure
// (`ao:floor-switch`, detail { floor, outcome, steps }), kept in window.__aoFloorLoads too, so tests
// and the perf guard can read the real timings.

import type { Net } from '../../net';
import { store } from '../../state';
import { hideOverlay, showOverlay } from './overlay';
import { FLOOR_STEPS, LoadTracker, type FloorStep, type StepLoad } from './progress';

/** A load that's over this quickly never shows the overlay (no flash on a fast floor). */
const SHOW_AFTER_MS = 150;

export interface FloorLoadRecord {
  floor: string;
  name: string;
  outcome: 'done' | 'timeout' | 'cancelled';
  total: number;
  steps: Record<string, number>;
}

export interface FloorLoading {
  /** `step` is in for `floor` (a step for another floor, or one this view doesn't wait for, is ignored). */
  done(step: FloorStep, floor: string | null | undefined): void;
}

const records: FloorLoadRecord[] = [];
(window as unknown as { __aoFloorLoads: FloorLoadRecord[] }).__aoFloorLoads = records;

function mark(name: string, detail: object) {
  try {
    performance.mark(name, { detail });
  } catch {
    // An old browser without mark details: the record still has it.
  }
}

/**
 * The overlay for this page. `steps` says what the view waits for right now (the 1D view's tab decides:
 * the Command Center waits on its summary and console, a team page on the team); enter, workers and view
 * are always in it.
 */
export function floorLoading(net: Net, steps: () => FloorStep[]): FloorLoading {
  const tracker = new LoadTracker<FloorStep>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let hiddenByYou = false;
  let first = true;
  const nameOf = (floor: string) => store.floors.find((f) => f.id === floor)?.name ?? floor;
  const want = (): FloorStep[] => [...new Set<FloorStep>(['enter', 'workers', ...steps(), 'view'])];

  function finish(load: StepLoad<FloorStep>, outcome: FloorLoadRecord['outcome'], now: number) {
    timers.forEach(clearTimeout);
    timers = [];
    const rec: FloorLoadRecord = { floor: load.floor, name: nameOf(load.floor), outcome, total: Math.round(now - load.started), steps: load.timings() };
    records.push(rec);
    if (records.length > 30) records.shift();
    try {
      performance.measure('ao:floor-switch', { start: load.started, end: now, detail: rec });
    } catch {
      // As above.
    }
    if (outcome !== 'cancelled') hideOverlay(outcome === 'done' ? `Project ${rec.name} loaded` : '');
  }

  function draw(load: StepLoad<FloorStep>, now = performance.now()) {
    if (hiddenByYou || tracker.current !== load) return;
    const phase = load.phase(now);
    if (phase !== 'loading' && phase !== 'slow') return;
    if (now - load.started < SHOW_AFTER_MS) return;
    const next = load.next;
    showOverlay({ title: `Loading project ${nameOf(load.floor)}… ${load.pct} %`, step: next ? `${FLOOR_STEPS[next]}…` : '', pct: load.pct, slow: phase === 'slow' }, () => (hiddenByYou = true));
  }

  function begin(floor: string, started: number) {
    const now = performance.now();
    const { load, cancelled } = tracker.begin(floor, want(), started);
    if (cancelled) finish(cancelled, 'cancelled', now);
    timers.forEach(clearTimeout);
    hiddenByYou = false;
    mark('ao:floor:start', { floor, ms: Math.round(now - started) });
    const age = now - started;
    timers = [
      setTimeout(() => draw(load), Math.max(0, SHOW_AFTER_MS - age)),
      setTimeout(() => draw(load), Math.max(0, load.limits.slowMs - age)),
      setTimeout(() => tracker.current === load && load.phase(performance.now()) === 'timeout' && finish(load, 'timeout', performance.now()), Math.max(0, load.limits.maxMs - age) + 5),
    ];
  }

  function done(step: FloorStep, floor: string | null | undefined) {
    const now = performance.now();
    const load = tracker.current;
    if (!load || !tracker.done(step, floor, now)) return;
    mark(`ao:floor:${step}`, { floor, ms: Math.round(now - load.started) });
    if (load.phase(now) === 'done') return finish(load, 'done', now);
    draw(load, now);
    // The page drawn with it all: two frames after the last of the rest came in.
    if (step !== 'view' && load.allBut('view')) requestAnimationFrame(() => requestAnimationFrame(() => done('view', load.floor)));
  }

  net.onSend((m) => {
    if (m.t === 'floor.go' && m.floor && m.floor !== store.floor) begin(m.floor, performance.now());
  });
  // The floor arriving: the one asked for, or one the page didn't ask for (the first, timed from the page's start).
  // A reconnect brings the same floor again: that's no new load.
  let entered: string | undefined;
  store.on('floor', () => {
    const f = store.floor;
    if (!f || f === entered) return;
    entered = f;
    const cur = tracker.current;
    if (!cur || cur.floor !== f || cur.has('enter')) begin(f, first ? 0 : performance.now());
    first = false;
    done('enter', f);
  });
  store.on('workers', () => done('workers', store.floor));
  return { done };
}
