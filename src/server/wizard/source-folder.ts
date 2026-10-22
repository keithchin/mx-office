// A New project draft's source folder (shared/source-folder.ts) on the office's machine: which paths are
// refused (the office's own folders, the projects home, system folders, a drive's root), the walk that
// both the scan and the import use, and the scan that gives the page its summary before anything is
// copied. The import into the project's sources/legacy/<name>/ at setup, with its manifest, is
// source-snapshot.ts. Everything here is fs/promises, so a large tree never holds the event loop;
// symbolic links and junctions are never followed. The office itself never uploads the folder (the
// planner gets its file index, never a file's contents); after setup the team's agents read the copy and
// send what they read to the hosted model (Claude, through its API) to work on it.

import { opendir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexOrder, isSecretName, legacyName, INDEX_MAX, SKIP_DIRS, SOURCE_FILE_MAX_BYTES, SOURCE_MAX_BYTES, SOURCE_MAX_FILES, type SourceFile, type SourceFolder } from '../../shared/source-folder.js';

export interface SourceCaps {
  maxBytes: number;
  maxFiles: number;
  fileMaxBytes: number;
}

export const DEFAULT_CAPS: SourceCaps = { maxBytes: SOURCE_MAX_BYTES, maxFiles: SOURCE_MAX_FILES, fileMaxBytes: SOURCE_FILE_MAX_BYTES };

/** The office's own folders and the projects home: never a source folder, nor inside one. */
export interface OfficeFolders {
  dataDir: string;
  projectsDir: string;
  /** The office's own code (defaults to the checkout this module runs from). */
  codeDir?: string;
}

const win = process.platform === 'win32';
const norm = (p: string) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return win ? r.toLowerCase() : r;
};
/** Whether two paths are the same (case-insensitively on Windows). */
export const samePath = (a: string, b: string) => norm(a) === norm(b);
/** Whether `child` is `parent` or inside it. */
export const inside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
};

/**
 * A path with its links resolved as far as it exists (the part not made yet joined on), so it compares
 * like with like against what `realpath` gives a source folder. On macOS the temporary folder is under
 * /var, a link to /private/var: a folder named /var/folders/… comes back from `realpath` as
 * /private/var/folders/…; on Windows an 8.3 short name comes back long.
 */
export async function realOf(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  for (let at = abs; ; at = path.dirname(at)) {
    try {
      return path.join(await realpath(at), ...rest);
    } catch {
      if (path.dirname(at) === at) return abs;
      rest.unshift(path.basename(at));
    }
  }
}

/** The office's checkout: three folders up from dist/server/wizard or src/server/wizard. */
const officeCode = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** System folders: never a source, nor anything inside them. */
function systemDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (win) {
    const sys = [env.WINDIR ?? env.SystemRoot ?? 'C:\\Windows', env.ProgramFiles ?? 'C:\\Program Files', env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', env.ProgramData ?? 'C:\\ProgramData'];
    if (env.APPDATA) sys.push(env.APPDATA);
    return sys;
  }
  return ['/etc', '/usr', '/bin', '/sbin', '/var', '/proc', '/dev', '/sys', '/boot', '/System', '/Library', '/private'];
}

/**
 * The temporary folders, the user's own even where they sit under a system folder: on macOS the per-user
 * one is under /var/folders (really /private/var/folders) and /tmp is /private/tmp. On Linux they're
 * outside every system folder, so nothing changes there; Windows' system folders don't hold them.
 */
async function tempDirs(): Promise<string[]> {
  if (win) return [];
  const out = new Set<string>();
  for (const t of [os.tmpdir(), '/tmp']) out.add(path.resolve(t)).add(await realOf(t));
  return [...out].filter((t) => path.parse(t).root !== t);
}

/** Whether `real` is a system folder or inside one (a temporary folder there is not). */
async function inSystemDir(real: string): Promise<boolean> {
  if (!systemDirs().some((s) => inside(real, s))) return false;
  return !(await tempDirs()).some((t) => inside(real, t));
}

