// The Project Manager's merge for local-only projects (server/local-merge/): what the panel, its confirm step and
// the Developer view's receipt show and send. Pure: the browser imports it too.
//
// A review pins one commit ("Approve at @sha"), and Merge merges exactly that commit: never whatever the branch's
// head has become since. Newer commits stay on the branch for a later review.

import type { MergeCheckView } from './merge-check.js';

/** A person's review of a team branch at the exact commit they saw. */
export interface LocalMergeReview {
  branch: string;
  sha: string;
  verdict: 'approve' | 'changes';
  by: string;
  byId?: string;
  at: number;
  note?: string;
}

/** The Developer change (DC-n) a branch belongs to, with the request's title. */
export interface LocalMergeDc {
  id: string;
  title: string;
}

/** What a branch changes since it left main: model files, other code, and notes (docs, journals). */
export interface LocalMergeFiles {
  model: number;
  code: number;
  notes: number;
}

/** `change`: model or code changes. `notes`: journal or docs only (nothing in the app changes). */
export type LocalMergeKind = 'change' | 'notes';

export interface LocalMergeBranch {
  branch: string;
  /** Its head now. */
  sha: string;
  ahead: number;
  behind: number;
  subject: string;
  owner?: string;
  /** The DC(s) it belongs to (dev/DC-n, or the change its worker was handed). */
  dcs?: LocalMergeDc[];
  /** The task its worker is on, when known. */
  task?: string;
  kind: LocalMergeKind;
  files: LocalMergeFiles;
  /** The newest review of a commit still on the branch and not yet on main (the head's, or an older one's). */
  review?: LocalMergeReview;
  /** Commits on the branch after the reviewed one: never part of its merge. */
  newer?: number;
  /** The branch's other commits main hasn't got (newest first, the head left out): any of them may be reviewed on its own. */
  commits?: { sha: string; subject: string }[];
  /** The commit an agent asked to have merged (its escalation names it), and who. */
  asked?: { sha: string; by: string };
}

export interface LocalMergeView {
  floor: string;
  /** Off GitHub ("Keep this project off GitHub", or on Team Server with no GitHub mirror): only then is there anything here. */
  localOnly: boolean;
  /** Off GitHub because the code is on Mendix Team Server: main goes there after each merge. */
  teamServer?: boolean;
  main: string;
  /** main's commit now (origin/main), so the panel can say what the team should see. */
  mainSha?: string;
  branches: LocalMergeBranch[];
  /** The team's autonomy: whether merges wait on the Project Manager at its level (they may merge at any level). */
  level: number;
  levelName: string;
  pmDecides: boolean;
}

/** A check or a journey's result at exactly the commit to merge. */
export interface LocalMergeResult {
  name: string;
  verdict: string;
}

/** What the confirm step shows before a merge: the commit, its DC(s), what it changes, its checks, and data impact. */
export interface LocalMergeConfirm {
  floor: string;
  branch: string;
  main: string;
  sha: string;
  subject: string;
  /** The branch's head now, and how many commits after `sha` stay out of this merge. */
  head: string;
  newer: number;
  kind: LocalMergeKind;
  files: LocalMergeFiles;
  /** A few of the changed paths, model first. */
  paths: string[];
  /** Model units changed (kind:Module.Name), when the model could be read at both ends. */
  units: string[];
  dcs: LocalMergeDc[];
  checks: LocalMergeResult[];
  journeys: LocalMergeResult[];
  /** The data-impact finding at that commit: clear, impact (with its lines), unknown, or none (no domain model). */
  dataImpact: { status: 'clear' | 'impact' | 'unknown' | 'none'; lines: string[] };
  /** The review that lets it merge, if any (a merge without one is refused). */
  review?: LocalMergeReview;
  /** The office's own mx check at exactly this commit: recorded, running, or started by this look (server/merge-check/). */
  mxCheck?: MergeCheckView;
  levelName: string;
  pmDecides: boolean;
}

