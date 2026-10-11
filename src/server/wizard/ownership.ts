// Whether Cancel & undo may delete what a setup made, decided on proof (shared/setup-provenance.ts),
// asked afresh each time: by the plan for the dialog, and again by the cancel's own steps on the server
// right before anything is deleted, whatever the request asked for. A GitHub repository only when the
// setup recorded creating it and GitHub still shows the same id at that name; a folder only when the
// setup recorded cloning it, it really is that folder (no junction or link on the way), and Delete
// project's own rules allow it (inside the projects folder, never the office's data or code). A setup's
// human-readable log lines never give authority. Delete project (server/project-delete/) is its own
// flow, authorised by its own dialog, and doesn't come through here.

import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { folderProof, repoProof, type FolderProvenance, type SetupProvenance } from '../../shared/setup-provenance.js';
import { folderRefusal, type FolderRules } from '../project-delete/fsops.js';
import type { Gh } from '../project-delete/repo.js';
import { within } from '../worktree-sweep/sweep.js';
import { lookupWithGh } from './repo-lookup.js';

const WIN = process.platform === 'win32';
const same = (a: string, b: string) => (WIN ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/** A folder's canonical path (links resolved), or undefined when it isn't there. */
export const canonical = (p: string): Promise<string | undefined> => realpath(p).catch(() => undefined);

/**
 * What the clone step records for the folder it now has: the setup's own when it wasn't there before
 * (or the setup recorded cloning this very folder on an earlier try), otherwise "there already".
 */
export async function folderRecord(prior: FolderProvenance | undefined, dir: string, existed: boolean, at: number): Promise<FolderProvenance> {
  const real = (await canonical(dir)) ?? path.resolve(dir);
  if (prior?.createdBySetup && same(prior.path, real)) return prior;
  if (!existed) return { createdBySetup: true, path: real, at };
  return { createdBySetup: false, preExisting: true, path: real, at };
}

export type RepoAuthority = { ok: true } | { ok: false; proof: 'pre-existing' | 'legacy' | 'none' | 'no-id' | 'unknown' | 'gone' | 'mismatch'; why: string };

/** Whether the setup's record proves it created `repo`, and GitHub shows that same repository there now. */
export async function repoAuthority(gh: Gh, prov: SetupProvenance | undefined, repo: string, legacyCreated: boolean): Promise<RepoAuthority> {
  const p = repoProof(prov, repo, legacyCreated);
  if (p.proof !== 'recorded') return { ok: false, proof: p.proof, why: p.why };
  const now = await lookupWithGh(gh, repo);
  if (now.state === 'unknown') return { ok: false, proof: 'unknown', why: `couldn’t check which repository is at ${repo} on GitHub now (${now.reason}), so it isn’t deleted: check the office’s GitHub login in 🔌 Connections, then try again` };
  if (now.state === 'not-found') return { ok: false, proof: 'gone', why: `${repo} isn’t on GitHub any more (or the office’s login can’t see it)` };
  if (!now.githubId) return { ok: false, proof: 'unknown', why: `GitHub didn’t say which repository is at ${repo} now, so it isn’t deleted` };
  if (now.githubId !== p.githubId) return { ok: false, proof: 'mismatch', why: `the repository at ${repo} now isn’t the one this setup created (GitHub’s id for it is different), so the office won’t delete it` };
  return { ok: true };
}

export type FolderAuthority = { ok: true } | { ok: false; proof: 'pre-existing' | 'legacy' | 'none' | 'moved' | 'link' | 'rules'; why: string };

/** Whether the setup's record proves it cloned `dir`, `dir` really is that folder inside the projects folder, and the folder rules allow deleting it. */
export async function folderAuthority(dir: string, prov: SetupProvenance | undefined, legacyCloned: boolean, rules: FolderRules, refusal?: string): Promise<FolderAuthority> {
  const st = await lstat(dir).catch(() => undefined);
  // A junction or symbolic link (Node's lstat reports both as links): never followed, never deleted.
  if (st?.isSymbolicLink()) return { ok: false, proof: 'link', why: 'it’s a junction or symbolic link, not a folder of its own, so the office won’t delete it' };
  const real = await canonical(dir);
  if (real) {
    const home = (await canonical(rules.home)) ?? path.resolve(rules.home);
    if (!same(real, path.resolve(dir))) return { ok: false, proof: 'link', why: `it really is ${real} (a junction or link on the way there), so the office won’t delete it` };
    if (!within(home, real)) return { ok: false, proof: 'link', why: `it really is ${real}, outside the office’s projects folder (${rules.home})` };
  }
  const p = folderProof(prov, real, legacyCloned, WIN);
  if (p.proof !== 'recorded') return { ok: false, proof: p.proof, why: p.why };
  const why = refusal ?? (await folderRefusal(dir, rules));
  if (why) return { ok: false, proof: 'rules', why };
  return { ok: true };
}
