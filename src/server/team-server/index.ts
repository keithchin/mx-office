// The office's side of Team Server (shared/team-server.ts): each project on Team Server has its main brought there
// after every change of main, and an existing local-only project can be connected. A sync (./sync.ts) runs:
//   - soon after something says the project's origin moved (floor-sync/bus.ts originNews: a local merge, a fetch
//     that saw GitHub move), a little later so a burst of news is one sync;
//   - on a slow clock (every few minutes, one project at a time), which also catches Studio Pro commits;
//   - when an admin presses Push to Team Server now;
//   - every half minute while Studio Pro has the project's Studio copy open, and for a while after (./studio-copy.ts),
//     so a commit made there (a Publish's automatic commit too) reaches main promptly; the team is told main moved.
// A local merge on a project with no GitHub syncs after a couple of seconds (one event, not a burst). Team Server not
// answering (no network yet after the machine slept) is waited out: a quick look for the network first, then a back-off
// (1, 2, 4… up to 30 minutes) for the clocks, never for a person's Push now; a wake from sleep waits a minute first.
// The app's cloud environments (./environments.ts) are read with the same token, cached.
// Only with the office's Mendix token (🔌 Connections, connections/resolve.ts `credential('mendix')`; a test office
// has none), and never two at once for a project. The last result per project is kept in
// <data>/team-server/<floor>.json with the record and a pending Projects API job, so a restart follows that job
// instead of creating a second app. Agents get no token from any of this.

import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import path from 'node:path';
import { MENDIX_ENDPOINTS, cleanProjectId, homeAt, portalUrl, type CloudEnvironments, type TeamServerEndpoints, type TeamServerRecord, type TeamServerSync, type TeamServerView } from '../../shared/team-server.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { credential } from '../connections/resolve.js';
import { onOriginNews, originNews } from '../floor-sync/bus.js';
import { noteChatter } from '../chatter/bus.js';
import { studioStateOf } from '../studio/index.js';
import { registerStudioTarget } from '../studio/targets.js';
import { loadEnvironments, peekEnvironments } from './environments.js';
import { prepareStudioCopy, studioCopyDir, studioTargetFor } from './studio-copy.js';
import { localOnlyAt } from '../local-only.js';
import { writeJsonAtomic } from '../flow/store.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { tsGit } from './git.js';
import { syncMain } from './sync.js';
import { cleanRecord, forgetTeamServer, onEnvironmentsWanted, teamServerAt } from './project.js';
import { connectProject } from './connect.js';
import { auditSync, auditTs } from './audit.js';
import type { Fetch } from './api.js';
import type { runCommand } from '../wizard/run.js';

/** A sync after origin news waits this long (more news meanwhile is the same sync). */
export const NEWS_DELAY_MS = 20_000;
/** …but only this long for a project with no GitHub: its origin moves only by the office's own merge, one event. */
export const NEWS_DELAY_LOCAL_MS = 2_000;
/** While Studio Pro has the Studio copy open (and this long after), a sync this often. */
export const STUDIO_POLL_MS = 30_000;
export const STUDIO_AFTER_MS = 15 * 60_000;
/** Back-off after Team Server didn't answer: doubling from 1 minute, at most 30. */
const BACKOFF_MS = [60_000, 2 * 60_000, 4 * 60_000, 8 * 60_000, 16 * 60_000, 30 * 60_000];
/** After a wake from sleep, the clocks wait this long for the network. */
export const WAKE_WAIT_MS = 60_000;
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
  /** Whether Team Server's host can be found at all (no network yet: no git is run). Tests pass their own. */
  reachable?: (host: string) => Promise<boolean>;
  /** Tells the team that main moved because commits came from Team Server (Studio Pro). */
  told?: (floor: string, s: TeamServerSync) => void;
}

