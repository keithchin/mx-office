// Putting a checked package into the requesting agent's folder and committing it there as the office:
//   - a widget: the .mpk copied to <app>/widgets/<Studio Pro's file name>, and only that file committed
//     (`git commit -- <file>`), so whatever the agent has staged or half-done stays as it was;
//   - a module: `mxcli marketplace install --file` into the app (./download.ts), only when the app has no
//     uncommitted changes (the install rewrites model files the agent may be editing), then everything the
//     install changed under the app folder committed.
// The folder must still be on the branch the agent asked from. Commits carry the office's commit identity
// (workers/git-identity.ts officeGitEnv), never a token; nothing is pushed.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { findMpr } from '../liveapp/checkout.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { runCommand } from '../wizard/run.js';
import { widgetFileName, type MarketplaceRequest, type PackageFacts } from '../../shared/marketplace.js';
import { childEnv, installModule, withHome, type Run } from './download.js';

export interface PlaceDeps {
  run?: Run;
  mxcli?: string;
  identity?: { name: string; email: string };
}

export type Placed = { ok: true; commit: string; files: string[] } | { ok: false; error: string };

async function git(deps: PlaceDeps, cwd: string, args: string[], home: string) {
  const run = deps.run ?? runCommand;
  return run('git', args, { cwd, env: childEnv(home, officeGitEnv(deps.identity)), timeoutMs: 120_000, allowFail: true });
}

const rel = (from: string, to: string) => path.relative(from, to).split(path.sep).join('/');

/** Places package `file` (already checked as `pkg`) for request `r` and commits it; what it did, or why not. */
export async function placeAndCommit(deps: PlaceDeps, r: MarketplaceRequest, file: string, pkg: PackageFacts): Promise<Placed> {
  // Said plainly before git is asked: a folder that isn't there made Windows report git itself as missing.
  if (!path.isAbsolute(r.folder)) return { ok: false, error: `${r.by.name}’s folder is recorded as a relative path (${r.folder}): it can ask again from its folder` };
  if (!(await stat(r.folder).then((s) => s.isDirectory(), () => false))) return { ok: false, error: `${r.by.name}’s folder isn’t there any more (${r.folder}): nothing was changed. It can ask again from the folder it works in now.` };
  return withHome(async (home) => {
    const branch = await git(deps, r.folder, ['rev-parse', '--abbrev-ref', 'HEAD'], home);
    if (branch.code !== 0) return { ok: false, error: `${r.by.name}’s folder isn’t a git checkout any more (${r.folder})` };
    const now = branch.stdout.trim();
    if (r.branch && now !== r.branch) return { ok: false, error: `${r.by.name}’s folder is on ${now} now, not ${r.branch} where it asked: nothing was changed. It can ask again from the branch it wants it on.` };
    let mpr: string | undefined;
    try {
      mpr = findMpr(r.folder);
    } catch {
      mpr = undefined;
    }
    if (!mpr) return { ok: false, error: `no Mendix app (.mpr) in ${r.by.name}’s folder` };
    const appDir = path.dirname(mpr);
    const top = await git(deps, r.folder, ['rev-parse', '--show-toplevel'], home);
    const root = top.code === 0 && top.stdout.trim() ? path.resolve(top.stdout.trim()) : r.folder;
    const message = `Add ${pkg.kind} ${pkg.name}${pkg.version ? ` ${pkg.version}` : ''} from the Mendix Marketplace (item ${r.id}, sha256 ${pkg.sha256.slice(0, 12)})\n\nAdded by Mx Office on ${r.by.name}’s request ${r.rid}.`;
    let files: string[];
    if (pkg.kind === 'widget') {
      const dest = path.join(appDir, 'widgets', widgetFileName(pkg));
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(file, dest);
      files = [rel(root, dest)];
      const add = await git(deps, root, ['add', '--', files[0]], home);
      if (add.code !== 0) return { ok: false, error: `git couldn’t add ${files[0]}: ${add.tail.slice(-2).join(' ')}` };
      const c = await git(deps, root, ['commit', '-m', message, '--', files[0]], home);
      if (c.code !== 0) return { ok: false, error: `git couldn’t commit ${files[0]}: ${c.tail.slice(-2).join(' ')}` };
    } else {
      if (!deps.mxcli) return { ok: false, error: 'mxcli isn’t set up on the office’s machine (🔌 Connections › Paths): a module can’t be installed' };
      const appRel = rel(root, appDir) || '.';
      const dirty = await git(deps, root, ['status', '--porcelain', '--', appRel], home);
      if (dirty.code !== 0 || dirty.stdout.trim()) return { ok: false, error: `${r.by.name}’s app has uncommitted changes: a module install rewrites model files, so commit (or put aside) the work first, then the module can be added` };
      const err = await installModule({ mxcli: deps.mxcli, run: deps.run, cwd: appDir }, file, mpr);
      if (err) return { ok: false, error: err };
      const changed = await git(deps, root, ['status', '--porcelain', '--', appRel], home);
      files = changed.stdout.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean).slice(0, 200);
      if (!files.length) return { ok: false, error: 'mxcli said it installed the module, but nothing in the app changed' };
      const add = await git(deps, root, ['add', '-A', '--', appRel], home);
      if (add.code !== 0) return { ok: false, error: `git couldn’t add the module’s files: ${add.tail.slice(-2).join(' ')}` };
      const c = await git(deps, root, ['commit', '-m', message, '--', appRel], home);
      if (c.code !== 0) return { ok: false, error: `git couldn’t commit the module: ${c.tail.slice(-2).join(' ')}` };
    }
    const sha = await git(deps, root, ['rev-parse', 'HEAD'], home);
    return { ok: true, commit: sha.stdout.trim(), files };
  });
}
