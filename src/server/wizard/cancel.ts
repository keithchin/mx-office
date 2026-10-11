// Cancel & undo for an unfinished new-project setup (shared/setup-cancel.ts): what the setup did, put
// back in reverse. The project comes off the office through Delete project's own job
// (server/project-delete/: agents sent home, worktrees removed, office data archived, floors.json, the
// prj_ id retired, the audit log), with the folder and the repository when ticked; a setup that never got
// as far as a floor has its folder and repository deleted here, under the same rules (only inside the
// projects folder, test mode never touches real GitHub, the token needs delete_repo). Last, the setup's
// own record goes. Each step is saved in <data>/deleted/setup-cancels/<id>.json as it ends, so one that
// stops (a locked file, GitHub down) carries on where it stopped when asked again. A Mendix Portal or
// Team Server app is never deleted. Everything that could be slow is async (git and gh off the event loop).

import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { normalizeRepo } from '../../shared/floors.js';
import { CANCEL_STEPS, cancelConfirmed, cleanCancelRequest, madeBySetup, type CancelJobView, type CancelPlan, type CancelStepId } from '../../shared/setup-cancel.js';
import { SETUP_STEPS, type StepId, type StepStatus } from '../../shared/wizard.js';
import { writeJsonAtomic } from '../flow/store.js';
import type { DeleteJobView, DeletePlan } from '../../shared/project-delete.js';
import { folderRefusal, removeTree } from '../project-delete/fsops.js';
import { canDeleteRepo, deleteRepo, type Gh } from '../project-delete/repo.js';
import type { JobState } from './job.js';

const DONE_KEEP_MS = 10 * 60_000;

/** The setup as Cancel & undo needs it, kept in its record (the setup's own goes with the floor's office data). */
export interface SetupSnapshot {
  id: string;
  repo: string;
  name: string;
  floor?: string;
  dir: string;
  steps: { id: StepId; status: StepStatus; detail?: string }[];
}

interface CancelRecord extends CancelJobView {
  setup: SetupSnapshot;
  byId?: string;
  /** The project step took the folder and the repository with it (Delete project did them). */
  viaProject?: boolean;
}

export interface CancelDeps {
  dataDir: string;
  projectsHome(): string;
  /** The setup (undefined once it's gone). */
  setup(id: string): JobState | undefined;
  running(id: string): boolean;
  /** Takes the setup's record out for good. */
  removeSetup(id: string): boolean;
  /** Where a setup without a floor would have cloned to. */
  defaultDir(owner: string, name: string): string;
  /** Whether the floor is in floors.json still (open or closed). */
  hasFloor(floor: string): boolean;
  /** Agents mid-turn on the floor, by name. */
  busyAgents(floor: string): string[];
  /** Why nothing may happen now (a safe restart, a pause or resume going), else undefined. */
  blocked(floor?: string): string | undefined;
  /** Studio Pro has the floor's project open. */
  studioOpen(floor: string): boolean;
  /** Delete project's service (server/project-delete/). */
  deletes: {
    plan(floor: string): Promise<DeletePlan | string>;
    start(floor: string, raw: unknown, by: { name: string; id?: string }): Promise<DeleteJobView | string>;
    settled(floor: string): Promise<void>;
    job(floor: string): Promise<DeleteJobView | undefined>;
  };
  gh: Gh;
  testMode(): boolean;
  ghIsFake(): boolean;
  audit(s: SetupSnapshot, by: { name: string; id?: string }, job: CancelJobView): void;
  now(): number;
}

export function snapshotOf(job: JobState, dir: string): SetupSnapshot {
  return {
    id: job.id,
    repo: `${job.plan.owner}/${job.plan.name}`,
    name: job.plan.name,
    ...(job.floor ? { floor: job.floor } : {}),
    dir: job.dir ?? dir,
    steps: SETUP_STEPS.map((s) => ({ id: s.id, status: job.steps[s.id]?.status ?? 'pending', ...(job.steps[s.id]?.detail ? { detail: job.steps[s.id].detail } : {}) })),
  };
}

const hasMpr = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).some((n) => n.toLowerCase().endsWith('.mpr'));

