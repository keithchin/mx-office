// The new-project wizard's side of the office: what the wizard page is told before it opens, starting
// a project's setup and carrying it on after a failure, editing its answers later, and the setup
// panel over a toolkit project's board. One per office, made on first use (like the analyzer), with
// its setups run on the office's workflow engine (server/flow/).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sameRepo } from '../../shared/floors.js';
import type { JobView, SetupView, StepId, WizardInfo } from '../../shared/wizard.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { tildify } from '../building.js';
import { applyChoice } from '../budget/index.js';
import { flowsOf } from '../flow/index.js';
import { findMpr } from '../liveapp/checkout.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { setShape } from '../roster/coverage.js';
import { everHired } from '../roster/store.js';
import { adminTokenConfigured, adminTokenSource, redactor } from './admin-token.js';
import { credential } from '../connections/resolve.js';
import { toolkitDir } from '../connections/store.js';
import { configProblems, defaultMendix, mendixVersions, toolkitEnv, wizardConfig, type WizardConfig } from './config.js';
import { existingAnswers, parseIntakeTemplate } from './intake.js';
import { JobBook, jobId, newJob, viewOf, type JobState } from './job.js';
import { mprVersion } from './mendix-app.js';
import { cleanPlan } from './plan.js';
import { setupView, setupViewOf } from './setup.js';
import { GateSource, branchInfo } from './gate-source.js';
import { withFloorToolkitEnv } from '../toolkit-env.js';
import { toolkitBusy, toolkitDirFor } from '../toolkit-pin/index.js';
import { useGateLock } from '../worktree-sweep/index.js';
import { bashPath, runCommand } from './run.js';
import { setupSteps, type FloorRef, type SetupDeps } from './steps.js';
import { trustFloor } from '../claude-trust.js';
import { childEnv } from '../workers/env.js';

/** What an edit writes again: the answers and decisions, and the commit that carries them. */
const EDIT_STEPS: StepId[] = ['intake', 'decisions', 'settings', 'commit'];
/** How long a floor's setup view is shared (setup()). */
export const SETUP_TTL_MS = 5_000;

export class Wizard {
  private base: WizardConfig;
  readonly book: JobBook;
  /** Floors whose gate-check is running now (🔄 Re-check), and when each last finished. */
  private checking = new Set<string>();
  private checkedAt = new Map<string, number>();
  /** The gates read from each floor's default branch, and gate-check run there when it moves (gate-source.ts). */
  private gates: GateSource;

  constructor(private ctx: Ctx) {
    this.base = wizardConfig();
    // Its runs are on the office's workflow engine; <office data>/wizard/ holds the jobs saved before it, taken in on load.
    this.book = new JobBook(path.join(ctx.cfg.dataDir, 'wizard'), redactor([]), flowsOf(ctx));
    this.gates = new GateSource((tmp, floorDir) => this.gateCheck(tmp, floorDir, 5 * 60_000).then(() => undefined));
    // The worktree sweep leaves a floor's ao-gates-* copy alone while its gate-check is running.
    useGateLock((dir) => this.gates.busy(dir) || toolkitBusy(dir));
  }

  /** The toolkit's gate-check over `dir`, with the floor's toolkit.env (read from the floor's own folder). */
  private async gateCheck(dir: string, floorDir: string, timeoutMs: number) {
    const tk = await toolkitDirFor(floorDir, this.cfg.toolkitDir);
    return this.gateCheckWith(tk.dir, dir, floorDir, timeoutMs, tk.pinned);
  }

  /**
   * gate-check.sh of the toolkit at `toolkit` over `dir`, with the floor's toolkit.env (read from the floor's own
   * folder). From a pin (toolkit-pin/) it doesn't fetch: the pin is the commit the project acknowledges, by design.
   */
  gateCheckWith(toolkit: string, dir: string, floorDir: string, timeoutMs: number, pinned = true) {
    const env = { ...withFloorToolkitEnv(floorDir, toolkitEnv(this.cfg)), ...(pinned ? { MXTK_NO_FETCH: '1' } : {}) };
    return runCommand(this.cfg.bash, [bashPath(path.join(toolkit, 'bin', 'gate-check.sh')), bashPath(dir)], { cwd: dir, env, timeoutMs, allowFail: true });
  }

  /** The toolkit's sync-project.sh of the toolkit at `toolkit` over `dir` (Update toolkit: the copies refreshed as the toolkit intends). */
  syncWith(toolkit: string, dir: string, floorDir: string, onLine: (line: string) => void) {
    const env = { ...withFloorToolkitEnv(floorDir, toolkitEnv(this.cfg)), MXTK_SYNC_SKIP_CLONE_CHECK: '1' };
    return runCommand(this.cfg.bash, [bashPath(path.join(toolkit, 'bin', 'sync-project.sh')), bashPath(dir)], { cwd: dir, env, timeoutMs: 10 * 60_000, onLine, allowFail: true }).then(() => undefined);
  }

  /** Where everything is: the toolkit folder looked up again each time, so a change in 🔌 Connections › Paths takes at once. */
  get cfg(): WizardConfig {
    return { ...this.base, toolkitDir: toolkitDir() };
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
      adminToken: { configured: adminTokenConfigured(this.cfg.adminTokenFile), file: tildify(this.cfg.adminTokenFile), source: adminTokenSource(this.cfg.adminTokenFile) },
      mendixToken: !!credential('mendix'),
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
    // Roles ticked since the team step ran are hired too (JobBook.edit), and only those.
    this.book.edit(job, { ...plan, createdByHand: job.plan.createdByHand, sprintrAppId: job.plan.sprintrAppId }, [...EDIT_STEPS, ...(moved ? (['env'] as StepId[]) : [])]);
    this.go(job);
    return viewOf(job);
  }

