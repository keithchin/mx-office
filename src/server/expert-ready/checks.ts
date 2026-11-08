// The readiness check of a folder (shared/expert-ready.ts): nine looks, run at once, each with its own time
// limit, each giving one row. Read-only by construction: files are read with fs/promises, git runs with
// GIT_OPTIONAL_LOCKS=0 (so even `git status` doesn't refresh the index) and only commands that read, the .mpr is
// read from a temporary copy (./model.ts), and mxcli is asked only for its version, from outside the folder.
// Everything about the office (the toolkit clone, Studio Pro installs, the budget, Team Server) comes in as
// deps, so the wizard can reuse the checks and tests run them on temporary folders. Remote URLs are never put in
// a row: a remote is only named and called Team Server, GitHub, on this machine or elsewhere.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { READY_LABELS, READY_ORDER, type ReadyCheck, type ReadyId, type ReadyReport, type ReadyState, type ReadyWishes } from '../../shared/expert-ready.js';
import { readTestFile } from '../../shared/testing/test-files.js';
import { TEAMSERVER_REMOTE } from '../../shared/team-server.js';
import { LINT_BASELINE } from '../../shared/review-gate.js';
import { ackOf, recordOf, PROJECT_FILE } from '../toolkit-pin/record.js';
import type { ModelLook } from './model.js';

/** Each look gives up after this long (a row saying so). */
export const CHECK_MS = 20_000;

export interface ReadyGit {
  /** git `args` in `dir`, read-only; trimmed output, or undefined when it failed. */
  (args: string[], dir: string): Promise<string | undefined>;
}

export interface ReadyDeps {
  git: ReadyGit;
  /** The model's version, size and demo users (./model.ts lookAtModel). */
  model(mpr: string): Promise<ModelLook>;
  /** The toolkit commit an unpinned folder seems to be on (toolkit-pin/detect.ts), full sha when the clone knows it. */
  toolkitCommit?(dir: string, register: string | undefined): Promise<{ sha: string; how: string } | undefined>;
  /** mxcli for the folder: the project's own copy, else PATH, else the office's; and its version when it may be asked. */
  mxcli(dir: string): Promise<{ bin: string; from: 'project' | 'path' | 'office'; version?: string } | undefined>;
  /** Studio Pro versions installed on this machine. */
  studioVersions(): string[];
  /** The budget of the project already attached to this folder, if any. */
  budget(dir: string): { total?: number } | undefined;
  /** What was asked for this folder before (wishes and a budget to set on attach). */
  wishes(dir: string): ReadyWishes;
  /** Whether fixes that call Team Server can run (a Mendix account in Settings). */
  mendixAccount(): boolean;
  /** The Expert project attached to this folder, if any. */
  attachedTo?(dir: string): string | undefined;
  now?: () => number;
  timeoutMs?: number;
}

const row = (id: ReadyId, state: ReadyState, line: string, more: Partial<ReadyCheck> = {}): ReadyCheck => ({ id, label: READY_LABELS[id], state, line, ...more });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function readText(f: string): Promise<string | undefined> {
  return readFile(f, 'utf8').catch(() => undefined);
}