export class SetupCancels {
  private running = new Map<string, Promise<void>>();
  /** The records of cancels running now: read from here, never the file (a reader holding it open on Windows makes the next save's rename fail). */
  private live = new Map<string, CancelRecord>();
  private finished = new Map<string, CancelRecord>();

  constructor(private deps: CancelDeps) {}

  private file(id: string) {
    return path.join(this.deps.dataDir, 'deleted', 'setup-cancels', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  }

  private async saved(id: string): Promise<CancelRecord | undefined> {
    const live = this.live.get(id);
    if (live) return live;
    try {
      const j = JSON.parse(await readFile(this.file(id), 'utf8')) as CancelRecord;
      return j?.id === id && Array.isArray(j.steps) ? j : undefined;
    } catch {
      return undefined;
    }
  }

  /** Saves the record; a save Windows refuses (a scanner holding the file) is said, and the next one tries again. */
  private save(r: CancelRecord) {
    try {
      writeJsonAtomic(this.file(r.id), r);
    } catch (err) {
      console.warn(`agent-office: couldn't save the cancel of ${r.repo} (${(err as Error).message}); it carries on and saves again at its next step`);
    }
  }

  /** Cancels that stopped part way (or run now), for the unfinished cards: their setup may be gone already. */
  async unfinished(): Promise<CancelJobView[]> {
    const dir = path.dirname(this.file('x'));
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
    const out: CancelJobView[] = [];
    for (const n of names) {
      const r = await this.saved(n.slice(0, -5));
      if (r && r.status !== 'done') out.push(view(r));
    }
    return out;
  }

  async job(id: string): Promise<CancelJobView | undefined> {
    const r = this.finished.get(id) ?? (await this.saved(id));
    return r && view(r);
  }

  private snapshot(id: string, old?: CancelRecord): SetupSnapshot | undefined {
    const job = this.deps.setup(id);
    if (job) return snapshotOf(job, this.deps.defaultDir(job.plan.owner, job.plan.name));
    return old?.setup;
  }

  private rules(dir: string) {
    return { home: this.deps.projectsHome(), dataDir: this.deps.dataDir, local: false, testMode: this.deps.testMode() };
  }

  /** Why nothing may start now. */
  private blocked(s: SetupSnapshot): string | undefined {
    if (this.running.has(s.id)) return 'It’s already being cancelled';
    if (this.deps.running(s.id)) return 'The setup is running: wait for it to stop (or fail) first';
    const b = this.deps.blocked(s.floor);
    if (b) return b;
    if (s.floor && this.deps.hasFloor(s.floor)) {
      const busy = this.deps.busyAgents(s.floor);
      if (busy.length) return `${busy.join(', ')} ${busy.length === 1 ? 'is' : 'are'} mid-turn: wait for ${busy.length === 1 ? 'it' : 'them'} to finish (or pause the project) first`;
    }
    return undefined;
  }

  /** What Cancel & undo would do, for the dialog. Nothing changes. */
  async plan(id: string): Promise<CancelPlan | string> {
    const old = this.finished.get(id) ?? (await this.saved(id));
    const s = this.snapshot(id, old);
    if (!s) return 'No such setup';
    const made = madeBySetup(s.steps);
    const onFloor = !!s.floor && this.deps.hasFloor(s.floor);
    const dp = onFloor ? await this.deps.deletes.plan(s.floor!) : undefined;
    const delPlan = typeof dp === 'object' ? dp : undefined;
    const exists = existsSync(s.dir);
    const refusal = delPlan ? (delPlan.folder.deletable ? undefined : delPlan.folder.why) : await folderRefusal(s.dir, this.rules(s.dir));
    let repoDelete: CancelPlan['repoDelete'];
    if (made.offline) repoDelete = { createdBySetup: false, byHand: false, offline: true, possible: false, why: 'a test office’s local repository: nothing on GitHub' };
    else {
      // Test mode with a real gh: it isn't even asked what its token may do.
      const fakeOnly = this.deps.testMode() && !this.deps.ghIsFake();
      const can = fakeOnly ? { possible: false } : delPlan ? delPlan.repoDelete : await canDeleteRepo(this.deps.gh, normalizeRepo(s.repo));
      repoDelete = {
        createdBySetup: made.repo,
        byHand: made.repoByHand,
        offline: false,
        possible: can.possible && !fakeOnly,
        ...(fakeOnly ? { why: 'the office is in test mode, and test mode never deletes a real GitHub repository' } : can.why ? { why: can.why } : {}),
        ...(can.settingsUrl ? { settingsUrl: can.settingsUrl } : {}),
      };
    }
    const did = s.steps.filter((x) => x.status === 'done' || x.status === 'skipped').map((x) => `${SETUP_STEPS.find((d) => d.id === x.id)?.label ?? x.id}${x.detail ? `: ${x.detail}` : ''}${x.status === 'skipped' ? ' (nothing to do)' : ''}`);
    const blocked = this.blocked(s);
    return {
      id: s.id,
      repo: s.repo,
      confirm: s.repo,
      ...(onFloor ? { floor: s.floor } : {}),
      dir: s.dir,
      did,
      agents: delPlan?.agents ?? 0,
      worktrees: delPlan?.worktrees.length ?? 0,
      folder: { exists, createdBySetup: made.folder, deletable: exists && !refusal, ...(refusal ? { why: refusal } : !exists ? { why: 'it isn’t there' } : {}) },
      repoDelete,
      mendix: { mpr: exists && (await hasMpr(s.dir)) },
      ...(blocked ? { blocked } : {}),
      ...(old && old.status !== 'done' ? { unfinished: view(old) } : {}),
    };
  }

  /** Starts (or carries on) Cancel & undo; resolves the job as it starts, or why not. Admin is the route's. */
  async start(id: string, raw: unknown, by: { name: string; id?: string }): Promise<CancelJobView | string> {
    const req = cleanCancelRequest(raw);
    if (typeof req === 'string') return req;
    const old = await this.saved(id);
    const s = this.snapshot(id, old);
    if (!s) return 'No such setup';
    if (!cancelConfirmed(req.confirm, s.repo)) return `To confirm, type ${s.repo} exactly`;
    const blocked = this.blocked(s);
    if (blocked) return blocked;
    let rec: CancelRecord;
    if (old && old.status !== 'done') {
      // Carried on with what was asked then.
      rec = { ...old, status: 'running', error: undefined, finishedAt: undefined };
    } else {
      const p = await this.plan(id);
      if (typeof p === 'string') return p;
      if (req.deleteFolder && p.folder.exists && !p.folder.deletable) return `The folder can’t be deleted: ${p.folder.why}`;
      if (req.deleteRepo && !p.repoDelete.offline && !p.repoDelete.possible) return `The repository can’t be deleted: ${p.repoDelete.why ?? 'the token can’t'}`;
      if (req.deleteFolder && s.floor && this.deps.studioOpen(s.floor)) return 'Studio Pro has the project open: close it first, so its folder can be deleted';
      rec = {
        id: s.id,
        repo: s.repo,
        deleteFolder: req.deleteFolder && p.folder.exists,
        deleteRepo: req.deleteRepo && !p.repoDelete.offline,
        status: 'running',
        steps: CANCEL_STEPS.map((x) => ({ id: x.id, label: x.label, status: 'pending' as const })),
        by: by.name,
        ...(by.id ? { byId: by.id } : {}),
        startedAt: this.deps.now(),
        setup: s,
      };
    }
    this.finished.delete(id);
    this.live.set(id, rec);
    this.save(rec);
    const run = this.run(rec).finally(() => (this.running.delete(id), this.live.delete(id)));
    this.running.set(id, run);
    return view(rec);
  }

  /** Waits for a setup's cancel (tests). */
  settled(id: string): Promise<void> {
    return this.running.get(id) ?? Promise.resolve();
  }

  private async run(rec: CancelRecord) {
    for (const s of rec.steps) {
      if (s.status === 'done' || s.status === 'skipped') continue;
      s.status = 'running';
      s.detail = undefined;
      this.save(rec);
      try {
        const out = await this.step(s.id, rec);
        s.status = out.skipped ? 'skipped' : 'done';
        s.detail = out.detail;
        this.save(rec);
      } catch (err) {
        s.status = 'failed';
        s.detail = (err as Error).message;
        rec.status = 'failed';
        rec.error = `${s.label}: ${(err as Error).message}`;
        rec.finishedAt = this.deps.now();
        this.save(rec);
        console.error(`agent-office: cancelling the setup of ${rec.repo} stopped at “${s.label}”: ${(err as Error).message}`);
        return;
      }
    }
    rec.status = 'done';
    rec.finishedAt = this.deps.now();
    // Kept with the archives (what was undone, and how), out of the list of unfinished ones.
    writeJsonAtomic(path.join(this.deps.dataDir, 'deleted', 'setup-cancels', 'done', `${rec.id}-${new Date(rec.finishedAt).toISOString().replace(/[:.]/g, '-')}.json`), rec);
    await rm(this.file(rec.id), { force: true });
    this.finished.set(rec.id, rec);
    setTimeout(() => this.finished.get(rec.id) === rec && this.finished.delete(rec.id), DONE_KEEP_MS).unref?.();
    this.deps.audit(rec.setup, { name: rec.by, id: rec.byId }, view(rec));
  }

  private async step(id: CancelStepId, rec: CancelRecord): Promise<{ detail?: string; skipped?: boolean }> {
    const s = rec.setup;
    const d = this.deps;
    switch (id) {
      case 'project': {
        const floor = s.floor;
        const pending = floor ? await d.deletes.job(floor) : undefined;
        if (!floor || (!d.hasFloor(floor) && (!pending || pending.status === 'done'))) return { detail: 'the setup never made a floor', skipped: true };
        const plan = await d.deletes.plan(floor);
        if (typeof plan === 'string') throw new Error(plan);
        const strong = rec.deleteFolder || rec.deleteRepo;
        const started = await d.deletes.start(floor, { mode: strong ? 'delete' : 'remove', deleteFolder: rec.deleteFolder, deleteRepo: rec.deleteRepo, discardWork: true, confirm: plan.confirm }, { name: rec.by, id: rec.byId });
        if (typeof started === 'string') throw new Error(started);
        await d.deletes.settled(floor);
        const job = await d.deletes.job(floor);
        if (!job || job.status !== 'done') throw new Error(job?.error ?? 'Delete project stopped part way: Retry carries it on');
        rec.viaProject = true;
        return { detail: `taken off the office as Delete project does${job.archiveDir ? `; office data archived to ${job.archiveDir}` : ''}` };
      }
      case 'folder': {
        if (rec.viaProject && rec.deleteFolder) return { detail: `deleted ${s.dir} (with the project)` };
        if (!rec.deleteFolder) return { detail: `kept ${s.dir}`, skipped: true };
        if (!existsSync(s.dir)) return { detail: `${s.dir} was already gone` };
        const why = await folderRefusal(s.dir, this.rules(s.dir));
        if (why) throw new Error(`refusing to delete ${s.dir}: ${why}`);
        await removeTree(s.dir);
        return { detail: `deleted ${s.dir}` };
      }
      case 'repo': {
        if (rec.viaProject && rec.deleteRepo) return { detail: `deleted ${s.repo} (with the project)` };
        if (!rec.deleteRepo) return { detail: madeBySetup(s.steps).offline ? 'a local repository: nothing on GitHub' : `kept ${s.repo}`, skipped: true };
        if (d.testMode() && !d.ghIsFake()) throw new Error('test mode never deletes a real GitHub repository');
        const can = await canDeleteRepo(d.gh, s.repo);
        if (!can.possible) throw new Error(can.why ?? 'the token can’t delete it');
        const r = await deleteRepo(d.gh, s.repo);
        return { detail: r === 'gone' ? `${s.repo} was already gone` : `deleted ${s.repo}` };
      }
      case 'record': {
        if (d.running(s.id)) throw new Error('the setup is running again: let it stop first');
        if (!d.setup(s.id)) return { detail: 'removed (it went with the project’s office data)' };
        if (!d.removeSetup(s.id)) throw new Error('couldn’t remove the setup’s record');
        return { detail: 'removed' };
      }
    }
  }
}

function view(r: CancelRecord): CancelJobView {
  const { setup: _s, byId: _b, viaProject: _v, ...v } = r;
  return { ...v, steps: v.steps.map((s) => ({ ...s })) };
}
