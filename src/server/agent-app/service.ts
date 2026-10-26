// Agents' app instances (P0-1 of the real rebuild test; words and limits in shared/agent-app.ts): an agent
// asks the office for a running copy of its app at one commit (its candidate, or main), gets its address and
// test users, drives journeys against it (./journey.ts), and stops it, all through the office (./hook.ts,
// bin/office-app.js), never by improvising `mxcli run --local` in its worktree. Each instance is the office's
// own app instance (app-instance/: its own workspace under the office's data folder, three free ports,
// a fresh database `<project>_ag<id>_<random>` dropped when it stops), with these rules on top:
//   * one per agent: asking again for the same commit gives the same instance; another commit replaces it;
//   * at most AGENT_APP_MAX on the machine, and none without AGENT_APP_MIN_FREE of memory (machine.ts
//     availableMemory): refused with the reason, never started to fail later;
//   * it stops by itself after AGENT_APP_IDLE_MS without a call from its agent, and after AGENT_APP_MAX_MS at
//     most; stopping ends mxcli's process tree by its pid, drops the database, and then ends anything whose
//     command line still names the instance's workspace (./leftovers.ts: no stale rollup-runner);
//   * what is running is written to <data>/agent-apps/live.json, so an office that crashed cleans up at its
//     next start (`recover`): the pids' trees, anything naming the workspaces, and their databases.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AGENT_APP_IDLE_MS, AGENT_APP_MAX, AGENT_APP_MAX_MS, AGENT_APP_MIN_FREE, memoryWords, type AgentAppView } from '../../shared/agent-app.js';
import { BOOT_PHASE_TITLE, type BootPhase } from '../../shared/app-instance.js';
import type { AppInstance } from '../app-instance/index.js';
import { instanceDir } from '../app-instance/index.js';
import { availableMemory } from '../machine.js';
import { killTreeNow } from '../liveapp/process.js';
import { killLeftovers, listProcesses, type LeftoverDeps } from './leftovers.js';

export interface Booted extends AppInstance {
  /** The instance's workspace: the commit's files. */
  workspace: string;
}

export interface BootSpec {
  floorId: string;
  floorDir: string;
  commit: string;
  purpose: string;
  signal: AbortSignal;
  progress(line: string): void;
  onPhase(phase: BootPhase): void;
}

export interface AgentAppDeps {
  dataDir: string;
  floorDir(id: string): string | undefined;
  boot(spec: BootSpec): Promise<Booted>;
  /** The project's test accounts at a commit (tests/e2e/project.config.js). */
  users?(floorDir: string, commit: string): Promise<{ user: string; role?: string }[]>;
  /** Plays the project's seed journey on a fresh instance, when it has one: what seeded it, in words. */
  seed?(e: AgentApp): Promise<string | undefined>;
  /** Drops a recovered instance's databases (by the instance's stem). */
  dropDatabases?(floorId: string, purpose: string): Promise<void>;
  freeMemory?(): Promise<number>;
  now?(): number;
  leftovers?: LeftoverDeps;
  idleMs?: number;
  maxMs?: number;
  max?: number;
  minFree?: number;
}

/** One agent's instance, as the office keeps it. */
export interface AgentApp {
  floorId: string;
  workerId: string;
  worker: string;
  commit: string;
  purpose: string;
  workspace: string;
  state: AgentAppView['state'];
  phase?: string;
  why?: string;
  seed?: string;
  users?: { user: string; role?: string }[];
  instance?: Booted;
  startedAt: number;
  lastUsed: number;
  abort: AbortController;
  /** Resolves once the start settled (ready or failed). */
  started: Promise<void>;
}

interface LiveRow {
  floorId: string;
  workerId: string;
  purpose: string;
  workspace: string;
  pid?: number;
}

/** The instance's purpose word for one agent: `ag` and 6 characters of its worker id's hash (folder and database names). */
export const purposeOf = (workerId: string) => `ag${createHash('sha1').update(workerId).digest('hex').slice(0, 6)}`;

const keyOf = (floorId: string, workerId: string) => `${floorId}|${workerId}`;

export class AgentApps {
  private apps = new Map<string, AgentApp>();
  private timer?: NodeJS.Timeout;
  private saving: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(private d: AgentAppDeps) {
    this.file = path.join(d.dataDir, 'agent-apps', 'live.json');
  }

  private now() {
    return this.d.now?.() ?? Date.now();
  }

  /** What the agent is told about its instance (and the call counts as using it). */
  view(floorId: string, workerId: string, touch = true): AgentAppView | undefined {
    const e = this.apps.get(keyOf(floorId, workerId));
    if (!e) return undefined;
    if (touch && e.state !== 'stopped' && e.state !== 'failed') e.lastUsed = this.now();
    return this.viewOf(e);
  }