async function entries(d: string): Promise<{ name: string; dir: boolean }[]> {
  try {
    return (await readdir(d, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch {
    return [];
  }
}

/** Files under `d` (not into skipped folders), at most `max`, `depth` levels down. */
async function walk(d: string, keep: (name: string) => boolean, depth = 6, max = 5000, skip = new Set(['node_modules', '.git', 'artifacts', '.mxcli'])): Promise<string[]> {
  const out: string[] = [];
  const go = async (dir: string, level: number) => {
    for (const e of await entries(dir)) {
      if (out.length >= max) return;
      const full = path.join(dir, e.name);
      if (e.dir) {
        if (level < depth && !skip.has(e.name)) await go(full, level + 1);
      } else if (keep(e.name)) out.push(full);
    }
  };
  await go(d, 0);
  return out;
}

/** The project's .mpr: at the top, else one folder down. */
export async function mprOf(dir: string): Promise<string | undefined> {
  const top = await entries(dir);
  const here = top.find((e) => !e.dir && /\.mpr$/i.test(e.name));
  if (here) return path.join(dir, here.name);
  for (const e of top) {
    if (!e.dir || e.name.startsWith('.') || ['node_modules', 'deployment', 'theme', 'javasource', 'javascriptsource', 'widgets'].includes(e.name)) continue;
    const sub = (await entries(path.join(dir, e.name))).find((x) => !x.dir && /\.mpr$/i.test(x.name));
    if (sub) return path.join(dir, e.name, sub.name);
  }
  return undefined;
}

// ---- The looks ----------------------------------------------------------------------------------

/**
 * The toolkit commit the folder is on: PROJECT.md's own `Toolkit commit:` line wins (full sha when the office's
 * clone knows it, else as written), then the office's estimate from the copied scripts (toolkit-pin/detect.ts).
 */
export async function toolkitCommitOf(dir: string, register: string | undefined, deps: Pick<ReadyDeps, 'toolkitCommit'>): Promise<{ sha: string; how: string } | undefined> {
  const ack = ackOf(register)?.toLowerCase();
  const found = await deps.toolkitCommit?.(dir, register).catch(() => undefined);
  if (ack && !found?.sha.toLowerCase().startsWith(ack)) return { sha: ack, how: 'PROJECT.md' };
  return found;
}

export async function checkToolkit(dir: string, deps: Pick<ReadyDeps, 'toolkitCommit'>): Promise<ReadyCheck> {
  const [skills, agents, bin, register, project] = await Promise.all([
    entries(path.join(dir, '.claude', 'skills')),
    entries(path.join(dir, '.claude', 'agents')),
    entries(path.join(dir, 'bin')),
    readText(path.join(dir, 'PROJECT.md')),
    readText(path.join(dir, PROJECT_FILE)),
  ]);
  const nSkills = skills.filter((e) => e.dir).length;
  const nAgents = agents.filter((e) => !e.dir && /\.md$/i.test(e.name)).length;
  const nScripts = bin.filter((e) => !e.dir).length;
  const ack = ackOf(register);
  const present = nSkills > 0 || !!ack || bin.some((e) => e.name === '_common.sh');
  if (!present) return row('toolkit', 'error', 'Not found', { detail: 'No toolkit skills, scripts or PROJECT.md toolkit line here. The session will run without the toolkit.' });
  const counts = `${plural(nSkills, 'skill')}, ${plural(nAgents, 'subagent')}, ${plural(nScripts, 'project script')}.`;
  const rec = recordOf(project);
  if (rec) return row('toolkit', 'ok', `Present · pinned to ${rec.commit.slice(0, 7)}`, { detail: counts });
  const found = await toolkitCommitOf(dir, register, deps);
  if (!found) return row('toolkit', 'warn', 'Present · commit unknown', { detail: `${counts} Not pinned: a toolkit update would change this project.` });
  const short = found.sha.slice(0, 7);
  return row('toolkit', 'warn', `Present · commit ${short}`, {
    detail: `${counts} Not pinned: a toolkit update would change this project.`,
    fix: { id: 'pin-toolkit', label: `Pin ${short}`, says: `Writes the pin (toolkit commit ${short}) into ${PROJECT_FILE}. Nothing else changes.` },
  });
}

export async function checkMxcli(dir: string, deps: Pick<ReadyDeps, 'mxcli'>): Promise<ReadyCheck> {
  const m = await deps.mxcli(dir);
  if (!m) return row('mxcli', 'error', 'Not found', { detail: 'No mxcli in the folder, on the PATH or in Settings › Folders. The session needs it to change the model.' });
  const v = m.version ? ` · ${m.version}` : '';
  const where = { project: 'Found in project', path: 'Found on the PATH', office: 'The office’s copy' }[m.from];
  const detail = { project: 'The copy in the folder is the one the session uses.', path: 'No copy in the folder: the session uses the one on the PATH.', office: 'No copy in the folder or on the PATH: the office’s mxcli is used.' }[m.from];
  return row('mxcli', 'ok', `${where}${v}`, { detail });
}

export function checkMendix(look: ModelLook | undefined, mpr: string | undefined, installed: string[]): ReadyCheck {
  if (!mpr) return row('mendix', 'error', 'No .mpr file in the folder', { detail: 'This doesn’t look like a Mendix app folder.' });
  const v = look?.version;
  if (!v) return row('mendix', 'warn', 'Version unknown', { detail: look?.problem ?? 'The .mpr didn’t say which Studio Pro saved it.' });
  if (installed.includes(v)) return row('mendix', 'ok', `${v} · Studio Pro ${v} installed`);
  const minor = v.split('.').slice(0, 2).join('.');
  const near = installed.filter((x) => x.startsWith(`${minor}.`));
  if (near.length) return row('mendix', 'warn', `${v} · Studio Pro ${v} not installed`, { detail: `Studio Pro ${near[0]} is installed. Install ${v} to open the app in Studio Pro.` });
  return row('mendix', 'warn', `${v} · Studio Pro ${v} not installed`, { detail: installed.length ? `Installed: ${installed.slice(0, 3).join(', ')}.` : 'No Studio Pro found on this machine. Builds still run through mxcli.' });
}

export interface GitLook {
  repo: boolean;
  branch?: string;
  remotes: { name: string; kind: 'teamserver' | 'github' | 'local' | 'other' }[];
}

/** What kind of place a remote URL is (the URL itself is never kept). */
export function remoteKind(url: string): GitLook['remotes'][number]['kind'] {
  const u = url.toLowerCase();
  if (/git\.api\.mendix\.com|teamserver\.sprintr\.com|mendix\.com\//.test(u)) return 'teamserver';
  if (/github\.com[/:]/.test(u)) return 'github';
  if (/^file:\/\//.test(u) || /^[a-z]:[\\/]/.test(u) || u.startsWith('/') || u.startsWith('.') || u.startsWith('\\\\')) return 'local';
  return 'other';
}

export async function checkGit(dir: string, deps: Pick<ReadyDeps, 'git'>): Promise<{ check: ReadyCheck; look: GitLook }> {
  const top = await deps.git(['rev-parse', '--show-toplevel'], dir);
  if (!top) return { check: row('git', 'error', 'No git repository', { detail: 'Background proof (commits, push, tests at a commit) needs git. Ask the session to run git init after attaching.' }), look: { repo: false, remotes: [] } };
  const [branch, count, status, last, remotes] = await Promise.all([
    deps.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir),
    deps.git(['rev-list', '--count', 'HEAD'], dir),
    deps.git(['status', '--porcelain', '--untracked-files=no'], dir),
    deps.git(['log', '-1', '--format=%cs%x1f%s'], dir),
    deps.git(['remote', '-v'], dir),
  ]);
  const seen = new Map<string, GitLook['remotes'][number]['kind']>();
  for (const l of (remotes ?? '').split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)/.exec(l.trim());
    if (m && !seen.has(m[1])) seen.set(m[1], remoteKind(m[2]));
  }
  const look: GitLook = { repo: true, ...(branch ? { branch } : {}), remotes: [...seen].map(([name, kind]) => ({ name, kind })) };
  const n = Number(count ?? 0) || 0;
  const dirty = (status ?? '').split(/\r?\n/).filter((l) => l.trim()).length;
  const [day, ...subj] = (last ?? '').split('\x1f');
  const subject = subj.join(' ').trim();
  const line = `${plural(n, 'commit')} on ${branch && branch !== 'HEAD' ? branch : 'a detached HEAD'} · ${dirty ? `${plural(dirty, 'uncommitted change')}` : 'no uncommitted changes'}`;
  const detail = n ? `Last commit ${day}: “${subject.length > 70 ? `${subject.slice(0, 70)} …` : subject}”` : 'No commits yet.';
  const state: ReadyState = n === 0 ? 'warn' : 'ok';
  return { check: row('git', state, line, { detail: dirty ? `${detail} Uncommitted changes are carried onto the session branch.` : detail }), look };
}

export async function checkTeamServer(dir: string, git: GitLook, deps: Pick<ReadyDeps, 'mendixAccount'>): Promise<ReadyCheck> {
  let recorded = false;
  try {
    recorded = !!(JSON.parse((await readText(path.join(dir, PROJECT_FILE))) ?? '{}') as { teamServer?: unknown }).teamServer;
  } catch {
    // an unreadable project file: no record
  }
  const ts = git.remotes.find((r) => r.kind === 'teamserver' || r.name === TEAMSERVER_REMOTE);
  if (ts) return row('teamserver', 'ok', `Set · remote “${ts.name}”`, { detail: 'Auto-push of the session branch goes there.' });
  const others = git.remotes.map((r) => `${r.name} points to ${{ github: 'a GitHub repo', local: 'a folder on this machine', other: 'another server', teamserver: 'Team Server' }[r.kind]}`);
  const fix = {
    id: 'add-teamserver' as const,
    label: 'Add Team Server remote',
    says: `Adds a “${TEAMSERVER_REMOTE}” remote (a new or existing Mendix Portal app) and records it in ${PROJECT_FILE}. Existing remotes stay as they are.`,
    ...(!git.repo ? { off: 'Needs a git repository first' } : !deps.mendixAccount() ? { off: 'Add your Mendix account in Settings › Connections first' } : {}),
  };
  return row('teamserver', 'warn', `Not set${others.length ? ` · ${others.join(', ')}` : ''}`, {
    detail: recorded ? `${PROJECT_FILE} names a Team Server app, but the folder has no remote for it.` : `Auto-push goes to Team Server once it is added.${git.remotes.length ? ' Your other remotes stay as they are.' : ''}`,
    fix,
  });
}

export function checkDemo(look: ModelLook | undefined, wishes: ReadyWishes): ReadyCheck {
  const d = look?.demo;
  if (!d) return row('demo', 'warn', 'Unknown', { detail: look?.problem ?? 'The project security couldn’t be read.' });
  if (!d.on) return row('demo', 'ok', 'Off', { detail: 'Nothing blocks a Deploy.' });
  return row('demo', 'error', `On · ${plural(d.count, 'demo user')}`, {
    detail: 'Fine for local work. Blocks Deploy at Lock in until seed users replace them.',
    fix: { id: 'seed-users', label: 'Switch to seed users', says: 'A model change the session makes: the office notes it and you ask the session after attaching.' },
    ...(wishes.seedUsers ? { done: 'Noted. Ask the session after attaching.' } : {}),
  });
}

export async function checkTests(dir: string, wishes: ReadyWishes): Promise<ReadyCheck> {
  const [testFiles, journeys, e2e] = await Promise.all([
    walk(path.join(dir, 'tests'), (n) => /\.test\.(mdl|md)$/i.test(n)),
    walk(path.join(dir, 'journeys'), (n) => /\.journey\.json$/i.test(n) && !/^example\./i.test(n), 2),
    walk(path.join(dir, 'tests', 'e2e'), (n) => /\.(c|m)?(js|ts)$/i.test(n) && !/\.d\.ts$/i.test(n), 3),
  ]);
  let mf = 0;
  for (const f of testFiles) {
    const text = await readText(f);
    if (text) mf += readTestFile(path.relative(dir, f), text).tests.length;
  }
  const line = `${plural(mf, 'microflow test')} · ${plural(journeys.length, 'journey')} · ${plural(e2e.length, 'e2e script')}`;
  if (mf > 0) return row('tests', 'ok', line, { detail: `${plural(testFiles.length, 'test file')}. Affected tests run in the background when the session goes idle.` });
  return row('tests', 'warn', line, {
    detail: journeys.length || e2e.length ? 'Journeys run in the background. With no microflow tests, logic changes are only caught through the UI.' : 'No tests yet: changes are only checked by hand.',
    fix: { id: 'add-tests', label: 'Ask session to add', says: 'The office notes it and you ask the session after attaching. Nothing is written now.' },
    ...(wishes.addTests ? { done: 'Noted. Ask the session after attaching.' } : {}),
  });
}

export function checkBudget(set: { total?: number } | undefined, wishes: ReadyWishes): ReadyCheck {
  const fix = { id: 'set-budget' as const, label: 'Set budget', says: 'A total in US dollars for the project; the session pauses at 100 %.' };
  if (set?.total) return row('budget', 'ok', `$${set.total} total`, { detail: 'The session pauses at 100 % when auto-pause is on.' });
  if (wishes.budget) return row('budget', 'ok', `$${wishes.budget.total} total · set when you attach`, { detail: 'Auto-pause at 100 %.', fix: { ...fix, label: 'Change' } });
  return row('budget', 'warn', 'Not set', { detail: 'Spend is tracked from the first session; nothing pauses it.', fix });
}

export async function checkLint(dir: string): Promise<ReadyCheck> {
  const text = await readText(path.join(dir, ...LINT_BASELINE.split('/')));
  if (!text) return row('lint', 'warn', 'No baseline', { detail: `No ${LINT_BASELINE}: every existing finding would show as new. The toolkit's lint gate makes one (lint-gate.sh --update-baseline).` });
  try {
    const j = JSON.parse(text) as { total?: unknown; counts?: Record<string, unknown> };
    const counts = j.counts && typeof j.counts === 'object' ? j.counts : {};
    const total = typeof j.total === 'number' ? j.total : Object.values(counts).reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
    return row('lint', 'ok', `${plural(total, 'finding')} across ${plural(Object.keys(counts).length, 'rule')}`, {
      detail: 'Taken as the baseline. Only new findings are shown during sessions.',
    });
  } catch {
    return row('lint', 'warn', 'Baseline unreadable', { detail: `${LINT_BASELINE} isn't valid JSON.` });
  }
}

// ---- All of them --------------------------------------------------------------------------------

function limited<T>(p: Promise<T>, ms: number, late: () => T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((done) => (t = setTimeout(() => done(late()), ms)))]).finally(() => clearTimeout(t));
}

const tooLong = (id: ReadyId, ms: number) => row(id, 'warn', 'Took too long to check', { detail: `Gave up after ${Math.round(ms / 1000)} s. Check again.` });
const failed = (id: ReadyId) => (err: unknown) => row(id, 'warn', 'Could not check', { detail: String((err as Error)?.message ?? err).slice(0, 160) });

/** The whole check of `dir` (a folder that exists). Never throws, never writes to the folder. */
export async function checkFolder(dir: string, deps: ReadyDeps): Promise<ReadyReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const ms = deps.timeoutMs ?? CHECK_MS;
  const wishes = deps.wishes(dir);
  const mpr = await mprOf(dir);
  const model = mpr ? limited(deps.model(mpr), ms, () => ({ problem: 'Reading the model took too long' }) as ModelLook) : Promise.resolve(undefined);
  const gitP = limited(checkGit(dir, deps), ms, () => ({ check: tooLong('git', ms), look: { repo: false, remotes: [] } as GitLook })).catch((e) => ({ check: failed('git')(e), look: { repo: false, remotes: [] } as GitLook }));
  const run = (id: ReadyId, p: () => Promise<ReadyCheck>) => limited(p(), ms, () => tooLong(id, ms)).catch(failed(id));
  const rows = await Promise.all([
    run('toolkit', () => checkToolkit(dir, deps)),
    run('mxcli', () => checkMxcli(dir, deps)),
    run('mendix', async () => checkMendix(await model, mpr, deps.studioVersions())),
    gitP.then((g) => g.check),
    run('teamserver', async () => checkTeamServer(dir, (await gitP).look, deps)),
    run('demo', async () => checkDemo(await model, wishes)),
    run('tests', () => checkTests(dir, wishes)),
    run('budget', async () => checkBudget(deps.budget(dir), wishes)),
    run('lint', () => checkLint(dir)),
  ]);
  const checks = READY_ORDER.map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
  const look = await model;
  const attached = deps.attachedTo?.(dir);
  return {
    dir,
    ...(mpr ? { mpr: path.basename(mpr) } : {}),
    ...(look?.stats ? { stats: look.stats } : {}),
    checks,
    toLookAt: checks.filter((c) => c.state !== 'ok').length,
    blocksDeploy: checks.filter((c) => c.id === 'demo' && c.state === 'error').map(() => 'Demo users are on'),
    ...(attached ? { attached } : {}),
    checkedAt: now(),
    ms: now() - started,
  };
}

/** Whether `dir` is a folder (the check's precondition). */
export const isFolder = (dir: string) => stat(dir).then((s) => s.isDirectory(), () => false);
