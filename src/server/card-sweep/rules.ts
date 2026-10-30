// Which open cards are done (release 82, team flow #2), pure: the real multi-day build left Needs you at 5 to 11
// escalations for work that was finished (merge asks and review requests whose commit was already on main,
// asks about branches long merged and deleted, a "From the chat" question the Project Manager had answered on
// another card). Each rule needs evidence the office read itself (./index.ts reads git), never an agent's word:
//   - commit-on-main: a merge ask or review request whose every named commit that exists is reachable from main;
//   - branch-gone:    a merge ask or review request naming only agent branches that exist nowhere any more
//                     (not locally, not on origin) and no commit that still exists, after a grace period;
//   - answered:       a card the office filed from an agent's words (its chat, a reply's list) about the same
//                     thing as a later card from the same agent that the Project Manager answered.
// Permission cards and the person's own (Separate, Still needed) are never swept.

import { mergeAskOf } from '../../shared/merge-target.js';
import type { AutoResolveKind, Escalation } from '../../shared/roster/escalation.js';
import { sameAsk } from '../roster/jeff-ask.js';

/** A merge ask or review request naming a branch gets this long before "branch gone" can close it (a typo, a push still to come). */
export const BRANCH_GRACE_MS = 30 * 60_000;

const REVIEW_WORD = /\b(review(s|ed|ing)?|approv(e|al|es|ed|ing)|sign[- ]?off|look at)\b/i;
const SHAS = /(?<![\w/@.-])@?([0-9a-f]{7,40})(?![\w-])/gi;
const BRANCHES = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]*\w)/g;
/** Branch names the team's agents use (office/<name>-<id>, dev/DC-n, feat/…); a path like docs/team is never one. */
const AGENT_BRANCH = /^(office|dev|feat|feature|fix|bugfix|hotfix|chore|agent|lead|team|wip|build|test|design)\/[\w./-]+$/i;
const CHAT_PREFIX = /^From the chat: /;

/** The commits and branches a card asks to merge or review, or undefined when it asks for neither. */
export interface CommitAsk {
  id: string;
  shas: string[];
  branches: string[];
}

type EscLike = Pick<Escalation, 'id' | 'by' | 'at' | 'title' | 'details' | 'options' | 'recommendation' | 'status' | 'permission' | 'from' | 'sourceGone' | 'told' | 'workerId' | 'role' | 'resolution'>;

/** A merge ask (shared/merge-target.ts) or a review request naming a commit or an agent branch. */
export function commitAskOf(e: EscLike): CommitAsk | undefined {
  if (e.permission) return undefined;
  const merge = mergeAskOf(e);
  if (merge) return { id: e.id, shas: merge.shas, branches: merge.branches.filter((b) => AGENT_BRANCH.test(b)) };
  const text = [e.title, e.details ?? '', ...(e.options ?? []), e.recommendation ?? ''].join('\n');
  if (!REVIEW_WORD.test(text) && !/\bmerg/i.test(text)) return undefined;
  const shas = [...new Set([...text.matchAll(SHAS)].map((m) => m[1].toLowerCase()).filter((s) => /[a-f]/.test(s) || s.length >= 12))];
  const branches = [...new Set([...text.matchAll(BRANCHES)].map((m) => m[1]).filter((b) => AGENT_BRANCH.test(b)))];
  return shas.length || branches.length ? { id: e.id, shas, branches } : undefined;
}

/** What git said about one card's commits and branches (./index.ts). */
export interface AskFacts {
  /** Each named commit that exists, in full, and whether main has it. */
  commits: { sha: string; onMain: boolean }[];
  /** Each named agent branch, and whether it exists locally or on origin. */
  branches: { name: string; exists: boolean }[];
}

export interface Sweep {
  id: string;
  kind: AutoResolveKind;
  reason: string;
}

/** Whether the person has had a say on the card that keeps it open (Still needed asked, a tell). */
const personKept = (e: EscLike) => !!e.sourceGone?.asked || !!e.told;

/** The card's verdict from its facts: done (with why), or undefined to leave it open. */
export function judgeCommitAsk(e: EscLike, ask: CommitAsk, f: AskFacts, main: string, now: number): Sweep | undefined {
  if (e.status !== 'open' || personKept(e)) return undefined;
  if (f.commits.length && f.commits.every((c) => c.onMain)) {
    return { id: e.id, kind: 'commit-on-main', reason: `The commit it asks about (${f.commits.map((c) => `@${c.sha.slice(0, 7)}`).join(', ')}) is on ${main} now` };
  }
  if (!f.commits.length && ask.branches.length && f.branches.length === ask.branches.length && f.branches.every((b) => !b.exists) && now - e.at >= BRANCH_GRACE_MS) {
    return { id: e.id, kind: 'branch-gone', reason: `The branch it asks about (${ask.branches.join(', ')}) is gone, locally and on origin, and none of its commits are left to merge` };
  }
  return undefined;
}

/** Office-filed cards (from the chat, from a reply's list) the Project Manager answered on a later card from the same agent. */
export function answeredElsewhere(all: readonly EscLike[]): Sweep[] {
  const out: Sweep[] = [];
  const answered = all.filter((x) => x.status === 'resolved' && x.resolution && x.resolution.by !== 'The office' && !x.resolution.auto && (x.resolution.verdict !== 'dismiss' || x.resolution.outcome === 'done'));
  for (const e of all) {
    if (e.status !== 'open' || personKept(e) || e.permission) continue;
    const filed = e.from?.kind === 'reply-ask' || CHAT_PREFIX.test(e.title);
    if (!filed) continue;
    const mine = (x: EscLike) => x.workerId === e.workerId || (!!e.role && x.role === e.role);
    const hit = answered.find((x) => x.id !== e.id && mine(x) && (x.resolution!.at ?? 0) >= e.at && sameAsk(x.title.replace(CHAT_PREFIX, ''), e.title.replace(CHAT_PREFIX, '')));
    if (hit) out.push({ id: e.id, kind: 'answered', reason: `The same question was answered on ESC-${hit.id} (${hit.resolution!.by}, ${hit.resolution!.verdict})` });
  }
  return out;
}
