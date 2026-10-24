// The Developer view's documents at a revision (shared/app-documents.ts classifies them): the project's
// document files in git at that commit (the Documents page's catalog and extras, shared/deliverables.ts), the
// last commit that touched each one at that commit (one `git log --name-status` pass, which also gives
// renames), the text of the Markdown, HTML, CSS and TSV ones (read by blob, for what they link and use and
// for their status line), and the acceptance records that cite them. Never a file's time on disk, never the
// project's folder: everything comes out of git at the commit, so it's the same with the app stopped, and
// it's worked out once per commit and kept.

import { execFileOff } from '../offloop/exec.js';
import { treeAt, type TreeFile } from '../deliverables/git.js';
import { modelOf } from '../model/index.js';
import { isDeliverablePath } from '../../shared/deliverables.js';
import { deniedPath } from '../../shared/app-explorer.js';
import { classifyDocuments, type DocAccepted, type DocCommit, type DocInput, type DocumentsView } from '../../shared/app-documents.js';

type Ctx = { cfg: { dataDir: string } };

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
/** Files whose text is read (what they link, their status line), and how much of each. */
const TEXT = /\.(md|markdown|html?|css|tsv)$/i;
const TEXT_MAX = 512 * 1024;
const TEXTS_MAX = 600;
const KEPT = 6;

function git(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: ENV, windowsHide: true, timeout: 60_000, maxBuffer: 128 * 1024 * 1024 }, (err, out) => resolve(err ? undefined : String(out)));
  });
}

/**
 * The last commit that touched each of `paths` at `sha`, and what each was renamed from: one `git log` over
 * the folders they're in, newest first, each path's first sighting kept.
 */
export async function lastCommits(dir: string, sha: string, paths: readonly string[]): Promise<{ last: Map<string, DocCommit>; renamed: Map<string, string> }> {
  const last = new Map<string, DocCommit>();
  const renamed = new Map<string, string>();
  if (!paths.length) return { last, renamed };
  const want = new Set(paths);
  const tops = [...new Set(paths.map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : p)))];
  const out = await git(['log', '--format=%x1e%H%x1f%ct%x1f%an%x1f%s', '--name-status', '-M', sha, '--', ...tops.map((t) => `:(literal)${t}`)], dir);
  let cur: DocCommit | undefined;
  for (const line of (out ?? '').split('\n')) {
    if (line.startsWith('\x1e')) {
      const [h, ct, an, subject] = line.slice(1).split('\x1f');
      cur = { sha: h, at: Number(ct) * 1000, author: an ?? '', subject: subject ?? '' };
      continue;
    }
    if (!cur || !line.trim()) continue;
    const cols = line.split('\t');
    const status = cols[0] ?? '';
    const path = status.startsWith('R') || status.startsWith('C') ? cols[2] : cols[1];
    if (!path || !want.has(path)) continue;
    if (!last.has(path)) last.set(path, cur);
    // The rename that brought it to this path (the newest one: later renames of the old path don't count).
    if (status.startsWith('R') && cols[1] && !renamed.has(path)) renamed.set(path, cols[1]);
  }
  return { last, renamed };
}

/** The files an acceptance record cites (`git:<sha>:<path>`), newest record last wins. */
async function acceptedFiles(ctx: Ctx, floorId: string): Promise<Map<string, DocAccepted>> {
  const out = new Map<string, DocAccepted>();
  try {
    const { acceptanceStore } = await import('../acceptance/index.js');
    for (const c of acceptanceStore(ctx.cfg.dataDir, floorId).cycles()) {
      const rec = c.record;
      if (!rec) continue;
      for (const d of rec.docs) {
        const m = /^git:([0-9a-f]{7,40}):(.+)$/.exec(d.locator ?? '');
        if (m) out.set(m[2], { version: rec.version, commit: m[1], at: rec.acceptedAt });
      }
    }
  } catch {
    // No records (or none readable): no acceptance badges.
  }
  return out;
}

const kept = new Map<string, Promise<DocumentsView>>();

/** The documents at commit `sha` with their relationships, dates from git and status where a source says so. */
export function documentsAt(ctx: Ctx, floor: { id: string; dir: string }, sha: string): Promise<DocumentsView> {
  const key = `${floor.dir}\0${sha}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const p = (async (): Promise<DocumentsView> => {
    const tree = await treeAt(floor.dir, sha);
    if (!tree.length) return { ...classifyDocuments(sha, []), problem: `Couldn’t read the files at ${sha.slice(0, 7)}: the commit isn’t in this repository, or it has no files.` };
    const files = tree.filter((f) => !deniedPath(f.path) && isDeliverablePath(f.path));
    const [{ last, renamed }, accepted] = await Promise.all([lastCommits(floor.dir, sha, files.map((f) => f.path)), acceptedFiles(ctx, floor.id)]);
    const texts = await readTexts(ctx, floor.dir, files.filter((f) => TEXT.test(f.path) && f.size <= TEXT_MAX).slice(0, TEXTS_MAX));
    const input: DocInput[] = files.map((f) => ({ path: f.path, size: f.size, ...(last.get(f.path) ? { last: last.get(f.path) } : {}), ...(renamed.get(f.path) ? { renamedFrom: renamed.get(f.path) } : {}), ...(texts.has(f.path) ? { text: texts.get(f.path) } : {}) }));
    return classifyDocuments(sha, input, accepted);
  })();
  kept.set(key, p);
  void p.then((v) => (v.problem ? kept.delete(key) : undefined), () => kept.delete(key));
  while (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  return p;
}

async function readTexts(ctx: Ctx, dir: string, files: TreeFile[]): Promise<Map<string, string>> {
  const blobs = modelOf(ctx).units.blobs(dir);
  const out = new Map<string, string>();
  await Promise.all(
    files.map(async (f) => {
      const b = await blobs.blob(f.oid).catch(() => null);
      if (b && !b.includes(0)) out.set(f.path, Buffer.from(b).toString('utf8'));
    }),
  );
  return out;
}
