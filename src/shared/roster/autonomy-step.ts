// The New project flow's required autonomy step (docs/site/teams-and-agents/autonomy.md): what each level
// lets the agent team do without asking, and what still needs the person, in plain words. Every line is
// generated from the tables the Playbooks, the standup and the escalation channel already use
// (AUTONOMY.approves, teamMayDecide, REVIEW_POLICY, quietTurns in ./autonomy.ts), never a second table, so
// the wizard can't promise what the office doesn't do. Each approval line says how it is held: the office
// stops it by itself, only a person can do it, or the team is only told to wait.
//
// Also the office's small organisation policy (off by default: limit the levels a new project may pick,
// or fix one level), what a project records about its choice, and how that reads. Pure: the browser too.

import {
  AUTONOMY,
  CRITICAL_TRIGGERS,
  DEFAULT_AUTONOMY,
  HUMAN_TRIGGERS,
  REVIEW_POLICY,
  TRIGGER_LABEL,
  isAutonomyLevel,
  quietTurns,
  teamMayDecide,
  type AutonomyLevel,
  type DecisionKind,
  type EscalationTrigger,
} from './autonomy.js';

export const LEVELS: readonly AutonomyLevel[] = [1, 2, 3, 4];

/** The level the step recommends for a new project (a badge, never a preselection): the office's own default. */
export const RECOMMENDED: AutonomyLevel = DEFAULT_AUTONOMY;

// ---- The copy, from the gate tables -----------------------------------------------------------------

/** Each decision kind in a business person's words (the gate mapping itself is AUTONOMY.approves). */
export const PLAIN_KIND: Record<DecisionKind, string> = {
  task: 'Tasks within the agreed scope',
  scope: 'Work outside the agreed scope',
  design: 'Design changes',
  architecture: 'Architecture changes',
  'peer-review': 'Approving another team’s work',
  merge: 'Merging finished work into the main version',
  milestone: 'Closing internal milestones',
  'client-milestone': 'Client-facing milestones',
  budget: 'Spending past the budget',
  'human-action': 'Hands-on actions only a person can do (sign-ins, keys, installs)',
};

/** Two kinds that read better as one line when they fall on the same side. */
const JOINED: readonly [DecisionKind, DecisionKind, string][] = [
  ['design', 'architecture', 'Design and architecture changes'],
  ['milestone', 'client-milestone', 'Closing milestones, internal and client-facing'],
];

/**
 * How an approval is held. `stops`: the office enforces it by itself (spending: the project pauses at 100 %
 * of its budget when auto-pause is on). `only-you`: no agent can do it at all. `told`: the office lists it
 * for the person and instructs the agents, but nothing technically blocks them.
 */
export type Held = 'stops' | 'only-you' | 'told';
export const HELD_LABEL: Record<Held, string> = { stops: 'stops automatically', 'only-you': 'only you can', told: 'team is told to wait' };

/** How `kind` is held when it needs the person. Spending stops by itself only while auto-pause is on. */
export function heldOf(kind: DecisionKind, opts: { autoPause?: boolean } = {}): Held {
  if (kind === 'budget') return opts.autoPause === false ? 'told' : 'stops';
  if (kind === 'human-action') return 'only-you';
  return 'told';
}

export interface PreviewLine {
  text: string;
  /** The kinds the line stands for (one, or two joined). */
  kinds: DecisionKind[];
}
export interface ApprovalLine extends PreviewLine {
  held: Held;
}

export interface LevelPreview {
  level: AutonomyLevel;
  name: string;
  /** One plain line under the level's name. */
  one: string;
  /** What the team may do without asking. */
  may: PreviewLine[];
  /** Said when `may` is empty, or a note under it. */
  mayNote: string;
  /** What still requires the person's approval, each with how it's held. */
  approvals: ApprovalLine[];
  /** Finished turns: reviewed or quiet. */
  turns: string;
  /** What alerts the person, beyond what always does. */
  alerts: string;
}

function lines(kinds: readonly DecisionKind[]): PreviewLine[] {
  const out: PreviewLine[] = [];
  const done = new Set<DecisionKind>();
  for (const k of kinds) {
    if (done.has(k)) continue;
    const pair = JOINED.find(([a, b]) => (a === k || b === k) && kinds.includes(a) && kinds.includes(b));
    if (pair) {
      done.add(pair[0]).add(pair[1]);
      out.push({ text: pair[2], kinds: [pair[0], pair[1]] });
    } else {
      done.add(k);
      out.push({ text: PLAIN_KIND[k], kinds: [k] });
    }
  }
  return out;
}

