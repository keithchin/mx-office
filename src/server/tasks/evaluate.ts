// The links from one decision revision to the work, and the evidence for each (Slice 1B-4, the rules in
// shared/task-links.ts). Everything it reads comes in: the revision's dispatches (each with the task it
// captured), the commits since the answer (one git log, cached by the caller), the floor's cached PR list,
// the build plan the stuck look already read, the members' task verifications and the acceptance records.
// Git questions it can't answer from those (is this commit on that branch, does that revision contain it)
// go through `io`, cached by the caller. No GitHub call, no polling of its own.

import { decisionLabel, type DispatchRecord } from '../../shared/dispatch.js';
import type { DecisionLinks, DecisionRev, TaskLink } from '../../shared/task-links.js';
import { taskIdIn, taskIdsIn } from '../../shared/tasks.js';
import { citesExactly } from '../dispatch/evidence.js';

export interface Commit {
  sha: string;
  /** Committer time, ms. */
  at: number;
  message: string;
}

export interface PullLike {
  number: number;
  title: string;
  body?: string;
  headRefName?: string;
  headRefOid?: string;
  checks?: string;
}

export interface Verification {
  taskId: string;
  pr: number;
  revision?: string;
  state: string;
}

export interface EvalInput {
  decision: string;
  rev: number;
  /** When the revision was answered: only what came after can be its change. */
  answerAt: number;
  /** The revision's kind and who gave it (a no-work-required one is the person's stated choice). */
  kind?: string;
  by?: string;
  note?: string;
  dispatches: readonly DispatchRecord[];
  commits: readonly Commit[];
  pulls: readonly PullLike[];
  /** Build-plan rows (file, line, text) to look for the decision or the task in. */
  planRows: readonly { file: string; line: number; text: string }[];
  verifications: readonly Verification[];
  acceptances: readonly { id: string; version: string; by: string; at: number; decisions?: readonly DecisionRev[] }[];
  now: number;
}

export interface EvalIo {
  /** Whether the answer's typed message was followed, in the same session, by an assistant turn citing the revision. */
  acknowledged(r: DispatchRecord, citation: string): Promise<boolean>;
  /** The commits on `branch` (local git), or undefined when it can't be read. */
  onBranch(branch: string): Promise<ReadonlySet<string> | undefined>;
  /** Whether revision `into` contains commit `sha`. */
  contains(sha: string, into: string): Promise<boolean>;
}

/** `ESC-<id> rev <n>`: how commits, PRs and turns cite a decision revision. */
export const citationOf = (decision: string, rev: number) => `${decisionLabel(decision)} rev ${rev}`;

const subject = (m: string) => m.split('\n')[0].trim();

