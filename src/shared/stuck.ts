// Stuck detection (server/stuck/, docs/site/using-the-office/stuck-detection.md): work that has stopped
// moving and needs the Project Manager, found by the office from what it already has (the pull-request
// poll, the build plan and PROJECT.md at main, Testing's records, the budget ledger), raised once in
// Needs you and resolved by itself when the condition clears. This file is the part both sides read:
// the item's shape, the settings, the words each item says and the messages its buttons send to the
// team lead. Pure: the page, the server and the tests import it.

/** What is stuck: a PR nobody touches, a decision only the PM can make, a test red for days, or the team busy with nothing landing. */
export type StuckKind = 'stale-pr' | 'decision' | 'failing' | 'circles' | 'blocked-row';

export type StuckAction = 'ask-lead' | 'answer' | 'accept' | 'blockers' | 'snooze' | 'dismiss';

/** Where a fact came from: a file and line at main, or a link. */
export interface StuckEvidence {
  label: string;
  file?: string;
  line?: number;
  url?: string;
}

/** A test or journey that has failed with the same failure since `since`. */
export interface FailingFact {
  name: string;
  since: number;
  detail?: string;
}

/** What a detector found: everything the item says, worked out afresh on every look. */
export interface StuckDraft {
  /** Stable: pr-51, decision-OW-1, failing-J-08, circles. */
  id: string;
  kind: StuckKind;
  /** Since when it has been stuck (ms). */
  since: number;
  /** What it holds up, in words: "J-08", "Team_Travel", "build-plan rows 59–62". */
  blocks: string[];
  evidence: StuckEvidence[];
  pr?: { number: number; title: string; url?: string };
  decision?: { id: string; question: string; rows: string; journeys: string[]; workaround?: string; accepted?: string; brd?: string };
  /** Build-plan rows whose State says blocked (stuck/blocked-rows.ts): which, on what, and the decision it names when that is resolved. */
  row?: { rows: string; blocker: string; resolved?: string };
  /** Failing tests or journeys: the item's own (failing) or linked to a stale PR that causes them. */
  failing?: FailingFact[];
  /** The failing item's cause, when the build plan names a PR. */
  waitsOn?: number;
  circles?: { activeMs: number; spend?: number; currency?: string; lastProgress?: string; lastProgressAt?: number };
}

/** An item as Needs you and its dialog show it. */
export interface StuckView extends StuckDraft {
  /** When the office first raised it (this time round). */
  raisedAt: number;
  /** Who covers Management (the Project Coordinator, or the Lead on a smaller team), when there's one. */
  lead?: string;
}

/** GET /api/stuck?floor=: the visible items, the lead's state for the "OK to interrupt?" choice, and the settings. */
export interface StuckFloorView {
  floor: string;
  on: boolean;
  items: StuckView[];
  /** Snoozed or dismissed, or covered by an open escalation about the same thing. */
  hidden: number;
  lead?: { name: string; working: boolean; since?: number };
  admin: boolean;
}

/** The thresholds, in hours. */
export interface StuckSettings {
  on: boolean;
  prHours: number;
  decisionHours: number;
  failingHours: number;
  circlesHours: number;
  by?: string;
  at?: number;
}

export const STUCK_DEFAULTS: StuckSettings = { on: true, prHours: 24, decisionHours: 24, failingHours: 48, circlesHours: 48 };
export const STUCK_HOURS_KEYS = ['prHours', 'decisionHours', 'failingHours', 'circlesHours'] as const;
export type StuckHoursKey = (typeof STUCK_HOURS_KEYS)[number];
export const STUCK_HOURS_LABEL: Record<StuckHoursKey, string> = {
  prHours: 'A pull request with no activity',
  decisionHours: 'A decision waiting on you',
  failingHours: 'A test failing the same way',
  circlesHours: 'Agents working with no progress',
};

/** How long a snooze lasts, and how long accepting a workaround keeps the decision quiet. */
export const SNOOZE_MS = 24 * 3_600_000;
export const ACCEPT_QUIET_MS = 7 * 24 * 3_600_000;

const hours = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 24 * 30 ? Math.round(v) : d);

/** Settings read from what was saved: anything missing or odd is its default. */
export function cleanStuckSettings(v: unknown): StuckSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: StuckSettings = { on: o.on !== false, prHours: hours(o.prHours, 24), decisionHours: hours(o.decisionHours, 24), failingHours: hours(o.failingHours, 48), circlesHours: hours(o.circlesHours, 48) };
  if (typeof o.by === 'string') out.by = o.by;
  if (typeof o.at === 'number') out.at = o.at;
  return out;
}

