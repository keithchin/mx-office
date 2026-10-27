// The office's side of Team Server (shared/team-server.ts): each project on Team Server has its main brought there
// after every change of main, and an existing local-only project can be connected. A sync (./sync.ts) runs:
//   - soon after something says the project's origin moved (floor-sync/bus.ts originNews: a local merge, a fetch
//     that saw GitHub move), a little later so a burst of news is one sync;
//   - on a slow clock (every few minutes, one project at a time), which also catches Studio Pro commits;
//   - when an admin presses Push to Team Server now.
// Only with the office's Mendix token (🔌 Connections, connections/resolve.ts `credential('mendix')`; a test office
// has none), and never two at once for a project. The last result per project is kept in
// <data>/team-server/<floor>.json with the record and a pending Projects API job, so a restart follows that job
// instead of creating a second app. Agents get no token from any of this.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MENDIX_ENDPOINTS, cleanProjectId, portalUrl, type TeamServerEndpoints, type TeamServerRecord, type TeamServerSync, type TeamServerView } from '../../shared/team-server.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { credential } from '../connections/resolve.js';
import { onOriginNews } from '../floor-sync/bus.js';
import { localOnlyAt } from '../local-only.js';
import { writeJsonAtomic } from '../flow/store.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { tsGit } from './git.js';
import { syncMain } from './sync.js';
import { cleanRecord, forgetTeamServer, teamServerAt } from './project.js';
import { connectProject } from './connect.js';
import { auditSync, auditTs } from './audit.js';
import type { Fetch } from './api.js';
import type { runCommand } from '../wizard/run.js';

/** A sync after origin news waits this long (more news meanwhile is the same sync). */
export const NEWS_DELAY_MS = 20_000;
/** The slow clock: one project per tick. */
export const TICK_MS = 3 * 60_000;
const START_MS = 90_000;

interface Saved {
  record?: TeamServerRecord;
  last?: TeamServerSync;
  pending?: { jobId: string; at: number; by: string };
}

export interface TeamServerDeps {
  dataDir: string;
  token(): string | undefined;
  env?: () => NodeJS.ProcessEnv;
  endpoints?: TeamServerEndpoints;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Runs git (tests pass a recording one). */
  run?: typeof runCommand;
}

export class TeamServerOffice {
  private saved = new Map<string, Saved>();
  private running = new Map<string, Promise<TeamServerSync>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private connecting = new Set<string>();
  private turn = 0;

  constructor(private d: TeamServerDeps) {}

  private file(floor: string) {
    return path.join(this.d.dataDir, 'team-server', `${floor.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  }

  private load(floor: string): Saved {
    let s = this.saved.get(floor);
    if (s) return s;
    s = {};
    try {
      const j = JSON.parse(readFileSync(this.file(floor), 'utf8')) as Saved;
      s = { ...(cleanRecord(j.record) ? { record: cleanRecord(j.record) } : {}), ...(j.last && typeof j.last.at === 'number' ? { last: j.last } : {}), ...(j.pending?.jobId ? { pending: j.pending } : {}) };
    } catch {
      // nothing kept yet
    }
    this.saved.set(floor, s);
    return s;
  }

  private store(floor: string, patch: Partial<Saved>) {
    const s = { ...this.load(floor), ...patch };
    for (const k of Object.keys(patch) as (keyof Saved)[]) if (patch[k] === undefined) delete s[k];
    this.saved.set(floor, s);
    try {
      writeJsonAtomic(this.file(floor), s);
    } catch (err) {
      console.error(`agent-office: couldn't save the Team Server state of ${floor}: ${(err as Error).message}`);
    }
  }

  /** The project's record: its project file's, else the one kept when it was connected (a folder not on main yet). */
  recordOf(floor: Pick<Floor, 'id' | 'dir'>): TeamServerRecord | undefined {
    return teamServerAt(floor.dir) ?? this.load(floor.id).record;
  }

