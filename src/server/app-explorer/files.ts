// The explorer's "Show all files" view on the server: the project's files at a commit, one folder at a time
// and paged, read-only. Everything comes out of git at that commit (one `ls-tree -r` per commit, kept), never
// from the project's folder on disk, so nothing outside the project can be reached and what's listed is
// exactly what runs. Never listed or opened: anything on the denylist (shared/app-explorer.ts deniedPath:
// .git, the office's data folder, environment files, keys, credentials, every config.json, token files) and
// anything the project's .gitignore matches (`git check-ignore --no-index`, asked once per commit). Paths are
// checked before anything is looked up (cleanTreePath: no `..`, nothing absolute).

import { execFileOff, type OffError } from '../offloop/exec.js';
import { blobOnBranch, treeAt, type TreeFile } from '../deliverables/git.js';
import { cleanTreePath, deniedPath, fileKind, FILE_MAX_BYTES, FILES_PAGE, IMAGE_TYPE, type ExplorerFile, type ExplorerNode } from '../../shared/app-explorer.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

/** git's output even when it exits 1 (check-ignore: nothing matched), undefined on a real failure. */
function gitOut(args: string[], cwd: string, input?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: ENV, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024, ...(input !== undefined ? { input } : {}) }, (err, out) => {
      if (!err) return resolve(out);
      const e = err as OffError;
      resolve(e.code === 1 ? (e.stdout ?? '') : undefined);
    });
  });
}

interface Folder {
  folders: Map<string, number>;
  files: TreeFile[];
}
interface Index {
  folders: Map<string, Folder>;
  files: Map<string, TreeFile>;
}

const indexes = new Map<string, Promise<Index>>();
const KEPT = 6;

/** The shown files at commit `sha`, by folder (kept per commit: a commit never changes). */
export function filesIndex(dir: string, sha: string): Promise<Index> {
  const key = `${dir}\0${sha}`;
  let p = indexes.get(key);
  if (p) return p;
  p = (async () => {
    const all = (await treeAt(dir, sha)).filter((f) => !deniedPath(f.path));
    const ignored = new Set<string>();
    if (all.length) {
      const out = await gitOut(['check-ignore', '--no-index', '--stdin', '-z'], dir, `${all.map((f) => f.path).join('\0')}\0`).catch(() => undefined);
      for (const p of (out ?? '').split(/\0|\n/)) if (p) ignored.add(p);
    }
    const idx: Index = { folders: new Map(), files: new Map() };
    const folder = (p: string) => {
      let f = idx.folders.get(p);
      if (!f) idx.folders.set(p, (f = { folders: new Map(), files: [] }));
      return f;
    };
    folder('');
    for (const f of all) {
      if (ignored.has(f.path)) continue;
      const parts = f.path.split('/');
      // A file under an ignored folder (git check-ignore names the file itself, so this is a second look).
      if (parts.some((_, i) => i > 0 && ignored.has(parts.slice(0, i).join('/')))) continue;
      idx.files.set(f.path, f);
      for (let i = 0; i < parts.length - 1; i++) {
        const parent = parts.slice(0, i).join('/');
        const here = parts.slice(0, i + 1).join('/');
        const pf = folder(parent);
        pf.folders.set(parts[i], 0);
        folder(here);
      }
      folder(parts.slice(0, -1).join('/')).files.push(f);
    }
    return idx;
  })();
  indexes.set(key, p);
  p.catch(() => indexes.delete(key));
  while (indexes.size > KEPT) indexes.delete(indexes.keys().next().value as string);
  return p;
}

export type FolderAnswer = { nodes: ExplorerNode[]; total: number; next?: number } | { error: string; status: number };