  private viewOf(e: AgentApp): AgentAppView {
    const idle = this.d.idleMs ?? AGENT_APP_IDLE_MS;
    const ends = e.startedAt + (this.d.maxMs ?? AGENT_APP_MAX_MS);
    return {
      state: e.state,
      commit: e.commit,
      ...(e.state === 'ready' && e.instance ? { url: e.instance.url } : {}),
      ...(e.users ? { users: e.users, passwords: 'tests/e2e/project.config.js' } : {}),
      ...(e.state === 'ready' || e.state === 'starting' ? { expires: Math.min(e.lastUsed + idle, ends), ends } : {}),
      ...(e.phase ? { phase: e.phase } : {}),
      ...(e.why ? { why: e.why } : {}),
      ...(e.seed ? { seed: e.seed } : {}),
      startedAt: e.startedAt,
    };
  }

  /** The agent's ready instance (for a journey), or why there isn't one. */
  ready(floorId: string, workerId: string, commit?: string): AgentApp | string {
    const e = this.apps.get(keyOf(floorId, workerId));
    if (!e || e.state === 'stopped' || e.state === 'failed') return `You have no running app instance${e?.why ? ` (the last one: ${e.why})` : ''}: start one with office-app start --commit <sha|main>`;
    if (e.state === 'starting') return `Your app instance @${e.commit.slice(0, 7)} is still starting (${e.phase ?? 'starting'}): ask again in a minute (office-app status)`;
    if (commit && !e.commit.startsWith(commit) && !commit.startsWith(e.commit)) return `Your app instance runs @${e.commit.slice(0, 7)}, not ${commit.slice(0, 7)}: start one at that commit first (office-app start --commit ${commit.slice(0, 12)})`;
    if (e.instance && !e.instance.alive()) {
      void this.stop(floorId, workerId, 'its process ended by itself');
      return 'Your app instance stopped by itself (its process ended): start it again';
    }
    e.lastUsed = this.now();
    return e;
  }

  /**
   * Starts (or gives back) the agent's instance at `commit` (a full sha the project's repository has). Gives
   * back at once, while it builds; the agent asks `view` until it's ready. A string says why not.
   */
  async start(floorId: string, worker: { id: string; name: string }, commit: string): Promise<AgentAppView | string> {
    const floorDir = this.d.floorDir(floorId);
    if (!floorDir) return 'No such project';
    const key = keyOf(floorId, worker.id);
    const had = this.apps.get(key);
    if (had && had.commit === commit && (had.state === 'starting' || had.state === 'ready')) {
      had.lastUsed = this.now();
      return this.viewOf(had);
    }
    const others = [...this.apps.values()].filter((e) => e !== had && (e.state === 'starting' || e.state === 'ready'));
    const max = this.d.max ?? AGENT_APP_MAX;
    if (others.length >= max) return `The office runs at most ${max} agents' app instances at once and ${others.length} are running (${others.map((e) => `${e.worker} @${e.commit.slice(0, 7)}`).join(', ')}): try again when one stops (they stop after ${Math.round((this.d.idleMs ?? AGENT_APP_IDLE_MS) / 60_000)} min unused)`;
    if (had && (had.state === 'starting' || had.state === 'ready')) await this.stop(floorId, worker.id, `replaced by an instance at ${commit.slice(0, 7)}`);
    const free = await (this.d.freeMemory ?? availableMemory)();
    const need = this.d.minFree ?? AGENT_APP_MIN_FREE;
    if (free < need) return memoryWords(free, need);
    const purpose = purposeOf(worker.id);
    const at = this.now();
    const abort = new AbortController();
    const e: AgentApp = { floorId, workerId: worker.id, worker: worker.name, commit, purpose, workspace: instanceDir(this.d.dataDir, floorId, purpose), state: 'starting', phase: 'Getting the commit’s files', startedAt: at, lastUsed: at, abort, started: Promise.resolve() };
    this.apps.set(key, e);
    this.arm();
    e.started = this.boot(e, floorDir);
    void this.save();
    return this.viewOf(e);
  }

  private async boot(e: AgentApp, floorDir: string): Promise<void> {
    try {
      const users = this.d.users?.(floorDir, e.commit).catch(() => []);
      const inst = await this.d.boot({ floorId: e.floorId, floorDir, commit: e.commit, purpose: e.purpose, signal: e.abort.signal, progress: (l) => (e.phase = l), onPhase: (p) => (e.phase = BOOT_PHASE_TITLE[p] ?? p) });
      if (e.abort.signal.aborted || this.apps.get(keyOf(e.floorId, e.workerId)) !== e) {
        await inst.stop();
        return;
      }
      e.instance = inst;
      e.users = (await users) ?? [];
      void this.save();
      e.phase = 'Seeding';
      e.seed = (await this.d.seed?.(e).catch((err: Error) => `the seed journey couldn't run: ${err.message}`)) ?? 'the after-startup microflow (runs at every start)';
      e.state = 'ready';
      e.phase = undefined;
      e.lastUsed = this.now();
    } catch (err) {
      e.state = 'failed';
      e.why = (err as Error).message.slice(0, 600);
      e.phase = undefined;
      await this.cleanup(e);
    }
  }