const listWords = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** What alerts the person at `level` beyond what always does (CRITICAL_TRIGGERS, HUMAN_TRIGGERS), from REVIEW_POLICY. */
function alertsLine(level: AutonomyLevel): string {
  const p = REVIEW_POLICY[level];
  const always = new Set<EscalationTrigger>([...CRITICAL_TRIGGERS, ...HUMAN_TRIGGERS]);
  const extra = p.escalate.filter((t) => !always.has(t)).map((t) => (t === 'revisions-exhausted' ? `work still failing review after ${p.maxRevisions} rounds` : TRIGGER_LABEL[t]));
  if (!extra.length) return 'Only critical issues alert you.';
  return `Alerts you about ${listWords(extra)}, as well as critical issues.`;
}

/** The step's preview of `level`, every line from the gate tables. `autoPause`: whether the project pauses at its budget. */
export function levelPreview(level: AutonomyLevel, opts: { autoPause?: boolean } = {}): LevelPreview {
  const a = AUTONOMY[level];
  const p = REVIEW_POLICY[level];
  const may = lines(teamMayDecide(level));
  return {
    level,
    name: a.name,
    one: a.plain,
    may,
    mayNote: may.length ? '' : `Nothing on its own: the team proposes every task${p.askBeforeNextStep ? ' and asks before each next step' : ''}.`,
    approvals: lines(a.approves).map((l) => ({ ...l, held: l.kinds.some((k) => heldOf(k, opts) === 'stops') ? 'stops' : l.kinds.some((k) => heldOf(k, opts) === 'only-you') ? 'only-you' : 'told' })),
    turns: quietTurns(level) ? 'Finished turns are quiet; what needs you arrives as an escalation.' : 'Each finished turn waits for your review.',
    alerts: alertsLine(level),
  };
}

/** The step's title, note and footer: the same words in the wizard, the docs and the tests. */
export const STEP_TITLE = 'How much should the agent team do without asking you?';
export const STEP_NOTE = 'Your organisation’s approval and deployment rules still apply, whatever you choose. Budget is set separately. You can change this later; the change is recorded.';
/** The words for the issues that always alert, from CRITICAL_TRIGGERS (a test checks they still are). */
export const ALWAYS_REACH: readonly EscalationTrigger[] = ['security', 'data-loss', 'budget-overrun'];
export const HELD_FOOTER = 'How this is held: “stops automatically” — the office enforces it. “Only you can” — no agent can do it. “Team is told to wait” — the office lists it for you and instructs the agents; it does not technically block them (for example, merges are only blocked if your main branch is protected on GitHub). Whatever you choose: security, data-loss and budget-overrun issues always reach you, spending stops at your budget while auto-pause is on, and deployment stays with people (the office has no deploy action; agents are told never to deploy).';
export const CHOOSE_REASON = 'Choose a level to continue. Nothing is preselected.';
export const ACK_REASON = 'Confirm the level your organisation set to continue.';

/** The by-stage option the step offers under a level below Delegated (toolkit projects: the existing autonomy by stage). */
export const BY_STAGE_TO: AutonomyLevel = 3;
export const byStageOffered = (level: AutonomyLevel, allowed: readonly AutonomyLevel[]) => level < BY_STAGE_TO && allowed.includes(BY_STAGE_TO);
export const byStageLabel = () => `Let the level rise to ${BY_STAGE_TO} ${AUTONOMY[BY_STAGE_TO].name} once the build plan (Stage 4) is approved`;

// ---- The organisation policy ------------------------------------------------------------------------

/**
 * The office's autonomy policy (off by default): `limit` lets a new project pick only `allowed`; `fixed`
 * sets `level` for every new project, shown locked and acknowledged. Kept small on purpose: no roles,
 * no clients; an admin sets it under ⚙️ Settings › 👥 Team (Autonomy policy for new projects).
 */
export interface AutonomyPolicy {
  mode: 'none' | 'limit' | 'fixed';
  allowed?: AutonomyLevel[];
  level?: AutonomyLevel;
  /** What the organisation calls it ("Delivery rules"), shown in the step. */
  name?: string;
  by?: string;
  at?: number;
}

