// The Studio copy: where Edit in Studio Pro opens a project on Team Server (docs/site/architecture/design-decisions.md,
// "Studio Pro opens a Studio copy"). The project's own folder has the bare repository on this machine (or GitHub) as
// its origin, and Studio Pro decides how a project is versioned from origin: opened there it's a "private server"
// project, and Publish to a Free App sandbox or a licensed node is refused. So the office keeps a second clone,
// `<owner>/.studio-pro/<name>` beside the project, whose origin is Team Server's plain URL. Studio Pro signs in to
// Team Server with the person's own Mendix account; the office uses its token only to make the copy and to bring it
// up to date (per command, never written down: ./git.ts). Agents never work in it.
//
// Before it opens: main goes to Team Server first (a sync), then the copy fast-forwards to it when it's on main with
// nothing uncommitted; otherwise it opens as it is and the answer says why. Studio mode watches the copy (studio/
// targets.ts), so the agents' mxcli writes pause while Studio Pro has it open, and commits made there (a Publish's
// automatic commit too) reach main through the sync's fast-forward pull (./sync.ts), sooner while Studio Pro is open.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { STUDIO_PUBLISH_HINTS, type TeamServerRecord } from '../../shared/team-server.js';
import type { StudioTarget } from '../../shared/studio-target.js';
import { LONGPATHS_CLONE_ARGS } from '../longpaths.js';
import { gitRefusalWords, type TsGit } from './git.js';
import { FETCH_MS, STALL_TUNING, UNREACHABLE } from './sync.js';

const NOTES = 'refs/notes/mx_metadata';

/** The Studio copy's folder: beside the project, in a hidden `.studio-pro` folder of its owner's. */
export const studioCopyDir = (dir: string) => path.join(path.dirname(path.resolve(dir)), '.studio-pro', path.basename(path.resolve(dir)));

/** The target Edit in Studio Pro uses for a project on Team Server. */
export function studioTargetFor(dir: string, rec: Pick<TeamServerRecord, 'url'>): StudioTarget {
  const at = studioCopyDir(dir);
  return { kind: 'teamserver', dir: at, ready: existsSync(path.join(at, '.git')), origin: rec.url, hints: STUDIO_PUBLISH_HINTS };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Makes the copy, or brings it up to date when that's safe. Never throws: an error is its words (token-free). */
export async function prepareStudioCopy(d: { g?: TsGit; dir: string; rec: Pick<TeamServerRecord, 'url'>; main?: string }): Promise<{ dir: string; note?: string } | { error: string }> {
  const main = d.main ?? 'main';
  const copy = studioCopyDir(d.dir);
  const g = d.g;
  try {
    if (!existsSync(path.join(copy, '.git'))) {
      if (!g) return { error: 'No Mendix token in 🔌 Connections, so the office can’t make the Studio copy from Team Server. Add one with the mx:modelrepository:repo:read scope, then try again.' };
      if (existsSync(copy) && readdirSync(copy).length) return { error: `${copy} is there but isn’t a git checkout: move it away, then try again (the office makes the Studio copy there).` };
      mkdirSync(path.dirname(copy), { recursive: true });
      const r = await g.auth(path.dirname(copy), [...LONGPATHS_CLONE_ARGS, ...STALL_TUNING, 'clone', '--no-progress', '--branch', main, d.rec.url, copy], { timeoutMs: 20 * 60_000, allowFail: true });
      if (r.code !== 0) return { error: `Couldn’t make the Studio copy from Team Server: ${gitRefusalWords(r.tail.join(' ') || `git clone exit ${r.code}`)}` };
      // The Studio Pro history notes (it reads the model's version from them).
      await g.auth(copy, ['fetch', '--quiet', 'origin', `+${NOTES}:${NOTES}`], { timeoutMs: FETCH_MS, allowFail: true });
      return { dir: copy, note: `Made the Studio copy at ${copy} from Team Server (its origin is Team Server).` };
    }
    if (!g) return { dir: copy, note: 'No Mendix token in 🔌 Connections, so the office couldn’t bring the Studio copy up to date: Pull in Studio Pro first.' };
    // Its origin is Team Server's plain URL, always (put right if someone changed it).
    const origin = (await g.plain(copy, ['remote', 'get-url', 'origin'], { allowFail: true })).stdout.trim();
    if (origin !== d.rec.url) await g.plain(copy, ['remote', origin ? 'set-url' : 'add', 'origin', d.rec.url]);
    const f = await g.auth(copy, [...STALL_TUNING, 'fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`], { timeoutMs: FETCH_MS, allowFail: true }).catch((err: Error) => ({ code: 1, tail: [err.message], stdout: '' }));
    if (f.code !== 0) {
      const said = f.tail.join(' ');
      return { dir: copy, note: UNREACHABLE.test(said) ? 'Team Server didn’t answer, so the Studio copy opens as it is: Pull in Studio Pro first.' : `The Studio copy opens as it is (${gitRefusalWords(said).slice(0, 160)}): Pull in Studio Pro first.` };
    }
    // Studio Pro's notes there aren't overwritten: a fetch that isn't a fast-forward is refused.
    await g.auth(copy, ['fetch', '--quiet', 'origin', `${NOTES}:${NOTES}`], { timeoutMs: FETCH_MS, allowFail: true });
    const branch = (await g.plain(copy, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })).stdout.trim();
    if (branch !== main) return { dir: copy, note: `The Studio copy is on ${branch || 'no branch'}, not ${main}: it opens as it is.` };
    const dirty = (await g.plain(copy, ['status', '--porcelain', '--untracked-files=no'], { allowFail: true })).stdout.trim();
    if (dirty) return { dir: copy, note: 'The Studio copy has changes nobody committed: it opens as it is. Commit them in Studio Pro (they go to Team Server, then into main).' };
    const behind = Number((await g.plain(copy, ['rev-list', '--count', `HEAD..refs/remotes/origin/${main}`], { allowFail: true })).stdout.trim()) || 0;
    if (!behind) return { dir: copy };
    const m = await g.plain(copy, ['merge', '--ff-only', '--quiet', `refs/remotes/origin/${main}`], { allowFail: true });
    if (m.code !== 0) return { dir: copy, note: `The Studio copy has commits Team Server doesn’t (${plural(behind, 'newer commit')} there too): it opens as it is. Pull, then push, in Studio Pro.` };
    return { dir: copy, note: `Brought the Studio copy up to date with Team Server (${plural(behind, 'commit')}).` };
  } catch (err) {
    return { error: `Couldn’t get the Studio copy ready: ${(g ? g.hide : String)((err as Error).message).slice(0, 300)}` };
  }
}

