// What the claims check reads of a project's git (check.ts): the commits of the last CLAIM_DAYS on
// origin/<default> and on the agents' pushed branches (the refs the office already fetches; nothing is
// fetched here), each with its parents, author, time, subject, body and the files it changed, and the
// lines each added to the claim documents (docs/BUILD-LOG.md, docs/team/*.md, evidence pages). Local git
// only, every git started off the event loop (offloop/exec.ts through asks/sources.ts); read-only.

import { git } from '../asks/sources.js';
import { CLAIM_DOC_PATHS } from '../../shared/claims.js';

/** How far back claims are looked at. */
export const CLAIM_DAYS = 14;
/** Model commits are read this much further back, so a claim near the edge still finds its evidence. */
const EXTRA_DAYS = 3;
const LOG_MAX = 1500;
export const BRANCHES_MAX = 25;

export interface Commit {
  sha: string;
  parents: string[];
  /** "Sophie (Mx Office Lead Developer)" as git has it, and the address. */
  author: string;
  email: string;
  /** Committer time (ms). */
  at: number;
  subject: string;
  body: string;
  files: string[];
}

export interface Snapshot {
  dir: string;
  main: { branch: string; sha: string };
  commits: Map<string, Commit>;
  /** Commits reachable from the default branch (within the window). */
  onMain: Set<string>;
  /** Branch → its tip and the commits it has that the default branch hasn't. */
  branches: Map<string, { sha: string; own: Set<string> }>;
  /** A commit not on the default branch → the first branch that has it. */
  branchOf: Map<string, string>;
  /** Commit → the lines it added to each claim document. */
  added: Map<string, { file: string; lines: string[] }[]>;
  /** When it was read (ms). */
  at: number;
}

const FORMAT = '--format=%x01%H%x00%P%x00%an%x00%ae%x00%ct%x00%s%x00%b%x02';

/** `git log --format=FORMAT --name-only` output, as commits. */
export function parseCommits(out: string | undefined): Commit[] {
  if (!out) return [];
  return out
    .split('\x01')
    .slice(1)
    .flatMap((block) => {
      const [head, rest = ''] = block.split('\x02');
      const [sha, parents, author, email, ct, subject, ...body] = head.split('\0');
      if (!/^[0-9a-f]{7,64}$/.test(sha ?? '')) return [];
      return [{ sha, parents: (parents ?? '').split(' ').filter(Boolean), author: author ?? '', email: email ?? '', at: Number(ct) * 1000, subject: (subject ?? '').trim(), body: body.join('\0').trim(), files: rest.split('\n').map((f) => f.trim()).filter(Boolean) }];
    });
}