  /** The setup for a floor: the wizard's, or one made from the project's files to edit it (a project set up by hand). */
  jobForFloor(floor: Floor): JobState | undefined {
    return this.book.byFloor(floor.id) ?? this.book.all().find((j) => sameRepo(`${j.plan.owner}/${j.plan.name}`, floor.def.repo));
  }

  /** The setup panel's view: from the default branch on GitHub when there is one, else from the floor's folder. */
  /** Each floor's setup view as last worked out, and when (setup() reuses it for SETUP_TTL_MS). */
  private setups = new Map<string, { at: number; view: Promise<SetupView>; done?: boolean }>();

  /**
   * The setup panel's view of a floor. Working it out runs git four to six times (a quarter to over half
   * a second on Windows), and a project switch asked for it three times at once (the setup panel, the
   * team phone, Needs you): one answer is shared for a few seconds, and a re-check starts afresh.
   */
  setup(floor: Floor, now = Date.now()): Promise<SetupView> {
    const had = this.setups.get(floor.id);
    if (had && now - had.at < SETUP_TTL_MS) return had.view;
    const view = this.freshSetup(floor);
    // Stale-while-revalidate: an answer already worked out is given at once while the fresh one comes
    // (its git takes seconds on a big project), and replaces it once it's in.
    if (had?.done) {
      had.at = now;
      void view.then((v) => this.setups.get(floor.id) === had && this.setups.set(floor.id, { at: Date.now(), view: Promise.resolve(v), done: true }), () => undefined);
      return had.view;
    }
    void view.then(() => {
      const e = this.setups.get(floor.id);
      if (e?.view === view) e.done = true;
    }, () => undefined);
    this.setups.set(floor.id, { at: now, view });
    view.catch(() => this.setups.get(floor.id)?.view === view && this.setups.delete(floor.id));
    return view;
  }

  private async freshSetup(floor: Floor): Promise<SetupView> {
    const job = this.jobForFloor(floor)?.id;
    const g = await this.gates.read(floor.dir).catch(() => undefined);
    if (!g) return { ...setupView(floor.dir), job, checking: this.checking.has(floor.id), checkedAt: this.checkedAt.get(floor.id) };
    const { info } = g;
    const off = info.branch !== info.def || info.behind > 0;
    return {
      ...setupViewOf(g.files),
      job,
      checking: g.regenerating,
      checkedAt: g.renderedAt,
      readFrom: `origin/${info.def}`,
      head: { branch: info.def, sha: info.sha },
      ...(off ? { checkout: { branch: info.branch, behind: info.behind, defaultBranch: info.def } } : {}),
    };
  }

  /**
   * Runs gate-check in the background so the panel's verdicts are fresh: on the default branch in a
   * temporary worktree when the project has one (the floor's folder untouched), else over the folder.
   */
  recheck(floor: Floor): string | undefined {
    this.setups.delete(floor.id);
    const dir = floor.dir;
    void branchInfo(dir).then((info) => {
      if (info) return void this.gates.regenerate(dir, info, true);
      this.recheckFolder(floor);
    });
    return undefined;
  }

  /** Whether a gate-check is running for the floor (keep-awake holds the computer awake meanwhile). */
  checkingGates(floor: Floor): boolean {
    return this.checking.has(floor.id) || this.gates.busy(floor.dir);
  }

  /** gate-check over the floor's own folder (it rewrites index.html there): only for a project with no remote. */
  private recheckFolder(floor: Floor) {
    if (this.checking.has(floor.id)) return;
    this.checking.add(floor.id);
    const dir = floor.dir;
    void this.gateCheck(dir, dir, 10 * 60_000)
      .catch((err: Error) => console.error(`agent-office: gate-check on ${floor.def.name} failed: ${err.message}`))
      .finally(() => {
        this.checking.delete(floor.id);
        this.checkedAt.set(floor.id, Date.now());
      });
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
      // Phase B (the Mendix Projects API) reads the Mendix token here: the wizard only, never the workers.
      mendixToken: () => credential('mendix'),
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
      // The office's own Claude Code (CLAUDE_CONFIG_DIR in its environment, else ~/.claude.json), as signins.ts's base.
      trustFloor: (dir) => void trustFloor(dir, childEnv()),
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
      known: (floorId, role) => {
        const floor = ctx.floors.get(floorId);
        return !!floor && everHired(rosterOf(ctx).data(floor.id).members[role]);
      },
      // The Team tab's own hire: the role's fixed name, its Playbook, and the model the roster has for it (the role's default on a new floor), or `model` for this one hire.
      hire: async (floorId, role, by, account, task, model) => {
        const floor = ctx.floors.get(floorId);
        if (!floor) return 'No such floor';
        return rosterOf(ctx).members.hire(teamFloor(ctx, floor), role, by, account, task, model);
      },
      applyBudget: (floorId, choice, by) => applyChoice(ctx, floorId, choice, by),
      setShape: (floorId, shape, by) => {
        const floor = ctx.floors.get(floorId);
        if (floor) setShape(rosterOf(ctx), teamFloor(ctx, floor), shape, by);
      },
    };
  }
}

const offices = new WeakMap<object, Wizard>();

/** The office's wizard if something already made it (keep-awake looks without making one). */
export const wizardIfMade = (ctx: Ctx): Wizard | undefined => offices.get(ctx.cfg);

/** The office's wizard: made on first use, then the same one for every request. */
export function wizardOf(ctx: Ctx): Wizard {
  let w = offices.get(ctx.cfg);
  if (!w) {
    w = new Wizard(ctx);
    offices.set(ctx.cfg, w);
  }
  return w;
}