export async function evaluateLinks(i: EvalInput, io: EvalIo): Promise<DecisionLinks> {
  const citation = citationOf(i.decision, i.rev);
  const needle = citation.toLowerCase();
  const cites = (text: string | undefined) => !!text && citesExactly(text.toLowerCase(), needle);
  const links: TaskLink[] = [];
  const byTask = new Map<string, TaskLink>();
  const after = i.commits.filter((c) => c.at > i.answerAt);
  const citing = after.filter((c) => cites(c.message));

  // ---- candidates: the recipient's task when each dispatch of this revision went ----
  for (const r of i.dispatches) {
    if (r.answerRev !== i.rev || r.decision !== i.decision || !r.task) continue;
    if (r.task.taskId && byTask.has(r.task.taskId)) continue;
    const l: TaskLink = { strength: 'candidate', ...(r.task.taskId ? { taskId: r.task.taskId } : { legacy: true }), title: r.task.text, ...(r.workerName ? { worker: r.workerName } : {}), via: `${r.workerName ?? 'the recipient'}'s task when the answer went`, ...(r.task.pr ? { pr: r.task.pr } : {}), ...(r.task.branch ? { branch: r.task.branch } : {}), evidence: {} };
    if (r.state === 'submitted' && r.confirmedBy === 'system' && (await io.acknowledged(r, citation))) l.evidence.acknowledged = { dispatchId: r.id };
    links.push(l);
    if (l.taskId) byTask.set(l.taskId, l);
  }

  // ---- associated: PRs that name the revision or a known task ----
  for (const p of i.pulls) {
    const text = `${p.title}\n${p.body ?? ''}`;
    const named = taskIdsIn(text).find((id) => byTask.has(id));
    if (named) {
      const l = byTask.get(named)!;
      l.pr ??= p.number;
      if (l.pr === p.number) l.branch ??= p.headRefName;
      continue;
    }
    if (!cites(text)) continue;
    const id = taskIdIn(p.body);
    const l: TaskLink = { strength: 'associated', ...(id ? { taskId: id } : {}), title: p.title, via: `PR #${p.number} names ${citation}`, pr: p.number, ...(p.headRefName ? { branch: p.headRefName } : {}), evidence: {} };
    links.push(l);
    if (id) byTask.set(id, l);
  }

  // The commits on each linked task's branch (one git log per branch, cached by the caller).
  const onBranch = new Map<TaskLink, ReadonlySet<string> | undefined>();
  for (const l of links) if (l.branch) onBranch.set(l, await io.onBranch(l.branch));
  const known = (c: Commit) => [...onBranch.values()].some((s) => s?.has(c.sha));

  // ---- associated: commits after the answer that cite the revision and belong to no linked task, by their Task trailer ----
  for (const c of citing) {
    const id = taskIdIn(c.message);
    if ((id && byTask.has(id)) || known(c)) continue;
    const l: TaskLink = { strength: 'associated', ...(id ? { taskId: id } : {}), title: subject(c.message), via: `commit ${c.sha.slice(0, 7)} names ${citation}`, evidence: { updated: { commit: c.sha, at: c.at } } };
    links.push(l);
    if (id) byTask.set(id, l);
  }

  // ---- updated: a citing commit after the answer, on the linked task's branch (or carrying its trailer) ----
  for (const l of links) {
    if (l.evidence.updated && l.strength === 'associated' && !l.branch) continue;
    const branch = onBranch.get(l);
    const mine = citing.filter((c) => (branch?.has(c.sha) ?? false) || (!!l.taskId && taskIdIn(c.message) === l.taskId));
    const newest = mine.sort((a, b) => b.at - a.at)[0];
    if (newest) l.evidence.updated = { commit: newest.sha, at: newest.at, ...(l.pr ? { pr: l.pr } : {}) };
  }

  // ---- verified: a check that passed at a revision containing that commit, on the task's own PR ----
  for (const l of links) {
    const u = l.evidence.updated;
    if (!u || !l.pr) continue;
    const p = i.pulls.find((x) => x.number === l.pr);
    if (p?.checks === 'pass' && p.headRefOid && (await io.contains(u.commit, p.headRefOid))) {
      l.evidence.verified = { revision: p.headRefOid, pr: p.number, source: 'pr-checks' };
      continue;
    }
    for (const v of i.verifications) {
      if (v.taskId !== l.taskId || v.pr !== l.pr || v.state !== 'verified' || !v.revision) continue;
      if (await io.contains(u.commit, v.revision)) {
        l.evidence.verified = { revision: v.revision, pr: v.pr, source: 'task-verification' };
        break;
      }
    }
  }

  // ---- inferred: build-plan rows that name the decision or a linked task ----
  const esc = i.decision.startsWith('esc:') ? `esc-${i.decision.slice(4)}`.toLowerCase() : undefined;
  for (const row of i.planRows) {
    const low = row.text.toLowerCase();
    const task = taskIdsIn(row.text)[0];
    if (!cites(row.text) && !(esc && low.includes(esc)) && !(task && byTask.has(task))) continue;
    links.push({ strength: 'inferred', ...(task ? { taskId: task } : {}), title: row.text.replace(/\s*\|\s*/g, ' | ').replace(/^\|\s*|\s*\|$/g, ''), via: `${row.file} line ${row.line} (inferred from its text)`, evidence: {} });
  }

  const acc = i.acceptances.filter((a) => a.decisions?.some((d) => d.decision === i.decision && d.rev === i.rev)).sort((a, b) => b.at - a.at)[0];
  return {
    decision: i.decision,
    rev: i.rev,
    links,
    ...(acc ? { implemented: { acceptanceId: acc.id, version: acc.version, by: acc.by, at: acc.at } } : {}),
    ...(i.kind === 'no-work-required' ? { noWorkRequired: { by: i.by ?? 'someone', at: i.answerAt, ...(i.note ? { note: i.note } : {}) } } : {}),
    evaluatedAt: i.now,
  };
}
