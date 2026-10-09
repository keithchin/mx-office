// Update toolkit, as two jobs a floor runs one at a time:
//   preview — the project's default branch checked out twice in temporary worktrees, the toolkit's
//             gate-check run over one from the commit the project is on and over the other from the new
//             commit (read-only: nothing in the project or its folder is written), the stage verdicts
//             compared, and the commits between listed;
//   apply   — the pin moved: in a temporary worktree of the default branch, the instruction files pointed
//             at the new pin (instructions.ts), the scripts the toolkit copied in and nobody edited brought
//             up to the new commit, the toolkit's own sync-project.sh run, PROJECT.md's Toolkit commit line
//             and agent-office.project.json's record moved, one commit `chore(toolkit): update to <sha>`
//             pushed to the default branch (or as a branch when it can't be), the book and the audit log
//             told. Roll back is an apply to the previous commit.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { short, stageWarning, verdictDiff, type ToolkitJobView, type StageVerdict } from '../../shared/toolkit.js';
import { stageVerdicts } from '../summary/project.js';
import { branchInfo } from '../wizard/gate-source.js';
import { GATE_PREFIX } from '../worktree-sweep/sweep.js';
import { blobId } from './detect.js';
import { git, gitRun, isAncestor, revParse } from './git.js';
import { bashForm, pinInstructions } from './instructions.js';
import { commitInfo, commitsIn, ensurePin, prunePins } from './pins.js';
import { nextRecord, PROJECT_FILE, recordOf, withAck, withRecord } from './record.js';
import type { PinFloor, ToolkitService } from './service.js';

const LOG_MAX = 200;
const GATE_TIMEOUT_MS = 6 * 60_000;

export interface JobDeps {
  /** Runs the toolkit's gate-check from `toolkit` over `worktree` (a checkout of the floor at `floorDir`). */
  gateCheck(toolkit: string, worktree: string, floorDir: string): Promise<string | void>;
  /** Runs the toolkit's sync-project.sh from `toolkit` over `dir`, each line to `log`. */
  sync(toolkit: string, dir: string, floorDir: string, log: (line: string) => void): Promise<void>;
  /** The floor's current stage as the setup panel has it (for the mid-stage warning). */
  current?(floor: PinFloor): Promise<{ id: string; title?: string; status: string } | undefined>;
  /** After the pin moved: the setup panel and Playbooks catch up, and the audit log hears of it. */
  moved?(floor: PinFloor, job: ToolkitJobView, by: { name: string; id?: string }): void;
}

type Job = ToolkitJobView & { by: { name: string; id?: string }; floorDir: string };

export class ToolkitJobs {
  private jobs = new Map<string, Job>();
  private running = new Map<string, string>();
  private seq = 0;

  constructor(
    private svc: ToolkitService,
    private deps: JobDeps,
  ) {}

  get(id: string): ToolkitJobView | undefined {
    const j = this.jobs.get(id);
    return j && view(j);
  }

  /** The job running for a floor now. */
  runningFor(floor: string): ToolkitJobView | undefined {
    const id = this.running.get(floor);
    return id ? this.get(id) : undefined;
  }

  /** Whether a job of this floor (whose checkout is `dir`) has temporary worktrees out now (the worktree sweep leaves them). */
  busyDir(dir: string): boolean {
    return [...this.running.values()].some((id) => path.resolve(this.jobs.get(id)?.floorDir ?? '').toLowerCase() === path.resolve(dir).toLowerCase());
  }

  /** Starts a preview of moving `floor` to `to` (a sha, or 'latest'/'previous'). The job, or why not. */
  async preview(floor: PinFloor, to: string, by: { name: string; id?: string }): Promise<ToolkitJobView | string> {
    return this.start('preview', floor, to, by);
  }

  /** Moves the pin. The job, or why not. */
  async apply(floor: PinFloor, to: string, by: { name: string; id?: string }): Promise<ToolkitJobView | string> {
    return this.start('apply', floor, to, by);
  }

