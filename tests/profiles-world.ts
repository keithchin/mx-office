// Fixtures for the agent-profile tests (not a test file itself): one Roster over two fake floors (fake
// workers, never a Claude session), with agent profiles wired exactly as the office wires them
// (roster-deps.ts). No network, no Claude, no GitHub. Markers are assembled at run time.

import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { RoleId } from '../src/shared/roster/roles.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { ProfileService } from '../src/server/profiles/service.js';
import { profileHooks, rosterProfileDeps } from '../src/server/profiles/roster-deps.js';

export const mark = (what: string) => ['MARKER', what, 'p2'].join('-');

export class FakeFloor implements TeamFloor {
  map = new Map<string, WorkerInfo>();
  hires: HireAsk[] = [];
  prompts: { id: string; text: string }[] = [];
  stopped: string[] = [];
  toasts: string[] = [];
  /** Set to make the next hires fail with this reason. */
  failHire?: string;
  roster!: Roster;
  readonly dir = mkdtempSync(path.join(os.tmpdir(), 'prf-floor-'));
  private n = 0;
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo | string> {
    if (this.failHire) return this.failHire;
    this.hires.push(ask);
    const id = `${this.id.replace(/[^a-f0-9]/g, '')}a${(++this.n).toString(16).padStart(5, '0')}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.roster.deps.now(), prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.stopped.push(id);
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    const w = this.map.get(id);
    if (!w) return 'Worker is not running';
    this.prompts.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename(id: string, name: string) {
    const w = this.map.get(id);
    if (w) w.name = name;
  }
  cwdOf = (w: WorkerInfo) => path.join(this.dir, '.agent-office', 'worktrees', w.id);
  openPulls = () => [];
  toast = (text: string) => void this.toasts.push(text);
  changed = () => undefined;
  set(id: string, status: WorkerStatus) {
    const w = this.map.get(id)!;
    w.status = status;
    this.roster.onWorker(this, w);
  }
  journal(team: string, text: string, w: WorkerInfo) {
    const file = path.join(this.cwdOf(w), 'docs', 'team', `${team}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, text);
  }
  workerOf(role: RoleId): WorkerInfo | undefined {
    const id = this.roster.data(this.id).members[role].workerId;
    return id ? this.map.get(id) : undefined;
  }
}

// Monday 2026-10-05 09:05 in Singapore.
export const START = Date.UTC(2026, 9, 5, 1, 5);

export interface World {
  dataDir: string;
  clock: { now: number };
  a: FakeFloor;
  b: FakeFloor;
  floors: FakeFloor[];
  roster: Roster;
  svc: ProfileService;
  audits: AuditInput[];
  /** A new service over the same data and roster (the office restarted, its rosters as saved). */
  restart(): ProfileService;
  /** Waits until the store's chain has written what was queued. */
  settle(): Promise<void>;
}

export function world(opts: { dataDir?: string; noProfiles?: boolean } = {}): World {
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(os.tmpdir(), 'prf-data-'));
  const clock = { now: START };
  const a = new FakeFloor('fa', 'Travel approval');
  const b = new FakeFloor('fb', 'Welcome desk');
  const floors = [a, b];
  const audits: AuditInput[] = [];
  const holder: { svc?: ProfileService } = {};
  const roster = new Roster(
    {
      dataDir,
      floors: () => floors,
      makeIssue: async () => ({ number: 1, url: 'https://example.invalid/1' }),
      analysis: () => '',
      now: () => clock.now,
      ...(opts.noProfiles ? {} : { profiles: profileHooks(() => holder.svc!) }),
    },
    0,
  );
  for (const f of floors) f.roster = roster;
  const make = () =>
    new ProfileService(rosterProfileDeps({ dataDir, roster: () => roster, floors: () => floors, audit: (e) => void audits.push(e), now: () => clock.now }));
  holder.svc = make();
  const w: World = {
    dataDir,
    clock,
    a,
    b,
    floors,
    roster,
    svc: holder.svc,
    audits,
    restart() {
      holder.svc = make();
      w.svc = holder.svc;
      return holder.svc;
    },
    async settle() {
      await w.svc.store.change(() => undefined);
    },
  };
  return w;
}

/** Waits (a few event-loop turns at a time) until `cond` holds. */
export async function until(cond: () => boolean, what = 'the condition', turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Benches a hired seat the way a real one goes: asked, works on its handoff (with `text`), done, stopped. */
export async function benchWithHandoff(w: World, f: FakeFloor, role: RoleId, team: string, text: string) {
  const worker = f.workerOf(role)!;
  f.set(worker.id, 'working');
  f.journal(team, `\n## 2026-10-05 09:50 — Handoff\n${text}\nAWAITING-PM: none\n`, worker);
  f.set(worker.id, 'done');
  await until(() => w.roster.data(f.id).members[role].phase === 'benched', 'the bench to finish');
}
