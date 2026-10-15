// Links from a decision's revision to the work (Slice 1B-4, plan §3): each link says how it was found
// (its strength) and how far the evidence for it goes (its levels), always tied to that revision.
//   Strength:  candidate   the recipient's current task when the answer went (captured on the dispatch): never proof;
//              associated  a commit, PR or issue names `ESC-<id> rev <n>` or the task id;
//              inferred    a build-plan row whose text names it.
//   Evidence:  acknowledged  the answer was typed (system-confirmed) and a later assistant turn in that same
//                            session cites the revision;
//              updated       a commit after the answer, on the task's branch, citing the revision: an
//                            "associated change", never "implemented";
//              verified      checks passed at a revision that contains that commit, on the task's PR: "checks
//                            passed on the associated change". A later unrelated pass proves nothing;
//              implemented as decided: only a person's acceptance record naming the revision.
// "No links found" (nothing located) is never "No implementation work required" (a person's stated choice,
// an answer revision of its own kind).
// Pure: the browser imports the types and the words.

import { LEGACY_TASK } from './tasks.js';

export type TaskLinkStrength = 'candidate' | 'associated' | 'inferred';

export interface TaskLinkEvidence {
  acknowledged?: { dispatchId: string };
  updated?: { commit: string; at?: number; pr?: number };
  verified?: { revision: string; pr?: number; source: 'pr-checks' | 'task-verification' };
}

export interface TaskLink {
  strength: TaskLinkStrength;
  /** The task's id; none on a legacy task (never made up). */
  taskId?: string;
  legacy?: boolean;
  /** The task's first line, a PR's title, a commit's subject, a build-plan row. */
  title: string;
  /** Who was on it. */
  worker?: string;
  /** Where the link is: "Linus's task when the answer went", "commit e77a0d3 names ESC-… rev 2". */
  via: string;
  pr?: number;
  branch?: string;
  evidence: TaskLinkEvidence;
}

/** What the decision's revision has: its links, a person's acceptance, or their "no implementation work required". */
export interface DecisionLinks {
  decision: string;
  rev: number;
  links: TaskLink[];
  implemented?: { acceptanceId: string; version: string; by: string; at: number };
  noWorkRequired?: { by: string; at: number; note?: string };
  evaluatedAt: number;
}

/** What shows when nothing was located: never "no impact", never "no work needed". */
export const NO_LINKS_FOUND = 'No links found: the office located no work that used this revision (that is not the same as no work being needed)';
/** A person's stated choice (an answer revision of kind no-work-required). */
export const NO_WORK_REQUIRED = 'No implementation work required';
/** The words that go into the revision's text when that's the choice. */
export const noWorkText = (note: string) => (note.trim() ? `${NO_WORK_REQUIRED}: ${note.trim()}` : NO_WORK_REQUIRED);

const short = (sha: string) => sha.slice(0, 7);
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One evidence level in words. */
export function evidenceWords(e: TaskLinkEvidence): string[] {
  const out: string[] = [];
  if (e.acknowledged) out.push('acknowledged');
  if (e.updated) out.push(`associated change ${e.updated.pr ? `PR #${e.updated.pr}` : `commit ${short(e.updated.commit)}`}`);
  if (e.verified) out.push(`checks passed on the associated change @${short(e.verified.revision)}`);
  return out;
}

/** `Task tsk_… "Visitor checkout" (Linus): candidate · acknowledged · associated change PR #98 · checks passed on the associated change @e77a0d3`. */
export function linkWords(l: TaskLink): string {
  const who = l.taskId ? `Task ${l.taskId}` : l.legacy ? LEGACY_TASK : l.strength === 'inferred' ? 'Build-plan row' : 'Work';
  return `${who} "${clip(l.title)}"${l.worker ? ` (${l.worker})` : ''}: ${[l.strength, ...evidenceWords(l.evidence)].join(' · ')}`;
}

/** The decision-level line: implemented as decided (a person's acceptance), or nothing. */
export const implementedWords = (i: NonNullable<DecisionLinks['implemented']>) => `Implemented as decided: accepted in ${i.version} by ${i.by}`;

/** What a revision's links say when there are none, or the person's stated choice. */
export function noneWords(d: Pick<DecisionLinks, 'noWorkRequired'> | undefined): string {
  if (d?.noWorkRequired) return `${NO_WORK_REQUIRED} (stated by ${d.noWorkRequired.by}${d.noWorkRequired.note ? `: ${d.noWorkRequired.note}` : ''})`;
  return NO_LINKS_FOUND;
}

/** A decision revision an acceptance record names (AcceptanceRecord.decisions), each well formed. */
export interface DecisionRev {
  decision: string;
  rev: number;
}

export function cleanDecisionRevs(v: unknown): DecisionRev[] {
  if (!Array.isArray(v)) return [];
  const out: DecisionRev[] = [];
  for (const x of v.slice(0, 200)) {
    if (!x || typeof x !== 'object') continue;
    const { decision, rev } = x as Record<string, unknown>;
    if (typeof decision === 'string' && /^(esc|q|stuck|proposal|mcr):[^\n\r]{1,300}$/.test(decision) && Number.isInteger(rev) && (rev as number) >= 1) out.push({ decision, rev: rev as number });
  }
  return out;
}
