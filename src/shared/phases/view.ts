// What the Roadmap and the Overview's phase strip show (GET /api/phases), put together from the plan and what
// the office read (server/phases/inputs.ts): per phase its rows with the done ones, its journeys with their
// results on main, the exit criteria, spend against the estimate with the soft badge, its dates, the merges
// that delivered its rows; Discovery before the phases and Cutover after them; the open proposals and the
// change history. Pure, so tests drive it and the page reads its types.

import { budgetBadge, draftsFromPlan, exitOf, spans, type Badge, type ExitInputs, type Span } from './derive.js';
import { phaseSpend, type SpendInput } from './spend.js';
import type { DeliveryPrefs, ExitJourney, Phase, PhaseChange, PhaseDraft, PhaseExit, PhasePlan, PhaseProposal } from './types.js';

export interface PhaseLine {
  id: string;
  order: number;
  name: string;
  goal: string;
  foundation: boolean;
  status: Phase['status'];
  checkpoint: boolean;
  publish: boolean;
  /** The other phases it overlaps, by their place (3). */
  overlaps: number[];
  early?: Phase['early'];
  rows: { n: number; step: string; done: boolean }[];
  rowsDone: number;
  useCases: string[];
  journeys: { id: string; title?: string; result: ExitJourney }[];
  exit: PhaseExit;
  spend: number;
  estimate: { min: number; max: number };
  days?: number;
  badge: Badge;
  span: Span;
  merges: { pr?: number; sha: string; title: string; at: number }[];
  startedAt?: number;
  endedAt?: number;
  deploy?: Phase['deploy'];
}

export interface PhasesView {
  floor: string;
  admin: boolean;
  now: number;
  plan: { state: PhasePlan['state']; delivery: PhasePlan['delivery']; prefs: DeliveryPrefs; approvedAt?: number; cutover?: PhasePlan['cutover'] };
  phases: PhaseLine[];
  proposals: PhaseProposal[];
  changes: PhaseChange[];
  discovery: { spend: number; start?: number; end?: number; done: boolean };
  cutover: { spend: number; estimate?: { min: number; max: number }; start: number; end: number };
  unassigned: number;
  spent: number;
  budget?: { total: number; autoPause: boolean };
  /** Every build-plan row at main, for the editors' Move to and the rows not in any phase. */
  buildRows: { n: number; step: string; heading?: string; done: boolean }[];
  journeysAll: { id: string; title?: string }[];
  /** The toolkit stage the budget books to now. */
  stage: string;
  main?: string;
  /** The office's first cut from the build plan's headings, when there are no phases yet (the PM may start from it). */
  draft?: PhaseDraft[];
  note?: string;
}

export interface ViewInput {
  floor: string;
  admin: boolean;
  now: number;
  plan: PhasePlan;
  planRows: readonly { n: number; step: string; phase?: string }[];
  /** The build plan's phases as headings (shared/liveapp/plan.ts), for the draft. */
  planPhases: readonly { title: string; rows: { n: number }[] }[];
  done: ReadonlySet<number>;
  journeys: readonly { id: string; title?: string; rows: number[] }[];
  exit: ExitInputs;
  spend: Omit<SpendInput, 'phases'>;
  merges: readonly { pr?: number; sha: string; title: string; at: number; rows: number[] }[];
  budget?: { total: number; autoPause: boolean };
  stage: string;
  /** When the project's Discovery began (the ledger's first stage note), if known. */
  discoveryFrom?: number;
}

const DAY = 86_400_000;