  view(floor: Pick<Floor, 'id' | 'dir'>, admin: boolean): TeamServerView {
    const record = this.recordOf(floor);
    const s = this.load(floor.id);
    return {
      floor: floor.id,
      ...(record ? { record, portalUrl: portalUrl(record.projectId) } : {}),
      ...(s.last ? { last: s.last } : {}),
      running: this.running.has(floor.id) || this.connecting.has(floor.id),
      token: !!this.d.token(),
      localOnly: localOnlyAt(floor.dir),
      may: admin,
    };
  }

  private git(token: string) {
    return tsGit({ token, env: { ...(this.d.env?.() ?? process.env), ...officeGitEnv() }, git: (this.d.endpoints ?? MENDIX_ENDPOINTS).git, run: this.d.run });
  }

  /** Brings main and Team Server together once (a sync already running is shared). */
  sync(floor: Pick<Floor, 'id' | 'dir'>, by?: { name: string; id?: string }): Promise<TeamServerSync> {
    const had = this.running.get(floor.id);
    if (had) return had;
    const run = this.syncNow(floor, by).finally(() => this.running.delete(floor.id));
    this.running.set(floor.id, run);
    return run;
  }

  private async syncNow(floor: Pick<Floor, 'id' | 'dir'>, by?: { name: string; id?: string }): Promise<TeamServerSync> {
    const rec = this.recordOf(floor);
    const at = (this.d.now ?? Date.now)();
    if (!rec) return { at, state: 'failed', message: 'This project isn’t on Team Server' };
    const token = this.d.token();
    if (!token) {
      const s: TeamServerSync = { at, state: 'no-token', message: 'No Mendix token in 🔌 Connections, so main isn’t being pushed to Team Server.' };
      if (this.load(floor.id).last?.state !== 'no-token') this.store(floor.id, { last: s });
      return s;
    }
    const s = await syncMain({ g: this.git(token), dir: floor.dir, rec, now: this.d.now });
    const before = this.load(floor.id).last;
    this.store(floor.id, { last: s });
    // A repeat of the same refusal isn't logged again on every tick.
    if (s.state !== 'same' && !(before && before.state === s.state && before.message === s.message && !by)) auditSync(floor.id, rec.projectId, s, by);
    return s;
  }

  /** A sync soon (origin news), once for a burst of news. */
  soon(floor: Pick<Floor, 'id' | 'dir'>, delay = NEWS_DELAY_MS) {
    if (!this.recordOf(floor) || this.timers.has(floor.id)) return;
    const t = setTimeout(() => {
      this.timers.delete(floor.id);
      void this.sync(floor);
    }, delay);
    t.unref?.();
    this.timers.set(floor.id, t);
  }

  /** One tick of the slow clock: the next project on Team Server, in turn. */
  async tick(floors: Pick<Floor, 'id' | 'dir'>[]): Promise<void> {
    if (!this.d.token()) return;
    const on = floors.filter((f) => this.recordOf(f));
    if (!on.length) return;
    const f = on[this.turn++ % on.length];
    await this.sync(f);
  }

