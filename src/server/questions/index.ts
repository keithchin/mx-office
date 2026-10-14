// The Questions page wired to the office: the service (service.ts) made once per office from what the
// office already has (each floor's folder and its agents' worktrees, the pinned toolkit's
// open-questions.sh run with Git Bash as the setup panel runs gate-check, the team's delivery and who
// covers Analysis), started with the office's clocks (office/timers.ts), told when a turn ends
// (office/floors.ts), read by Needs you on the server (notify-teams/gather.ts, so Teams cards and phone
// pushes follow it), by stuck detection (stuck/sources.ts) and by /api/questions.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { QuestionsNeed, Recipient } from '../../shared/questions.js';
import { coverOf } from '../../shared/roster/coverage.js';
import { audit } from '../audit/index.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { execFileOff } from '../offloop/exec.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import type { SendOpts } from '../roster/deliver.js';
import { stuckSettings } from '../stuck/settings.js';
import { registerStuckSource } from '../stuck/sources.js';
import { parseToolkitEnv, TOOLKIT_ENV_FILE } from '../toolkit-env.js';
import { toolkitDirFor } from '../toolkit-pin/index.js';
import { toolkitEnv, wizardConfig, type WizardConfig } from '../wizard/config.js';
import { WORKTREES_DIR } from '../worktrees.js';
import { Collector, type Folder } from './collect.js';
import { bashRunner } from './script.js';
import { QuestionsService, type QFloor } from './service.js';

/**
 * How Send's message is delivered (roster/deliver.ts): as the person's, waking an asleep agent, held for the
 * end of the turn under way unless they said now (the console's "OK to interrupt?"), ending with the resume
 * line so the agent goes back to its task afterwards.
 */
export const sendOpts = (by: string, when: 'now' | 'after'): SendOpts => ({ origin: 'person', by, wake: true, hold: true, resume: true, ...(when === 'after' ? { between: true } : {}) });

const services = new WeakMap<object, QuestionsService>();
const collectors = new WeakMap<Floor, Collector>();
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

let cfg: WizardConfig | undefined;
/** The wizard's settings (Git Bash, jq, mxcli), worked out once. */
const config = () => (cfg ??= wizardConfig());

/** A floor as the service reads it. */
export const qFloor = (floor: Floor): QFloor => ({ id: floor.id, name: floor.def.name, dir: floor.dir });

/** The floor's toolkit.env, read asynchronously (MXTK_ROOT, MXBUILD_PATH…). */
async function floorEnv(floorDir: string): Promise<Record<string, string>> {
  return readFile(path.join(floorDir, TOOLKIT_ENV_FILE), 'utf8').then(parseToolkitEnv, () => ({}));
}

const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);

/** The project's toolkit's open-questions.sh: MXTK_ROOT in its toolkit.env, else its pin (or the office's clone). */
export async function scriptFor(floorDir: string): Promise<string | undefined> {
  const root = (await floorEnv(floorDir)).MXTK_ROOT;
  if (root && (await isFile(path.join(root, 'bin', 'open-questions.sh')))) return path.join(root, 'bin', 'open-questions.sh');
  const tk = await toolkitDirFor(floorDir).catch(() => undefined);
  const p = tk && path.join(tk.dir, 'bin', 'open-questions.sh');
  return p && (await isFile(p)) ? p : undefined;
}

/** Which of `rels` are new or changed in `dir`'s working copy (git status, off the event loop). */
export function changedFiles(dir: string, rels: string[]): Promise<Set<string> | undefined> {
  if (!rels.length) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    execFileOff('git', ['status', '--porcelain', '--untracked-files=all', '--', ...rels], { cwd: dir, env: GIT_ENV, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, out) => {
      if (err) return resolve(undefined);
      resolve(new Set(out.split('\n').filter((l) => l.length > 3).map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))));
    });
  });
}