  private async start(kind: Job['kind'], floor: PinFloor, want: string, by: Job['by']): Promise<ToolkitJobView | string> {
    if (this.running.has(floor.id)) return 'A toolkit preview or update is already running for this project: wait for it to finish';
    const root = this.svc.root;
    const pin = await this.svc.pinOf(floor);
    const status = await this.svc.status(floor);
    if (!status.git) return status.problems[0] ?? "The toolkit folder isn't a git clone";
    const from = pin?.commit ?? status.commit?.sha;
    const target = want === 'latest' ? (await this.svc.latest(root))?.sha : want === 'previous' ? pin?.previous : want === 'current' ? from : want;
    const to = target && (await revParse(root, target));
    if (!to) return want === 'previous' ? 'There is no previous toolkit commit to roll back to' : `The toolkit clone hasn't got ${want}`;
    // Back to the previous pin, or to any commit the current one already has, is a roll back.
    const back = !!pin && (want === 'previous' || to === pin.previous || (to !== pin.commit && (await isAncestor(root, to, pin.commit))));
    const action: Job['action'] = !pin ? 'pin' : back ? 'rollback' : 'update';
    if (pin && to === pin.commit) return `The project is already pinned to ${short(to)}`;
    const id = `tk${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    const job: Job = { id, kind, floor: floor.id, floorDir: floor.dir, from, to, action, status: 'running', startedAt: Date.now(), log: [], by };
    this.jobs.set(id, job);
    this.running.set(floor.id, id);
    // Only the latest few jobs are kept.
    for (const old of [...this.jobs.keys()].slice(0, Math.max(0, this.jobs.size - 20))) if (![...this.running.values()].includes(old)) this.jobs.delete(old);
    const run = kind === 'preview' ? this.runPreview(job, floor, !!pin) : this.runApply(job, floor);
    void run
      .then(() => {
        job.status = kind === 'preview' ? 'ready' : 'done';
      })
      .catch((err: Error) => {
        job.status = 'failed';
        job.error = err.message;
        say(job, `✗ ${err.message}`);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.running.delete(floor.id);
        this.svc.invalidate(floor.id);
      });
    return view(job);
  }

  private async runPreview(job: Job, floor: PinFloor, pinned: boolean) {
    const root = this.svc.root;
    say(job, `Making the pin of ${short(job.to)}…`);
    const after = await ensurePin(root, job.to);
    // What the project runs now: its pin, else (not pinned yet) the shared clone as it is.
    const before = pinned && job.from ? await ensurePin(root, job.from) : root;
    const info = await branchInfo(floor.dir);
    const base = info?.sha ?? (await revParse(floor.dir, 'HEAD'));
    if (!base) throw new Error("The project's checkout has no commit to check");
    say(job, `Checking the gates of ${info ? `origin/${info.def}` : 'the checkout'} (${short(base)}) with the toolkit the project runs now${pinned ? ` (${short(job.from)})` : ' (the shared clone)'}…`);
    job.before = await this.gatesOn(before, floor, base);
    say(job, `…${job.before.length} stage verdicts. Now with ${short(job.to)}…`);
    // The new toolkit over the project as the update would leave it: the same preparation as Confirm (the
    // instruction files, the copied scripts, the toolkit's sync-project.sh), only in the temporary checkout.
    job.after = await this.gatesOn(after, floor, base, (tmp) => this.prepare(job, floor, tmp, after));
    job.changes = verdictDiff(job.before, job.after);
    say(job, `…${job.changes.length ? `${job.changes.length} stage verdict${job.changes.length === 1 ? '' : 's'} would change` : 'no stage verdict would change'}.`);
    job.commits = job.from ? [...(await commitsIn(root, `${job.from}..${job.to}`, 100)), ...(await commitsIn(root, `${job.to}..${job.from}`, 100)).map((c) => ({ ...c, subject: `(taken out) ${c.subject}` }))] : await commitsIn(root, job.to, 20);
    job.stageWarning = stageWarning(await this.deps.current?.(floor).catch(() => undefined));
  }

  /** gate-check from `toolkit` over a temporary detached worktree of `base` in the floor's repository; the verdicts it rendered. */
  private async gatesOn(toolkit: string, floor: PinFloor, base: string, prepare?: (tmp: string) => Promise<void>): Promise<StageVerdict[]> {
    const tmp = await mkdtemp(path.join(os.tmpdir(), GATE_PREFIX));
    try {
      const made = await gitRun(['worktree', 'add', '--detach', '--force', tmp, base], floor.dir, 120_000);
      if (!made.ok) throw new Error(`couldn't check out ${short(base)}: ${made.err.slice(0, 200)}`);
      // A committed dashboard gate-check didn't write itself is never overwritten by it (it refuses), and a stale one
      // read twice would show no change: it goes, so what's read is what this run rendered.
      await rm(path.join(tmp, 'index.html'), { force: true });
      await prepare?.(tmp);
      let said: string | void = undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('gate-check took too long')), GATE_TIMEOUT_MS)));
      try {
        said = await Promise.race([this.deps.gateCheck(toolkit, tmp, floor.dir), late]);
      } finally {
        clearTimeout(timer);
      }
      const html = await readFile(path.join(tmp, 'index.html'), 'utf8').catch(() => '');
      const verdicts = html ? stageVerdicts(html) : verdictsFromOutput(said ?? '');
      if (!verdicts.length) throw new Error(`gate-check from ${path.basename(toolkit)} gave no stage verdicts (no dashboard, nothing in its output)`);
      // The temporary checkout's path in a reason reads as the project's own file.
      const here = [`${bashForm(tmp)}/`, `${tmp}${path.sep}`, `${tmp.replace(/\\/g, '/')}/`];
      return verdicts.map((v) => (v.detail ? { ...v, detail: here.reduce((d, x) => d.split(x).join(''), v.detail) } : v));
    } finally {
      await gitRun(['worktree', 'remove', '--force', '--force', tmp], floor.dir, 60_000);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      await gitRun(['worktree', 'prune'], floor.dir);
    }
  }

  /**
   * The checkout at `tmp` made what the update leaves: the scripts the toolkit copied in and nobody edited brought
   * up to the new commit, the instruction files pointed at the pin (the ritual's pull out), the toolkit's own
   * sync-project.sh run from the pin, and PROJECT.md's Toolkit commit line moved.
   */
  private async prepare(job: Job, floor: PinFloor, tmp: string, pin: string) {
    const root = this.svc.root;
    const { date } = await commitInfo(root, job.to);
    if (job.from) for (const f of await upgradeCopies(root, job.from, job.to, tmp)) say(job, `Brought bin/${f} up to ${short(job.to)} (the project hadn't changed it)`);
    const names = [path.basename(path.resolve(root))];
    for (const f of pinInstructions(tmp, { pin, sha: job.to, date, names })) say(job, `Pointed ${f} at the pin`);
    say(job, `Running the toolkit's sync-project.sh from ${short(job.to)}…`);
    await this.deps.sync(pin, tmp, floor.dir, (l) => say(job, `  ${l}`)).catch((err: Error) => say(job, `  sync-project.sh: ${err.message} (carrying on)`));
    // The sync can write the ritual again (with the pin's path): its pull goes again too.
    pinInstructions(tmp, { pin, sha: job.to, date, names });
    const reg = path.join(tmp, 'PROJECT.md');
    if (existsSync(reg)) writeFileSync(reg, withAck(readFileSync(reg, 'utf8'), job.to));
  }

  private async runApply(job: Job, floor: PinFloor) {
    const root = this.svc.root;
    say(job, `Making the pin of ${short(job.to)}…`);
    const pin = await ensurePin(root, job.to);
    const info = await branchInfo(floor.dir);
    const base = info?.sha ?? (await revParse(floor.dir, 'HEAD'));
    if (!base) throw new Error("The project's checkout has no commit to build on");
    const branch = `agent-office/toolkit-${short(job.to)}-${Date.now().toString(36)}`;
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ao-tkup-'));
    let keepBranch = false;
    try {
      const made = await gitRun(['worktree', 'add', '-b', branch, tmp, base], floor.dir, 120_000);
      if (!made.ok) throw new Error(`couldn't check out ${short(base)}: ${made.err.slice(0, 200)}`);
      const { date } = await commitInfo(root, job.to);
      await this.prepare(job, floor, tmp, pin);
      const pf = path.join(tmp, PROJECT_FILE);
      const text = existsSync(pf) ? readFileSync(pf, 'utf8') : undefined;
      const repo = await git(['remote', 'get-url', 'origin'], root);
      writeFileSync(pf, withRecord(text, nextRecord(recordOf(text), job.to, job.by.name, job.action, repo)));
      await gitRun(['-c', 'core.safecrlf=false', 'add', '-A'], tmp, 120_000);
      const verb = job.action === 'rollback' ? 'roll back to' : job.action === 'pin' ? 'pin to' : 'update to';
      const list = (job.commits ?? (job.from ? await commitsIn(root, `${job.from}..${job.to}`, 20) : [])).slice(0, 20).map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`);
      const body = [`Toolkit ${job.from ? `${short(job.from)} → ` : ''}${short(job.to)}${date ? ` (${date})` : ''}, by ${job.by.name} with Agent Office's Update toolkit.`, ...(list.length ? ['', ...list] : [])].join('\n');
      const who = (await git(['config', 'user.email'], tmp)) ? [] : ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost'];
      const c = await gitRun([...who, '-c', 'core.safecrlf=false', 'commit', '-q', '-m', `chore(toolkit): ${verb} ${short(job.to)}`, '-m', body], tmp, 10 * 60_000);
      if (!c.ok) throw new Error(`the commit failed: ${c.err.slice(0, 300)}`);
      job.commit = await git(['rev-parse', 'HEAD'], tmp);
      say(job, `Committed ${short(job.commit)} chore(toolkit): ${verb} ${short(job.to)}`);
      if (info) {
        const r = await gitRun(['push', '-q', 'origin', `HEAD:refs/heads/${info.def}`], tmp, 5 * 60_000);
        if (r.ok) job.pushed = info.def;
        else {
          say(job, `Couldn't push to ${info.def} (${r.err.slice(0, 160)}): pushing the branch instead`);
          const b = await gitRun(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], tmp, 5 * 60_000);
          if (!b.ok) throw new Error(`couldn't push the update: ${b.err.slice(0, 200)}`);
          job.pushed = branch;
        }
      } else {
        keepBranch = true;
        job.pushed = `local branch ${branch}`;
      }
      say(job, `Pushed to ${job.pushed}${job.pushed === branch ? ': open a pull request for it' : ''}.`);
      this.svc.setPin(floor, job.to, job.from);
      writeToolkitEnv(floor.dir, pin);
      this.deps.moved?.(floor, view(job), job.by);
      const keep = this.svc.book.all().flatMap((e) => [e.commit, ...(e.previous ? [e.previous] : [])]);
      const gone = await prunePins(root, keep).catch(() => []);
      if (gone.length) say(job, `Removed ${gone.length} toolkit pin${gone.length === 1 ? '' : 's'} no project uses any more`);
    } finally {
      await gitRun(['worktree', 'remove', '--force', '--force', tmp], floor.dir, 60_000);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      await gitRun(['worktree', 'prune'], floor.dir);
      if (!keepBranch) await gitRun(['branch', '-D', branch], floor.dir);
    }
  }
}

