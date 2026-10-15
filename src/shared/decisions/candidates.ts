// Each Needs-you source as a candidate for a decision card (./group.ts folds them): its compact row (the
// NeedItem the strip, the phone and Teams show), its source line, the explicit ids it can be grouped on
// (./ids.ts) and what its card says when it's the card's primary. Pure.

import type { GhPull } from '../protocol.js';
import type { Escalation } from '../roster/escalation.js';
import { jeffOrder, rankChip, rankOf, rankTip, sortedByJeff } from '../roster/jeff-rank.js';
import type { RosterView } from '../roster/types.js';
import type { SetupView } from '../wizard.js';
import { STUCK_ICON, stuckConsequence, stuckTitle, type StuckView } from '../stuck.js';
import { askNeeds, type AsksNeed } from '../asks.js';
import { needsWords, questionsNeedParts, type QuestionBrief, type QuestionsNeed } from '../questions.js';
import type { NeedItem } from '../needsyou.js';
import { isJourneyId, refsFromTitle } from './ids.js';
import type { DecisionCard, DecisionKind, DecisionSource } from './types.js';
import { escalationKind } from './words.js';

export interface Candidate {
  need: NeedItem;
  source: DecisionSource;
  /** Explicit ids it groups on: q:<key>, id:<ID>, pr:<n>, stage:<id>, stuck:<id>. */
  keys: string[];
  kind: DecisionKind;
  /** Which source leads a card when several fold (lower first): a question, then a decision escalation, a proposal, a sign-off, stuck, an ask, a PR check, an FYI. */
  prio: number;
  body: Pick<DecisionCard, 'question' | 'evidence' | 'blocks' | 'owner' | 'notes'> & Partial<Pick<DecisionCard, 'detail' | 'options' | 'recommendation' | 'why' | 'escalation' | 'questionKey' | 'gone' | 'answered'>> & { analyst?: string };
  /** A free-text test name it is about: other cards naming it are "possibly related", never merged. */
  mentions?: string;
}

const URGENCY_RANK: Record<Escalation['urgency'], number> = { critical: 0, urgent: 1, important: 2, info: 3 };
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + ' UTC';
const para = (s: string) => {
  const p = s.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()).find(Boolean);
  return p && p.length > 320 ? `${p.slice(0, 310).replace(/\s+\S*$/, '')}…` : p;
};

/** An escalation's grouping keys: only what it names explicitly (refs); a record from before refs groups on nothing. */
export function escalationKeys(e: Pick<Escalation, 'refs'>): string[] {
  const r = e.refs;
  if (!r) return [];
  return [r.questionKey && `q:${r.questionKey}`, r.decisionId && `id:${r.decisionId}`, r.pr && `pr:${r.pr}`, r.stageId && `stage:${r.stageId}`, r.stuckId && `stuck:${r.stuckId}`, r.journeyId && `id:${r.journeyId}`].filter((k): k is string => !!k);
}

function escalationLabel(e: Escalation, fyi: boolean): string {
  if (e.from?.kind === 'awaiting') return `AWAITING-PM in ${e.by}'s journal`;
  if (e.from?.kind === 'proposal') return `${e.by}'s approved hands-on proposal`;
  if (/^From the chat: /.test(e.title)) return `${e.by}'s chat (filed by Jeff)`;
  return fyi ? `FYI from ${e.by}` : `${e.by}'s escalation`;
}

