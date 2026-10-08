// What each setup step does. Every step looks first at what's already there (the repository on
// GitHub, the floor, the scaffold, the answers, the commit) and does only what's missing, so a Retry
// after a failure, or the office restarting halfway, simply carries on. The office's own pieces (the
// building, the queue) come in through `SetupDeps`, so the steps can be run against a fake in tests.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENTRY_MODE_INFO, INTERVIEW_MODE_INFO, PROJECT_ROLES, SMALL_TIER_LIMITS, type IntakeAnswer, type ProjectRole, type StepId } from '../../shared/wizard.js';
import { findMpr } from '../liveapp/checkout.js';
import { withFloorToolkitEnv } from '../toolkit-env.js';
import { adminGhEnv, adminTokenHelp, readAdminToken, redactor } from './admin-token.js';
import { DISCOVERY_TITLE, discoveryBrief, discoveryPrompt } from './brief.js';
import { mendixVersions, mxbuildPath, toolkitEnv, type WizardConfig } from './config.js';
import { writeIntakeAnswers } from './intake.js';
import type { JobState, StepImpl, StepIO } from './job.js';
import type { BudgetChoice } from '../../shared/budget/levels.js';
import { SHAPES, shapeForRoles, type TeamShape } from '../../shared/roster/coverage.js';
import { createApp, ignoreMendixOutput, mprVersion } from './mendix-app.js';
import { recordDecisions } from './register.js';
import { bashPath, runCommand } from './run.js';
import { LONGPATHS_CLONE_ARGS, ensureLongPaths } from '../longpaths.js';
import { toolkitDirFor } from '../toolkit-pin/index.js';
import { pinInstructions } from '../toolkit-pin/instructions.js';
import { writeToolkitEnv } from '../toolkit-pin/jobs.js';
import { pinForNew } from '../toolkit-pin/pins.js';
import { nextRecord } from '../toolkit-pin/record.js';

export interface FloorRef {
  id: string;
  dir: string;
}

export interface SetupDeps {
  cfg: WizardConfig;
  /** The Mendix token from 🔌 Connections, for the Mendix Projects API (Phase B); never put in a worker's environment. */
  mendixToken?(): string | undefined;
  projectsDir(): string;
  /** The floor for `repo` (owner/name), if the building has one. */
  floorOf(repo: string): FloorRef | undefined;
  /** Clones `repo` with the office's gh login and opens it as a floor (the elevator's way). */
  addFloor(repo: string, by: string, account?: string): Promise<FloorRef | string>;
  /** Opens a checkout already on disk as `repo`'s floor (the offline test office's way). */
  adoptFloor(repo: string, dir: string, by: string): FloorRef | string;
  /** Puts a task on a floor's queue; why not, if it couldn't. */
  queue(floor: string, prompt: string, title: string, issue: number, model: string, by: string, account?: string): string | undefined;
  /** Whether a role of the project team is a worker on the floor already (hired, or writing its handoff). */
  hired(floor: string, role: ProjectRole): boolean;
  /** Whether the floor has had a role of the project team in any state: at work, writing its handoff, benched, or sent home. */
  known(floor: string, role: ProjectRole): boolean;
  /**
   * Hires a role of the project team the roster's way (its fixed name, its Playbook, its own model), with `task` as its
   * first job and on `model` for this hire when given (the role keeps its own); why not, if it couldn't.
   */
  hire(floor: string, role: ProjectRole, by: string, account?: string, task?: string, model?: string): Promise<string | undefined>;
  /** Saves the Budget step's budget on the floor and sets the team's models and settings for its level (budget/index.ts); the problems, if any. */
  applyBudget?(floor: string, choice: BudgetChoice, by: string): string[];
  /** Sets the floor's team shape and its coverage (roster/coverage.ts), before the team is hired. */
  setShape?(floor: string, shape: TeamShape, by: string): void;
  /** Marks the floor's folder trusted in the office's own Claude Code config (claude-trust.ts), so its agents start without the trust prompt. */
  trustFloor?(dir: string): void;
  /** The office's environment (tests pass their own). */
  env?: NodeJS.ProcessEnv;
  /** Runs a command (tests pass a fake for the Mendix tools); runCommand when not given. */
  run?: typeof runCommand;
  /** The pin a new project starts on (toolkit-pin/pins.ts pinForNew); tests can pass their own. */
  pinToolkit?(root: string): Promise<{ sha: string; dir: string; date?: string } | undefined>;
}

