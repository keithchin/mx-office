// Reading a company brain: is it one (README.md and ROUTING.md), is it its own git repository (its HEAD
// is the snapshot; otherwise "not versioned", allowed but labelled), and what its ROUTING.md routes to
// (each routed file's sha256 and size) and what it leaves out (candidates in inbox/, handoffs/,
// proposals/, patches/, routed files that are missing, and files nothing routes to). Never the text
// itself: the office keeps hashes, not brain content. git runs off the event loop (wizard/run.ts →
// offloop/exec.ts) and reads are async; each read is cached for a minute per brain, so a hire and the
// five-minute look share it.

import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../wizard/run.js';
import { EXCLUDED_DIRS, excludedDirOf, parseRouting, routingWarnings, windowsForm, type BrainRead, type ExcludedFile, type RoutedFile } from '../../shared/portfolios.js';

/** How long a read is reused. */
export const BRAIN_CACHE_MS = 60_000;
/** At most this many files are walked for "unrouted", and listed. */
const WALK_MAX = 2000;
const UNROUTED_MAX = 100;

/** git with no credentials and no network, quiet: only ever read-only commands on a local folder. */
export function quietGitEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file', GCM_INTERACTIVE: 'never' };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[k];
  return env;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const same = (a: string, b: string) => {
  const n = (p: string) => windowsForm(path.resolve(p)).replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

async function git(dir: string, args: string[]): Promise<string | undefined> {
  try {
    const r = await runCommand('git', ['-C', dir, ...args], { cwd: dir, env: quietGitEnv(), timeoutMs: 15_000, allowFail: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The brain's HEAD and whether it has changes, when it is a git repository of its own (not a folder inside another one). */
export async function brainVersion(dir: string): Promise<{ snapshot: string | null; dirty: boolean }> {
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  // Compared with links resolved: git names the top through them (on macOS /var/… is /private/var/…).
  if (!top || !same(await realpath(top).catch(() => top), await realpath(dir).catch(() => dir))) return { snapshot: null, dirty: false };
  const head = await git(dir, ['rev-parse', 'HEAD']);
  if (!head || !/^[0-9a-f]{40,64}$/.test(head)) return { snapshot: null, dirty: false };
  const status = await git(dir, ['status', '--porcelain']);
  return { snapshot: head, dirty: !!status };
}

/** Files under the brain that nothing routes to (markdown and the like), and one entry per conventionally excluded folder. */
async function unrouted(dir: string, routed: Set<string>): Promise<ExcludedFile[]> {
  const out: ExcludedFile[] = [];
  let walked = 0;
  const walk = async (rel: string): Promise<void> => {
    if (walked > WALK_MAX || out.length >= UNROUTED_MAX) return;
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++walked > WALK_MAX || out.length >= UNROUTED_MAX) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const why = !rel ? excludedDirOf(e.name) : undefined;
        if (why) out.push({ path: `${r}/`, reason: why });
        else await walk(r);
      } else if (e.isFile() && /\.(md|txt|mdl|json|ya?ml)$/i.test(e.name) && !routed.has(r) && r !== 'ROUTING.md' && r !== 'README.md') {
        out.push({ path: r, reason: 'unrouted' });
      }
    }
  };
  await walk('');
  return out;
}

const unavailable = (p: string, why: string, now: number): BrainRead => ({ path: windowsForm(p), status: 'unavailable', snapshot: null, dirty: false, routed: [], excluded: [], why, warnings: [], readAt: now });

/** Whether `dir` is a company brain: a folder with README.md and ROUTING.md. Why not, if it isn't. */
export async function brainProblem(dir: string): Promise<string | undefined> {
  if (!dir || !path.isAbsolute(dir)) return 'Give the full path to the company brain folder';
  const st = await stat(dir).catch(() => undefined);
  if (!st?.isDirectory()) return `No folder at ${windowsForm(dir)}`;
  for (const f of ['README.md', 'ROUTING.md']) {
    const s = await stat(path.join(dir, f)).catch(() => undefined);
    if (!s?.isFile()) return `Not a company brain: ${f} is missing (the toolkit's init-company-brain.sh makes one)`;
  }
  return undefined;
}

/** Reads the brain now (no cache). */
export async function readBrainNow(dir: string, now = Date.now()): Promise<BrainRead> {
  const bad = await brainProblem(dir);
  if (bad) return unavailable(dir, bad, now);
  let md: Buffer;
  try {
    md = await readFile(path.join(dir, 'ROUTING.md'));
  } catch (err) {
    return unavailable(dir, `ROUTING.md can't be read: ${(err as Error).message}`, now);
  }
  const { paths, rows } = parseRouting(md.toString('utf8'));
  const routed: RoutedFile[] = [];
  const excluded: ExcludedFile[] = [];
  for (const rel of paths) {
    const why = excludedDirOf(rel);
    if (why) {
      excluded.push({ path: rel, reason: why });
      continue;
    }
    const buf = await readFile(path.join(dir, ...rel.split('/'))).catch(() => undefined);
    if (!buf) excluded.push({ path: rel, reason: 'missing-file' });
    else routed.push({ path: rel, sha256: sha256(buf), bytes: buf.length });
  }
  const rest = await unrouted(dir, new Set(paths));
  for (const x of rest) if (!excluded.some((e) => e.path === x.path)) excluded.push(x);
  // Make sure every conventional exclusion is named even when the walk stopped early.
  for (const d of EXCLUDED_DIRS) {
    if (excluded.some((e) => e.path === `${d}/`)) continue;
    const s = await stat(path.join(dir, d)).catch(() => undefined);
    if (s?.isDirectory()) excluded.push({ path: `${d}/`, reason: d });
  }
  const v = await brainVersion(dir);
  return {
    path: windowsForm(dir),
    status: v.snapshot ? 'ok' : 'unversioned',
    snapshot: v.snapshot,
    dirty: v.dirty,
    routed,
    excluded,
    routing: { sha256: sha256(md), bytes: md.length, rows },
    warnings: routingWarnings(rows, md.length),
    readAt: now,
  };
}

/** The key a brain change is noticed by: HEAD when versioned, else a hash of the routed set and ROUTING.md. */
export function snapshotKey(r: Pick<BrainRead, 'status' | 'snapshot' | 'routed' | 'routing'>): string {
  if (r.status === 'unavailable') return 'unavailable';
  if (r.snapshot) return r.snapshot;
  return `content:${createHash('sha256').update(JSON.stringify([r.routing?.sha256, r.routed.map((x) => [x.path, x.sha256])])).digest('hex').slice(0, 16)}`;
}

/** Reads of each brain, reused for BRAIN_CACHE_MS (one read at a time per brain). */
export class BrainReader {
  private cache = new Map<string, { at: number; read: Promise<BrainRead> }>();
  constructor(private now: () => number = Date.now, private ttl = BRAIN_CACHE_MS) {}

  read(dir: string, fresh = false): Promise<BrainRead> {
    const key = windowsForm(path.resolve(dir)).toLowerCase();
    const hit = this.cache.get(key);
    if (hit && !fresh && this.now() - hit.at < this.ttl) return hit.read;
    const read = readBrainNow(dir, this.now()).catch((err: Error) => unavailable(dir, err.message, this.now()));
    this.cache.set(key, { at: this.now(), read });
    return read;
  }

  /** The last read, if there was one (for views that mustn't wait). */
  async last(dir: string): Promise<BrainRead | undefined> {
    return this.cache.get(windowsForm(path.resolve(dir)).toLowerCase())?.read;
  }
}
