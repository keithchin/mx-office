// How far a load has got, as pure accounting (no DOM, no timers): the steps it waits for, done in any
// order, its percentage, whether it's slow or past its limit, and starting another one cancelling it.
// The floor's loading overlay (floor.ts) feeds it what the page actually waits for when it enters a
// floor; tests/loading-progress.test.ts checks every case.

/** What the flat views wait for when they enter a floor (each view picks the ones it shows). */
export const FLOOR_STEPS = {
  enter: 'Entering the floor',
  workers: 'The agents',
  roster: 'The team',
  summary: 'The summary',
  budget: 'The budget',
  setup: 'The project’s stages',
  convo: 'The Coordinator’s console',
  view: 'Drawing the page',
} as const;
export type FloorStep = keyof typeof FLOOR_STEPS;

export interface LoadLimits {
  /** After this long the overlay says it's still loading. */
  slowMs: number;
  /** After this long it gives up waiting and lets the page be (never stuck). */
  maxMs: number;
}
export const FLOOR_LIMITS: LoadLimits = { slowMs: 5_000, maxMs: 15_000 };

export type LoadPhase = 'loading' | 'slow' | 'done' | 'timeout' | 'cancelled';

/** One load: a floor and the steps it waits for. Times are the caller's clock (performance.now()). */
export class StepLoad<S extends string = string> {
  private readonly at = new Map<S, number>();
  private cancelled = false;
  private finished: number | undefined;

  constructor(
    readonly floor: string,
    readonly steps: readonly S[],
    readonly started: number,
    readonly limits: LoadLimits = FLOOR_LIMITS,
  ) {}

  /** Marks `step` done at `now`: true the first time for a step this load waits for, while it's still going. */
  done(step: S, now: number): boolean {
    if (this.cancelled || this.finished !== undefined || !this.steps.includes(step) || this.at.has(step)) return false;
    this.at.set(step, now);
    if (this.at.size === this.steps.length) this.finished = now;
    return true;
  }

  has(step: S): boolean {
    return this.at.has(step);
  }

  /** Every step but `except` done (the last one, drawing the page, waits on the rest). */
  allBut(except: S): boolean {
    return this.steps.every((s) => s === except || this.at.has(s));
  }

  /** Done of all, as a whole percentage (100 only once every step is). */
  get pct(): number {
    if (!this.steps.length) return 100;
    return this.at.size === this.steps.length ? 100 : Math.min(99, Math.floor((this.at.size / this.steps.length) * 100));
  }

  /** The first step still to come, in the order they were listed (for the overlay's words). */
  get next(): S | undefined {
    return this.steps.find((s) => !this.at.has(s));
  }

  cancel() {
    if (this.finished === undefined) this.cancelled = true;
  }

  phase(now: number): LoadPhase {
    if (this.cancelled) return 'cancelled';
    if (this.finished !== undefined) return 'done';
    const age = now - this.started;
    if (age >= this.limits.maxMs) return 'timeout';
    return age >= this.limits.slowMs ? 'slow' : 'loading';
  }

  /** How long after the start each step came (ms, rounded), in the order they came. */
  timings(): Record<string, number> {
    return Object.fromEntries([...this.at].sort((a, b) => a[1] - b[1]).map(([s, t]) => [s, Math.round(t - this.started)]));
  }
}

/** The page's one load at a time: beginning another cancels the one before, and a step for another floor is ignored. */
export class LoadTracker<S extends string = string> {
  current: StepLoad<S> | undefined;

  constructor(private readonly limits: LoadLimits = FLOOR_LIMITS) {}

  /** Starts loading `floor`; the load before (if still going) is cancelled and handed back. */
  begin(floor: string, steps: readonly S[], now: number): { load: StepLoad<S>; cancelled?: StepLoad<S> } {
    const before = this.current;
    const going = before && (before.phase(now) === 'loading' || before.phase(now) === 'slow') ? before : undefined;
    going?.cancel();
    this.current = new StepLoad(floor, steps, now, this.limits);
    return { load: this.current, cancelled: going };
  }

  /** `step` done for `floor`: true when it moved the current load on. */
  done(step: S, floor: string | null | undefined, now: number): boolean {
    const l = this.current;
    if (!l || !floor || l.floor !== floor) return false;
    const p = l.phase(now);
    if (p !== 'loading' && p !== 'slow') return false;
    return l.done(step, now);
  }
}