// ---- Words ----------------------------------------------------------------------------------------

/** "30 hours", "4 days". */
export function ageWords(ms: number): string {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} days`;
}

/** "A", "A and B", "A, B and C" (at most `max`, then "and N more"). */
export function listWords(xs: readonly string[], max = 4): string {
  const shown = xs.slice(0, max);
  const more = xs.length - shown.length;
  const all = more > 0 ? [...shown, `${more} more`] : shown;
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

const quoted = (b: string) => (/^(J-|build-plan|rows?\b|row )/.test(b) ? b : `'${b}'`);
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The item's one sentence (Needs you's row, the Teams card, the phone). */
export function stuckTitle(d: StuckDraft, now: number): string {
  const age = ageWords(now - d.since);
  switch (d.kind) {
    case 'stale-pr': {
      const blocks = d.blocks.length ? ` It blocks ${listWords(d.blocks.map(quoted))} (build plan).` : '';
      return `PR #${d.pr?.number} has had no activity for ${age}.${blocks}`;
    }
    case 'decision': {
      const dec = d.decision!;
      // A client question in a BRD (server/questions/): what it blocks is in its own words.
      if (dec.brd) return `Client question waiting on you: ${dec.id} ${dec.question}${/[.…?!]$/.test(dec.question) ? '' : '.'}${d.blocks.length ? ` Blocks ${listWords(d.blocks)}.` : ''}`;
      const rows = dec.rows ? ` Blocks build-plan ${dec.rows}${dec.journeys.length ? ` (${dec.journeys.join(', ')})` : ''}.` : '';
      return `Decision waiting on you: ${dec.id} ${dec.question}${/[.…?!]$/.test(dec.question) ? '' : '.'}${rows}${dec.workaround ? ` Build continues on ${dec.workaround}.` : ''}`;
    }
    case 'failing': {
      const f = d.failing?.[0];
      return `${f?.name ?? 'A test'} has failed for ${age}${d.waitsOn ? `: waits on PR #${d.waitsOn}` : f?.detail ? ` with the same failure: ${f.detail}` : ''}`;
    }
    case 'blocked-row': {
      const r = d.row!;
      const say = /^rows/.test(r.rows) ? 'say' : 'says';
      return r.resolved ? `${r.rows[0].toUpperCase()}${r.rows.slice(1)} ${say} blocked on ${r.resolved}, which is resolved: update the build plan or name the real blocker` : `Build-plan ${r.rows} ${/^rows/.test(r.rows) ? 'have' : 'has'} been blocked for ${age} on: ${r.blocker || 'no blocker named'}`;
    }
    case 'circles': {
      const c = d.circles!;
      return `The team has been working for ${ageWords(c.activeMs)} over ${age} with no progress: no merged PR, no stage change and no build-plan row change.`;
    }
  }
}

/** What waiting costs, in a sentence. */
export function stuckConsequence(d: StuckDraft): string {
  switch (d.kind) {
    case 'stale-pr':
      return d.blocks.length ? `While it waits, ${listWords(d.blocks.map(quoted))} stay${d.blocks.length === 1 ? 's' : ''} blocked, the team keeps working around ${d.blocks.length === 1 ? 'it' : 'them'}, and the PR gets harder to merge.` : 'Nothing in the build plan names it, so it may simply be forgotten; an open PR only gets harder to merge.';
    case 'decision':
      return `Until you decide, ${d.decision!.rows ? `build-plan ${d.decision!.rows} stay parked` : 'the work it holds stays parked'}${d.decision!.journeys.length ? ` and ${d.decision!.journeys.join(', ')} can't be built or tested` : ''}.`;
    case 'failing':
      return 'A test that stays red stops proving anything, and new breaks hide behind it.';
    case 'blocked-row':
      return d.row!.resolved ? `The rows stay parked on a decision that was already made, so nobody builds them.` : `While it waits, build-plan ${d.row!.rows} stay parked.`;
    case 'circles':
      return 'Spend keeps going with nothing landing.';
  }
}

