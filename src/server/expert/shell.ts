// Expert mode on the server (shared/expert.ts): which projects are in it, their sessions (./session.ts), the
// asked → visible timer of each (./loop.ts), fed by the session's own hooks (workers/hook-bus.ts) and the live
// app's state (liveapp/state-bus.ts), and what the session screen's header says. One service per office
// (expertOf). Nothing here runs per keystroke: the terminal's bytes go straight through the pty host; this
// hears a handful of hook events per turn and the live app's few state changes.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { LiveAppState } from '../../shared/protocol.js';
import { isExpertMode, type ExpertView } from '../../shared/expert.js';
import { onWorkerHook } from '../workers/hook-bus.js';
import { onLiveState } from '../liveapp/state-bus.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { isModelChange, loopStep, loopView, newLoop, readLoop, type LoopEvent, type LoopState } from './loop.js';
import { sessionWorker } from './session-worker.js';
import { headerOf } from './header.js';

export type ExpertCtx = Pick<Ctx, 'cfg' | 'floors' | 'workerFloor'>;

/** Whether a floor is an Expert-mode project (`mode: 'expert'` on its record). */
export const isExpert = (floor: Floor | undefined): boolean => isExpertMode(floor?.def);

const SAVE_MS = 1000;

export class ExpertService {
  private loops = new Map<string, Promise<LoopState>>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  /** What the live app last served per floor, to tell a new served reload from a repeat of the same state. */
  private servedKey = new Map<string, string>();
  private unsubs: (() => void)[] = [];

  constructor(
    private ctx: ExpertCtx,
    private now: () => number = Date.now,
  ) {
    this.unsubs.push(
      onWorkerHook((workerId, event, payload) => this.hook(workerId, event, payload)),
      onLiveState((s) => this.live(s)),
    );
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
    for (const t of this.saveTimers.values()) clearTimeout(t);
  }

  /** The floor's timer (read from disk the first time). */
  loop(floor: Floor): Promise<LoopState> {
    let p = this.loops.get(floor.id);
    if (!p) {
      p = readFile(this.fileOf(floor), 'utf8').then((t) => readLoop(JSON.parse(t)), () => newLoop());
      this.loops.set(floor.id, p);
    }
    return p;
  }

  async view(floor: Floor): Promise<ExpertView> {
    const [loop, head] = await Promise.all([this.loop(floor), headerOf(floor, this.ctx.cfg.dataDir)]);
    const w = sessionWorker(floor);
    return { floor: floor.id, mode: isExpert(floor) ? 'expert' : 'team', ...(w ? { workerId: w.id } : {}), ...head, loop: loopView(loop, this.now()) };
  }

  /** One event for a floor's timer (the hooks and the live app call it; tests too). */
  async step(floor: Floor, ev: LoopEvent): Promise<void> {
    const s = await this.loop(floor);
    const had = JSON.stringify([s.session, s.samples.length, s.pending]);
    loopStep(s, ev);
    if (JSON.stringify([s.session, s.samples.length, s.pending]) !== had) this.save(floor, s);
  }

  private hook(workerId: string, event: string, payload: unknown) {
    const floor = this.ctx.workerFloor(workerId);
    if (!floor || !isExpert(floor)) return;
    const w = floor.workers.get(workerId);
    if (!w?.session) return;
    const p = (payload ?? {}) as { session_id?: unknown; tool_name?: unknown; tool_input?: { command?: unknown } };
    const at = this.now();
    if (event === 'UserPromptSubmit') void this.step(floor, { kind: 'prompt', at, ...(typeof p.session_id === 'string' ? { session: p.session_id } : {}) });
    else if (event === 'PostToolUse' && p.tool_name === 'Bash' && typeof p.tool_input?.command === 'string' && isModelChange(p.tool_input.command)) void this.step(floor, { kind: 'change', at });
    // A turn ended: the live app looks at the project's branch now rather than at its next poll (a push may have landed).
    else if (event === 'Stop') void liveAppsIfMade(this.ctx)?.of(floor).poll().catch(() => undefined);
  }

  private live(s: LiveAppState) {
    const floor = this.ctx.floors.get(s.floor);
    if (!floor || !isExpert(floor)) return;
    if (s.status !== 'running' || !s.served) return;
    // When it served: the build coming up, or the hot reload it confirmed (each says when).
    const at = Math.max(s.served.builtAt, s.lastUpdate?.ok ? s.lastUpdate.at : 0);
    const key = `${s.served.sha}|${at}`;
    if (this.servedKey.get(floor.id) === key) return;
    this.servedKey.set(floor.id, key);
    // A reload from before the model change doesn't stop the timer (loopStep compares with the change's time).
    void this.step(floor, { kind: 'served', at });
  }

  private fileOf(floor: Floor) {
    return path.join(floor.dir, '.agent-office', 'expert-loop.json');
  }

  private save(floor: Floor, s: LoopState) {
    if (this.saveTimers.has(floor.id)) return;
    this.saveTimers.set(
      floor.id,
      setTimeout(() => {
        this.saveTimers.delete(floor.id);
        const file = this.fileOf(floor);
        const body = JSON.stringify({ session: s.session, samples: s.samples });
        void mkdir(path.dirname(file), { recursive: true })
          .then(() => writeFile(`${file}.tmp`, body))
          .then(() => rename(`${file}.tmp`, file))
          .catch((err) => console.error(`agent-office: couldn't save ${file}: ${(err as Error).message}`));
      }, SAVE_MS),
    );
  }
}

const services = new WeakMap<object, ExpertService>();

export function expertOf(ctx: ExpertCtx): ExpertService {
  let s = services.get(ctx.cfg);
  if (!s) services.set(ctx.cfg, (s = new ExpertService(ctx)));
  return s;
}