/** gate-check's summary lines (`Stage 2 (Requirements): FAIL · …`), for a run that didn't render its dashboard. */
export function verdictsFromOutput(text: string): StageVerdict[] {
  const out: StageVerdict[] = [];
  for (const m of text.matchAll(/^Stage (\w+) \(([^)]+)\): (PASS|FAIL|PENDING|WAIVED|MANUAL)\b(?: · (.*))?$/gm)) {
    if (!out.some((v) => v.id === m[1])) out.push({ id: m[1], title: m[2], status: m[3], detail: m[4]?.replace(/^Surface (MISSING: [^—]*— |present[^—]*— )/, '').slice(0, 240) });
  }
  return out;
}

const say = (job: Job, line: string) => {
  job.log.push(line);
  if (job.log.length > LOG_MAX) job.log.splice(0, job.log.length - LOG_MAX);
};

const view = (j: Job): ToolkitJobView => {
  const { by: _by, floorDir: _dir, ...rest } = j;
  return { ...rest, log: [...j.log] };
};

/**
 * The scripts the toolkit copied into the project's bin/ (from its project-bin/) that the project never
 * changed (each still byte-for-byte the `from` commit's version) are brought up to `to`'s. Edited ones are
 * left for sync-project.sh to report. Returns the names brought up.
 */
