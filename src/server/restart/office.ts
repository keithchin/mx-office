// 🔁 Restart safely made from the real office (restart/index.ts is the machine): its floors and their
// workers, ⏸ Pause / ▶ Resume project (project-run/), `npm run build` in the office's own checkout,
// and exitOffice (exit.ts, which cli.ts wires to a graceful shutdown). startSafeRestart (office/timers.ts)
// also finishes a restart the last office started: it resumes the floors that restart paused.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAsleepStatus } from '../roster/bench.js';
import { headSha } from '../gitfiles.js';
import { noteChatter, OFFICE } from '../chatter/bus.js';
import type { Ctx } from '../office/context.js';
import { projectRunsOf } from '../project-run/adapter.js';
import { PAUSE_FLOW } from '../project-run/flows.js';
import { projectPause } from '../project-run/store.js';
import { exitOffice, launcherLoops } from './exit.js';
import { resumeAfterRestart, SafeRestart, type RestartDeps } from './index.js';

/** The office's own checkout (the one `npm run build` builds). */
function appDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'agent-office') return dir;
    } catch {
      // keep looking
    }
  }
  return process.cwd();
}

const APP = appDir();
// Asked on every look at the restart state: read from the checkout's files when they settle it (gitfiles.ts).
const head = () => {
  const fast = headSha(APP);
  if (fast !== null) return fast;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return undefined;
  }
};
/** The commit the office started on: a different HEAD later means new commits to build. */
const STARTED_ON = head();

function build(): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    let log = '';
    const p = spawn('npm', ['run', 'build'], { cwd: APP, shell: true, windowsHide: true });
    const add = (b: Buffer) => (log = (log + b.toString()).slice(-20_000));
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    const timer = setTimeout(() => p.kill(), 10 * 60_000);
    p.on('error', (err) => (clearTimeout(timer), resolve({ ok: false, log: `${log}\n${err.message}` })));
    p.on('close', (code) => (clearTimeout(timer), resolve({ ok: code === 0, log: log.split('\n').slice(-40).join('\n') })));
  });
}

let current: SafeRestart | undefined;

export function safeRestartOf(ctx: Ctx): SafeRestart {
  if (current) return current;
  const runs = projectRunsOf(ctx);
  const chatter = (floorId: string, text: string) => noteChatter(floorId, { kind: 'relay', from: OFFICE, to: { group: 'team' }, text });
  const deps: RestartDeps = {
    dataDir: ctx.cfg.dataDir,
    floors: () => [...ctx.floors.keys()],
    paused: (id) => !!projectPause(id),
    pause: (id, by) => void runs.pause(id, by, undefined, 'restart'),
    resume: (id, by) => runs.resume(id, { mode: 'work' }, by, undefined, 'after a safe restart'),
    busy: () =>
      [...ctx.floors.values()].flatMap((f) => {
        // An agent asked for its handoff is busy until it's asleep, even in the moment before its turn shows as started.
        const run = runs.going(f.id);
        const handing = run?.workflow === PAUSE_FLOW ? run.state.agents.filter((a) => a.status === 'pending' || a.status === 'handoff').map((a) => a.workerId) : [];
        return f.workers
          .list()
          .filter((w) => w.kind === 'agent' && !isAsleepStatus(w.status) && (w.status === 'working' || w.status === 'starting' || (handing.includes(w.id) && w.status !== 'needs_input')))
          .map((w) => ({ name: w.name, floor: f.id, doing: w.status === 'starting' ? 'starting' : handing.includes(w.id) ? 'handing off' : 'mid-turn' }));
      }),
    newCommits: () => !!STARTED_ON && head() !== STARTED_ON,
    build,
    exit: (code) => exitOffice(code),
    loop: launcherLoops(),
    now: () => Date.now(),
    chatter,
  };
  current = new SafeRestart(deps);
  return current;
}

/** The restart's clock, and the end of the last office's restart: its floors resumed. Returns what stops it. */
export function startSafeRestart(ctx: Ctx): () => void {
  const r = safeRestartOf(ctx);
  const timer = setInterval(() => void r.tick().catch((err) => console.error(`agent-office: safe restart: ${(err as Error).message}`)), 1_000);
  timer.unref?.();
  const runs = projectRunsOf(ctx);
  const later = setTimeout(
    () =>
      void resumeAfterRestart({
        dataDir: ctx.cfg.dataDir,
        floors: () => [...ctx.floors.keys()],
        pausedForRestart: (id) => projectPause(id)?.why === 'restart',
        resume: (id, by) => runs.resume(id, { mode: 'work' }, by, undefined, 'after a safe restart'),
        chatter: (floorId, text) => noteChatter(floorId, { kind: 'relay', from: OFFICE, to: { group: 'team' }, text }),
      }),
    8_000,
  );
  later.unref?.();
  return () => {
    clearInterval(timer);
    clearTimeout(later);
  };
}
