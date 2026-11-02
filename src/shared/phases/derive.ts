// What the office works out about the phases, pure: each phase's exit criteria from what it recorded (journey
// results on main, the mx check at main, data-impact holds), when a phase moves on (to its checkpoint, or done
// and the next one started), the soft budget badge against the team's estimate, and the dates the timeline
// draws (actual for started phases; the team's days, re-forecast from the pace of the active phase, for the
// rest). Also a first cut of phases from the build plan's own headings, for a Project Manager setting them up
// before the team proposed any.

import type { Phase, PhaseExit, ExitJourney, PhaseDraft } from './types.js';

export const DAY_MS = 86_400_000;

export interface ExitInputs {
  /** main's head. */
  commit?: string;
  /** The newest decided result of each journey on a commit on main. */
  journeyResults: Record<string, 'passed' | 'failed'>;
  /** The mx check at main's head, when one ran there. */
  modelCheck?: { status: 'pass' | 'fail' | 'error'; errors?: number; commit: string };
  /** Data-impact holds standing without an approval. */
  openDataImpacts: number;
}

/** A phase's exit criteria now: its journeys passed on main, mx check 0 errors at main, no open data impact. */
export function exitOf(p: Pick<Phase, 'journeys'>, x: ExitInputs, now: number): PhaseExit {
  const journeys: Record<string, ExitJourney> = {};
  for (const j of p.journeys) journeys[j] = x.journeyResults[j] === 'passed' ? 'pass' : x.journeyResults[j] === 'failed' ? 'fail' : 'owed';
  const mc = x.modelCheck;
  const modelCheck: PhaseExit['modelCheck'] = !mc ? { status: 'none' } : mc.status === 'pass' && !mc.errors ? { status: 'pass', errors: 0, commit: mc.commit } : { status: 'fail', ...(mc.errors !== undefined ? { errors: mc.errors } : {}), commit: mc.commit };
  const allPass = p.journeys.length > 0 && p.journeys.every((j) => journeys[j] === 'pass');
  return { at: now, ...(x.commit ? { commit: x.commit } : {}), journeys, modelCheck, openDataImpacts: x.openDataImpacts, met: allPass && modelCheck.status === 'pass' && x.openDataImpacts === 0 };
}

export interface Advance {
  /** The phase that reached its exit: to its checkpoint (checkpoint on) or done. */
  phase: string;
  to: 'checkpoint' | 'done';
  /** The phase started after it (when it went straight to done). */
  started?: string;
  exit: PhaseExit;
}

/**
 * Moves the active phases whose exit criteria are met: to 'checkpoint' when the phase stops for the Project
 * Manager's review, else to 'done' with the next planned phase started. Changes `phases` in place; what moved.
 */
export function advance(phases: Phase[], exits: ReadonlyMap<string, PhaseExit>, now: number): Advance[] {
  const out: Advance[] = [];
  for (const p of phases) {
    if (p.status !== 'active') continue;
    const exit = exits.get(p.id);
    if (!exit?.met) continue;
    p.exit = exit;
    if (p.checkpoint) {
      p.status = 'checkpoint';
      out.push({ phase: p.id, to: 'checkpoint', exit });
      continue;
    }
    p.status = 'done';
    p.endedAt = now;
    const next = startNext(phases, now);
    out.push({ phase: p.id, to: 'done', exit, ...(next ? { started: next.id } : {}) });
  }
  return out;
}

/** Starts the first planned phase when none is running; the phase started. */
export function startNext(phases: Phase[], now: number): Phase | undefined {
  if (phases.some((p) => p.status === 'active' || p.status === 'checkpoint')) return undefined;
  const next = phases.find((p) => p.status === 'planned');
  if (!next) return undefined;
  next.status = 'active';
  next.startedAt = now;
  return next;
}

/** The phase "in progress" for the strip and the headline: the first active or at its checkpoint. */
export const currentPhase = (phases: readonly Phase[]) => phases.find((p) => p.status === 'active' || p.status === 'checkpoint');

export type BadgeKind = 'ok' | 'pace' | 'upper' | 'over' | 'none';
export interface Badge {
  kind: BadgeKind;
  text: string;
  /** Projected spend at the end, when the pace says. */
  projected?: number;
}

/** At least this share of a phase's rows done before its pace projects anything. */
export const PACE_MIN_SHARE = 0.15;

/**
 * The soft warning against the team's estimate: "Over by $5" past the top of the range, "Pace $130" when the
 * spend so far, at the share of rows done, reaches the top, "Upper half" at the checkpoint above the middle,
 * else "In range". A badge only: nothing pauses on it (the project total keeps its own auto-pause).
 */
