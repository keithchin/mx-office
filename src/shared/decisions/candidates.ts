// Each Needs-you source as a candidate for a decision card (./group.ts folds them): its compact row (the
// NeedItem the strip, the phone and Teams show), its source line, the explicit ids it can be grouped on
// (./ids.ts) and what its card says when it's the card's primary. Pure.

import type { GhPull } from '../protocol.js';
import { fyiNow, type Escalation } from '../roster/escalation.js';
import { triedItems } from '../roster/handadd.js';
import { jeffOrder, rankChip, rankOf, rankTip, sortedByJeff } from '../roster/jeff-rank.js';
import type { RosterView } from '../roster/types.js';
import type { SetupView } from '../wizard.js';
import { STUCK_ICON, stuckConsequence, stuckTitle, type StuckView } from '../stuck.js';
import { askNeeds, type AsksNeed } from '../asks.js';
import { needsWords, questionsNeedParts, type QuestionBrief, type QuestionsNeed } from '../questions.js';
import type { NeedItem } from '../needsyou.js';
import { isJourneyId, refsFromTitle } from './ids.js';
import { withoutArtifactLine } from './artifact.js';
import type { DecisionCard, DecisionKind, DecisionSource } from './types.js';
import { escalationKind } from './words.js';
import { manualInPlay, signoffMeaning, signoffState } from '../gate-play.js';
import { buildSummary, buildUnderWay } from '../build-progress.js';

