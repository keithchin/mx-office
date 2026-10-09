// Deleting a project, GitHub-style (shared/project-delete.ts): the plan the dialog shows, then one job
// per project that runs its steps in order (stop the agents, remove the worktrees, archive the office
// data, remove it, delete the folder, delete the repository, take it out of floors.json), saving after
// each one in <data>/deleted/jobs/<floor>.json. A step that fails stops the job with why; asking again
// carries it on from that step (every step is safe to run twice). Everything slow is async (git and gh
// off the event loop, fs/promises), so the office never stalls. The audit log is never touched but to
// record project.delete.

import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DELETE_STEPS, cleanRequest, confirmMatches, confirmTarget, worktreesWithWork, type DeleteJobView, type DeletePlan, type DeleteRequest, type DeleteStepId } from '../../shared/project-delete.js';
import { writeJsonAtomic } from '../flow/store.js';
import { archiveDirFor, archiveProject, removeLiveData } from './data.js';
import { folderRefusal, removeTree } from './fsops.js';
import { canDeleteRepo, deleteRepo } from './repo.js';
import type { DeleteDeps, DeleteFloor, JobRecord } from './types.js';
import { officeWorktrees, removeOfficeWorktrees } from './worktrees.js';

const DONE_KEEP_MS = 10 * 60_000;

/** The Portal's page for a Mendix app in the project folder (never deleted by the office). */
async function mendixOf(dir: string): Promise<DeletePlan['mendix']> {
  const names = await readdir(dir).catch(() => [] as string[]);
  if (!names.some((n) => n.toLowerCase().endsWith('.mpr'))) return undefined;
  let appId: string | undefined;
  try {
    const j = JSON.parse(await readFile(path.join(dir, 'agent-office.project.json'), 'utf8')) as Record<string, unknown>;
    const v = j.sprintrAppId ?? j.mendixAppId ?? j.appId;
    if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) appId = v.toLowerCase();
  } catch {
    // none recorded
  }
  return {
    portalUrl: appId ? `https://sprintr.home.mendix.com/link/project/${appId}` : 'https://sprintr.home.mendix.com/',
  };
}

export class ProjectDeletes {
  private running = new Map<string, Promise<void>>();
  private finished = new Map<string, JobRecord>();

  constructor(private deps: DeleteDeps) {}