export function budgetBadge(p: Pick<Phase, 'status' | 'estimate'>, spent: number, share: number, warnAbove?: number): Badge {
  const { min, max } = p.estimate;
  const top = warnAbove && warnAbove > 0 ? Math.min(max || warnAbove, warnAbove) : max;
  if (p.status === 'planned' && spent < 0.5) return { kind: 'none', text: '' };
  if (top > 0 && spent > top) return { kind: 'over', text: `Over by $${Math.round(spent - top)}` };
  if (p.status === 'active' && share >= PACE_MIN_SHARE && share < 1 && top > 0) {
    const projected = Math.round(spent / share);
    if (projected >= top) return { kind: 'pace', text: `Pace $${projected}`, projected };
  }
  if ((p.status === 'checkpoint' || p.status === 'done') && max > 0 && spent > (min + max) / 2 && spent <= top) return { kind: 'upper', text: 'Upper half' };
  return { kind: 'ok', text: 'In range' };
}

/** Working days for a phase with no estimate of its own: half a day a row, at least 2. */
export const defaultDays = (rows: number) => Math.max(2, Math.ceil(rows / 2));

export interface Span {
  start: number;
  end: number;
  /** Both ends happened (a done phase). */
  actual: boolean;
  /** When the early work (overlap) began, before `start`. */
  earlyFrom?: number;
}

/**
 * The timeline's dates: a done phase from its start to its end; the active one from its start to a forecast
 * (the team's days, or longer when the pace of its rows says so); planned ones after it in order, each its
 * days long. Midnight-aligned times in ms.
 */
export function spans(phases: readonly Phase[], rowsDone: (p: Phase) => number, now: number, startAt?: number): Map<string, Span> {
  const out = new Map<string, Span>();
  const day = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
  let cursor = day(startAt ?? now);
  for (const p of phases) {
    const days = p.days ?? defaultDays(p.rows.length);
    const early = p.early ? day(p.early.since) : undefined;
    if ((p.status === 'done' || p.status === 'stopped') && p.startedAt) {
      const s = day(p.startedAt);
      const e = Math.max(s + DAY_MS, day(p.endedAt ?? now) + DAY_MS);
      out.set(p.id, { start: s, end: e, actual: true, ...(early !== undefined && early < s ? { earlyFrom: early } : {}) });
      cursor = e;
      continue;
    }
    if ((p.status === 'active' || p.status === 'checkpoint') && p.startedAt) {
      const s = day(p.startedAt);
      const elapsed = Math.max(1, Math.ceil((day(now) - s) / DAY_MS) + 1);
      const share = p.rows.length ? rowsDone(p) / p.rows.length : 0;
      const byPace = share >= PACE_MIN_SHARE ? Math.ceil(elapsed / share) : 0;
      const total = p.status === 'checkpoint' ? elapsed : Math.max(days, byPace, elapsed + 1);
      const e = s + total * DAY_MS;
      out.set(p.id, { start: s, end: e, actual: false, ...(early !== undefined && early < s ? { earlyFrom: early } : {}) });
      cursor = Math.max(cursor, e);
      continue;
    }
    const s = Math.max(cursor, day(now));
    const e = s + days * DAY_MS;
    out.set(p.id, { start: s, end: e, actual: false, ...(early !== undefined && early < s ? { earlyFrom: early } : {}) });
    cursor = e;
  }
  return out;
}

/** A first cut from the build plan's "### Phase N — …" headings (shared/liveapp/plan.ts parsePlan's phases), for the PM to edit. */
export function draftsFromPlan(planPhases: readonly { title: string; rows: { n: number }[] }[], journeys: readonly { id: string; rows: number[] }[]): PhaseDraft[] {
  return planPhases.slice(0, 20).map((ph, i) => {
    const rows = ph.rows.map((r) => r.n);
    const js = journeys.filter((j) => j.rows.some((r) => rows.includes(r))).map((j) => j.id);
    return { name: ph.title.slice(0, 80) || `Phase ${i + 1}`, goal: '', foundation: i === 0, rows, journeys: js, estimate: { min: 0, max: 0 }, days: defaultDays(rows.length), checkpoint: true, publish: true };
  });
}

/** The phases' journeys made unique: a journey a draft repeats stays with the first phase that names it. */
export function uniqueJourneys(drafts: PhaseDraft[]): PhaseDraft[] {
  const seen = new Set<string>();
  return drafts.map((d) => ({ ...d, journeys: (d.journeys ?? []).filter((j) => (seen.has(j) ? false : (seen.add(j), true))) }));
}
