// The new-project wizard's side of the office: what the wizard page is told before it opens, starting
// a project's setup and carrying it on after a failure, editing its answers later, and the setup
// panel over a toolkit project's board. One per office, made on first use (like the analyzer), with
// its setups kept in <office data>/wizard/.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sameRepo } from '../../shared/floors.js';
import type { JobView, SetupView, StepId, WizardInfo } from '../../shared/wizard.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { tildify } from '../building.js';
import { findMpr } from '../liveapp/checkout.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { adminTokenConfigured, redactor } from './admin-token.js';
import { configProblems, defaultMendix, mendixVersions, toolkitEnv, wizardConfig, type WizardConfig } from './config.js';
import { existingAnswers, parseIntakeTemplate } from './intake.js';
import { JobBook, jobId, newJob, viewOf, type JobState } from './job.js';
import { mprVersion } from './mendix-app.js';
import { cleanPlan } from './plan.js';
import { setupView } from './setup.js';
import { bashPath, runCommand } from './run.js';
import { setupSteps, type FloorRef, type SetupDeps } from './steps.js';

/** What an edit writes again: the answers and decisions, and the commit that carries them. */
const EDIT_STEPS: StepId[] = ['intake', 'decisions', 'settings', 'commit'];

export class Wizard {
  readonly cfg: WizardConfig;
  readonly book: JobBook;
  /** Floors whose gate-check is running now (🔄 Re-check), and when each last finished. */
  private checking = new Set<string>();
  private checkedAt = new Map<string, number>();

  constructor(private ctx: Ctx) {
    this.cfg = wizardConfig();
    this.book = new JobBook(path.join(ctx.cfg.dataDir, 'wizard'), redactor([]));
  }

  info(admin: boolean): WizardInfo {
    const versions = mendixVersions(this.cfg.mendixDir);
    let questions: WizardInfo['questions'] = [];
    try {
      questions = parseIntakeTemplate(readFileSync(path.join(this.cfg.toolkitDir, 'bin', 'lib', 'intake-template.sh'), 'utf8'));
    } catch {
      // configProblems says the toolkit is missing
    }
    return {
      admin,
      org: this.cfg.org,
      adminToken: { configured: adminTokenConfigured(this.cfg.adminTokenFile), file: tildify(this.cfg.adminTokenFile) },
      offline: !!this.cfg.offlineDir,
      mendixVersions: versions,
      defaultMendix: defaultMendix(versions),
      questions,
      problems: configProblems(this.cfg, versions),
      toolkitDir: this.cfg.toolkitDir,
      jobs: this.book
        .all()
        .filter((j) => j.status !== 'done')
        .map((j) => ({ id: j.id, repo: `${j.plan.owner}/${j.plan.name}`, status: this.book.isRunning(j.id) ? 'running' : j.status })),
    };
  }

  job(id: string): JobView | undefined {
    const j = this.book.get(id);
    return j && viewOf(j);
  }

  /** Starts a new project's setup. A setup for the same repository that's still there is carried on rather than started again. */
  start(raw: unknown, by: string, account?: string): JobView | string {
    const plan = cleanPlan(raw, mendixVersions(this.cfg.mendixDir), this.cfg.org);
    if (typeof plan === 'string') return plan;
    const id = jobId(plan.owner, plan.name);
    const had = this.book.get(id);
    if (had && had.status === 'done') return `${plan.owner}/${plan.name} was already set up — edit its answers from its floor's setup panel`;
    if (had && this.book.isRunning(id)) return viewOf(had);
    if (plan.kind === 'new' && !plan.createdByHand && !this.cfg.offlineDir && !adminTokenConfigured(this.cfg.adminTokenFile)) {
      return "There's no admin token, so the office can't create the repository: create one (see the instructions), or create the repository on GitHub yourself and tick that box";
    }
    const job = had ? Object.assign(had, { plan }) : newJob(plan, by, account);
    this.book.add(job);
    this.go(job);
    return viewOf(job);
  }

  retry(id: string): JobView | string {
    const job = this.book.get(id);
    if (!job) return 'No such setup';
    this.go(job);
    return viewOf(job);
  }

  /** New answers for a setup that ran: written into the project again and committed. */
  edit(id: string, raw: unknown): JobView | string {
    const job = this.book.get(id);
    if (!job) return 'No such setup';
    if (this.book.isRunning(id)) return 'That setup is still running: wait for it to finish';
    const plan = cleanPlan({ ...(raw as object), owner: job.plan.owner, name: job.plan.name, kind: job.plan.kind }, mendixVersions(this.cfg.mendixDir), this.cfg.org);
    if (typeof plan === 'string') return plan;
    const moved = plan.mendix !== job.plan.mendix;
    job.plan = { ...plan, createdByHand: job.plan.createdByHand, sprintrAppId: job.plan.sprintrAppId };
    this.book.reset(job, [...EDIT_STEPS, ...(moved ? (['env'] as StepId[]) : [])]);
    this.go(job);
    return viewOf(job);
  }