export async function upgradeCopies(root: string, from: string, to: string, dir: string): Promise<string[]> {
  const list = await git(['ls-tree', '--name-only', `${to}:project-bin`], root);
  const out: string[] = [];
  for (const name of list?.split('\n').filter(Boolean) ?? []) {
    const f = path.join(dir, 'bin', name);
    if (!existsSync(f)) continue;
    const [was, now] = await Promise.all([git(['rev-parse', '-q', '--verify', `${from}:project-bin/${name}`], root), git(['rev-parse', '-q', '--verify', `${to}:project-bin/${name}`], root)]);
    if (!was || !now || was === now) continue;
    const buf = readFileSync(f);
    const mine = blobId(buf) === was || blobId(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')) === was;
    if (!mine) continue;
    const r = await gitRun(['cat-file', 'blob', now], root);
    if (!r.ok) continue;
    writeFileSync(f, r.out);
    out.push(name);
  }
  return out;
}

/** MXTK_ROOT in the floor's machine-local toolkit.env, so the toolkit's own scripts and the workers resolve the pin (git-ignored, never committed). */
export function writeToolkitEnv(floorDir: string, pin: string) {
  const f = path.join(floorDir, '.claude', 'toolkit.env');
  if (!existsSync(f)) return;
  const line = `MXTK_ROOT=${path.resolve(pin).replace(/\\/g, '/')}`;
  const lines = readFileSync(f, 'utf8').replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const i = lines.findIndex((l) => /^\s*(export\s+)?MXTK_ROOT=/.test(l));
  if (i >= 0) lines[i] = line;
  else lines.push('# The project\'s pinned toolkit (Agent Office › Update toolkit).', line);
  writeFileSync(f, `${lines.join('\n')}\n`);
}