const MIN = 60_000;
/** The project's client and team settings, committed at the repository's root. */
export const PROJECT_FILE = 'agent-office.project.json';
/** Today on the office's clock (the register's dates are the people's dates, not UTC's). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const repoOf = (job: JobState) => `${job.plan.owner}/${job.plan.name}`;
const said = (io: StepIO) => (line: string) => io.log(`  ${line}`);

/** Marker files of a finished scaffold, machine-local ones included (a fresh clone of a scaffolded repo lacks those). */
const SCAFFOLD = ['intake.md', 'PROJECT.md', 'CLAUDE.local.md', 'bin/install-project-hooks.sh', '.claude/settings.local.json', '.claude/.doctor-receipt'];

export function setupSteps(deps: SetupDeps): Record<StepId, StepImpl> {
  const { cfg } = deps;
  const env = () => toolkitEnv(cfg, deps.env ?? process.env);
  const git = (dir: string, args: string[], io: StepIO, timeoutMs = 2 * MIN, allowFail = false) => runCommand('git', args, { cwd: dir, env: env(), timeoutMs, onLine: said(io), allowFail });
  // The toolkit's scripts run with the project's toolkit.env over the office's environment, as everything
  // the office starts for a floor does (toolkit-env.ts), and with the picked Studio Pro's mxbuild even
  // before the env step has written it there.
  const bash = (job: JobState, script: string, args: string[], io: StepIO, timeoutMs: number, allowFail = false) =>
    runCommand(cfg.bash, [bashPath(script), ...args], { cwd: dirOf(job), env: { ...withFloorToolkitEnv(dirOf(job), env()), MXBUILD_PATH: mxbuildPath(cfg, job.plan.mendix) }, timeoutMs, onLine: said(io), allowFail });
  const bare = (job: JobState) => path.join(cfg.offlineDir!, job.plan.owner, `${job.plan.name}.git`);
  const dirOf = (job: JobState) => {
    if (!job.dir || !existsSync(job.dir)) throw new Error("The project's floor isn't there yet: Retry from the clone step");
    return job.dir;
  };
  const file = (job: JobState, rel: string) => path.join(dirOf(job), rel);
  const quiet: StepIO = { log: () => undefined };

  /**
   * The toolkit's pre-commit hook refuses a model the mxbuild gate hasn't passed on this machine, so a
   * new app that's never been committed goes through bin/verify-model.sh first (one mxbuild, which
   * stamps it). A model that's committed already, or stamped, or a project without the hook's scripts
   * needs nothing.
   */
  const verifyNewModel = async (job: JobState, io: StepIO) => {
    const dir = dirOf(job);
    const mpr = findMpr(dir);
    const verify = path.join(dir, 'bin', 'verify-model.sh');
    if (!mpr || !existsSync(verify)) return;
    if ((await git(dir, ['ls-files', '--', path.relative(dir, mpr)], quiet)).stdout.trim()) return;
    if ((await bash(job, path.join(dir, 'bin', 'model-stamp.sh'), ['check', '-q'], quiet, 2 * MIN, true).catch(() => ({ code: 1 }))).code === 0) return;
    io.log("  the toolkit's pre-commit hook wants the new app through the mxbuild gate first: running bin/verify-model.sh (a minute or two)…");
    const r = await bash(job, verify, [], io, 20 * MIN, true);
    if (r.code !== 0) throw new Error(`bin/verify-model.sh exit ${r.code}, so the pre-commit hook would refuse the new app: ${r.tail.slice(-2).join(' ').slice(0, 300)}. Fix the cause and Retry`);
  };

  return {
    async repo(job, io) {
      const repo = repoOf(job);
      if (job.plan.kind === 'change') return { status: 'skipped', detail: `existing repository ${repo}` };
      if (cfg.offlineDir) {
        const at = bare(job);
        if (existsSync(path.join(at, 'HEAD'))) return { status: 'skipped', detail: `already there (offline: ${at})` };
        mkdirSync(path.dirname(at), { recursive: true });
        await git(path.dirname(at), ['init', '--bare', '-b', 'main', at], io);
        // Like `gh repo create --add-readme`: one commit, so the clone has something to check out.
        const seed = mkdtempSync(path.join(os.tmpdir(), 'wizard-seed-'));
        try {
          await git(seed, ['clone', at, '.'], io, 2 * MIN, true);
          writeFileSync(path.join(seed, 'README.md'), `# ${job.plan.name}\n\n${job.plan.description}\n`);
          await git(seed, ['add', 'README.md'], io);
          await git(seed, ['-c', 'user.name=agent-office', '-c', 'user.email=agent-office@localhost', 'commit', '-m', 'Initial commit'], io);
          await git(seed, ['push', 'origin', 'HEAD:main'], io);
        } finally {
          rmSync(seed, { recursive: true, force: true });
        }
        return { status: 'done', detail: `offline: a local bare repository at ${at}` };
      }
      const seen = await runCommand('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], { cwd: deps.projectsDir(), env: env(), timeoutMs: MIN, allowFail: true }).catch(() => ({ code: 1 }));
      if (seen.code === 0) return { status: 'skipped', detail: `${repo} is already on GitHub` };
      if (job.plan.createdByHand) throw new Error(`Couldn't find ${repo} on GitHub with the office's login. Create it there first (in ${job.plan.owner}, with a README), then Retry`);
      const token = readAdminToken(cfg.adminTokenFile);
      if (!token) throw new Error(`No admin token in 🔌 Connections or ${cfg.adminTokenFile}. ${adminTokenHelp(cfg.adminTokenFile, job.plan.owner).join(' ')}`);
      const hide = redactor([token]);
      const args = ['repo', 'create', repo, job.plan.private ? '--private' : '--public', '--add-readme'];
      if (job.plan.description) args.push('--description', job.plan.description);
      try {
        // The admin token goes to this one child and nowhere else (see admin-token.ts).
        await runCommand('gh', args, { cwd: deps.projectsDir(), env: adminGhEnv(deps.env ?? process.env, token), timeoutMs: 2 * MIN, onLine: (l) => io.log(`  ${hide(l)}`) });
      } catch (err) {
        throw new Error(hide((err as Error).message));
      }
      return { status: 'done', detail: `created ${repo} on GitHub (${job.plan.private ? 'private' : 'public'})` };
    },

    async clone(job, io) {
      const repo = repoOf(job);
      const known = deps.floorOf(repo);
      const settle = (f: FloorRef | string, detail: string) => {
        if (typeof f === 'string') throw new Error(f);
        job.floor = f.id;
        job.dir = f.dir;
        return { status: 'done' as const, detail };
      };
      // The floor's repository takes long paths (a Mendix app's npm packages, longpaths.ts), and the office's Claude Code trusts the floor.
      const floorReady = async <T>(r: T) => {
        if (job.dir) {
          await ensureLongPaths(job.dir);
          deps.trustFloor?.(job.dir);
        }
        return r;
      };
      if (known) return await floorReady({ ...settle(known, ''), status: 'skipped', detail: `already a floor (${known.dir})` });
      if (cfg.offlineDir) {
        const dest = path.join(deps.projectsDir(), job.plan.owner, job.plan.name);
        if (!existsSync(path.join(dest, '.git'))) {
          mkdirSync(path.dirname(dest), { recursive: true });
          await git(path.dirname(dest), ['clone', ...LONGPATHS_CLONE_ARGS, bare(job), dest], io);
          // origin reads as GitHub (the office keys floors by it); pushes go to the local bare repository.
          await git(dest, ['remote', 'set-url', 'origin', `https://github.com/${repo}.git`], io);
          await git(dest, ['remote', 'set-url', '--push', 'origin', bare(job)], io);
        }
        return await floorReady(settle(deps.adoptFloor(repo, dest, job.by), `offline floor at ${dest}`));
      }
      io.log(`  cloning ${repo} with the office's gh login…`);
      return await floorReady(settle(await deps.addFloor(repo, job.by, job.account), `cloned into ${deps.projectsDir()}`));
    },

    async env(job) {
      const f = file(job, '.claude/toolkit.env');
      const want: Record<string, string | undefined> = { MXBUILD_PATH: mxbuildPath(cfg, job.plan.mendix), MXCLI_VERSION: 'nightly', PYTHON: cfg.python };
      const before = existsSync(f) ? readFileSync(f, 'utf8') : '';
      const lines = before ? before.replace(/\r/g, '').replace(/\n+$/, '').split('\n') : ['# Per-project toolkit settings (read by mxcli-project-toolkit scripts). Windows paths as-is.', '# Machine-local: git-ignored, written by the agent-office new-project wizard.'];
      for (const [k, v] of Object.entries(want)) {
        if (!v) continue;
        const i = lines.findIndex((l) => l.startsWith(`${k}=`));
        if (i >= 0) lines[i] = `${k}=${v}`;
        else lines.push(`${k}=${v}`);
      }
      const after = `${lines.join('\n')}\n`;
      if (after === before) return { status: 'skipped', detail: 'already up to date' };
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, after);
      return { status: 'done', detail: `Studio Pro ${job.plan.mendix}` };
    },

    async app(job, io) {
      // Before init: init-project.sh names the .mpr in CLAUDE.local.md, and the scaffold and the app go up in one commit.
      const dir = dirOf(job);
      const run = deps.run ?? runCommand;
      const mpr = findMpr(dir);
      if (job.plan.kind === 'change') {
        if (!mpr) return { status: 'skipped', detail: 'existing app: no .mpr found in the repository' };
        const saved = await mprVersion(cfg, mpr, mendixVersions(cfg.mendixDir), run);
        const off = saved && !job.plan.mendix.startsWith(saved) && !saved.startsWith(job.plan.mendix);
        return { status: 'skipped', detail: `existing app ${path.relative(dir, mpr)}${saved ? `, last saved with Studio Pro ${saved}` : ''}${off ? ` (not the ${job.plan.mendix} picked: edit the answers to change it)` : ''}` };
      }
      const ignored = ignoreMendixOutput(dir);
      if (mpr) return { status: 'skipped', detail: `already there (${path.relative(dir, mpr)})${ignored ? '; .gitignore updated' : ''}` };
      io.log(`  creating the Mendix app with Studio Pro ${job.plan.mendix}…`);
      return { status: 'done', detail: await createApp(cfg, job.plan, dir, { run, env: env(), onLine: said(io) }) };
    },

    async init(job, io) {
      const dir = dirOf(job);
      if (SCAFFOLD.every((rel) => existsSync(path.join(dir, rel)))) return { status: 'skipped', detail: 'already scaffolded' };
      // A new project starts on the fork's newest commit, as a pin of its own (toolkit-pin/): its wiring names the pin, so later toolkit commits never reach it mid-stage.
      const tk = job.toolkit ?? (await (deps.pinToolkit ?? pinForNew)(cfg.toolkitDir).catch((err: Error) => void io.log(`  couldn't pin the toolkit (${err.message}): using ${cfg.toolkitDir} as it is`)));
      if (tk) {
        job.toolkit = tk;
        io.log(`  toolkit pinned at ${tk.sha.slice(0, 7)}${tk.date ? ` (${tk.date})` : ''}: ${tk.dir}`);
      }
      io.log('  (this takes a few minutes on Windows: the toolkit checks the machine and renders its dashboard)');
      await bash(job, path.join(tk?.dir ?? cfg.toolkitDir, 'bin', 'init-project.sh'), [bashPath(dir), '--ignore-sources'], io, 25 * MIN);
      if (tk) {
        pinInstructions(dir, { pin: tk.dir, sha: tk.sha, date: tk.date, names: [path.basename(path.resolve(cfg.toolkitDir))] });
        writeToolkitEnv(dir, tk.dir);
      }
      const missing = SCAFFOLD.filter((rel) => !existsSync(path.join(dir, rel)));
      if (missing.includes('intake.md') || missing.includes('PROJECT.md')) throw new Error(`init-project.sh finished but didn't write ${missing.join(', ')}`);
      return { status: 'done', detail: missing.length ? `scaffolded (not written: ${missing.join(', ')})` : 'scaffolded' };
    },

    async hooks(job, io) {
      const dir = dirOf(job);
      const script = path.join(dir, 'bin', 'install-project-hooks.sh');
      if (!existsSync(script)) throw new Error("bin/install-project-hooks.sh isn't in the project: the scaffold didn't finish (Retry from init)");
      await bash(job, script, [], io, 2 * MIN);
      return { status: 'done', detail: existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')) ? 'pre-commit hook in place' : 'ran' };
    },

    async intake(job) {
      const f = file(job, 'intake.md');
      if (!existsSync(f)) throw new Error('intake.md is missing: Retry from init');
      const md = readFileSync(f, 'utf8');
      const answers = intakeAnswersOf(job);
      const out = writeIntakeAnswers(md, answers);
      if (out === md) return { status: 'skipped', detail: 'answers already in intake.md' };
      writeFileSync(f, out);
      return { status: 'done', detail: `${answers.filter((a) => a.text.trim()).length} answers written` };
    },

    async decisions(job) {
      const f = file(job, 'PROJECT.md');
      if (!existsSync(f)) throw new Error('PROJECT.md is missing: Retry from init');
      const md = readFileSync(f, 'utf8');
      const { flat, rows } = decisionsOf(job);
      const out = recordDecisions(md, flat, rows);
      if (out === md) return { status: 'skipped', detail: 'already recorded' };
      writeFileSync(f, out);
      return { status: 'done', detail: rows.map((r) => r.decision).join(' · ') };
    },

    async settings(job) {
      // Committed with the project (agent-office.project.json at its root), so the client portal and the team model on any office see the same client and team.
      const f = file(job, PROJECT_FILE);
      let saved: Record<string, unknown> = {};
      try {
        saved = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      } catch {
        // first time
      }
      const p = job.plan;
      // The team's shape too, when it isn't Enterprise (the budget plan prices it: budget/plan-source.ts).
      const toolkit = job.toolkit && !saved.toolkit ? { toolkit: nextRecord(undefined, job.toolkit.sha, job.by, 'create') } : {};
      const next = { ...saved, ...toolkit, repo: repoOf(job), description: p.description, clients: p.clients, operators: p.operators, roles: p.roles, entryMode: p.entry, sizeTier: p.tier, mendix: p.mendix, interview: p.interview, ...(p.shape && p.shape !== 'enterprise' ? { teamShape: p.shape } : {}), createdBy: saved.createdBy ?? job.by, createdAt: saved.createdAt ?? job.startedAt, wizardJob: job.id };
      if (JSON.stringify(next) === JSON.stringify(saved)) return { status: 'skipped', detail: 'already saved' };
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, `${JSON.stringify(next, null, 2)}\n`);
      return { status: 'done', detail: `${p.clients.length} client(s), ${p.roles.length} role(s)` };
    },

    async gates(job, io) {
      const dir = dirOf(job);
      const tk = job.toolkit?.dir ?? (await toolkitDirFor(dir, cfg.toolkitDir)).dir;
      const r = await bash(job, path.join(tk, 'bin', 'gate-check.sh'), [bashPath(dir)], io, 10 * MIN, true);
      return { status: 'done', detail: r.code === 0 ? 'index.html and the current stage are up to date' : `gate-check exit ${r.code}: stages still to do` };
    },

    async commit(job, io) {
      const dir = dirOf(job);
      const status = await git(dir, ['status', '--porcelain'], { log: () => undefined });
      let made = 'nothing new to commit';
      if (status.stdout.trim()) {
        await verifyNewModel(job, io);
        // core.safecrlf off: otherwise every scaffolded file logs a line-ending warning on Windows.
        await git(dir, ['-c', 'core.safecrlf=false', 'add', '-A'], io);
        const first = !(await git(dir, ['log', '--oneline', '-n', '50'], { log: () => undefined }, MIN, true)).stdout.includes('Toolkit scaffold');
        const subject = first ? `Toolkit scaffold${job.plan.kind === 'new' ? ' and Mendix app' : ''} (mxcli-project-toolkit init-project via the agent-office new-project wizard)` : 'Kickoff answers updated in the agent-office new-project wizard';
        const body = decisionsOf(job).rows.map((r) => `- ${r.decision}`).join('\n');
        await git(dir, ['-c', 'core.safecrlf=false', 'commit', '-m', subject, '-m', body], io, 10 * MIN);
        made = 'committed';
      }
      await git(dir, ['push', 'origin', 'HEAD'], io, 5 * MIN);
      return { status: 'done', detail: `${made}, pushed` };
    },

    async issue(job, io) {
      if (!job.plan.discovery.issue) return { status: 'skipped', detail: 'not asked for' };
      if (job.issue) return { status: 'skipped', detail: `already #${job.issue}` };
      const body = discoveryBrief(job.plan, job.toolkit?.dir ?? cfg.toolkitDir, job.toolkit?.sha);
      if (cfg.offlineDir) {
        const dir = path.join(cfg.offlineDir, job.plan.owner, `${job.plan.name}.issues`);
        mkdirSync(dir, { recursive: true });
        job.issue = 1;
        writeFileSync(path.join(dir, '1.md'), `# ${DISCOVERY_TITLE}\n\n${body}\n`);
        return { status: 'done', detail: `offline: written to ${dir}` };
      }
      const repo = repoOf(job);
      const found = await runCommand('gh', ['issue', 'list', '--repo', repo, '--state', 'all', '--search', 'Discovery in:title', '--json', 'number,title'], { cwd: dirOf(job), env: env(), timeoutMs: MIN });
      const same = (JSON.parse(found.stdout || '[]') as { number: number; title: string }[]).find((i) => i.title === DISCOVERY_TITLE);
      if (same) {
        job.issue = same.number;
        return { status: 'skipped', detail: `already #${same.number}` };
      }
      const tmp = path.join(os.tmpdir(), `wizard-brief-${job.id}.md`);
      writeFileSync(tmp, body);
      try {
        const r = await runCommand('gh', ['issue', 'create', '--repo', repo, '--title', DISCOVERY_TITLE, '--body-file', tmp], { cwd: dirOf(job), env: env(), timeoutMs: 2 * MIN, onLine: said(io) });
        const n = Number(/\/issues\/(\d+)/.exec(r.stdout)?.[1]);
        if (!n) throw new Error(`gh made the issue but didn't say its number: ${r.stdout.trim().slice(0, 200)}`);
        job.issue = n;
      } finally {
        rmSync(tmp, { force: true });
      }
      return { status: 'done', detail: `#${job.issue}` };
    },

    async team(job, io) {
      // After the push: a hire's worktree comes fresh from GitHub, so it starts on the scaffold and the app.
      // After an edit (job.addRoles): only the roles ticked since, and never one the floor has had in any
      // state (at work, benched, or sent home on purpose), so an edit doesn't undo the Team tab's choices.
      const adding = job.addRoles;
      // The team's shape first (who covers which team), then the budget level, so every hire below is on its level's models and settings.
      if (!adding && job.floor && deps.setShape) deps.setShape(job.floor, job.plan.shape ?? shapeForRoles(job.plan.roles), job.by);
      // The Budget step first, so every hire below is on its level's models and settings.
      if (!adding && job.plan.budget && job.floor && deps.applyBudget && !job.budgetApplied) {
        const problems = deps.applyBudget(job.floor, job.plan.budget, job.by);
        io.log(`  budget: ${job.plan.budget.level}, $${job.plan.budget.total}${problems.length ? ` (${problems.join('; ')})` : ''}`);
        job.budgetApplied = true;
      }
      const roles = PROJECT_ROLES.filter((r) => job.plan.roles.includes(r.id) && (!adding || adding.includes(r.id)));
      if (!roles.length) return { status: 'skipped', detail: adding ? 'no roles added' : 'no roles ticked' };
      if (cfg.offlineDir) return { status: 'skipped', detail: 'offline test office: nobody is hired' };
      if (!job.floor) throw new Error("The project's floor isn't there yet");
      const floor = job.floor;
      // The Discovery issue went to the queue (or the Chief Analyst) when the setup first ran: an edit doesn't hand it out again.
      const handOff = !adding && handsDiscoveryToAnalyst(job);
      const model = job.plan.discovery.model;
      const made: string[] = [];
      const had: string[] = [];
      for (const r of roles) {
        if (adding ? deps.known(floor, r.id) : deps.hired(floor, r.id)) {
          had.push(r.label);
          continue;
        }
        const task = handOff && r.id === discoveryRole(job) ? discoveryPrompt(job.issue!) : undefined;
        io.log(`  hiring the ${r.label}${task ? `, with Discovery #${job.issue} on ${model}` : ''}…`);
        const err = await deps.hire(floor, r.id, job.by, job.account, task, task ? model : undefined);
        if (err) throw new Error(`Couldn't hire the ${r.label}: ${err}${made.length ? ` (hired so far: ${made.join(', ')})` : ''}`);
        if (task) job.discoveryHired = true;
        made.push(r.label);
      }
      if (adding) job.addRoles = [];
      if (!made.length) return { status: 'skipped', detail: `${adding ? 'already on the floor' : 'already hired'}: ${had.join(', ')}` };
      return { status: 'done', detail: `hired ${made.join(', ')}${had.length ? `; ${adding ? 'already on the floor' : 'already there'}: ${had.join(', ')}` : ''}` };
    },

    async queue(job) {
      if (!job.plan.discovery.queue) return { status: 'skipped', detail: 'not asked for' };
      if (!job.issue) return { status: 'skipped', detail: 'no Discovery issue to queue' };
      if (cfg.offlineDir) return { status: 'skipped', detail: 'offline test office: no agent is queued' };
      if (job.discoveryHired) return { status: 'skipped', detail: `#${job.issue} went to the Chief Analyst when it was hired` };
      if (!job.floor) throw new Error("The project's floor isn't there yet");
      const err = deps.queue(job.floor, discoveryPrompt(job.issue), `Discovery #${job.issue} (${job.plan.discovery.model})`, job.issue, job.plan.discovery.model, job.by, job.account);
      if (err && !/already on the queue/i.test(err)) throw new Error(err);
      return { status: err ? 'skipped' : 'done', detail: err ?? `#${job.issue} on ${job.plan.discovery.model}` };
    },
  };
}

/** Who works the Discovery issue: whoever covers Analysis on the plan's shape (the Chief Analyst, or the Solo Lead). */
export const discoveryRole = (job: Pick<JobState, 'plan'>): ProjectRole => SHAPES[job.plan.shape ?? shapeForRoles(job.plan.roles)].coverage.analysis as ProjectRole;

/** The Discovery issue goes to whoever covers Analysis as its first task, rather than to a worker off the queue: asked to be queued, and that member is on the team. */
export const handsDiscoveryToAnalyst = (job: JobState) => job.plan.discovery.queue && !!job.issue && job.plan.roles.includes(discoveryRole(job));

/**
 * Intake Q9's answer: the question asks "attended or unattended", the register's `Interview mode:` line
 * holds the toolkit's word for it (interview-mode.sh reads steering, assist or auto), so it says both.
 */
export function interviewAnswer(mode: JobState['plan']['interview']): string {
  const info = INTERVIEW_MODE_INFO[mode];
  return `${info.q9} — Interview mode: ${mode} (${info.does}).${mode === 'auto' ? ' Chosen explicitly in the agent-office new-project wizard.' : ''}`;
}

/** The intake answers to write: the wizard's form, plus the three it decides itself (entry mode, interview mode, exec approval). */
export function intakeAnswersOf(job: JobState): IntakeAnswer[] {
  const p = job.plan;
  const own = p.intake.filter((a) => ![1, 9, 11].includes(a.n));
  const token = ENTRY_MODE_INFO[p.entry].token;
  return [
    ...(token ? [{ n: 1, kind: 'answered' as const, text: token }] : []),
    ...own,
    { n: 9, kind: 'answered', text: interviewAnswer(p.interview) },
    { n: 11, kind: 'answered', text: p.execApproval },
  ];
}

/** The kickoff decisions: flat lines gate-check reads, and the rows the Decisions table shows. */
export function decisionsOf(job: JobState) {
  const p = job.plan;
  const info = ENTRY_MODE_INFO[p.entry];
  const when = `CONFIRMED ${today()}`;
  const by = `Chosen by ${job.by} in the agent-office new-project wizard`;
  const tier = p.tier === 'small' ? `small — declared at kickoff; Stage 0's inventory confirms the counts (at most ${SMALL_TIER_LIMITS})` : 'standard';
  const flat: [string, string][] = [
    ...(info.token ? [['Entry mode', info.token] as [string, string]] : []),
    ['Size tier', tier],
    ['Mendix version', p.mendix],
    ['Interview mode', p.interview],
    ['Exec approval', p.execApproval],
  ];
  const rows = [
    { stage: 'P', decision: `Entry mode: ${info.label}`, status: when, notes: `${by}; stages that run: ${info.stages}` },
    { stage: 'P', decision: `Size tier: ${p.tier}`, status: when, notes: p.tier === 'small' ? `${by}; small-project-tier.md applies (at most ${SMALL_TIER_LIMITS}), counts confirmed at Stage 0` : by },
    { stage: 'P', decision: `Mendix version: ${p.mendix}`, status: when, notes: `${by}; Studio Pro on the office machine` },
    { stage: 'P', decision: `Interview mode: ${p.interview}`, status: when, notes: `${by}; ${INTERVIEW_MODE_INFO[p.interview].q9}: ${INTERVIEW_MODE_INFO[p.interview].does}` },
  ];
  return { flat, rows };
}
