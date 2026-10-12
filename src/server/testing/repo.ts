// Reading a project's repository for the Testing tab, all through git started off the event loop
// (offloop/exec.ts) and in as few starts as it takes: one ls-tree for the files, one cat-file --batch
// for their contents, one log for the commit that last changed each report. "main" is origin/<default>
// when the project has a remote (as the setup panel and Deliverables read it), else the folder's HEAD.

import { execFileOff } from '../offloop/exec.js';
import { branchInfo } from '../wizard/gate-source.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

export function git(args: string[], cwd: string, input?: string, timeout = 30_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout, env: ENV, windowsHide: true, ...(input !== undefined ? { input } : {}) }, (err, out) => resolve(err ? undefined : out));
  });
}

export interface MainRef {
  branch: string;
  sha: string;
  /** Read from origin/<default> (else the folder's HEAD, with no remote). */
  remote: boolean;
}

/** The commit "main" is at. */
export async function mainOf(dir: string): Promise<MainRef | undefined> {
  const info = await branchInfo(dir);
  if (info) return { branch: info.def, sha: info.sha, remote: true };
  const [sha, branch] = await Promise.all([git(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], dir), git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)]);
  return sha?.trim() ? { branch: branch?.trim() || 'HEAD', sha: sha.trim(), remote: false } : undefined;
}

/** The files under `paths` at `sha` (`deep` false: only the files right in a folder given as 'docs/'). */
export async function listFiles(dir: string, sha: string, paths: string[], deep = true): Promise<string[]> {
  const out = await git(['ls-tree', ...(deep ? ['-r'] : []), '--name-only', '-z', sha, '--', ...paths], dir);
  return (out ?? '').split('\0').filter(Boolean);
}

/** Files at `sha` as text, by path; a file over `maxBytes`, or missing, is left out. */
export async function readFiles(dir: string, sha: string, files: string[], maxBytes = 2 * 1024 * 1024): Promise<Map<string, string>> {
  const got = new Map<string, string>();
  if (!files.length) return got;
  const out = await git(['cat-file', '--batch'], dir, files.map((f) => `${sha}:${f}`).join('\n') + '\n', 60_000);
  if (!out) return got;
  const buf = Buffer.from(out, 'utf8');
  let at = 0;
  for (const f of files) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const head = buf.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(head);
    if (!m) continue; // "<name> missing"
    const size = Number(m[2]);
    if (m[1] === 'blob' && size <= maxBytes) got.set(f, buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return got;
}

/** The commit that last added or changed each file under `paths`, as of `sha` (newest first, so the first seen wins). */
export async function lastCommits(dir: string, sha: string, paths: string[], max = 3000): Promise<Map<string, { sha: string; at: string }>> {
  const out = await git(['log', `-n${max}`, '--format=%x01%H %cI', '--name-only', '--no-renames', sha, '--', ...paths], dir, undefined, 60_000);
  const by = new Map<string, { sha: string; at: string }>();
  for (const block of (out ?? '').split('\x01')) {
    const [head, ...names] = block.split('\n');
    const [c, at] = head.trim().split(' ');
    if (!c) continue;
    for (const n of names) if (n.trim() && !by.has(n.trim())) by.set(n.trim(), { sha: c, at });
  }
  return by;
}

/** Each revision a report declares, as the full commit when this repo has it (else left out). */
export async function resolveRevisions(dir: string, revs: string[]): Promise<Map<string, string>> {
  const got = new Map<string, string>();
  const ask = [...new Set(revs.filter((r) => /^[0-9a-f]{4,64}$/i.test(r)))];
  if (!ask.length) return got;
  const out = await git(['cat-file', '--batch-check'], dir, ask.map((r) => `${r}^{commit}`).join('\n') + '\n');
  const lines = (out ?? '').split('\n');
  ask.forEach((r, i) => {
    const m = /^([0-9a-f]{40,64}) commit /.exec(lines[i] ?? '');
    if (m) got.set(r, m[1]);
  });
  return got;
}