/** Whether `host` resolves within a few seconds. */
async function resolves(host: string): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([lookup(host).then(() => true), new Promise<boolean>((done) => (timer = setTimeout(() => done(false), 5_000)))]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export class TeamServerOffice {
  private saved = new Map<string, Saved>();
  private running = new Map<string, Promise<TeamServerSync>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private connecting = new Set<string>();
  private turn = 0;
  /** Back-off per project after Team Server didn't answer. */
  private waits = new Map<string, { until: number; n: number }>();
  /** The clocks wait until then (a wake from sleep). */
  private quietUntil = 0;

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
      home: homeAt(localOnlyAt(floor.dir), record),
      may: admin,
      ...(record && peekEnvironments(record.projectId) ? { environments: peekEnvironments(record.projectId) } : {}),
      ...(record ? { studio: { dir: studioCopyDir(floor.dir), ready: studioTargetFor(floor.dir, record).ready } } : {}),
    };
  }

  /** The app's cloud environments (cached a few minutes; `force` reads now). Undefined: not on Team Server, or no token. */
  async environments(floor: Pick<Floor, 'id' | 'dir'>, force = false): Promise<CloudEnvironments | undefined> {
    const rec = this.recordOf(floor);
    return rec ? this.environmentsOf(rec.projectId, force) : undefined;
  }

  environmentsOf(projectId: string, force = false): Promise<CloudEnvironments | undefined> {
    const token = this.d.token();
    if (!token) return Promise.resolve(undefined);
    return loadEnvironments({ token, endpoints: this.d.endpoints, fetch: this.d.fetch, now: this.d.now }, projectId, force);
  }

  /** Gets the Studio copy ready for Edit in Studio Pro: main to Team Server first, then the copy made or brought up to date. */
  async prepareStudio(floor: Pick<Floor, 'id' | 'dir'>): Promise<{ dir: string; note?: string } | { error: string }> {
    const rec = this.recordOf(floor);
    if (!rec) return { error: 'This project isn’t on Team Server' };
    const token = this.d.token();
    const s = token ? await this.sync(floor) : undefined;
    const r = await prepareStudioCopy({ g: token ? this.git(token) : undefined, dir: floor.dir, rec });
    if ('error' in r || !s || s.state === 'same' || s.state === 'pushed' || s.state === 'pulled') return r;
    // Main couldn't go to Team Server first: said, and it opens anyway.
    return { ...r, note: [r.note, `Main isn’t on Team Server yet: ${s.message}`].filter(Boolean).join(' ') };
  }

  /** The clocks hold off until `at` (a wake from sleep: the network comes back first). */
  quiet(at: number) {
    this.quietUntil = Math.max(this.quietUntil, at);
  }

  private git(token: string) {
    return tsGit({ token, env: { ...(this.d.env?.() ?? process.env), ...officeGitEnv() }, git: (this.d.endpoints ?? MENDIX_ENDPOINTS).git, run: this.d.run });
  }

  /** Brings main and Team Server together once (a sync already running is shared). */
  sync(floor: Pick<Floor, 'id' | 'dir'>, by?: { name: string; id?: string }): Promise<TeamServerSync> {
    const had = this.running.get(floor.id);
    if (had) return had;
    // The clocks wait out a back-off or a wake from sleep; a person (`by`) never does.
    const now = (this.d.now ?? Date.now)();
    const wait = this.waits.get(floor.id);
    const last = this.load(floor.id).last;
    if (!by && last && ((wait && now < wait.until) || now < this.quietUntil)) return Promise.resolve(last);
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
    const host = new URL((this.d.endpoints ?? MENDIX_ENDPOINTS).git).hostname;
    const s: TeamServerSync = (await (this.d.reachable ?? resolves)(host))
      ? await syncMain({ g: this.git(token), dir: floor.dir, rec, now: this.d.now })
      : { at, state: 'unreachable', message: `The office can’t find ${host} (no network yet, or just after a sleep): it tries again by itself.` };
    if (s.state === 'unreachable') {
      // Waited out, doubling: 1, 2, 4… up to 30 minutes.
      const n = (this.waits.get(floor.id)?.n ?? 0) + 1;
      s.retryAt = at + BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)];
      this.waits.set(floor.id, { until: s.retryAt, n });
    } else this.waits.delete(floor.id);
    const before = this.load(floor.id).last;
    this.store(floor.id, { last: s });
    if (s.state === 'pulled') {
      // Commits from Studio Pro: whoever follows origin hears, and so does the team.
      originNews(floor.dir);
      try {
        this.d.told?.(floor.id, s);
      } catch (err) {
        console.error(`agent-office: couldn't tell ${floor.id}'s team that main moved: ${(err as Error).message}`);
      }
    }
    // A repeat of the same refusal isn't logged again on every tick.
    if (s.state !== 'same' && !(before && before.state === s.state && before.message === s.message && !by)) auditSync(floor.id, rec.projectId, s, by);
    return s;
  }

  /** A sync soon (origin news), once for a burst of news. */
  soon(floor: Pick<Floor, 'id' | 'dir'>, delay?: number) {
    const rec = this.recordOf(floor);
    if (!rec || this.timers.has(floor.id)) return;
    // A project with no GitHub: its origin moved by the office's own merge, one event, so almost at once.
    delay ??= rec.mirror ? NEWS_DELAY_MS : NEWS_DELAY_LOCAL_MS;
    const t = setTimeout(() => {
      this.timers.delete(floor.id);
      void this.sync(floor);
    }, delay);
    t.unref?.();
    this.timers.set(floor.id, t);
  }

  /** One tick of the slow clock: the next project on Team Server, in turn. */
  async tick(floors: Pick<Floor, 'id' | 'dir'>[]): Promise<void> {
    if (!this.d.token() || (this.d.now ?? Date.now)() < this.quietUntil) return;
    const on = floors.filter((f) => this.recordOf(f));
    if (!on.length) return;
    const f = on[this.turn++ % on.length];
    await this.sync(f);
    // Its cloud environments too, when they're old (cached: most ticks ask nothing).
    void this.environments(f);
  }

  /** The Studio clock: a sync for each project whose Studio copy Studio Pro has open now, or had open lately. */
  async studioTick(floors: Pick<Floor, 'id' | 'dir'>[], stateOf: (id: string) => { open: boolean; since: number } | undefined): Promise<void> {
    if (!this.d.token()) return;
    const now = (this.d.now ?? Date.now)();
    for (const f of floors) {
      const st = stateOf(f.id);
      if (!st || !(st.open || now - st.since < STUDIO_AFTER_MS) || !this.recordOf(f)) continue;
      await this.sync(f);
    }
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
    t = new TeamServerOffice({
      dataDir: ctx.cfg.dataDir,
      token: () => credential('mendix'),
      told: (id, s) => {
        noteChatter(id, { kind: 'nudge', from: { name: 'The office', kind: 'office' }, to: { group: 'team' }, text: s.message, at: s.at });
        ctx.toastFloor(ctx.floors.get(id), `☁️ ${s.message}`, 'info');
      },
    });
    offices.set(ctx.cfg, t);
    const ts = t;
    // The Overview's environments, read again in the background when they're old.
    onEnvironmentsWanted((projectId) => void ts.environmentsOf(projectId));
  }
  return t;
}