/** Why `raw` can't be a source folder, or its real path when it can. Checks only; nothing is read inside it. */
export async function checkSourcePath(raw: unknown, office: OfficeFolders): Promise<{ path: string } | { error: string }> {
  const typed = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1') : '';
  if (!typed) return { error: 'Type the folder’s full path' };
  if (typed.length > 400) return { error: 'That path is too long' };
  if (!path.isAbsolute(typed) || (win && !/^[a-zA-Z]:[\\/]/.test(typed))) return { error: 'Use the folder’s full path, like C:\\work\\legacy-app' };
  let real: string;
  try {
    real = await realpath(typed);
    if (!(await stat(real)).isDirectory()) return { error: `${typed} isn’t a folder` };
  } catch {
    return { error: `There’s no folder at ${typed} on the office’s machine` };
  }
  if (path.parse(real).root.replace(/[\\/]+$/, '') === real.replace(/[\\/]+$/, '')) return { error: 'A whole drive can’t be a source folder: pick the app’s own folder' };
  const home = os.homedir();
  if (norm(real) === norm(home) || norm(real) === norm(path.dirname(home))) return { error: 'Your whole home folder can’t be a source folder: pick the app’s own folder' };
  if (await inSystemDir(real)) return { error: 'That’s a system folder: pick the app’s own folder' };
  const own: [string, string][] = [
    [await realOf(office.dataDir), 'the office’s data folder'],
    [await realOf(office.projectsDir), 'the projects home'],
    [await realOf(office.codeDir ?? officeCode()), 'the office’s own code'],
  ];
  for (const [dir, what] of own) {
    if (inside(real, dir) || inside(dir, real)) return { error: `That folder is ${inside(real, dir) ? 'inside' : 'around'} ${what}: pick the app’s own folder` };
  }
  return { path: real };
}

export class CapError extends Error {}

/** A file the walk kept, with its modified time (the import compares it before and after copying). */
export interface WalkedFile extends SourceFile {
  mtimeMs: number;
}

export interface Walked {
  files: WalkedFile[];
  bytes: number;
  skipped: SourceFolder['skipped'];
}

/**
 * Walks `root` as the import will: skipped folders, secrets-like and large files, and links (junctions
 * too) left out. Throws a CapError past the caps.
 */
export async function walk(root: string, caps: SourceCaps): Promise<Walked> {
  const out: Walked = { files: [], bytes: 0, skipped: { dirs: {}, secrets: 0, large: 0, links: 0 } };
  const skip = new Set<string>(SKIP_DIRS);
  const visit = async (dir: string, rel: string): Promise<void> => {
    const d = await opendir(dir);
    for await (const e of d) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        out.skipped.links++;
      } else if (e.isDirectory()) {
        if (skip.has(e.name)) out.skipped.dirs[e.name] = (out.skipped.dirs[e.name] ?? 0) + 1;
        else await visit(abs, r);
      } else if (e.isFile()) {
        if (isSecretName(e.name)) {
          out.skipped.secrets++;
          continue;
        }
        const st = await stat(abs);
        const size = st.size;
        if (size > caps.fileMaxBytes) {
          out.skipped.large++;
          continue;
        }
        out.files.push({ path: r, size, mtimeMs: st.mtimeMs });
        out.bytes += size;
        if (out.files.length > caps.maxFiles) throw new CapError(`More than ${caps.maxFiles.toLocaleString('en-US')} files after skipping dependencies and build output: pick a smaller folder (the app’s own source)`);
        if (out.bytes > caps.maxBytes) throw new CapError(`More than ${Math.round(caps.maxBytes / 1024 / 1024)} MB after skipping dependencies and build output: pick a smaller folder (the app’s own source)`);
      } else out.skipped.links++;
    }
  };
  await visit(root, '');
  return out;
}

/** The summary the page shows before anything is copied; or why it can't be used (a cap, a folder that can't be read). */
export async function scanSourceFolder(dir: string, caps: SourceCaps = DEFAULT_CAPS, now = () => new Date()): Promise<SourceFolder | { error: string }> {
  try {
    const w = await walk(dir, caps);
    if (!w.files.length) return { error: 'There’s nothing to copy in that folder once dependencies, build output and secrets-like files are left out' };
    const index = w.files.slice().sort(indexOrder).slice(0, INDEX_MAX).map(({ path: p, size }) => ({ path: p, size }));
    return { path: dir, name: legacyName(path.basename(dir)), files: w.files.length, bytes: w.bytes, skipped: w.skipped, index, scannedAt: now().toISOString() };
  } catch (err) {
    return { error: err instanceof CapError ? err.message : `The office couldn’t read that folder: ${(err as Error).message}` };
  }
}
