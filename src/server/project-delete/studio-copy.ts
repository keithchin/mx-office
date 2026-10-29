// A Team Server project's Studio copy (team-server/studio-copy.ts: `<owner>/.studio-pro/<name>`, the clone Studio Pro
// opens) goes with the project's folder, under the same guards (folderRefusal: inside the projects home, no link,
// not the office's own data or code, test-office folders only in test mode), and only when the office made it for
// exactly this project (its mark in the copy's .git). Used by project delete and, through it or directly, Cancel & undo.

import { readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { officeStudioCopyOf } from '../team-server/studio-copy.js';
import { folderRefusal, removeTree, type FolderRules } from './fsops.js';

/** The copy the office made for the project at `dir`, and whether it may go (and why not). Undefined: none it made. */
export async function studioCopyPlan(dir: string, rules: FolderRules): Promise<{ path: string; deletable: boolean; why?: string } | undefined> {
  const copy = officeStudioCopyOf(dir);
  if (!copy) return undefined;
  const why = await folderRefusal(copy, rules);
  return why ? { path: copy, deletable: false, why } : { path: copy, deletable: true };
}

/** Deletes the office's Studio copy of the project at `dir` (and the `.studio-pro` folder once it's empty): a line about it, '' when there's none. */
export async function removeStudioCopy(dir: string, rules: FolderRules): Promise<string> {
  const p = await studioCopyPlan(dir, rules);
  if (!p) return '';
  if (!p.deletable) return `kept the Studio copy ${p.path} (${p.why})`;
  await removeTree(p.path);
  const parent = path.dirname(p.path);
  if (path.basename(parent) === '.studio-pro' && !(await readdir(parent).catch(() => ['?'])).length) await rmdir(parent).catch(() => undefined);
  return `deleted the Studio copy ${p.path}`;
}