/** The next safe thing to do, in a sentence. */
export function stuckNext(d: StuckDraft, lead = 'the team lead'): string {
  switch (d.kind) {
    case 'stale-pr':
      return `Ask ${lead} to rebase and merge it, or close it if it's no longer needed. The office never changes the PR itself.`;
    case 'decision':
      return d.decision!.workaround ? `Answer it, or accept ${d.decision!.workaround} for this slice.` : 'Answer it.';
    case 'failing':
      return d.waitsOn ? `Get PR #${d.waitsOn} merged or closed (ask ${lead}).` : `Ask ${lead} to fix it or say what it waits on.`;
    case 'blocked-row':
      return d.row!.resolved ? `Ask ${lead} to update the build plan, or name the real blocker.` : `Ask ${lead} what it waits on; if only you can clear it, it should be an escalation.`;
    case 'circles':
      return `Ask ${lead} for a blockers summary.`;
  }
}

/** The buttons an item has, besides the Snooze and Dismiss every item has. */
export function stuckActions(d: StuckDraft): StuckAction[] {
  switch (d.kind) {
    case 'stale-pr':
    case 'failing':
    case 'blocked-row':
      return ['ask-lead', 'snooze', 'dismiss'];
    case 'decision':
      return d.decision?.workaround ? ['answer', 'accept', 'snooze', 'dismiss'] : ['answer', 'snooze', 'dismiss'];
    case 'circles':
      return ['blockers', 'snooze', 'dismiss'];
  }
}

/** Each action's button words. */
export function actionLabel(a: StuckAction, d: StuckDraft, lead = 'the team lead'): string {
  switch (a) {
    case 'ask-lead':
      return d.kind === 'stale-pr' ? `Ask ${lead} to rebase and merge, or close it` : `Ask ${lead} to fix it`;
    case 'answer':
      return 'Answer';
    case 'accept':
      return 'Accept the current workaround for now';
    case 'blockers':
      return `Ask ${lead} for a blockers summary`;
    case 'snooze':
      return 'Snooze 1 day';
    case 'dismiss':
      return 'Dismiss';
  }
}

/** What an action sends to the team lead (as the Project Manager's message); undefined for Snooze and Dismiss. */
export function leadMessage(a: StuckAction, d: StuckDraft, now: number, answer = ''): string | undefined {
  const blocks = d.blocks.length ? ` It blocks ${listWords(d.blocks.map(quoted), 8)}.` : '';
  switch (a) {
    case 'ask-lead':
      if (d.kind === 'stale-pr')
        return `The Project Manager asks: PR #${d.pr?.number} "${d.pr?.title ?? ''}" has had no activity for ${ageWords(now - d.since)} (since ${date(d.since)}).${blocks} Rebase it on the default branch and get it reviewed and merged, or close it if it is no longer needed, then update the build-plan rows that wait on it. If something only I can decide is holding it, escalate it (office-workers escalate) with options and a recommendation.`;
      return `The Project Manager asks: ${stuckTitle(d, now)}. Fix it, or tell me exactly what it waits on; if that is something only I can decide, escalate it (office-workers escalate) with options and a recommendation.`;
    case 'answer': {
      const dec = d.decision!;
      if (dec.brd) return `The Project Manager answers open question ${dec.id} in ${dec.brd} (${dec.question}): "${answer.trim()}". Record it in that BRD's openQuestions entry ${dec.id}: status ANSWERED and this as its answer, then re-run bin/open-questions.sh.`;
      return `The Project Manager answers decision ${dec.id} (${dec.question}): "${answer.trim()}". Record it in PROJECT.md's Decisions as CONFIRMED by the Project Manager on ${date(now)}, mark ${dec.id} decided in the build plan's pending decisions${dec.rows ? `, and unblock ${dec.rows}` : ''}.`;
    }
    case 'accept': {
      const dec = d.decision!;
      return `PM accepts ${dec.workaround} for this slice; record as CONFIRMED. Decision ${dec.id} (${dec.question}) stays open: write it in PROJECT.md's Decisions as CONFIRMED by the Project Manager on ${date(now)} ("PM accepts ${dec.workaround} for this slice"), and keep ${dec.rows || 'the rows it blocks'} on it until the decision is made.`;
    }
    case 'blockers': {
      const c = d.circles!;
      return `The Project Manager asks for a blockers summary: the team has been working about ${ageWords(c.activeMs)} since ${date(d.since)} with no merged PR, no stage change and no build-plan row change. List what is blocking each open piece of work, what only I can decide (escalate those with options and a recommendation), and what you will do next.`;
    }
    default:
      return undefined;
  }
}

export const STUCK_ICON: Record<StuckKind, string> = { 'stale-pr': '⏳', decision: '❓', failing: '🔴', circles: '🔁', 'blocked-row': '🧱' };