/** The floor's folder and each worktree under .agent-office/worktrees, with the agent working in it. */
export async function foldersOf(floor: { dir: string }, workers: readonly WorkerInfo[]): Promise<Folder[]> {
  const root = path.join(floor.dir, WORKTREES_DIR);
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);
  const out: Folder[] = [{ dir: floor.dir, where: 'main' }];
  for (const name of names.sort()) {
    const dir = path.join(root, name);
    const w = workers.find((x) => x.worktree && path.resolve(floor.dir, x.worktree.path) === path.resolve(dir));
    out.push({ dir, where: 'worktree', worktree: name, ...(w ? { agent: w.name, workerId: w.id } : {}) });
  }
  return out;
}

/** The office's Questions service: made on first use, then the same one. */
export function questionsOf(ctx: Ctx): QuestionsService {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const floorOf = (f: QFloor) => ctx.floors.get(f.id);
  const asRecipient = (w: WorkerInfo | undefined): Recipient | undefined => (w && w.kind === 'agent' && !w.lost ? { name: w.name, workerId: w.id, working: w.status === 'working' } : undefined);
  s = new QuestionsService({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    floors: () => [...ctx.floors.values()].map(qFloor),
    folders: async (f) => {
      const floor = floorOf(f);
      return floor ? foldersOf(floor, floor.workers.list()) : [{ dir: f.dir, where: 'main' }];
    },
    collector(f) {
      const floor = floorOf(f);
      const make = () =>
        new Collector({
          floor: f.id,
          floorDir: f.dir,
          script: () => scriptFor(f.dir),
          run: bashRunner({ bash: config().bash, env: async (dir) => ({ ...toolkitEnv(config()), ...(await floorEnv(dir)), MXTK_NO_FETCH: '1' }) }),
          changed: changedFiles,
          now: () => Date.now(),
        });
      if (!floor) return make();
      let c = collectors.get(floor);
      if (!c) collectors.set(floor, (c = make()));
      return c;
    },
    recipientOf(f, q) {
      const floor = floorOf(f);
      if (!floor) return undefined;
      // The agent whose working copy it is, while it's on the floor; else whoever covers Analysis.
      const own = q.source.workerId ? asRecipient(floor.workers.get(q.source.workerId)) : undefined;
      if (own) return own;
      const roster = rosterOf(ctx);
      const d = roster.data(floor.id);
      const m = d.members[coverOf(d.coverage, 'analysis')];
      return m && m.phase === 'active' ? asRecipient(roster.workerOf(teamFloor(ctx, floor), m)) : undefined;
    },
    send(f, workerId, text, by, when) {
      const floor = floorOf(f);
      const w = floor?.workers.get(workerId);
      if (!floor || !w) return 'That agent is no longer on the project';
      // The team's one way of typing into an agent (roster/deliver.ts): held for the end of its turn unless now.
      const r = rosterOf(ctx).delivery.send(teamFloor(ctx, floor), w, text, sendOpts(by, when));
      return r.status === 'refused' ? r.why : undefined;
    },
    decisionHours: () => {
      const st = stuckSettings();
      return st.on ? st.decisionHours : undefined;
    },
    record: (e) => audit.record(e),
  });
  services.set(ctx.cfg, s);
  const made = s;
  registerStuckSource((f, now) => made.stuckDrafts({ id: f.id, name: f.name, dir: f.dir }, now));
  return s;
}

/** What the server's Needs you reads (Teams cards, phone pushes): the questions waiting on the person. */
export async function questionsNeedOf(ctx: Ctx, floor: Floor): Promise<QuestionsNeed | undefined> {
  try {
    return await questionsOf(ctx).need(qFloor(floor));
  } catch {
    return undefined;
  }
}

const lastStatus = new Map<string, WorkerInfo['status']>();

/** Every worker update: a turn that just ended may have written questions, so the floor is collected again shortly. */
export function questionsOnWorker(ctx: Ctx, floor: Floor, w: WorkerInfo | string) {
  if (typeof w === 'string') return void lastStatus.delete(w);
  const prev = lastStatus.get(w.id);
  lastStatus.set(w.id, w.status);
  if (w.kind === 'agent' && prev === 'working' && (w.status === 'done' || w.status === 'idle')) questionsOf(ctx).turnEnded(qFloor(floor));
}

/** Starts the collections; returns what stops them. */
export function startQuestions(ctx: Ctx): () => void {
  const s = questionsOf(ctx);
  s.start();
  return () => s.stop();
}
