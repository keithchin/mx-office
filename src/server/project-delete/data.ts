// The office's data for one project, archived before it's removed: <data>/deleted/<floor>-<time>/ keeps
// a copy of every per-project file the office writes (the team, chatter, budget ledger, acceptance
// records, the live app's log), its toolkit pin and incidents, and the project's own .agent-office
// folder (without the worktrees), so a deletion can be undone by hand. The audit log and the incident
// log are hash-chained office records: they're copied, never cut. The model cache is keyed by content,
// not by project, and the team phone's read marks are per person, so neither has anything to remove.

import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WORKTREES_DIR } from '../worktrees.js';
import { copyTree, removeTree } from './fsops.js';
import { within } from '../worktree-sweep/sweep.js';

const safe = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, '_');

/** The office's per-project files and folders, relative to its data folder. */
export const officeFiles = (floor: string): string[] => [
  `roster/${safe(floor)}.json`,
  `judge/${safe(floor)}.jsonl`,
  `chatter/${safe(floor)}.jsonl`,
  `chatter/${safe(floor)}.state.json`,
  `budget/${floor}.json`,
  `acceptance/${floor}.jsonl`,
  `acceptance/${floor}`,
  `live/${floor}.log`,
];

/** Removed but not archived: the live app's own clone of the repository (made again from GitHub). */
export const derivedFiles = (floor: string): string[] => [`live/${floor}`];

/** <data>/deleted/<floor>-<yyyymmdd-hhmmss>. */
export function archiveDirFor(dataDir: string, floor: string, at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return path.join(dataDir, 'deleted', `${safe(floor)}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`);
}

export interface ArchiveInput {
  dataDir: string;
  floor: string;
  /** The project's folder. */
  dir: string;
  to: string;
  /** Its entry in the office's toolkit pin book, if any. */
  pin?: unknown;
  /** What floors.json had for it. */
  def: unknown;
}

/** Copies everything to the archive (again, when a retry comes back to it: copies overwrite). Returns how many files. */
export async function archiveProject(a: ArchiveInput): Promise<number> {
  await mkdir(a.to, { recursive: true });
  let files = 0;
  for (const rel of officeFiles(a.floor)) files += await copyTree(path.join(a.dataDir, rel), path.join(a.to, 'office', rel));
  const projectData = path.join(a.dir, '.agent-office');
  if (!within(projectData, a.dataDir) && path.resolve(projectData) !== path.resolve(a.dataDir)) files += await copyTree(projectData, path.join(a.to, 'project-agent-office'), [path.join(a.dir, WORKTREES_DIR)]);
  const incidents = await readFile(path.join(a.dataDir, 'incidents', 'incidents.jsonl'), 'utf8').catch(() => '');
  const mine = incidents.split('\n').filter((l) => l.includes(`"${a.floor}"`) && floorsOf(l).includes(a.floor));
  if (mine.length) await writeFile(path.join(a.to, 'incidents.jsonl'), `${mine.join('\n')}\n`);
  if (a.pin) await writeFile(path.join(a.to, 'toolkit-pin.json'), `${JSON.stringify(a.pin, null, 2)}\n`);
  await writeFile(path.join(a.to, 'floor.json'), `${JSON.stringify(a.def, null, 2)}\n`);
  return files + mine.length;
}

const floorsOf = (line: string): string[] => {
  try {
    const v = JSON.parse(line) as {
      floors?: unknown;
      incident?: { floors?: unknown };
    };
    const f = v.floors ?? v.incident?.floors;
    return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Removes the live copies (after archiveProject). The project's .agent-office goes too, unless the
 * office keeps its own data there (`keepProjectData`: the project it was started in).
 */
export async function removeLiveData(dataDir: string, floor: string, dir: string, keepProjectData: boolean): Promise<void> {
  for (const rel of officeFiles(floor))
    await rm(path.join(dataDir, rel), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 150,
    });
  for (const rel of derivedFiles(floor)) await removeTree(path.join(dataDir, rel));
  const projectData = path.join(dir, '.agent-office');
  if (keepProjectData || within(projectData, dataDir) || path.resolve(projectData) === path.resolve(dataDir)) return;
  await removeTree(projectData);
}