export const NO_POLICY: AutonomyPolicy = { mode: 'none' };

export function cleanPolicy(v: unknown): AutonomyPolicy {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.replace(/[\r\n]+/g, ' ').trim().slice(0, 80) : '';
  const meta = { ...(name ? { name } : {}), ...(typeof r.by === 'string' && r.by ? { by: r.by.slice(0, 80) } : {}), ...(typeof r.at === 'number' && Number.isFinite(r.at) ? { at: r.at } : {}) };
  if (r.mode === 'fixed' && isAutonomyLevel(r.level)) return { mode: 'fixed', level: r.level, ...meta };
  if (r.mode === 'limit' && Array.isArray(r.allowed)) {
    const allowed = LEVELS.filter((l) => (r.allowed as unknown[]).includes(l));
    if (allowed.length && allowed.length < LEVELS.length) return { mode: 'limit', allowed, ...meta };
  }
  return { ...NO_POLICY };
}

/** The levels a new project may pick under `p`. */
export function allowedLevels(p: AutonomyPolicy | undefined): AutonomyLevel[] {
  if (p?.mode === 'fixed' && p.level) return [p.level];
  if (p?.mode === 'limit' && p.allowed?.length) return [...p.allowed];
  return [...LEVELS];
}

/** The policy in a line ("Fixed at 2 Guided", "Up to 3 Delegated"). */
export function policyWords(p: AutonomyPolicy | undefined): string {
  if (p?.mode === 'fixed' && p.level) return `Fixed at ${p.level} ${AUTONOMY[p.level].name}`;
  if (p?.mode === 'limit' && p.allowed?.length) return `Only ${listWords(p.allowed.map((l) => `${l} ${AUTONOMY[l].name}`))}`;
  return 'None: every level may be chosen';
}

/** What the step sends with the plan. */
export interface AutonomyAsk {
  level: AutonomyLevel;
  /** The person ticked "I understand…" for a level the policy fixed. */
  ack?: boolean;
  /** Let the level rise to Delegated once the build plan passes (byStageOffered). */
  byStage?: boolean;
}

export const STEP_REQUIRED = 'Choose how much the agent team may do without asking you';

/** Why `ask` can't be used under `p`, or undefined. */
export function askProblem(ask: AutonomyAsk | undefined, p: AutonomyPolicy | undefined): string | undefined {
  if (!ask || !isAutonomyLevel(ask.level)) return STEP_REQUIRED;
  const allowed = allowedLevels(p);
  if (!allowed.includes(ask.level)) return p?.mode === 'fixed' ? `Your organisation’s policy fixes the level at ${p.level} ${AUTONOMY[p.level!].name}` : `Level ${ask.level} isn’t allowed by your organisation’s policy (${policyWords(p)})`;
  if (p?.mode === 'fixed' && ask.ack !== true) return `Confirm you understand the team will work at ${p.level} ${AUTONOMY[p.level!].name}, as set by your organisation`;
  if (ask.byStage && !byStageOffered(ask.level, allowed)) return `Rising to ${BY_STAGE_TO} ${AUTONOMY[BY_STAGE_TO].name} by stage isn’t offered at level ${ask.level}${allowed.includes(BY_STAGE_TO) ? '' : ' under your organisation’s policy'}`;
  return undefined;
}

/** The level an older caller (no step) gets: 2 Guided, or the nearest the policy allows. */
export function olderCallerLevel(p: AutonomyPolicy | undefined): { level: AutonomyLevel; source: AutonomySource } {
  const allowed = allowedLevels(p);
  if (allowed.includes(DEFAULT_AUTONOMY) && p?.mode !== 'fixed') return { level: DEFAULT_AUTONOMY, source: 'default' };
  const level = [...allowed].sort((a, b) => Math.abs(a - DEFAULT_AUTONOMY) - Math.abs(b - DEFAULT_AUTONOMY) || a - b)[0];
  return { level, source: 'policy' };
}

// ---- What a project records ---------------------------------------------------------------------

/** Chosen in the step; set by the organisation's policy; or the default for a caller without the step. */
export type AutonomySource = 'chosen' | 'policy' | 'default';
export const SOURCE_LABEL: Record<AutonomySource, string> = { chosen: 'chosen', policy: 'set by your organisation’s policy', default: 'default (older caller)' };