export interface Candidate {
  need: NeedItem;
  source: DecisionSource;
  /** Explicit ids it groups on: q:<key>, id:<ID>, pr:<n>, stage:<id>, stuck:<id>. */
  keys: string[];
  kind: DecisionKind;
  /** Which source leads a card when several fold (lower first): a question, a toolkit sign-off (SIGNOFF_PRIO: its own dialog, never an escalation answer), then a decision escalation, a proposal, stuck, an ask, a PR check, an FYI. */
  prio: number;
  body: Pick<DecisionCard, 'question' | 'evidence' | 'blocks' | 'owner' | 'notes'> & Partial<Pick<DecisionCard, 'detail' | 'tried' | 'options' | 'recommendation' | 'why' | 'escalation' | 'questionKey' | 'gone' | 'answered' | 'duplicates' | 'after' | 'permission' | 'artifact' | 'trigger'>> & { analyst?: string };
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
export function escalationKeys(e: Pick<Escalation, 'refs' | 'title'>): string[] {
  // A record from before refs: read from its title with the same rule as at raise time (one id of a kind only), never written back.
  const r = e.refs ?? refsFromTitle(e.title);
  return [r.questionKey && `q:${r.questionKey}`, r.decisionId && `id:${r.decisionId}`, r.pr && `pr:${r.pr}`, r.stageId && `stage:${r.stageId}`, r.stuckId && `stuck:${r.stuckId}`, r.journeyId && `id:${r.journeyId}`].filter((k): k is string => !!k);
}

/** A source's small print: filed as FYI, recorded before decision cards, and "id read from the title" when its refs were derived. */
function sourceNote(e: Escalation, filedAsFyi: boolean): string | undefined {
  const parts = [filedAsFyi ? 'filed as FYI' : '', !e.refs ? 'recorded before decision cards' : '', !e.refs && escalationKeys(e).length ? 'id read from the title' : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function escalationLabel(e: Escalation, fyi: boolean): string {
  if (e.from?.kind === 'awaiting') return `AWAITING-PM in ${e.by}'s journal`;
  if (e.from?.kind === 'proposal') return `${e.by}'s approved hands-on proposal`;
  if (e.from?.kind === 'reply-ask') return `${e.by}'s reply, listed as needing you`;
  if (/^From the chat: /.test(e.title)) return `${e.by}'s chat (filed by Jeff)`;
  return fyi ? `FYI from ${e.by}` : `${e.by}'s escalation`;
}

/** The floor's open escalations as candidates: not-FYI ones in Jeff's order (or loudest, then oldest), then the FYIs. */
export function escalationCandidates(r: RosterView): Candidate[] {
  const admin = !!r.admin;
  const byJeff = sortedByJeff(r.escalations, r.settings?.jeff?.priority);
  const loud = jeffOrder(r.escalations.filter((e) => e.status === 'open' && !fyiNow(e)), byJeff, (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.at - b.at);
  const fyis = r.escalations.filter((x) => x.status === 'open' && fyiNow(x)).sort((a, b) => a.at - b.at);
  return [...loud, ...fyis].map((e) => {
    const { kind, filedAsFyi } = escalationKind(e);
    const fyi = fyiNow(e);
    const n = byJeff && !fyi ? rankOf(e) : undefined;
    const isLoud = e.urgency === 'urgent' || e.urgency === 'critical';
    const need: NeedItem = fyi
      ? { key: `fyi-${e.id}`, kind: kind === 'fyi' ? 'fyi' : 'escalation', icon: kind === 'fyi' ? 'ℹ️' : '🚩', tag: 'FYI', text: `${e.by} escalated: ${e.title}`, since: e.at, level: kind === 'fyi' ? 'info' : 'warn', action: admin ? 'Answer' : 'View', target: { to: 'escalation', id: e.id } }
      : { key: `esc-${e.id}`, kind: 'escalation', icon: '🚩', tag: e.urgency.toUpperCase(), text: `${e.by} escalated: ${e.title}`, since: e.at, level: isLoud ? 'block' : 'warn', action: admin ? 'Answer' : 'View', target: { to: 'escalation', id: e.id }, ...(n !== undefined && e.jeffRank ? { rank: { n, chip: rankChip(n), tip: rankTip(e.jeffRank, n) } } : {}) };
    const notes = [
      ...(filedAsFyi ? ['Filed as FYI, but it asks something: shown as a decision.'] : []),
      ...(e.fyiCorrected ? [`Filed as a decision, not FYI: ${e.fyiCorrected}.`] : []),
      ...(!e.refs ? [escalationKeys(e).length ? 'Recorded before decision cards: its id was read from the title.' : 'Recorded before decision cards: no id in its title, so shown on its own.'] : []),
      ...(e.told ? [`${e.told.by} told ${e.by} at ${hhmm(e.told.at)}: ${e.told.what}`] : []),
    ];
    const label = escalationLabel(e, kind === 'fyi');
    return {
      need,
      source: { id: `esc:${e.id}`, type: 'escalation', label, text: e.title, target: need.target, escalation: e.id, ...(kind === 'fyi' ? { fyi: true } : {}), ...(sourceNote(e, filedAsFyi) ? { note: sourceNote(e, filedAsFyi) } : {}) },
      keys: escalationKeys(e),
      kind,
      prio: kind === 'fyi' ? 7 : 1,
      body: {
        question: e.title,
        ...(para(withoutArtifactLine(e.details)) ? { detail: para(withoutArtifactLine(e.details)) } : {}),
        ...(triedItems(e.details).length ? { tried: triedItems(e.details) } : {}),
        ...(e.options.length ? { options: e.options } : {}),
        ...(e.recommendation ? { recommendation: e.recommendation } : {}),
        evidence: e.from?.kind === 'awaiting' ? [{ label: `The AWAITING-PM line in ${e.by}'s newest journal entry`, where: 'its details' }] : e.from?.kind === 'reply-ask' ? [{ label: `${e.by}'s reply`, where: e.from.message ? `team chat, message ${e.from.message}` : 'its terminal (its last message)' }] : [],
        blocks: [],
        owner: e.by,
        notes,
        escalation: e.id,
        ...(e.artifact ? { artifact: e.artifact } : {}),
        ...(e.trigger ? { trigger: e.trigger } : {}),
        ...(e.sourceGone ? { gone: e.sourceGone } : {}),
        ...(e.permission ? { permission: { command: e.permission.command, rule: e.permission.rule, ...(e.permission.suggested ? { suggested: e.permission.suggested } : {}), count: e.permission.count, who: e.permission.who ?? e.by, ...(e.permission.allowed ? { allowed: e.permission.allowed } : {}) }, after: e.permission.allowed ? `After you allowed it: ${e.by} is told to run it again. This card closes by itself once the office sees the command run; if Claude Code still denies it, the session may need a restart to read the rule.` : `Approving in the office doesn't change Claude Code's permission settings. Allow writes exactly this rule for ${e.by} on this project; the card stays open until the office sees the command run.` } : {}),
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
    const need: NeedItem = { key: `appr-${a.id}`, kind: 'approval', icon, text, ...(a.at ? { since: a.at } : {}), level: 'warn', action: admin ? 'Review' : 'View', target: { to: 'approvals' } };
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
  const evidenceOf = (need: NeedItem) => (need.target.to === 'ask' ? [...(asks?.items.find((i) => i.id === (need.target as { id: string }).id)?.evidence ?? [])] : []);
  return askNeeds(asks, floor).map((need) => ({
    need,
    source: { id: `ask:${need.key.replace(/^asks-/, '')}`, type: 'ask', label: 'surfaced from the team’s files', text: need.text, target: need.target, ...(unread ? { note: unread } : {}) },
    keys: [],
    kind: need.kind === 'assumption' ? 'decision' : need.level === 'info' ? 'fyi' : 'status',
    prio: 5,
    body: { question: need.text, evidence: evidenceOf(need), blocks: [], owner: 'the lead', notes: unread ? [`Kept as it was: ${unread}.`] : [] },
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

/**
 * The toolkit stage at a ✋ gate waiting for your sign-off: a MANUAL stage only when it's the one in play
 * (every earlier stage passed or waived: shared/gate-play.ts). gate-check reports Stage 5 (Build) MANUAL
 * from a project's first run, and that is a stage not started, not a decision. Its Sign off opens the
 * sign-off dialog (ui/signoff/), which asks the lead to record the toolkit's CONFIRMED Decisions row.
 * It never goes through an escalation's answer: it leads any card it folds into (SIGNOFF_PRIO), so the
 * card's only buttons are Sign off (confirmed in the dialog) and Not yet. Once signed off in the office
 * it is a status line until the register has the row; once the row is there it is gone.
 */
export function signoffCandidates(setup: SetupView | undefined): Candidate[] {
  const out: Candidate[] = [];
  const all = setup?.verdicts?.length ? setup.verdicts : setup?.show ? setup.stages : [];
  for (const s of all) {
    if (!manualInPlay(all, s.id, setup?.decisions)) continue;
    const st = signoffState(setup, s.id);
    if (st.state === 'recorded') continue;
    const target = { to: 'signoff', stage: s.id, title: s.title } as const;
    const evidence = [{ label: `gate-check: Stage ${s.id} MANUAL${s.detail ? ` (${s.detail})` : ''}` }];
    if (st.state === 'requested') {
      const lead = st.req.lead ?? 'the lead';
      const need: NeedItem = { key: `setup-${s.id}`, kind: 'setup', icon: '✋', text: `Stage ${s.id} (${s.title}) signed off by ${st.req.by}: waiting for ${lead} to record it in PROJECT.md`, since: st.req.at, level: 'info', action: 'View', target };
      out.push({ need, source: { id: `stage:${s.id}`, type: 'signoff', label: 'the toolkit’s gate check', text: need.text, target }, keys: [`stage:${s.id}`], kind: 'status', prio: SIGNOFF_PRIO, body: { question: need.text, detail: signoffMeaning(s.id, s.title), evidence, blocks: [], owner: lead, notes: [`It goes once PROJECT.md’s Decisions has a CONFIRMED row for Stage ${s.id}.`], after: `Nothing more to do: ${lead} records it and the card goes once the register says so.` } });
      continue;
    }
    // The build under way (shared/build-progress.ts): its sign-off is for when it's complete, so the card says where it is instead of nagging.
    const building = s.id === '5' && buildUnderWay(setup?.stage?.build);
    const text = building ? `Stage ${s.id} (${s.title}) is in progress (${buildSummary(setup!.stage!.build!)}): sign it off once the build is complete` : `Stage ${s.id} (${s.title}) waits for your sign-off`;
    const need: NeedItem = { key: `setup-${s.id}`, kind: 'setup', icon: '✋', text, level: building ? 'info' : 'warn', action: 'Sign off', target };
    out.push({ need, source: { id: `stage:${s.id}`, type: 'signoff', label: 'the toolkit’s gate check', text: need.text, target }, keys: [`stage:${s.id}`], kind: 'decision', prio: SIGNOFF_PRIO, body: { question: need.text, detail: signoffMeaning(s.id, s.title), evidence, blocks: [], owner: 'the toolkit', notes: ['Sign off asks the team lead to add the CONFIRMED row to PROJECT.md’s Decisions, after their turn. Nothing is sent until you confirm it.'], after: 'After you sign off: the lead is told “Signed off” with the exact Decisions row to add, after their current turn. This card then says it waits for them to record it.' } });
  }
  return out;
}

/** A sign-off leads any card it folds into (after a client question): its answer path is the sign-off dialog, never an escalation's free-text answer. */
export const SIGNOFF_PRIO = 0.5;