/** What a merge did: the merge commit, the reviewed commit, and what stayed out. */
export interface LocalMergeDone {
  ok: true;
  merge: string;
  into: string;
  sha: string;
  newer: number;
  words: string;
  /** Who was told "main is now @M". */
  told: string[];
}

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** After the merge: "Merged @3d6ca6b (reviewed). The branch has 2 newer commits, not included." (the toast says main's new commit). */
export function mergedWords(sha: string, newer: number): string {
  return `Merged @${short(sha)} (reviewed).${newer > 0 ? ` The branch has ${plural(newer, 'newer commit')}, not included.` : ''}`;
}

/** "Merging @3d6ca6b (reviewed). The branch has 2 newer commits, not included." */
export function mergingWords(sha: string, newer: number): string {
  return `Merging @${short(sha)} (reviewed).${newer > 0 ? ` The branch has ${plural(newer, 'newer commit')}, not included.` : ''}`;
}

/** What a branch's row says about its review and what's next. */
export function mergeStateWords(b: LocalMergeBranch): string {
  const r = b.review;
  if (!r) return `not reviewed: review @${short(b.sha)} first`;
  const at = short(r.sha);
  const newer = b.newer ? ` · ${plural(b.newer, 'newer commit')} not reviewed (not part of this merge)` : '';
  return r.verdict === 'approve' ? `approved @${at} by ${r.by}: ready to merge @${at}${newer}` : `changes asked by ${r.by} at @${at}${newer}`;
}

/** The DC label of a row: "DC-3 · Rename the button" (several joined), or the branch name when it has none. */
export function dcWords(b: Pick<LocalMergeBranch, 'dcs' | 'branch'>): string {
  return b.dcs?.length ? b.dcs.map((d) => `${d.id}${d.title ? ` · ${d.title}` : ''}`).join('; ') : '';
}

/** "notes only (journal, docs)" or "3 model files, 1 code file". */
export function filesWords(f: LocalMergeFiles, kind: LocalMergeKind): string {
  if (kind === 'notes') return `notes only (${plural(f.notes, 'journal or docs file')}, no model or code changes)`;
  const parts = [f.model ? plural(f.model, 'model file') : '', f.code ? plural(f.code, 'code file') : '', f.notes ? plural(f.notes, 'notes file') : ''].filter(Boolean);
  return parts.join(', ') || 'no file changes';
}

const MODEL_RE = /(^|\/)[^/]+\.mpr$|(^|\/)mprcontents\/|^mdlsource\//i;
const NOTES_RE = /\.(md|markdown|txt|rst|adoc)$|^(docs|journal|journals|notes)\//i;

/** Which of the three a path is: model (.mpr, mprcontents/, mdlsource/), notes (docs, journals, text), or code. */
export function pathKind(p: string): keyof LocalMergeFiles {
  return MODEL_RE.test(p) ? 'model' : NOTES_RE.test(p) ? 'notes' : 'code';
}

/** Counts the changed paths by kind, and whether the branch is notes only. */
export function classify(paths: readonly string[]): { files: LocalMergeFiles; kind: LocalMergeKind } {
  const files: LocalMergeFiles = { model: 0, code: 0, notes: 0 };
  for (const p of paths) if (p.trim()) files[pathKind(p.trim())]++;
  return { files, kind: !files.model && !files.code && files.notes > 0 ? 'notes' : 'change' };
}

/** What the team is told after a merge: main's new commit, what was merged and what stayed out. */
export function mainNowWords(m: { main: string; merge: string; branch: string; sha: string; dcs: readonly LocalMergeDc[]; newer: number; reviewedBy: string }): string {
  const what = m.dcs.length ? m.dcs.map((d) => d.id).join(', ') : m.branch;
  return [
    `${m.main} is now @${short(m.merge)} (merged ${what}).`,
    `The Project Manager merged ${m.branch} at @${short(m.sha)} (reviewed by ${m.reviewedBy}) with --no-ff, in Mx Office.${m.newer > 0 ? ` ${plural(m.newer, 'newer commit')} on ${m.branch} after @${short(m.sha)} ${m.newer === 1 ? 'was' : 'were'} not merged: ${m.newer === 1 ? 'it needs' : 'they need'} a new review.` : ''}`,
    `Run \`git fetch origin\` and work from origin/${m.main} (@${short(m.merge)}): don't ask for this merge again, and bring ${m.main} into your branch before the next one.`,
  ].join('\n');
}