export interface AutonomyChoice {
  level: AutonomyLevel;
  source: AutonomySource;
  /** Who: the account's name, or the name on the page with the shared password. */
  by: string;
  byId?: string;
  /** Signed in with the shared office password, not an account. */
  shared?: boolean;
  at: number;
  /** The policy's name when one applied. */
  policy?: string;
  acknowledged?: boolean;
  byStage?: boolean;
}

/** The latest change made on the Team settings after the project was created. */
export interface AutonomyChange {
  from: AutonomyLevel;
  to: AutonomyLevel;
  by: string;
  byId?: string;
  at: number;
}

/** What GET /api/roster carries about the level's origin: nothing recorded means the project predates the step (or came in another way). */
export interface AutonomyRecordView {
  choice?: AutonomyChoice;
  last?: AutonomyChange;
  policy: AutonomyPolicy;
}

const who = (c: { by: string; shared?: boolean }) => `${c.by}${c.shared ? ' (shared password)' : ''}`;

/** "Chosen by Alex Lee on 20 Oct 2026", and the like; `date` formats a time. */
export function choiceLine(c: AutonomyChoice | undefined, date: (ms: number) => string): string {
  if (!c) return 'No choice recorded: this project was set up before the autonomy step, or added without the New project wizard. It keeps its settings.';
  const lvl = `${c.level} ${AUTONOMY[c.level].name}`;
  if (c.source === 'chosen') return `${lvl}, chosen by ${who(c)} on ${date(c.at)}${c.byStage ? `; rises to ${BY_STAGE_TO} ${AUTONOMY[BY_STAGE_TO].name} once the build plan passes` : ''}.`;
  if (c.source === 'policy') return `${lvl}, set by your organisation’s policy${c.policy ? ` (${c.policy})` : ''}${c.acknowledged ? `, acknowledged by ${who(c)}` : ` for ${who(c)}`} on ${date(c.at)}.`;
  return `${lvl}, the default for a project created without the autonomy step (older caller), by ${who(c)} on ${date(c.at)}.`;
}

export function changeLine(ch: AutonomyChange | undefined, date: (ms: number) => string): string {
  if (!ch) return '';
  return `Changed from ${ch.from} ${AUTONOMY[ch.from].name} to ${ch.to} ${AUTONOMY[ch.to].name} by ${ch.by} on ${date(ch.at)}.`;
}

/** A budget level card's "what it changes" without its autonomy line: on a project that chose its level in the step, the budget level never changes autonomy. */
export const withoutAutonomyLine = (changes: readonly string[]) => changes.filter((c) => !/^Autonomy\b/i.test(c));

/**
 * Why a Team settings change goes outside the policy (a level it doesn't allow, or autonomy by stage that
 * would reach one), or undefined. Only what changes is checked, so a project already outside a newer policy
 * can still save its other settings.
 */
export function outsidePolicy(p: AutonomyPolicy, raw: unknown, current: { autonomy: AutonomyLevel; autonomyByStage?: { enabled: boolean; early: AutonomyLevel; build: AutonomyLevel } }): string | undefined {
  if (p.mode === 'none') return undefined;
  const s = (raw && typeof raw === 'object' ? raw : {}) as { autonomy?: unknown; autonomyByStage?: { enabled?: unknown; early?: unknown; build?: unknown } };
  const allowed = allowedLevels(p);
  const why = `Your organisation’s autonomy policy (${policyWords(p)}) doesn’t allow it; an admin can change the policy under ⚙️ Settings › 👥 Team (Autonomy policy for new projects)`;
  if (isAutonomyLevel(s.autonomy) && s.autonomy !== current.autonomy && !allowed.includes(s.autonomy)) return `Level ${s.autonomy} ${AUTONOMY[s.autonomy].name}: ${why}`;
  const b = s.autonomyByStage;
  if (b && b.enabled === true) {
    const levels = [b.early, b.build].filter(isAutonomyLevel);
    const was = current.autonomyByStage;
    const changed = !was?.enabled || was.early !== b.early || was.build !== b.build;
    if (changed && levels.some((l) => !allowed.includes(l))) return `Autonomy by stage would reach a level outside the policy: ${why}`;
  }
  return undefined;
}