  /** Stops the agent's instance (its process tree, its database, anything left naming its workspace). */
  async stop(floorId: string, workerId: string, why = 'stopped by its agent'): Promise<AgentAppView | undefined> {
    const e = this.apps.get(keyOf(floorId, workerId));
    if (!e) return undefined;
    if (e.state === 'stopped' || e.state === 'failed') return this.viewOf(e);
    e.state = 'stopped';
    e.why = why;
    e.phase = undefined;
    e.abort.abort(why);
    await e.instance?.stop().catch(() => undefined);
    await this.cleanup(e);
    return this.viewOf(e);
  }

  /** After a stop or a failed start: whatever still names the workspace is ended; the record is rewritten. */
  private async cleanup(e: AgentApp) {
    await killLeftovers([e.workspace], this.d.leftovers).catch(() => []);
    await this.save();
  }

  /** The idle and hard limits, checked every 30 s while any instance runs. */
  async tick(): Promise<void> {
    const now = this.now();
    const idle = this.d.idleMs ?? AGENT_APP_IDLE_MS;
    const max = this.d.maxMs ?? AGENT_APP_MAX_MS;
    for (const e of [...this.apps.values()]) {
      if (e.state !== 'ready' && e.state !== 'starting') continue;
      if (now - e.startedAt > max) await this.stop(e.floorId, e.workerId, `reached its ${Math.round(max / 60_000)}-minute limit`);
      else if (e.state === 'ready' && now - e.lastUsed > idle) await this.stop(e.floorId, e.workerId, `unused for ${Math.round(idle / 60_000)} minutes`);
    }
    if (![...this.apps.values()].some((e) => e.state === 'ready' || e.state === 'starting')) this.disarm();
  }

  private arm() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref?.();
  }

  private disarm() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** What runs now, on disk: for `recover` after a crash. */
  private save(): Promise<unknown> {
    const rows: LiveRow[] = [...this.apps.values()].filter((e) => e.state === 'starting' || e.state === 'ready').map((e) => ({ floorId: e.floorId, workerId: e.workerId, purpose: e.purpose, workspace: e.workspace, ...(e.instance?.pid ? { pid: e.instance.pid } : {}) }));
    this.saving = this.saving.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(rows, null, 1));
    }).catch(() => undefined);
    return this.saving;
  }

  /**
   * At the office's start: what an earlier office left running (it crashed, or was killed) is ended: each
   * recorded pid's tree (only when that process is still an mxcli), anything naming the workspaces, and their
   * databases. What it cleaned up, in words.
   */
  async recover(): Promise<string[]> {
    const read = await readFile(this.file, 'utf8').then((t) => JSON.parse(t) as LiveRow[], () => [] as LiveRow[]);
    // Only what this office doesn't run itself (an agent may have started one before this look).
    const rows = (Array.isArray(read) ? read : []).filter((r) => r && typeof r.workspace === 'string' && !this.apps.has(keyOf(r.floorId, r.workerId)));
    if (!rows.length) return [];
    const said: string[] = [];
    const procs = await (this.d.leftovers?.list ?? listProcesses)();
    for (const r of rows) {
      const p = r.pid ? procs.find((x) => x.pid === r.pid && /mxcli/i.test(x.cmd)) : undefined;
      if (p) (this.d.leftovers?.kill ?? killTreeNow)(p.pid);
      const hits = await killLeftovers([r.workspace], { ...this.d.leftovers, list: async () => procs });
      await this.d.dropDatabases?.(r.floorId, r.purpose).catch(() => undefined);
      said.push(`${r.floorId}/${r.purpose}: ${p ? 1 : 0} mxcli tree, ${hits.length} process${hits.length === 1 ? '' : 'es'} naming its workspace, its databases dropped`);
    }
    await this.save();
    return said;
  }

  /** Every instance stopped (the office stopping). */
  async shutdown(): Promise<void> {
    this.disarm();
    await Promise.all([...this.apps.values()].map((e) => this.stop(e.floorId, e.workerId, 'the office stopped')));
  }

  /** Every agent's instance, for tests and the office's own look. */
  all(): readonly AgentApp[] {
    return [...this.apps.values()];
  }
}