  /** The setup for a floor: the wizard's, or one made from the project's files to edit it (a project set up by hand). */
  jobForFloor(floor: Floor): JobState | undefined {
    return this.book.byFloor(floor.id) ?? this.book.all().find((j) => sameRepo(`${j.plan.owner}/${j.plan.name}`, floor.def.repo));
  }

  setup(floor: Floor): SetupView {
    const v = setupView(floor.dir);
    return { ...v, job: this.jobForFloor(floor)?.id, checking: this.checking.has(floor.id), checkedAt: this.checkedAt.get(floor.id) };
  }

  /** Runs gate-check over a floor's project in the background, so the panel's verdicts are fresh. */
  recheck(floor: Floor): string | undefined {
    if (this.checking.has(floor.id)) return undefined;
    this.checking.add(floor.id);
    const dir = floor.dir;
    void runCommand(this.cfg.bash, [bashPath(path.join(this.cfg.toolkitDir, 'bin', 'gate-check.sh')), bashPath(dir)], { cwd: dir, env: toolkitEnv(this.cfg), timeoutMs: 10 * 60_000, allowFail: true })
      .catch((err: Error) => console.error(`agent-office: gate-check on ${floor.def.name} failed: ${err.message}`))
      .finally(() => {
        this.checking.delete(floor.id);
        this.checkedAt.set(floor.id, Date.now());
      });
    return undefined;
  }

  /**
   * For "change an existing app": the Studio Pro version its .mpr was last saved with, when the repository
   * is a floor already, and the installed version that matches it (to preselect). Read-only.
   */
  async appVersion(repo: string): Promise<{ saved?: string; installed?: string }> {
    const floor = [...this.ctx.floors.values()].find((f) => sameRepo(f.def.repo, repo));
    const mpr = floor && findMpr(floor.dir);
    if (!mpr) return {};
    const versions = mendixVersions(this.cfg.mendixDir);
    const saved = await mprVersion(this.cfg, mpr, versions, runCommand);
    return { saved, installed: saved && versions.find((v) => v === saved || v.startsWith(`${saved}.`)) };
  }

  /** The intake answers already in a floor's project, for the wizard to show when editing. */
  answersOf(floor: Floor) {
    try {
      return existingAnswers(readFileSync(path.join(floor.dir, 'intake.md'), 'utf8'));
    } catch {
      return [];
    }
  }

  private go(job: JobState) {
    void this.book.run(job, setupSteps(this.deps())).then(() => {
      if (job.status === 'done') this.ctx.toastAll(`✨ ${job.plan.name}: the project setup finished`);
    });
  }

  private deps(): SetupDeps {
    const { ctx } = this;
    const ref = (f: Floor): FloorRef => ({ id: f.id, dir: f.dir });
    return {
      cfg: this.cfg,
      projectsDir: () => ctx.building.projectsDir,
      floorOf: (repo) => {
        const f = [...ctx.floors.values()].find((x) => sameRepo(x.def.repo, repo));
        return f && ref(f);
      },
      addFloor: async (repo, by, account) => {
        const r = await ctx.building.add(repo, by, () => ctx.floorsChanged(), account);
        ctx.floorsChanged();
        if (typeof r === 'string') return r;
        const floor = ctx.openFloor(r);
        return floor ? ref(floor) : `Cloned ${repo}, but couldn't open its floor — see the office's log`;
      },
      adoptFloor: (repo, dir, by) => {
        const r = ctx.building.adopt(repo, dir, by);
        if (typeof r === 'string') return r;
        const floor = ctx.floors.get(r.id) ?? ctx.openFloor(r);
        ctx.floorsChanged();
        return floor ? ref(floor) : `Couldn't open the floor at ${dir} — see the office's log`;
      },
      queue: (floorId, prompt, title, issue, model, by, account) => {
        const floor = ctx.floors.get(floorId);
        if (!floor) return 'No such floor';
        return floor.queue.add(prompt, by, title, issue, 'claude', model, 'medium', account);
      },
      hired: (floorId, role) => {
        const floor = ctx.floors.get(floorId);
        if (!floor) return false;
        const roster = rosterOf(ctx);
        const m = roster.data(floor.id).members[role];
        return (m.phase === 'active' || m.phase === 'benching') && !!roster.workerOf(teamFloor(ctx, floor), m);
      },
      // The Team tab's own hire: the role's fixed name, its Playbook, and the model the roster has for it (the role's default on a new floor).
      hire: async (floorId, role, by, account, task) => {
        const floor = ctx.floors.get(floorId);
        if (!floor) return 'No such floor';
        return rosterOf(ctx).members.hire(teamFloor(ctx, floor), role, by, account, task);
      },
    };
  }
}

const offices = new WeakMap<object, Wizard>();

/** The office's wizard: made on first use, then the same one for every request. */
export function wizardOf(ctx: Ctx): Wizard {
  let w = offices.get(ctx.cfg);
  if (!w) {
    w = new Wizard(ctx);
    offices.set(ctx.cfg, w);
  }
  return w;
}
