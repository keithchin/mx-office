// Folder-name case in a commit's files (the "Folder name case" check, server/path-case/). Windows doesn't tell
// `Styling` from `styling`, Linux and macOS do, so a mistake hides in Windows previews and breaks the Linux cloud
// build. Two rules, read from the commit's paths alone:
//   1. two paths that differ only by case (`themesource/Styling/x.scss` and `themesource/styling/x.scss`, or two
//      folders `Styling` and `styling` side by side): Linux sees two, Windows one;
//   2. Mendix's code folders `themesource/`, `javasource/` and `javascriptsource/`, and the module folders right
//      under them, are all lower case (Mendix makes them so, and the Linux cloud build only reads that spelling).
// The Mendix project is the folder that holds the .mpr file (the repository root when there is none). Pure (no
// Node imports): the messages are written for the Project Manager.

export const CODE_FOLDERS = ['themesource', 'javasource', 'javascriptsource'] as const;

export interface PathCaseFinding {
  /** `collision`: paths differing only by case; `top`: a code folder in the wrong case; `module`: a module folder under one. */
  kind: 'collision' | 'top' | 'module';
  /** The offending folder or file, as the commit spells it. */
  path: string;
  /** What it should be called (top, module), or the other spellings (collision). */
  expected?: string;
  others?: string[];
  message: string;
}

/** The most findings kept for one commit (the rest are counted). */
export const MAX_FINDINGS = 20;

const lower = (s: string) => s.toLowerCase();
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const RENAME = 'Rename it with git mv (two steps on Windows: to a temporary name first).';

/** Every file and folder in `files` (folders as the paths leading to a file). */
function allPaths(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}

/** The Mendix project folders: each folder with a .mpr file in it ('' for the root), else the root. */
export function projectRoots(files: readonly string[]): string[] {
  const roots = [...new Set(files.filter((f) => /\.mpr$/i.test(f)).map(parentOf))];
  return roots.length ? roots : [''];
}

function collisionMessage(path: string, others: string[]): string {
  const names = [path, ...others].join(' and ');
  return `${names} differ only by case. Linux and macOS see them as different, Windows as one, so files go missing or get mixed up. Keep one name (lower case for a module folder) and move everything into it with git mv.`;
}

/** What is wrong with the case of folder names in a commit's files (paths as git lists them, '/'-separated). */
export function pathCaseFindings(files: readonly string[]): { findings: PathCaseFinding[]; more: number } {
  const paths = allPaths(files.filter(Boolean));
  const dirs = new Set([...paths].map(parentOf).filter(Boolean));
  const out: PathCaseFinding[] = [];

  // 1. Paths that differ only by case, reported at the shallowest level (not again for every file under them).
  const byLower = new Map<string, string[]>();
  for (const p of paths) {
    const k = lower(p);
    const had = byLower.get(k);
    if (had) had.push(p);
    else byLower.set(k, [p]);
  }
  const clash = new Set([...byLower].filter(([, v]) => v.length > 1).map(([k]) => k));
  const under = (k: string) => {
    for (let p = parentOf(k); p; p = parentOf(p)) if (clash.has(p)) return true;
    return false;
  };
  for (const k of [...clash].sort()) {
    if (under(k)) continue;
    const [first, ...rest] = byLower.get(k)!.sort();
    out.push({ kind: 'collision', path: first, others: rest, message: collisionMessage(first, rest) });
  }

  // 2. Mendix's code folders and the module folders in them in lower case (a clash above already covers its paths).
  const sorted = [...paths].sort();
  for (const root of projectRoots(files)) {
    const pre = root ? `${root}/` : '';
    for (const p of sorted) {
      if (!p.startsWith(pre) || clash.has(lower(p)) || under(lower(p))) continue;
      const rel = p.slice(pre.length).split('/');
      const top = rel[0];
      if (!(CODE_FOLDERS as readonly string[]).includes(lower(top))) continue;
      if (rel.length === 1 && top !== lower(top) && dirs.has(p)) {
        const want = `${pre}${lower(top)}`;
        out.push({ kind: 'top', path: p, expected: want, message: `${p}: Mendix's folder is ${want} (all lower case). The Linux cloud build ignores ${top}; Windows previews hide the difference. ${RENAME}` });
      }
      // A module folder: a folder right under a code folder spelled right (one with files in it).
      if (rel.length === 2 && top === lower(top) && rel[1] !== lower(rel[1]) && dirs.has(p)) {
        const want = `${pre}${top}/${lower(rel[1])}`;
        out.push({ kind: 'module', path: p, expected: want, message: `${p}: module folders under ${top} must be lower case (${want}). The Linux cloud build ignores it; Windows previews hide the difference. ${RENAME}` });
      }
    }
  }
  return { findings: out.slice(0, MAX_FINDINGS), more: Math.max(0, out.length - MAX_FINDINGS) };
}

/** A one-line summary for a check's name: the first finding's path and what's wrong. */
export function pathCaseHeadline(findings: readonly PathCaseFinding[], more = 0): string {
  const f = findings[0];
  if (!f) return '';
  const what = f.kind === 'collision' ? `${f.path} and ${f.others?.[0] ?? ''} differ only by case` : `${f.path} must be lower case`;
  const rest = findings.length - 1 + more;
  return rest > 0 ? `${what} (and ${rest} more)` : what;
}
