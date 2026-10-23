// What an update would change in the app, read before it touches the running one (the rule is
// shared/liveapp/speed.ts): the files that differ between the served commit and the target (git diff in the
// live checkout, which has both), and the model units that differ, read straight out of git by the model's
// unit reader (model/units.ts: each unit's type by its blob, so a page edit reads as one Forms$Page). Both
// halves run at once; a few hundred milliseconds the first time, tens after. Anything that goes wrong
// reads as a restart, never as hot.
//
// Why not `mxcli diff-local`: it names no unit for a page change ("0 new, 1 modified"), so it can't tell a
// page from a domain model, and it takes a second or so with mxcli's start-up (the QB0 measurements).

import { execFileOff } from '../offloop/exec.js';
import type { ModelUnits } from '../model/units.js';
import { classifyChange, type ChangeClass, type UnitChange } from '../../shared/liveapp/speed.js';

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileOff('git', ['-c', 'core.longpaths=true', '-c', 'core.quotepath=false', ...args], { cwd, timeout: 60_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** The model units that differ between two commits of the repository in `dir`; null when either can't be read. */
export async function unitChanges(units: ModelUnits, dir: string, from: string, to: string): Promise<UnitChange[] | null> {
  const [a, b] = await Promise.all([units.commit(dir, from), units.commit(dir, to)]);
  if (!a || !b) return null;
  const out: UnitChange[] = [];
  for (const [id, u] of b.ix.units) {
    const was = a.ix.units.get(id);
    if (!was) out.push({ type: u.type, name: u.name, change: '+' });
    else if (was.hash !== u.hash || was.type !== u.type) out.push({ type: u.type, name: u.name, change: '~' });
  }
  for (const [id, u] of a.ix.units) if (!b.ix.units.has(id)) out.push({ type: u.type, name: u.name, change: '-' });
  return out;
}

export interface ClassifyDeps {
  /** The office's model unit reader (model/index.ts modelOf().units); without one, any model change is a restart. */
  units?: ModelUnits;
}

/**
 * Which way an update from `from` to `to` can go, in the checkout `dir` (both commits fetched there);
 * `mprPath` is the .mpr's path from the repository's top, which says where the app's folder is.
 */
export async function classifyUpdate(dir: string, from: string, to: string, mprPath: string, d: ClassifyDeps): Promise<ChangeClass> {
  const slash = mprPath.replaceAll('\\', '/').lastIndexOf('/');
  const prefix = slash >= 0 ? mprPath.replaceAll('\\', '/').slice(0, slash + 1) : '';
  try {
    const [names, units] = await Promise.all([
      git(['diff', '--name-only', '--no-renames', '-z', from, to], dir),
      d.units ? unitChanges(d.units, dir, from, to).catch(() => null) : Promise.resolve(null),
    ]);
    return classifyChange({ paths: names.split('\0').filter(Boolean), prefix, units });
  } catch (err) {
    return { kind: 'restart', reason: `couldn't compare the commits (${(err as Error).message.split('\n')[0].slice(0, 160)})`, touched: [] };
  }
}

/** The commits an update from `from` to `to` brings in: how many, and the newest `max` besides `to` (grouped merges). */
export async function commitsIn(dir: string, from: string, to: string, max = 10): Promise<{ count: number; included: { sha: string; subject?: string }[] } | undefined> {
  try {
    const [count, log] = await Promise.all([git(['rev-list', '--count', `${from}..${to}`], dir), git(['log', `--max-count=${max + 1}`, '--format=%H%x00%s', `${from}..${to}`], dir)]);
    const included = log
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\0'))
      .filter(([sha]) => sha !== to)
      .slice(0, max)
      .map(([sha, subject]) => ({ sha, ...(subject ? { subject: subject.slice(0, 200) } : {}) }));
    return { count: Number(count.trim()) || 0, included };
  } catch {
    return undefined;
  }
}
