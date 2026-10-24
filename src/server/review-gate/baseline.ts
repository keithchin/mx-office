// The direct-push check's unchecked range, and reconciling it (pushes.ts keeps the state). When the office has
// no earlier record of a project's default branch (its first look, or a renamed branch), the commits up to
// where it first saw it were never checked. That is shown, one card in Needs you and a state on the 🔐 Security
// tab, until someone settles it:
//   - check the last N first-parent commits up to there for ones that skipped a pull request (anyone signed in
//     can ask; what it finds becomes the usual direct-push cards, and the commits older than N stay unchecked,
//     which the record says);
//   - or an admin accepts that commit as the starting point (audited): nothing before it will be checked.
// Local git only, off the event loop. This is a check against mistakes, not a boundary against an agent: an
// agent running as the office's user can edit the file it keeps (docs/site/architecture/trust-and-authority.md).

import type { AskItem } from '../../shared/asks.js';
import { git } from '../asks/sources.js';
import { directPushes, editPushState, KEEP, LOG_FORMAT, parseLog, type PushState } from './pushes.js';

/** How many commits a check looks at by default, and at most. */
export const SCAN_DEFAULT = 50;
export const SCAN_MAX = 200;

const short = (sha: string) => sha.slice(0, 7);

/** The one card while the range is unchecked. */
export function uncheckedItem(branch: string, u: { from: string; at: number }): AskItem {
  return {
    id: `gate-push-unchecked-${short(u.from)}`,
    kind: 'gate',
    level: 'info',
    text: `Direct-push check: no earlier record of ${branch}. Commits up to ${short(u.from)} weren't checked`,
    since: u.at,
    lines: [
      `The office started watching ${branch} at ${short(u.from)}. Commits after it are checked; the ones before it never were, so one that skipped a pull request wouldn't show.`,
      `On the 🔐 Security tab, under Direct-push check: check the last ${SCAN_DEFAULT} commits for ones that skipped a pull request, or (an admin) accept ${short(u.from)} as the starting point.`,
      'Hiding this card leaves the state on the Security tab until it is reconciled.',
    ],
    acts: [{ act: 'seen', label: 'Hide' }],
  };
}

export type ReconcileResult = { state: PushState; found: number; scanned: number } | { error: string };

/**
 * Checks the last `n` first-parent commits up to the unchecked commit for ones that skipped a pull request
 * (`merges`: PR merge commits the office knows), adds them as events, and settles the range.
 */
export async function scanUnchecked(dataDir: string, floorId: string, dir: string, merges: ReadonlySet<string>, n: number, by: string, now = Date.now()): Promise<ReconcileResult> {
  const count = Math.max(1, Math.min(SCAN_MAX, Math.floor(n) || SCAN_DEFAULT));
  let error: string | undefined;
  let found = 0;
  let scanned = 0;
  const state = await editPushState(dataDir, floorId, async (s) => {
    if (!s.unchecked || !s.branch) return void (error = 'Nothing to reconcile: every commit since the office started watching was checked.');
    const out = await git(['log', '--first-parent', `-n${count}`, `--format=${LOG_FORMAT}`, s.unchecked.from], dir);
    if (out === undefined) return void (error = `The office's copy of the project doesn't have ${short(s.unchecked.from)} any more, so it can't check before it.`);
    const commits = parseLog(out).reverse();
    scanned = commits.length;
    const known = new Set(s.events.map((e) => e.sha));
    const hits = directPushes(commits, merges, s.branch).filter((e) => !known.has(e.sha));
    found = hits.length;
    const { unchecked: _u, ...rest } = s;
    return { ...rest, reconciled: { how: 'scan', from: s.unchecked.from, by, at: now, scanned, found }, events: [...s.events, ...hits].slice(-KEEP) };
  });
  return error ? { error } : { state, found, scanned };
}

/** An admin accepts the unchecked commit as the starting point: nothing before it will be checked. */
export async function acceptUnchecked(dataDir: string, floorId: string, by: string, now = Date.now()): Promise<ReconcileResult> {
  let error: string | undefined;
  const state = await editPushState(dataDir, floorId, async (s) => {
    if (!s.unchecked) return void (error = 'Nothing to reconcile: every commit since the office started watching was checked.');
    const { unchecked: _u, ...rest } = s;
    return { ...rest, reconciled: { how: 'accept', from: s.unchecked.from, by, at: now } };
  });
  return error ? { error } : { state, found: 0, scanned: 0 };
}