  /**
   * Connect to Team Server: a local-only project gets a Portal app (made, or the pasted App ID), the remote and its
   * main there (./connect.ts). The confirm step is the page's; this checks it again. Throws nothing: an error is its words.
   */
  async connect(floor: Pick<Floor, 'id' | 'dir'> & { name: string; description?: string }, opts: { projectId?: unknown; create?: boolean }, by: { name: string; id?: string }): Promise<{ ok: true; view: TeamServerView } | { ok: false; error: string }> {
    if (this.recordOf(floor)) return { ok: false, error: 'This project is on Team Server already' };
    if (!localOnlyAt(floor.dir)) return { ok: false, error: 'Connect to Team Server is for local-only projects. A GitHub project is linked by hand: see Migrate an app in the docs' };
    const token = this.d.token();
    if (!token) return { ok: false, error: 'No Mendix token in 🔌 Connections: add one with the mx:app:create and mx:modelrepository:repo:read / :write scopes first' };
    const pasted = opts.projectId === undefined || opts.projectId === '' ? undefined : cleanProjectId(opts.projectId);
    if (opts.projectId && !pasted) return { ok: false, error: 'That isn’t an App ID: copy it from the Portal (the app’s Settings › General › App ID), like 1a2b3c4d-…' };
    if (!pasted && opts.create !== true) return { ok: false, error: 'Paste the App ID of an existing app, or confirm that the office creates one' };
    if (this.connecting.has(floor.id) || this.running.has(floor.id)) return { ok: false, error: 'The office is already working on this project’s Team Server link' };
    this.connecting.add(floor.id);
    const s = this.load(floor.id);
    try {
      const c = await connectProject({
        g: this.git(token),
        dir: floor.dir,
        name: floor.name,
        description: floor.description ?? '',
        by: by.name,
        endpoints: this.d.endpoints ?? MENDIX_ENDPOINTS,
        api: { token, endpoints: this.d.endpoints, fetch: this.d.fetch, sleep: this.d.sleep, now: this.d.now },
        ...(pasted ? { projectId: pasted } : s.pending ? { jobId: s.pending.jobId } : {}),
        sent: (jobId) => {
          this.store(floor.id, { pending: { jobId, at: Date.now(), by: by.name } });
          auditTs({ action: 'team-server.app-create', floor: floor.id, by: by.name, byId: by.id, summary: `${by.name} asked the Mendix Portal to create an app for ${floor.name} (job ${jobId})`, severity: 'info' });
        },
        now: this.d.now,
      });
      if (c.how === 'made') auditTs({ action: 'team-server.app-created', floor: floor.id, by: by.name, byId: by.id, projectId: c.rec.projectId, summary: `The Mendix Portal created the app for ${floor.name} (${c.rec.projectId})` });
      this.store(floor.id, { record: c.rec, last: c.sync, pending: undefined });
      forgetTeamServer();
      auditTs({ action: 'team-server.connected', floor: floor.id, by: by.name, byId: by.id, projectId: c.rec.projectId, summary: `${by.name} connected ${floor.name} to Team Server (${c.how === 'made' ? 'new' : 'existing'} Portal app ${c.rec.projectId}) and pushed main ${c.commit.slice(0, 7)}`, details: { commit: c.commit, how: c.how, url: c.rec.url } });
      return { ok: true, view: this.view(floor, true) };
    } catch (err) {
      return { ok: false, error: (err as Error).message.slice(0, 500) };
    } finally {
      this.connecting.delete(floor.id);
    }
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

const offices = new WeakMap<object, TeamServerOffice>();

/** The office's one (made on first use). */
export function teamServerOf(ctx: Ctx): TeamServerOffice {
  let t = offices.get(ctx.cfg);
  if (!t) {
    t = new TeamServerOffice({ dataDir: ctx.cfg.dataDir, token: () => credential('mendix') });
    offices.set(ctx.cfg, t);
  }
  return t;
}

/** The clocks: origin news makes a sync soon, and one project per tick. Returns what stops them. */
export function startTeamServer(ctx: Ctx): () => void {
  const ts = teamServerOf(ctx);
  const floorAt = (dir: string) => [...ctx.floors.values()].find((f) => path.resolve(f.dir) === path.resolve(dir));
  const off = onOriginNews((dir) => {
    const f = floorAt(dir);
    if (f) ts.soon(f);
  });
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    void ts.tick([...ctx.floors.values()]).finally(() => (busy = false));
  };
  const first = setTimeout(tick, START_MS);
  const every = setInterval(tick, TICK_MS);
  first.unref?.();
  every.unref?.();
  return () => {
    off();
    clearTimeout(first);
    clearInterval(every);
    ts.stop();
  };
}