/** One folder's rows at `sha`: folders first, then files, `FILES_PAGE` at a time from `cursor`. */
export async function folderAt(dir: string, sha: string, rawPath: unknown, cursor = 0): Promise<FolderAnswer> {
  const p = cleanTreePath(rawPath);
  if (p === null) return { status: 400, error: 'Not a path inside the project' };
  if (p && deniedPath(p)) return { status: 404, error: 'No such folder' };
  const idx = await filesIndex(dir, sha);
  const f = idx.folders.get(p);
  if (!f) return { status: 404, error: 'No such folder' };
  const join = (n: string) => (p ? `${p}/${n}` : n);
  const rows: ExplorerNode[] = [
    ...[...f.folders.keys()].sort((a, b) => a.localeCompare(b)).map((n): ExplorerNode => {
      const sub = idx.folders.get(join(n));
      return { id: `f:${join(n)}/`, label: n, kind: 'folder', folder: true, path: join(n), count: (sub?.folders.size ?? 0) + (sub?.files.length ?? 0) };
    }),
    ...[...f.files].sort((a, b) => a.path.localeCompare(b.path)).map((x): ExplorerNode => ({ id: `f:${x.path}`, label: x.path.slice(x.path.lastIndexOf('/') + 1), kind: 'file', path: x.path, size: x.size, key: x.path })),
  ];
  const from = Math.max(0, Math.floor(cursor) || 0);
  const nodes = rows.slice(from, from + FILES_PAGE);
  return { nodes, total: rows.length, ...(from + FILES_PAGE < rows.length ? { next: from + FILES_PAGE } : {}) };
}

export type FileAnswer = ExplorerFile | { error: string; status: number };

/** One file at `sha`, to show read-only: text, a picture, or why not (binary, too big). */
export async function fileAt(dir: string, sha: string, rawPath: unknown): Promise<FileAnswer> {
  const p = cleanTreePath(rawPath);
  if (!p) return { status: 400, error: 'Not a file inside the project' };
  if (deniedPath(p)) return { status: 404, error: 'No such file' };
  const f = (await filesIndex(dir, sha)).files.get(p);
  if (!f) return { status: 404, error: 'No such file' };
  const kind = fileKind(p);
  if (kind === 'binary') return { path: p, size: f.size, kind: 'binary' };
  if (f.size > FILE_MAX_BYTES) return { path: p, size: f.size, kind: 'large' };
  const body = await blobOnBranch(dir, sha, p, FILE_MAX_BYTES);
  if (!body) return { status: 404, error: 'The file couldn’t be read' };
  if (kind === 'image') {
    const ext = (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? '').toLowerCase();
    return { path: p, size: f.size, kind: 'image', data: `data:${IMAGE_TYPE[ext] ?? 'application/octet-stream'};base64,${body.toString('base64')}` };
  }
  if (body.includes(0)) return { path: p, size: f.size, kind: 'binary' };
  return { path: p, size: f.size, kind: 'text', text: body.toString('utf8') };
}

/** The files that differ between two commits (shown ones only), at most `max`. */
export async function changedFiles(dir: string, from: string, to: string, max = 2000): Promise<string[]> {
  const out = await gitOut(['diff', '--name-only', '-z', '--no-renames', from, to], dir);
  return (out ?? '').split('\0').filter((p) => p && !deniedPath(p)).slice(0, max);
}

export const SEARCH_MAX = 200;

/** The shown files at `sha` whose path has every word of `q` in it (the whole revision, not the opened folders), at most SEARCH_MAX. */
export async function searchFiles(dir: string, sha: string, q: string): Promise<{ nodes: ExplorerNode[]; total: number }> {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return { nodes: [], total: 0 };
  const idx = await filesIndex(dir, sha);
  const hits: TreeFile[] = [];
  for (const f of idx.files.values()) {
    const p = f.path.toLowerCase();
    if (terms.every((t) => p.includes(t))) hits.push(f);
  }
  const total = hits.length;
  // Names that match first, then shorter paths.
  const name = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  const named = (p: string) => Number(!terms.every((t) => name(p).includes(t)));
  hits.sort((a, b) => named(a.path) - named(b.path) || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { nodes: hits.slice(0, SEARCH_MAX).map((x): ExplorerNode => ({ id: `f:${x.path}`, label: x.path.slice(x.path.lastIndexOf('/') + 1), kind: 'file', path: x.path, size: x.size, key: x.path, hint: x.path, detail: x.path })), total };
}
