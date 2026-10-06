// Keep-awake's state machine: hold the computer awake while anything is working, let go once it has all
// been idle for the set minutes, and let go at once when switched off or when the office stops. How it
// asks the system is a Spawner (spawn.ts: a PowerShell helper on Windows, caffeinate on macOS,
// systemd-inhibit on Linux), so the tests drive this with a stub. Pure apart from what the spawner does.

import type { AwakeActivity } from '../../shared/keep-awake.js';

/** A running helper that keeps the computer awake until it's stopped (or dies). */
export interface Holder {
  stop(): void;
}

/** Starts a helper; `exited` is called if it ends without being stopped, with why. */
export type Spawner = (exited: (why: string) => void) => Holder;

/** After a helper died, the next start waits this long, times the failures in a row (at most 10 minutes). */
export const RESPAWN_MS = 60_000;
const RESPAWN_MAX_MS = 10 * 60_000;

export interface AwakeSnapshot {
  holding: boolean;
  activity: AwakeActivity;
  since?: number;
  releaseAt?: number;
  error?: string;
}

export class KeepAwake {
  private holder?: Holder;
  private since?: number;
  private lastBusy?: number;
  private activity: AwakeActivity = { workers: 0, jobs: 0 };
  private idleMs = 0;
  private error?: string;
  private failures = 0;
  private retryAt = 0;

  constructor(
    /** Undefined: this platform can't (update only tracks what's running). */
    private readonly spawn: Spawner | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  get supported() {
    return !!this.spawn;
  }

  get holding() {
    return !!this.holder;
  }

  /** What's running now, whether the setting is on, and how long idle lasts before letting go. */
  update(activity: AwakeActivity, on: boolean, idleMs: number) {
    const now = this.now();
    this.activity = activity;
    this.idleMs = idleMs;
    const busy = activity.workers + activity.jobs > 0;
    if (busy) this.lastBusy = now;
    else if (this.lastBusy === undefined) this.lastBusy = now;
    if (!on || !this.spawn) return this.release();
    if (busy) {
      if (!this.holder && now >= this.retryAt) this.acquire(now);
      return;
    }
    if (this.holder && now - this.lastBusy >= idleMs) this.release();
  }

  /** The office is stopping: let go now. */
  stop() {
    this.release();
  }

  snapshot(): AwakeSnapshot {
    const idle = this.activity.workers + this.activity.jobs === 0;
    return {
      holding: this.holding,
      activity: this.activity,
      ...(this.since !== undefined ? { since: this.since } : {}),
      ...(this.holder && idle && this.lastBusy !== undefined ? { releaseAt: this.lastBusy + this.idleMs } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private acquire(now: number) {
    let mine: Holder | undefined;
    try {
      mine = this.spawn!((why) => {
        // Only the helper we're holding with counts: one already stopped may report late.
        if (this.holder !== mine) return;
        this.holder = undefined;
        this.since = this.now();
        this.error = why;
        this.failures++;
        this.retryAt = this.now() + Math.min(RESPAWN_MAX_MS, RESPAWN_MS * this.failures);
      });
    } catch (err) {
      this.error = (err as Error).message;
      this.failures++;
      this.retryAt = now + Math.min(RESPAWN_MAX_MS, RESPAWN_MS * this.failures);
      return;
    }
    this.holder = mine;
    this.since = now;
  }

  private release() {
    const h = this.holder;
    if (!h) return;
    this.holder = undefined;
    this.since = this.now();
    this.failures = 0;
    this.retryAt = 0;
    this.error = undefined;
    try {
      h.stop();
    } catch {
      // it's going anyway
    }
  }
}