  private jobFile(floor: string) {
    return path.join(this.deps.dataDir, 'deleted', 'jobs', `${floor.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  }

  private async saved(floor: string): Promise<JobRecord | undefined> {
    try {
      const j = JSON.parse(await readFile(this.jobFile(floor), 'utf8')) as JobRecord;
      return j && j.floor === floor && Array.isArray(j.steps) ? j : undefined;
    } catch {
      return undefined;
    }
  }

  private save(job: JobRecord) {
    writeJsonAtomic(this.jobFile(job.floor), job);
  }

  private folderRules(f: DeleteFloor) {
    return {
      home: this.deps.projectsHome(),
      dataDir: this.deps.dataDir,
      local: f.local,
      testMode: this.deps.testMode(),
    };
  }

  /** What deleting would do, for the dialog. Nothing changes. */
  async plan(floor: string): Promise<DeletePlan | string> {
    const job = this.finished.get(floor) ?? (await this.saved(floor));
    const f = this.deps.floor(floor) ?? job?.def;
    if (!f) return 'No such project';
    const [worktrees, refusal, repoDelete, mendix] = await Promise.all([officeWorktrees(f.dir), folderRefusal(f.dir, this.folderRules(f)), canDeleteRepo(this.deps.gh, f.repo), mendixOf(f.dir)]);
    if (repoDelete.possible && this.deps.testMode() && !this.deps.ghIsFake())
      Object.assign(repoDelete, {
        possible: false,
        why: 'the office is in test mode, and test mode never deletes a real GitHub repository',
      });
    return {
      floor: f.id,
      name: f.name,
      ...(f.repo ? { repo: f.repo } : {}),
      dir: f.dir,
      confirm: confirmTarget({ floor: f.id, repo: f.repo }),
      agents: this.deps.agents(f.id),
      worktrees,
      archiveDir: path.join(this.deps.dataDir, 'deleted', `${f.id}-<date-time>`),
      folder: refusal ? { deletable: false, why: refusal } : { deletable: true },
      repoDelete,
      ...(mendix ? { mendix } : {}),
      ...(this.deps.blocked(f.id) ? { blocked: this.deps.blocked(f.id) } : {}),
      ...(job && job.status !== 'done' ? { unfinished: view(job) } : {}),
    };
  }

  /** The job's progress, while it runs and a while after. */
  async job(floor: string): Promise<DeleteJobView | undefined> {
    const j = this.finished.get(floor) ?? (await this.saved(floor));
    return j && view(j);
  }

  /**
   * Starts (or carries on) deleting a project. Checks everything first (the typed name, admin is the
   * route's, what may go); resolves the job as it starts, or why not.
   */
  async start(floor: string, raw: unknown, by: { name: string; id?: string }): Promise<DeleteJobView | string> {
    const req = cleanRequest(raw);
    if (typeof req === 'string') return req;
    if (this.running.has(floor)) return 'It’s already being deleted';
    const old = await this.saved(floor);
    const f = this.deps.floor(floor) ?? old?.def;
    if (!f) return 'No such project';
    if (!confirmMatches(req.confirm, confirmTarget({ floor: f.id, repo: f.repo }))) return `To confirm, type ${confirmTarget({ floor: f.id, repo: f.repo })} exactly`;
    const blocked = this.deps.blocked(f.id);
    if (blocked) return blocked;
    // A job that stopped part way carries on with what was asked then; a new one checks what it may do.
    let job: JobRecord;
    if (old && old.status !== 'done') {
      job = {
        ...old,
        status: 'running',
        error: undefined,
        finishedAt: undefined,
        request: {
          ...old.request,
          discardWork: old.request.discardWork || req.discardWork,
        },
      };
    } else {
      const why = await this.refusal(f, req);
      if (why) return why;
      job = {
        floor: f.id,
        name: f.name,
        mode: req.mode,
        deleteFolder: !!req.deleteFolder,
        deleteRepo: !!req.deleteRepo,
        status: 'running',
        steps: DELETE_STEPS.map((s) => ({
          id: s.id,
          label: s.label,
          status: 'pending' as const,
        })),
        by: by.name,
        byId: by.id,
        startedAt: this.deps.now(),
        def: f,
        request: {
          mode: req.mode,
          deleteFolder: !!req.deleteFolder,
          deleteRepo: !!req.deleteRepo,
          discardWork: !!req.discardWork,
        },
      };
    }
    this.finished.delete(floor);
    this.save(job);
    const run = this.run(job).finally(() => this.running.delete(floor));
    this.running.set(floor, run);
    return view(job);
  }

  /** Waits for a project's job (tests). */
  settled(floor: string): Promise<void> {
    return this.running.get(floor) ?? Promise.resolve();
  }

  /** Why the request can't go ahead as asked. */
  private async refusal(f: DeleteFloor, req: DeleteRequest): Promise<string | undefined> {
    if (req.deleteFolder) {
      const why = await folderRefusal(f.dir, this.folderRules(f));
      if (why) return `The folder can’t be deleted: ${why}`;
    }
    if (req.deleteRepo) {
      if (this.deps.testMode() && !this.deps.ghIsFake()) return 'The office is in test mode, and test mode never deletes a real GitHub repository';
      const can = await canDeleteRepo(this.deps.gh, f.repo);
      if (!can.possible) return `The repository can’t be deleted: ${can.why}`;
    }
    const work = worktreesWithWork(await officeWorktrees(f.dir));
    if (work.length && !req.discardWork)
      return `${work.length} worktree${work.length === 1 ? ' has' : 's have'} uncommitted or unpushed work (${work.map((w) => w.branch ?? path.basename(w.path)).join(', ')}): tick “remove them anyway” to go ahead`;
    return undefined;
  }

  private async run(job: JobRecord) {
    for (const s of job.steps) {
      if (s.status === 'done' || s.status === 'skipped') continue;
      s.status = 'running';
      s.detail = undefined;
      this.save(job);
      try {
        const out = await this.step(s.id, job);
        s.status = out.skipped ? 'skipped' : 'done';
        s.detail = out.detail;
        this.save(job);
      } catch (err) {
        s.status = 'failed';
        s.detail = (err as Error).message;
        job.status = 'failed';
        job.error = `${s.label}: ${(err as Error).message}`;
        job.finishedAt = this.deps.now();
        this.save(job);
        console.error(`agent-office: deleting ${job.name} stopped at “${s.label}”: ${(err as Error).message}`);
        return;
      }
    }
    job.status = 'done';
    job.finishedAt = this.deps.now();
    // The job's record goes with the archive; the jobs folder only keeps unfinished ones.
    if (job.archiveDir) writeJsonAtomic(path.join(job.archiveDir, 'manifest.json'), job);
    await rm(this.jobFile(job.floor), { force: true });
    this.finished.set(job.floor, job);
    setTimeout(() => this.finished.get(job.floor) === job && this.finished.delete(job.floor), DONE_KEEP_MS).unref?.();
    this.deps.audit(job.def, { name: job.by, id: job.byId }, view(job));
    this.deps.announce(job.def, job.by);
  }

  private async step(id: DeleteStepId, job: JobRecord): Promise<{ detail?: string; skipped?: boolean }> {
    const f = job.def;
    const d = this.deps;
    switch (id) {
      case 'agents': {
        const n = await d.stopAgents(f.id, job.by);
        return {
          detail: n ? `${n} agent${n === 1 ? '' : 's'} stopped and sent home` : 'no agents were running',
        };
      }
      case 'worktrees': {
        const trees = await officeWorktrees(f.dir);
        if (!trees.length) return { detail: 'none', skipped: true };
        const work = worktreesWithWork(trees);
        if (work.length && !job.request.discardWork) throw new Error(`${work.length} worktree(s) hold uncommitted or unpushed work; confirm removing them anyway`);
        const r = await removeOfficeWorktrees(f.dir, !job.deleteFolder);
        if (r.failed.length) throw new Error(`couldn’t remove ${r.failed.join('; ')}`);
        return {
          detail: `${r.removed} removed${r.keptBranches.length ? `; kept the branch${r.keptBranches.length === 1 ? '' : 'es'} ${r.keptBranches.join(', ')} (unpushed commits) in the repository` : ''}`,
        };
      }
      case 'archive': {
        job.archiveDir ??= archiveDirFor(d.dataDir, f.id, d.now());
        this.save(job);
        const files = await archiveProject({
          dataDir: d.dataDir,
          floor: f.id,
          dir: f.dir,
          to: job.archiveDir,
          pin: d.pin(f.id),
          def: f,
        });
        return {
          detail: `${files} file${files === 1 ? '' : 's'} copied to ${job.archiveDir}`,
        };
      }
      case 'data': {
        // In memory first, so nothing writes the files back once they're gone.
        await d.forget(f, job.archiveDir ?? archiveDirFor(d.dataDir, f.id, d.now()));
        await removeLiveData(d.dataDir, f.id, f.dir, f.local);
        d.pin(f.id, true);
        return {
          detail: f.local ? 'removed (the project’s .agent-office kept: the office keeps its own data there)' : 'removed',
        };
      }
      case 'folder': {
        if (!job.deleteFolder) return { detail: `kept ${f.dir}`, skipped: true };
        const why = await folderRefusal(f.dir, this.folderRules(f));
        if (why) throw new Error(`refusing to delete ${f.dir}: ${why}`);
        await removeTree(f.dir);
        return { detail: `deleted ${f.dir}` };
      }
      case 'repo': {
        if (!job.deleteRepo || !f.repo)
          return {
            detail: f.repo ? `kept ${f.repo}` : 'no repository',
            skipped: true,
          };
        if (d.testMode() && !d.ghIsFake()) throw new Error('test mode never deletes a real GitHub repository');
        const can = await canDeleteRepo(d.gh, f.repo);
        if (!can.possible) throw new Error(can.why ?? 'the token can’t delete it');
        const r = await deleteRepo(d.gh, f.repo);
        return {
          detail: r === 'gone' ? `${f.repo} was already gone` : `deleted ${f.repo}`,
        };
      }
      case 'floor': {
        if (d.floor(f.id)) {
          const err = d.removeFloor(f.id, job.by);
          if (err) throw new Error(err);
        }
        d.retire(f, job.by);
        return { detail: 'taken off floors.json; its project id is retired' };
      }
    }
  }
}

/** The job without what only the server keeps. */
function view(j: JobRecord): DeleteJobView {
  const { def: _def, request: _req, byId: _id, ...v } = j;
  return { ...v, steps: v.steps.map((s) => ({ ...s })) };
}
