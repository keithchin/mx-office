// The performance guard's budgets, for the plain-.mjs harnesses. The same numbers as PERF_BUDGETS in
// src/shared/testlab.ts (tests/perf-budgets.test.ts keeps them equal): tune them there and here.
export const PERF_BUDGETS = {
  /** No single main-thread task may run longer than this while a view opens or runs. */
  longTaskMs: 200,
  /** From navigation until the view has drawn its main content and answers. */
  timeToUsableMs: 3000,
  /** From picking another project (the floor picker, or a card on Home) until its view is usable. */
  switchMs: 1500,
  /** How long each view is left running on live events while its heap is watched. */
  soakSeconds: 60,
  /** The JS heap may grow by at most this much over the soak (after a GC at each end). */
  heapGrowthPct: 25,
  /** Growth below this many MB never fails, whatever the percentage (small heaps jitter). */
  heapSlackMB: 4,
  /** No event-loop block on the office server may run longer than this while the journey makes a project (wizard, clone, hiring). */
  serverStallMs: 250,
};