export function buildView(i: ViewInput): PhasesView {
  const { plan } = i;
  const stepOf = new Map(i.planRows.map((r) => [r.n, r]));
  const titleOf = new Map(i.journeys.map((j) => [j.id, j.title]));
  const money = phaseSpend({ ...i.spend, phases: plan.phases });
  const doneIn = (p: Phase) => p.rows.filter((r) => i.done.has(r)).length;
  const firstStart = plan.phases.find((p) => p.startedAt)?.startedAt;
  const sp = spans(plan.phases, doneIn, i.now, firstStart ?? i.now);
  const warnAbove = typeof plan.prefs.envelope === 'object' ? plan.prefs.envelope.warnAbove : undefined;
  const lines: PhaseLine[] = plan.phases.map((p, idx) => {
    const done = doneIn(p);
    const spend = money.byPhase[p.id] ?? 0;
    const live = p.status === 'active' || p.status === 'planned' || p.status === 'checkpoint' ? exitOf(p, i.exit, i.now) : (p.exit ?? exitOf(p, i.exit, i.now));
    return {
      id: p.id,
      order: idx + 1,
      name: p.name,
      goal: p.goal,
      foundation: p.foundation,
      status: p.status,
      checkpoint: p.checkpoint,
      publish: p.publish,
      overlaps: p.overlapsWith.map((id) => plan.phases.findIndex((x) => x.id === id) + 1).filter((n) => n > 0),
      ...(p.early ? { early: p.early } : {}),
      rows: p.rows.map((n) => ({ n, step: stepOf.get(n)?.step ?? '', done: i.done.has(n) })),
      rowsDone: done,
      useCases: p.useCases,
      journeys: p.journeys.map((id) => ({ id, ...(titleOf.get(id) ? { title: titleOf.get(id) } : {}), result: live.journeys[id] ?? 'owed' })),
      exit: live,
      spend,
      estimate: p.estimate,
      ...(p.days ? { days: p.days } : {}),
      badge: budgetBadge(p, spend, p.rows.length ? done / p.rows.length : 0, warnAbove),
      span: sp.get(p.id)!,
      merges: i.merges.filter((m) => m.rows.some((r) => p.rows.includes(r))).slice(0, 30).map(({ rows: _r, ...m }) => m),
      ...(p.startedAt ? { startedAt: p.startedAt } : {}),
      ...(p.endedAt ? { endedAt: p.endedAt } : {}),
      ...(p.deploy ? { deploy: p.deploy } : {}),
    };
  });
  const firstPhaseStart = lines.length ? Math.min(...lines.map((l) => l.span.earlyFrom ?? l.span.start)) : i.now;
  const lastEnd = lines.length ? Math.max(...lines.map((l) => l.span.end)) : i.now;
  const cutDays = plan.cutover?.days ?? 5;
  const discoveryEnd = firstStart ?? (plan.state === 'approved' ? firstPhaseStart : undefined);
  return {
    floor: i.floor,
    admin: i.admin,
    now: i.now,
    plan: { state: plan.state, delivery: plan.delivery, prefs: plan.prefs, ...(plan.approvedAt ? { approvedAt: plan.approvedAt } : {}), ...(plan.cutover ? { cutover: plan.cutover } : {}) },
    phases: lines,
    proposals: [...plan.proposals].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.at - a.at).slice(0, 20),
    changes: [...plan.changes].reverse().slice(0, 60),
    discovery: { spend: money.discovery, ...(i.discoveryFrom ? { start: i.discoveryFrom } : {}), ...(discoveryEnd ? { end: discoveryEnd } : {}), done: !!firstStart },
    cutover: { spend: money.cutover, ...(plan.cutover ? { estimate: { min: plan.cutover.min, max: plan.cutover.max } } : {}), start: lastEnd, end: lastEnd + cutDays * DAY },
    unassigned: money.unassigned,
    spent: money.total,
    ...(i.budget ? { budget: i.budget } : {}),
    buildRows: i.planRows.map((r) => ({ n: r.n, step: r.step, ...(r.phase ? { heading: r.phase } : {}), done: i.done.has(r.n) })),
    journeysAll: i.journeys.map((j) => ({ id: j.id, ...(j.title ? { title: j.title } : {}) })),
    stage: i.stage,
    ...(i.exit.commit ? { main: i.exit.commit } : {}),
    ...(plan.state === 'none' && i.planPhases.length ? { draft: draftsFromPlan(i.planPhases, i.journeys) } : {}),
    ...(!i.planRows.length ? { note: 'No build plan on main yet (architecture/build-plan.md): the team proposes phases from it at the Build Plan gate.' } : {}),
  };
}

/** "Build · Events (3 of 8)": the strip's headline, when a phase is in progress. */
export function buildHeadline(v: Pick<PhasesView, 'phases'>): { phase?: PhaseLine; text: string } {
  const line = v.phases.find((l) => l.status === 'active' || l.status === 'checkpoint');
  if (!line) {
    const done = v.phases.filter((l) => l.status === 'done').length;
    return { text: done === v.phases.length && done ? `Build · all ${done} phases done` : `Build · ${v.phases.length} phases planned` };
  }
  return { phase: line, text: `Build · ${line.name} (${line.order} of ${v.phases.length})` };
}

/** "$90–130" for an estimate; "no estimate" for none. */
export const rangeText = (e: { min: number; max: number }) => (e.max > 0 ? `$${e.min}–${e.max}` : 'no estimate');

/** "$65" (whole dollars from $10, cents below). */
export const usd = (n: number) => (n >= 10 || n === 0 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

/** A phase's share of rows done, 0-100. */
export const percentDone = (l: Pick<PhaseLine, 'rowsDone' | 'rows'>) => (l.rows.length ? Math.round((100 * l.rowsDone) / l.rows.length) : 0);