/** Edit in Studio Pro on a project on Team Server opens its Studio copy (./studio-copy.ts, studio/targets.ts). Returns how to stop. */
export function teamServerStudioTarget(ts: TeamServerOffice): () => void {
  return registerStudioTarget({
    of: (floor) => {
      const rec = ts.recordOf(floor);
      return rec ? studioTargetFor(floor.dir, rec) : undefined;
    },
    prepare: (floor) => ts.prepareStudio(floor),
  });
}

/** The clocks: origin news makes a sync soon, and one project per tick. Returns what stops them. */
export function startTeamServer(ctx: Ctx): () => void {
  const ts = teamServerOf(ctx);
  const floorAt = (dir: string) => [...ctx.floors.values()].find((f) => path.resolve(f.dir) === path.resolve(dir));
  const off = onOriginNews((dir) => {
    const f = floorAt(dir);
    if (f) ts.soon(f);
  });
  const offTarget = teamServerStudioTarget(ts);
  let busy = false;
  let lastTick = Date.now();
  const tick = () => {
    const now = Date.now();
    // Much longer since the last tick than the clock's beat: the machine slept. The network comes back first.
    if (now - lastTick > 2 * TICK_MS) ts.quiet(now + WAKE_WAIT_MS);
    lastTick = now;
    if (busy) return;
    busy = true;
    void ts.tick([...ctx.floors.values()]).finally(() => (busy = false));
  };
  let studioBusy = false;
  const studioTick = () => {
    if (studioBusy) return;
    studioBusy = true;
    void ts.studioTick([...ctx.floors.values()], studioStateOf).finally(() => (studioBusy = false));
  };
  const first = setTimeout(tick, START_MS);
  const every = setInterval(tick, TICK_MS);
  const studio = setInterval(studioTick, STUDIO_POLL_MS);
  first.unref?.();
  every.unref?.();
  studio.unref?.();
  return () => {
    off();
    offTarget();
    clearTimeout(first);
    clearInterval(every);
    clearInterval(studio);
    ts.stop();
  };
}