/** The floor's open escalations as candidates: not-FYI ones in Jeff's order (or loudest, then oldest), then the FYIs. */
export function escalationCandidates(r: RosterView): Candidate[] {
  const admin = !!r.admin;
  const byJeff = sortedByJeff(r.escalations, r.settings?.jeff?.priority);
  const loud = jeffOrder(r.escalations.filter((e) => e.status === 'open' && !e.fyi), byJeff, (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.at - b.at);
  const fyis = r.escalations.filter((x) => x.status === 'open' && x.fyi).sort((a, b) => a.at - b.at);
  return [...loud, ...fyis].map((e) => {
    const { kind, filedAsFyi } = escalationKind(e);
    const n = byJeff && !e.fyi ? rankOf(e) : undefined;
    const isLoud = e.urgency === 'urgent' || e.urgency === 'critical';
    const need: NeedItem = e.fyi
      ? { key: `fyi-${e.id}`, kind: kind === 'fyi' ? 'fyi' : 'escalation', icon: kind === 'fyi' ? 'ℹ️' : '🚩', tag: 'FYI', text: `${e.by} escalated: ${e.title}`, since: e.at, level: kind === 'fyi' ? 'info' : 'warn', action: admin ? 'Answer' : 'View', target: { to: 'escalation', id: e.id } }
      : { key: `esc-${e.id}`, kind: 'escalation', icon: '🚩', tag: e.urgency.toUpperCase(), text: `${e.by} escalated: ${e.title}`, since: e.at, level: isLoud ? 'block' : 'warn', action: admin ? 'Answer' : 'View', target: { to: 'escalation', id: e.id }, ...(n !== undefined && e.jeffRank ? { rank: { n, chip: rankChip(n), tip: rankTip(e.jeffRank, n) } } : {}) };
    const notes = [
      ...(filedAsFyi ? ['Filed as FYI, but it asks something: shown as a decision.'] : []),
      ...(!e.refs ? ['Recorded before decision cards: shown on its own, not grouped.'] : []),
      ...(e.told ? [`${e.told.by} told ${e.by} at ${hhmm(e.told.at)}: ${e.told.what}`] : []),
    ];
    const label = escalationLabel(e, kind === 'fyi');
    return {
      need,
      source: { id: `esc:${e.id}`, type: 'escalation', label, text: e.title, target: need.target, escalation: e.id, ...(kind === 'fyi' ? { fyi: true } : {}), ...(filedAsFyi ? { note: 'filed as FYI' } : !e.refs ? { note: 'recorded before decision cards' } : {}) },
      keys: escalationKeys(e),
      kind,
      prio: kind === 'fyi' ? 7 : 1,
      body: {
        question: e.title,
        ...(para(e.details) ? { detail: para(e.details) } : {}),
        ...(e.options.length ? { options: e.options } : {}),
        ...(e.recommendation ? { recommendation: e.recommendation } : {}),
        evidence: e.from?.kind === 'awaiting' ? [{ label: `The AWAITING-PM line in ${e.by}'s newest journal entry`, where: 'its details' }] : [],
        blocks: [],
        owner: e.by,
        notes,
        escalation: e.id,
        ...(e.sourceGone ? { gone: e.sourceGone } : {}),
      },
    } satisfies Candidate;
  });
}

/** Proposals, merges and the rest of the approvals waiting on you (escalations are above; the cap when paused is its own line). */
export function approvalCandidates(r: RosterView): Candidate[] {
  const admin = !!r.admin;
  const out: Candidate[] = [];
  for (const a of r.approvals) {
    if (a.kind === 'escalation' || (a.kind === 'cap' && r.paused)) continue;
    const icon = a.kind === 'merge' ? '🔀' : a.kind === 'cap' ? '💸' : a.kind === 'subagent' ? '🧰' : '📝';
    const text = a.kind === 'proposal' ? `Proposal to approve: ${a.title}` : a.kind === 'subagent' ? `To approve: ${a.title}` : a.title;
    const need: NeedItem = { key: `appr-${a.id}`, kind: 'approval', icon, text, level: 'warn', action: admin ? 'Review' : 'View', target: { to: 'approvals' } };
    const refs = refsFromTitle(a.title);
    const pr = a.kind === 'merge' ? Number(a.id.replace(/^m-/, '')) || refs.pr : refs.pr;
    const keys = [pr && `pr:${pr}`, refs.decisionId && `id:${refs.decisionId}`, refs.journeyId && `id:${refs.journeyId}`].filter((k): k is string => !!k);
    out.push({ need, source: { id: `appr:${a.id}`, type: 'approval', label: a.kind === 'proposal' ? 'a proposal waiting on you' : a.kind === 'merge' ? 'a merge waiting on you' : 'an approval', text, target: need.target }, keys, kind: 'decision', prio: 2, body: { question: text, ...(a.detail ? { detail: a.detail } : {}), evidence: [], blocks: [], owner: a.detail.split(' (')[0] || 'the team', notes: [] } });
  }
  return out;
}

/** A stuck item's grouping keys: its PR, its decision (a BRD question by key, a register id by id), a journey id, and itself. */
function stuckKeys(s: StuckView): { keys: string[]; mentions?: string } {
  const keys = [`stuck:${s.id}`];
  if (s.pr) keys.push(`pr:${s.pr.number}`);
  if (s.decision) keys.push(s.decision.brd ? `q:${s.questionKey ?? `${s.decision.brd}#${s.decision.id}`}` : `id:${s.decision.id}`);
  const f = s.kind === 'failing' ? s.failing?.[0]?.name : undefined;
  if (f && isJourneyId(f)) keys.push(`id:${f}`);
  return { keys, ...(f && !isJourneyId(f) ? { mentions: f } : {}) };
}

/** Stuck detection's visible items. A client question's Answer goes to the Questions page, never a message to the lead. */
export function stuckCandidates(items: readonly StuckView[], now: number): Candidate[] {
  return items.map((s) => {
    const lead = s.lead ?? 'the lead';
    const brdKey = s.decision?.brd ? (s.questionKey ?? `${s.decision.brd}#${s.decision.id}`) : undefined;
    const action = s.kind === 'decision' ? 'Answer' : s.kind === 'stale-pr' ? `Ask ${lead}` : s.kind === 'circles' ? 'Ask for blockers' : 'Review';
    const target = brdKey ? ({ to: 'questions', key: brdKey } as const) : ({ to: 'stuck', id: s.id } as const);
    const need: NeedItem = { key: `stuck-${s.id}`, kind: 'stuck', icon: STUCK_ICON[s.kind], tag: 'Stuck', text: stuckTitle(s, now), since: s.since, level: s.kind === 'decision' || s.kind === 'stale-pr' ? 'block' : 'warn', action, target };
    const unread = s.unreadAt ? `couldn't re-read the source at ${hhmm(s.unreadAt)}` : undefined;
    const { keys, mentions } = stuckKeys(s);
    const where = s.decision ? (s.decision.brd ? `stuck detection (${s.decision.brd})` : 'stuck detection (PROJECT.md / build plan)') : 'stuck detection';
    return {
      need,
      source: { id: `stuck:${s.id}`, type: 'stuck', label: where, text: need.text, target, ...(unread ? { note: unread } : {}) },
      keys,
      kind: s.kind === 'decision' ? 'decision' : 'status',
      prio: 4,
      body: {
        question: need.text,
        detail: stuckConsequence(s),
        evidence: s.evidence.map((x) => ({ label: x.label, ...(x.url ? { where: x.url } : x.file ? { where: `${x.file}${x.line ? `:${x.line}` : ''}` } : {}) })),
        blocks: s.blocks.map((b) => ({ label: b })),
        owner: lead,
        notes: unread ? [`Kept as it was: ${unread}. Nothing resolves on a failed read.`] : [],
        ...(brdKey ? { questionKey: brdKey } : {}),
      },
      ...(mentions ? { mentions } : {}),
    } satisfies Candidate;
  });
}

/** One card per question waiting on you (and per answer of yours not recorded yet); an older office's batch row when there are no items. */
export function questionCandidates(qn: QuestionsNeed | undefined): Candidate[] {
  if (!qn) return [];
  if (!qn.items) {
    const parts = questionsNeedParts(qn);
    if (!parts) return [];
    const need: NeedItem = { key: parts.key, kind: 'questions', icon: '❓', text: parts.text, ...(parts.since !== undefined ? { since: parts.since } : {}), level: parts.level, action: 'Answer', target: { to: 'questions' } };
    return [{ need, source: { id: `q:${parts.key}`, type: 'question', label: 'Questions page', target: need.target }, keys: [], kind: 'decision', prio: 0, body: { question: parts.text, evidence: [], blocks: [], owner: 'the analysts', notes: [] } }];
  }
  const ids = new Map<string, number>();
  for (const b of qn.items) ids.set(b.id, (ids.get(b.id) ?? 0) + 1);
  return qn.items.map((b: QuestionBrief) => {
    const blocking = !!b.blocks && !/^\s*(none|nothing|n\/a|-)?\s*\.?\s*$/i.test(b.blocks);
    const need: NeedItem = { key: `q-${b.key}`, kind: 'questions', icon: '❓', tag: b.id, text: b.answered ? `${b.id}: your answer is ${b.answered.status === 'sent' ? `sent to ${b.answered.to ?? 'the analyst'}` : 'ready to send'}, not recorded yet` : `Question for the client: ${b.id} ${b.question}`, ...(b.since !== undefined ? { since: b.since } : {}), level: b.answered ? 'info' : blocking ? 'block' : 'warn', action: b.answered?.status === 'pending' ? 'Send' : 'Answer', target: { to: 'questions', key: b.key }, ...(qn.waiting > 0 ? { notify: { key: `questions-b${qn.batch}`, text: needsWords(qn) } } : {}) };
    // A register row (PROJECT.md's OQ-07) is the same question as the BRD's OQ-07, when only one BRD has that id.
    const keys = [`q:${b.key}`, ...(ids.get(b.id) === 1 ? [`id:${b.id}`] : [])];
    return {
      need,
      source: { id: `q:${b.key}`, type: 'question', label: `Questions page (${b.file})`, text: b.question, target: need.target },
      keys,
      kind: b.answered ? 'status' : 'decision',
      prio: 0,
      body: {
        question: b.question,
        ...(b.brdTitle || b.brd ? { detail: `${b.brd ?? ''}${b.brdTitle ? ` ${b.brdTitle}` : ''}`.trim() } : {}),
        ...(b.options?.length ? { options: b.options } : {}),
        ...(b.proposedPosition ? { recommendation: b.proposedPosition } : {}),
        evidence: [{ label: `${b.file}: openQuestions ${b.id} (${b.state})`, where: b.where }],
        blocks: blocking ? b.blocks!.split(/\s*,\s*/).filter(Boolean).map((x) => ({ label: x })) : [],
        owner: 'the analyst',
        notes: [],
        questionKey: b.key,
        ...(b.answered ? { answered: { status: b.answered.status, ...(b.answered.to ? { to: b.answered.to } : {}) } } : {}),
      },
    } satisfies Candidate;
  });
}

/** Surfaced asks (server/asks/): consent is a decision, the rest status; kept as they were when the last read failed. */
export function askCandidates(asks: (AsksNeed & { unreadAt?: number }) | undefined, floor: string | undefined): Candidate[] {
  const unread = asks?.unreadAt ? `couldn't re-read at ${hhmm(asks.unreadAt)}` : undefined;
  return askNeeds(asks, floor).map((need) => ({
    need,
    source: { id: `ask:${need.key.replace(/^asks-/, '')}`, type: 'ask', label: 'surfaced from the team’s files', text: need.text, target: need.target, ...(unread ? { note: unread } : {}) },
    keys: [],
    kind: need.kind === 'assumption' ? 'decision' : need.level === 'info' ? 'fyi' : 'status',
    prio: 5,
    body: { question: need.text, evidence: [], blocks: [], owner: 'the lead', notes: unread ? [`Kept as it was: ${unread}.`] : [] },
  }));
}

/** Open, ready PRs whose checks fail. */
export function prCheckCandidates(pulls: readonly GhPull[]): Candidate[] {
  return pulls
    .filter((p) => p.state === 'OPEN' && !p.isDraft && p.checks === 'fail')
    .map((p) => {
      const need: NeedItem = { key: `pr-${p.number}`, kind: 'pr', icon: '❌', text: `PR #${p.number} has failing checks: ${p.title}`, since: Date.parse(p.updatedAt) || undefined, level: 'warn', action: `Open PR #${p.number}`, target: { to: 'pr', number: p.number } };
      return { need, source: { id: `pr:${p.number}`, type: 'pr-check', label: 'PR checks', text: need.text, target: need.target }, keys: [`pr:${p.number}`], kind: 'status', prio: 6, body: { question: need.text, evidence: [{ label: `PR #${p.number} on GitHub`, ...(p.url ? { where: p.url } : {}) }], blocks: [], owner: p.author ?? 'its author', notes: [] } } satisfies Candidate;
    });
}

/** Toolkit stages at a ✋ gate, waiting for your sign-off. */
export function signoffCandidates(setup: SetupView | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const s of setup?.verdicts?.length ? setup.verdicts : setup?.show ? setup.stages : []) {
    if (s.status !== 'MANUAL') continue;
    const need: NeedItem = { key: `setup-${s.id}`, kind: 'setup', icon: '✋', text: `Stage ${s.id} (${s.title}) waits for your sign-off`, level: 'warn', action: 'Sign off', target: { to: 'setup' } };
    out.push({ need, source: { id: `stage:${s.id}`, type: 'signoff', label: 'the toolkit’s gate check', text: need.text, target: need.target }, keys: [`stage:${s.id}`], kind: 'decision', prio: 3, body: { question: need.text, evidence: [], blocks: [], owner: 'the toolkit', notes: [] } });
  }
  return out;
}
