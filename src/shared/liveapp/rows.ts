// Which build-plan rows a commit gives evidence for, for the live app's readiness: the build progress's own
// rules (shared/build-progress.ts: a commit subject naming the row on a commit that changed build files or
// says applied / proven / done / PASS, never a "Draft row 16" or "Journal: row 3"; "### <date> — Row N"
// notes in docs/BUILD-LOG.md), applied one history at a time, since the live app needs to know which
// commits are in the running build. The plan's own State column is never trusted for this: agents don't
// update it (PackTrack, release 56: all 33 rows "not built" while main had rows 3–14 merged). Pure.

import { buildLog, rowEvidence, rowRanges, rowsIn, type CommitLine } from '../build-progress.js';

export { isBuildPath, rowRanges, rowsIn } from '../build-progress.js';

/** The rows one commit gives build evidence for (none for a draft, a journal line or a bare mention). */
export const commitRows = (c: CommitLine): number[] => rowEvidence([c]).evidence;

/** The rows docs/BUILD-LOG.md's "### <date> — Row N" notes are about. */
export const buildLogRows = (md: string | undefined): number[] => buildLog(md)?.rows ?? [];

/** Every row with build evidence in a run of commits (and the BUILD-LOG at its tip). */
export function rowsWithEvidence(commits: readonly CommitLine[], log?: string): Set<number> {
  return new Set([...rowEvidence(commits).evidence, ...buildLogRows(log)]);
}

/** "row 7" / "rows 3–14" / "rows 3, 5". */
export const rowsWord = (rows: readonly number[]) => `row${rows.length === 1 ? '' : 's'} ${rowRanges(rows)}`;

/** The rows a merged pull request's title names ("Rows 4-14: domain and seed"): merged build work. */
export const prTitleRows = (title: string): number[] => rowsIn(title);
