// Keep-awake while agents work: while any worker on any floor is starting or mid-turn, or a queued task,
// a Firm audit, a gate-check or a workflow run is going, the office asks the computer not to sleep
// (spawn.ts), and lets go once everything has been idle for the set minutes (10 by default). The
// screen may still turn off. On by default; set in ⚙️ Settings → Workers (.agent-office/keep-awake.json).
// Started by office/timers.ts; its stop lets go at once.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { IDLE_DEFAULT, IDLE_MAX, IDLE_MIN, type AwakeActivity, type KeepAwakeView } from '../../shared/keep-awake.js';
import { writeJsonAtomic } from '../flow/store.js';
import { flowsOf } from '../flow/index.js';
import { firmIfMade } from '../firm/adapter.js';
import { wizardIfMade } from '../wizard/index.js';
import type { Ctx } from '../office/context.js';
import { KeepAwake } from './machine.js';
import { systemSpawner } from './spawn.js';

/** How often it looks at what's running. */
export const CHECK_MS = 15_000;

interface Saved {
  on: boolean;
  idleMinutes: number;
  by?: string;
  at?: number;
}

export function cleanIdle(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= IDLE_MIN && n <= IDLE_MAX ? n : undefined;
}

/** What's running across the building right now. */
export function activityOf(ctx: Ctx): AwakeActivity {
  let workers = 0;
  let jobs = 0;
  // The Firm and the wizard only when something made them: one that wasn't has nothing running.
  const wizard = wizardIfMade(ctx);
  for (const f of ctx.floors.values()) {
    for (const w of f.workers.list()) if (w.status === 'starting' || w.status === 'working') workers++;
    jobs += f.queue.state().tasks.filter((t) => t.status === 'running').length;
    if (wizard?.checkingGates(f)) jobs++;
  }
  jobs += (firmIfMade(ctx)?.list() ?? []).filter((e) => e.phase === 'staffing' || e.phase === 'fieldwork' || e.phase === 'consolidating').length;
  jobs += flowsOf(ctx)
    .list()
    .filter((r) => r.status === 'running').length;
  return { workers, jobs };
}

export class OfficeKeepAwake {
  private saved: Saved = { on: true, idleMinutes: IDLE_DEFAULT };
  private readonly file: string;
  readonly machine: KeepAwake;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly ctx: Ctx,
    machine?: KeepAwake,
  ) {
    this.file = path.join(ctx.cfg.dataDir, 'keep-awake.json');
    this.machine = machine ?? new KeepAwake(systemSpawner());
    this.restore();
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.machine.stop();
  }

  check() {
    let activity: AwakeActivity;
    try {
      activity = activityOf(this.ctx);
    } catch (err) {
      console.error(`agent-office: keep-awake: ${(err as Error).message}`);
      return;
    }
    this.machine.update(activity, this.saved.on, this.saved.idleMinutes * 60_000);
  }

  view(admin: boolean): KeepAwakeView {
    const s = this.machine.snapshot();
    return { on: this.saved.on, idleMinutes: this.saved.idleMinutes, ...s, platform: process.platform, supported: this.machine.supported, by: this.saved.by, at: this.saved.at, admin };
  }

  /** Why it can't, if it can't. */
  set(p: { on?: unknown; idleMinutes?: unknown }, by: string): string | undefined {
    const next = { ...this.saved };
    if (p.on !== undefined) next.on = p.on === true;
    if (p.idleMinutes !== undefined) {
      const m = cleanIdle(p.idleMinutes);
      if (m === undefined) return `Idle minutes are a whole number from ${IDLE_MIN} to ${IDLE_MAX}`;
      next.idleMinutes = m;
    }
    this.saved = { ...next, by, at: Date.now() };
    try {
      writeJsonAtomic(this.file, this.saved);
    } catch (err) {
      console.error(`agent-office: keep-awake: couldn't save: ${(err as Error).message}`);
    }
    this.check();
    return undefined;
  }

  get settings(): Readonly<Saved> {
    return this.saved;
  }

  private restore() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.saved = { on: s.on !== false, idleMinutes: cleanIdle(s.idleMinutes) ?? IDLE_DEFAULT, ...(typeof s.by === 'string' ? { by: s.by } : {}), ...(typeof s.at === 'number' ? { at: s.at } : {}) };
    } catch {
      // a broken file is the defaults
    }
  }
}

const offices = new WeakMap<object, OfficeKeepAwake>();

export function keepAwakeOf(ctx: Ctx): OfficeKeepAwake {
  let k = offices.get(ctx.cfg);
  if (!k) {
    k = new OfficeKeepAwake(ctx);
    offices.set(ctx.cfg, k);
  }
  return k;
}

/** Starts watching; returns what stops it (and lets go). */
export function startKeepAwake(ctx: Ctx): () => void {
  const k = keepAwakeOf(ctx);
  k.start();
  return () => k.stop();
}
