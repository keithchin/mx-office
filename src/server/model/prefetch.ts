// Reading ahead for the Model tab, so the next document someone opens is already worked out: the
// rest of the module they're looking at, and when main moves while the tab was in use lately, the
// documents the move changed. One run per floor at a time, a newer one (they moved on) stopping the
// older between two documents; at most MAX documents a run, one after another, each after the event
// loop has had its turn (setImmediate), so a page's own requests never wait behind a read-ahead.
// Nothing runs on a timer: only someone opening a document or main moving starts one.

export const PREFETCH_MAX = 40;

export type Task = () => Promise<unknown>;

const turn = () => new Promise<void>((r) => setImmediate(r));

export class Prefetcher {
  private runs = new Map<string, number>();
  private seq = 0;
  /** Tasks run, for tests and the perf script. */
  done = 0;

  constructor(readonly max = PREFETCH_MAX) {}

  /** Starts working through `tasks` for `lane` (a floor), stopping the run before it. Resolves when this run ends. */
  run(lane: string, tasks: Task[]): Promise<number> {
    const mine = ++this.seq;
    this.runs.set(lane, mine);
    return (async () => {
      let n = 0;
      for (const t of tasks.slice(0, this.max)) {
        await turn();
        if (this.runs.get(lane) !== mine) break;
        await t().catch(() => {});
        this.done++;
        n++;
      }
      if (this.runs.get(lane) === mine) this.runs.delete(lane);
      return n;
    })();
  }

  /** Stops whatever runs for `lane`. */
  cancel(lane: string) {
    this.runs.delete(lane);
  }

  busy(lane: string): boolean {
    return this.runs.has(lane);
  }
}