/** `git log -p --unified=0 --format=%x01%H` output: each commit's added lines, per file. */
export function parseAdded(out: string | undefined): Map<string, { file: string; lines: string[] }[]> {
  const res = new Map<string, { file: string; lines: string[] }[]>();
  if (!out) return res;
  for (const block of out.split('\x01').slice(1)) {
    const nl = block.indexOf('\n');
    const sha = (nl < 0 ? block : block.slice(0, nl)).trim();
    if (!/^[0-9a-f]{7,64}$/.test(sha)) continue;
    const files: { file: string; lines: string[] }[] = [];
    let cur: { file: string; lines: string[] } | undefined;
    for (const line of block.slice(nl + 1).split('\n')) {
      if (line.startsWith('+++ ')) {
        const f = line.slice(4).trim();
        cur = f === '/dev/null' ? undefined : { file: f.replace(/^b\//, ''), lines: [] };
        if (cur) files.push(cur);
      } else if (cur && line.startsWith('+') && !line.startsWith('+++')) cur.lines.push(line.slice(1));
      else if (line.startsWith('diff --git ')) cur = undefined;
    }
    const kept = files.filter((f) => f.lines.length);
    if (kept.length) res.set(sha, kept);
  }
  return res;
}

const since = (now: number, days: number) => `--since=${Math.floor((now - days * 86_400_000) / 1000)}`;

/** The origin branches besides the default one, newest first: name and tip. */
async function originBranches(dir: string, def: string): Promise<{ name: string; sha: string }[]> {
  const out = (await git(['for-each-ref', '--sort=-committerdate', `--count=${BRANCHES_MAX + 2}`, '--format=%(refname)%00%(objectname)', 'refs/remotes/origin'], dir)) ?? '';
  return out
    .split('\n')
    .map((l) => l.trim().split('\0'))
    .flatMap(([ref, sha]) => {
      const name = (ref ?? '').replace(/^refs\/remotes\/origin\//, '');
      return ref && sha && name !== 'HEAD' && name !== def ? [{ name, sha }] : [];
    })
    .slice(0, BRANCHES_MAX);
}

/** Reads the window of commits on the default branch (`main`) and the branches. Undefined when git can't read the default branch. */
export async function readSnapshot(dir: string, main: { branch: string; sha: string }, now = Date.now()): Promise<Snapshot | undefined> {
  const window = since(now, CLAIM_DAYS + EXTRA_DAYS);
  const docs = ['--', ...CLAIM_DOC_PATHS];
  const [mainLog, mainDocs, refs] = await Promise.all([
    git(['-c', 'core.quotepath=off', 'log', main.sha, window, `-n${LOG_MAX}`, FORMAT, '--name-only', '--no-renames'], dir),
    git(['-c', 'core.quotepath=off', 'log', main.sha, window, `-n${LOG_MAX}`, '--format=%x01%H', '-p', '--unified=0', '--no-renames', '--no-color', ...docs], dir),
    originBranches(dir, main.branch),
  ]);
  if (mainLog === undefined) return undefined;
  const commits = new Map<string, Commit>();
  const onMain = new Set<string>();
  for (const c of parseCommits(mainLog)) {
    commits.set(c.sha, c);
    onMain.add(c.sha);
  }
  const added = parseAdded(mainDocs);
  const branches = new Map<string, { sha: string; own: Set<string> }>();
  const branchOf = new Map<string, string>();
  const reads = await Promise.all(
    refs.map(async (r) => {
      if (r.sha === main.sha) return undefined;
      const range = `${main.sha}..${r.sha}`;
      const [log, diff] = await Promise.all([git(['-c', 'core.quotepath=off', 'log', range, window, `-n${LOG_MAX}`, FORMAT, '--name-only', '--no-renames'], dir), git(['-c', 'core.quotepath=off', 'log', range, window, `-n${LOG_MAX}`, '--format=%x01%H', '-p', '--unified=0', '--no-renames', '--no-color', ...docs], dir)]);
      return { r, log: parseCommits(log), diff: parseAdded(diff) };
    }),
  );
  for (const got of reads) {
    if (!got || !got.log.length) continue;
    const own = new Set<string>();
    for (const c of got.log) {
      own.add(c.sha);
      if (!commits.has(c.sha)) commits.set(c.sha, c);
      if (!onMain.has(c.sha) && !branchOf.has(c.sha)) branchOf.set(c.sha, got.r.name);
    }
    for (const [sha, files] of got.diff) if (!added.has(sha)) added.set(sha, files);
    branches.set(got.r.name, { sha: got.r.sha, own });
  }
  return { dir, main, commits, onMain, branches, branchOf, added, at: now };
}

/** The commits `from` reaches (itself included), within the snapshot's window. */
export function ancestry(s: Snapshot, from: string): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const sha = stack.pop()!;
    if (seen.has(sha)) continue;
    const c = s.commits.get(sha);
    if (!c) continue;
    seen.add(sha);
    stack.push(...c.parents);
  }
  return seen;
}

/** The file names under result-looking paths at `sha` (one ls-tree per commit, cached). */
const trees = new Map<string, Promise<string[]>>();
export function treeFiles(dir: string, sha: string): Promise<string[]> {
  const k = `${dir}\0${sha}`;
  let p = trees.get(k);
  if (!p) {
    p = git(['ls-tree', '-r', '--name-only', '-z', sha], dir).then((out) => (out ?? '').split('\0').filter(Boolean));
    trees.set(k, p);
    while (trees.size > 50) trees.delete(trees.keys().next().value!);
  }
  return p;
}

/** A file's text at a commit (undefined when it isn't there or is over 4 MB). */
export async function fileAt(dir: string, sha: string, file: string): Promise<string | undefined> {
  const size = await git(['cat-file', '-s', `${sha}:${file}`], dir);
  if (size === undefined || Number(size.trim()) > 4 * 1024 * 1024) return undefined;
  return git(['show', `${sha}:${file}`], dir);
}

/** The last commit at or before `sha` that changed `file`. */
export async function lastChange(dir: string, sha: string, file: string): Promise<string | undefined> {
  return (await git(['-c', 'core.quotepath=off', 'log', '-1', '--format=%H', sha, '--', file], dir))?.trim() || undefined;
}

/** The first-parent commit of the default branch that brought `sha` in (a PR's merge commit), or `sha` itself when it is first-parent. */
export async function broughtBy(s: Snapshot, sha: string): Promise<string | undefined> {
  if (sha === s.main.sha) return sha;
  const out = await git(['rev-list', '--ancestry-path', '--first-parent', '--reverse', `${sha}..${s.main.sha}`], s.dir);
  const first = out?.split('\n')[0]?.trim();
  if (!first) return undefined;
  const m = s.commits.get(first);
  return m && m.parents[0] === sha ? sha : first;
}

/** Whether the model files `x` changed are the same on `tip` (its change reached it, by a squash or a cherry-pick). */
export async function sameModelOn(dir: string, x: Commit, tip: string, isModel: (f: string) => boolean): Promise<boolean> {
  const files = x.files.filter(isModel);
  if (!files.length) return false;
  const out = await git(['diff', '--name-only', '--no-renames', x.sha, tip, '--', ...files.slice(0, 200)], dir);
  return out !== undefined && !out.trim();
}
