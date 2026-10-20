// Quitting the desktop app, for good: once Quit is decided (the office stopped or left running, as the
// user chose), everything the app holds goes, in order, and the process ends. Each step runs once, a step
// that throws or hangs doesn't stop the next, and if the process is still there a few seconds after the
// steps (something nobody destroyed: a window whose page cancels its unload, a dialog, a view), the app
// logs what was still open and exits anyway. Before this, a Live app window whose page had a beforeunload
// handler cancelled Electron's quit after the tray and the office window were gone, leaving a windowless
// mx-office.exe that the next start handed off to.
// Pure of Electron: the steps, the quit and the exit are handed in (main.ts).

export interface TeardownStep {
  name: string;
  run(): void | Promise<void>;
}

export interface TeardownDeps {
  steps: TeardownStep[];
  /** What the app still holds (windows, views, the tray, the office child), named for the log. */
  openNow(): string[];
  /** The normal quit (Electron's app.quit: will-quit, then the process ends). */
  quit(): void;
  /** The last resort (Electron's app.exit: no events, no unload handlers). */
  exit(code: number): void;
  log(line: string): void;
  /** How long the process may still be there after the quit before it exits anyway (default 5 s). */
  graceMs?: number;
  /** How long one step may take before the next goes ahead (default 3 s). */
  stepTimeoutMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
}

export const GRACE_MS = 5000;
export const STEP_TIMEOUT_MS = 3000;

export class Teardown {
  private running?: Promise<void>;
  private grace?: unknown;
  private finished = false;

  constructor(private readonly deps: TeardownDeps) {}

  /** Whether Quit has been decided (the app is going; nothing may keep it). */
  get started(): boolean {
    return !!this.running;
  }

  /** Tears everything down and quits; the same promise for every call after the first. */
  run(why: string): Promise<void> {
    if (!this.running) this.running = this.go(why);
    return this.running;
  }

  /** Electron got as far as will-quit: the process ends by itself, the fallback isn't needed. */
  done() {
    this.finished = true;
    if (this.grace !== undefined) (this.deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.grace);
    this.grace = undefined;
  }

  private async go(why: string) {
    const { deps } = this;
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    deps.log(`quitting (${why})`);
    for (const step of deps.steps) {
      let timer: unknown;
      try {
        const late = new Promise<'late'>((r) => (timer = setTimer(() => r('late'), deps.stepTimeoutMs ?? STEP_TIMEOUT_MS)));
        const how = await Promise.race([Promise.resolve().then(() => step.run()).then(() => 'done' as const), late]);
        if (how === 'late') deps.log(`quit: ${step.name} didn't finish in time; going on`);
      } catch (e) {
        deps.log(`quit: ${step.name} failed (${(e as Error)?.message ?? e}); going on`);
      } finally {
        clearTimer(timer);
      }
    }
    if (this.finished) return;
    const graceMs = deps.graceMs ?? GRACE_MS;
    this.grace = setTimer(() => {
      this.grace = undefined;
      if (this.finished) return;
      let open: string[] = [];
      try {
        open = deps.openNow();
      } catch {
        // nothing more to say
      }
      deps.log(`quit: still running ${Math.round(graceMs / 1000)} s after Quit (open: ${open.join(', ') || 'nothing the app knows of'}); exiting`);
      deps.exit(0);
    }, graceMs);
    try {
      deps.quit();
    } catch (e) {
      deps.log(`quit: the quit failed (${(e as Error)?.message ?? e}); exiting`);
      this.done();
      deps.exit(0);
    }
  }
}

/**
 * Another start of the app while this one runs (Electron's single-instance lock sends it here): show the
 * window; when this instance is already quitting, end it and start the app again with the new start's
 * arguments, so a start never hands off to an instance on its way out; while it is still starting (no
 * window yet), nothing: its window shows by itself.
 */
export function secondInstanceAction(s: { quitting: boolean; hasWindow: boolean }): 'show' | 'relaunch' | 'wait' {
  if (s.quitting) return 'relaunch';
  return s.hasWindow ? 'show' : 'wait';
}
