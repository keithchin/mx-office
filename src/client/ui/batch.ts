// Drawing at most a few times a second, however fast the office sends updates (the performance guard's
// rule: a busy floor sends a worker update for every tool call of every live worker, and a view that
// redraws in full for each one froze the page: the Workers view, 2026-10-07). `batched(fn)` hands back
// a function to call as often as you like: fn runs on the next animation frame, then at most once per
// `ms`, and the last call always gets its run. Pure timing, no DOM, so a test can drive it.

export interface Batched {
  (): void;
  /** Runs now if a run is waiting (a click shouldn't wait for the next frame). */
  flush(): void;
  cancel(): void;
}

export interface BatchClock {
  now(): number;
  later(fn: () => void, ms: number): unknown;
  clear(t: unknown): void;
  frame(fn: () => void): unknown;
}

const realClock: BatchClock = {
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  // A hidden tab gets no frames: a timer then, so a view still catches up when it's shown.
  frame: (fn) => (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible' ? requestAnimationFrame(fn) : setTimeout(fn, 0)),
};

export function batched(fn: () => void, ms = 250, clock: BatchClock = realClock): Batched {
  let last = -Infinity;
  let timer: unknown;
  let waiting = false;
  const run = () => {
    timer = undefined;
    if (!waiting) return;
    waiting = false;
    last = clock.now();
    fn();
  };
  const ask = (() => {
    waiting = true;
    if (timer !== undefined) return;
    const wait = Math.max(0, last + ms - clock.now());
    timer = clock.later(() => clock.frame(run), wait);
  }) as Batched;
  ask.flush = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    run();
  };
  ask.cancel = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    waiting = false;
  };
  return ask;
}
