// The project progress bar (the thin line between the flat views' top row and their tabs, and the mini
// one on Home's cards): a project's phases, which are the mxcli-project-toolkit's stages (its runbook's
// "stages at a glance", the titles bin/gate-check.sh writes) without the ones its entry mode doesn't run,
// then Handover and Accepted; the ✋ gates and the register's decisions as milestones on them. Only what
// was measured is shown: a gate verdict, "3 of 5 deliverables on main", a decision's date, spend from the
// ledger. Anything nobody measured is `unknown`, never a made-up percentage. Pure: the browser and the
// server (server/progress/) both import it, and derivePhases is what the tests pin.

import type { EntryMode } from './wizard.js';

export interface ToolkitStage {
  id: string;
  title: string;
  /** A ✋ hard gate: it needs a CONFIRMED decision row in PROJECT.md, not just its artifacts. */
  hand: boolean;
}

/** The toolkit's stages, in its own words (CONVERSION-RUNBOOK.md "The stages at a glance", gate-check's titles). */
export const TOOLKIT_STAGES: readonly ToolkitStage[] = [
  { id: 'P', title: 'Kickoff', hand: false },
  { id: '0', title: 'Triage', hand: true },
  { id: '1', title: 'Analysis', hand: false },
  { id: '2', title: 'Requirements', hand: false },
  { id: '3', title: 'Architecture & Design', hand: true },
  { id: '4', title: 'Build Plan', hand: true },
  { id: '5', title: 'Build', hand: false },
  { id: '6', title: 'Test', hand: false },
  { id: '7', title: 'Cutover', hand: true },
];

/** The stages an entry mode doesn't run (gate-check's stage_waiver "mode" scope, the runbook's Entry Modes table). */
export const SKIPPED_BY_MODE: Record<Exclude<EntryMode, 'assurance'>, readonly string[]> = {
  greenfield: ['1', '2', '3', '4', '7'],
  'requirements-driven': ['7'],
  'existing-app-change': ['7'],
  migration: [],
};

export type PhaseStatus = 'done' | 'waived' | 'failed' | 'waiting' | 'active' | 'pending' | 'unknown';
export type MilestoneStatus = 'passed' | 'waived' | 'failed' | 'waiting' | 'assumed' | 'pending' | 'unknown';

export interface Milestone {
  kind: 'gate' | 'decision' | 'acceptance';
  label: string;
  status: MilestoneStatus;
  /** YYYY-MM-DD, when the source dates it. */
  at?: string;
  detail?: string;
}

export interface PhaseSpend {
  /** The plan's lines for this stage, USD; undefined when the plan has none. */
  planned?: number;
  actual: number;
  /** Calls the office couldn't price were made: actual is a floor, not the whole cost. */
  partial?: boolean;
}

export interface PhaseDeliverables {
  expected: number;
  present: number;
  branch: number;
  draft: number;
  missing: number;
  items: { title: string; status: string; files?: number }[];
}

export type PhaseOpen = 'setup' | 'deliverables' | 'acceptance';

export interface Phase {
  /** A stage id (P, 0–7), `delivery` (no toolkit stages), `handover` or `accepted`. */
  id: string;
  title: string;
  kind: 'stage' | 'delivery' | 'handover' | 'accepted';
  status: PhaseStatus;
  /** The first phase that isn't done or waived. */
  current?: boolean;
  /** gate-check's verdict, as written (PASS, FAIL…). */
  verdict?: string;
  /** What was measured, a line each ("Gate: PASS", "3 of 5 deliverables on main"). */
  measures: string[];
  deliverables?: PhaseDeliverables;
  milestones: Milestone[];
  /** The first and last day the ledger booked spend to this stage (YYYY-MM-DD). */
  dates?: { first?: string; last?: string };
  spend?: PhaseSpend;
  /** What a click on it opens. */
  open: PhaseOpen;
}

/** What the bar says about acceptance (server/acceptance/). */
export interface ProgressAcceptance {
  /** The delivery cycle the bar is for: v1, then v1.1… after a reopen. */
  version: string;
  cycle: number;
  accepted?: { at: number; by: string };
  /** Why the accepted delivery no longer matches what's there now (empty: unchanged); computed on view. */
  changed?: string[];
  /** Earlier versions accepted, newest first. */
  earlier: { version: string; at: number }[];
}

/** GET /api/progress's answer. */
export interface ProjectProgress {
  floor: string;
  toolkit: boolean;
  entry?: string;
  phases: Phase[];
  acceptance: ProgressAcceptance;
  /** One line about the whole bar ("Entry mode not recorded: every stage shown"). */
  note?: string;
  /** Deliverables weren't scanned for this answer (Home's mini bar): their counts are left out, not zero. */
  mini?: boolean;
  generatedAt: number;
  admin: boolean;
}

// ---- Deriving the phases (pure) ---------------------------------------------------------------------

export interface VerdictIn {
  id: string;
  title?: string;
  status: string;
  detail?: string;
}

export interface StageDeliverablesIn extends PhaseDeliverables {
  stage: string;
}

export interface ProgressInput {
  /** A toolkit project (PROJECT.md has a decision register). */
  toolkit: boolean;
  /** The register's entry mode, parsed (undefined when it doesn't say). */
  entry?: EntryMode;
  /** gate-check's verdict per stage (with the setup panel's own Stage P and decision-row checks folded in). */
  verdicts: readonly VerdictIn[];
  decisions: readonly { stage: string; decision: string; status: string }[];
  /** Per stage; undefined when not scanned (then no counts at all). */
  deliverables?: readonly StageDeliverablesIn[];
  /** The 2-stage's BRD file count, when scanned. */
  brds?: number;
  /** Per stage id; undefined when the ledger isn't readable. */
  spend?: Readonly<Record<string, PhaseSpend & { first?: string; last?: string }>>;
  acceptance: ProgressAcceptance;
  /** The setup panel is showing (until Stage 4 is signed off): its stages open it, else the deliverables. */
  setupShown?: boolean;
}

const SETTLED: readonly PhaseStatus[] = ['done', 'waived'];
const dateIn = (s: string) => /(\d{4}-\d{2}-\d{2})/.exec(s)?.[1];
const confirmed = (s: string) => /^confirmed/i.test(s.trim());
const assumed = (s: string) => /^assumed/i.test(s.trim());

/** The stages a project runs: its entry mode's, plus any skipped one that has something in it after all. */
export function stagesFor(entry: EntryMode | undefined, verdicts: readonly VerdictIn[]): ToolkitStage[] {
  if (entry === 'assurance') return [];
  const skip = new Set(entry ? SKIPPED_BY_MODE[entry] : []);
  // gate-check's own rule: a mode excuses an EMPTY stage only. A greenfield project that wrote a build plan still has to sign it off.
  const something = (id: string) => verdicts.some((v) => v.id === id && /^(PASS|FAIL|MANUAL)$/i.test(v.status));
  return TOOLKIT_STAGES.filter((s) => !skip.has(s.id) || something(s.id));
}

/**
 * A failing gate verdict that only waits on a person's confirmation, not on broken work: a ✋ gate with no
 * sign-off yet, or a 'Confirmed by:' line still holding the toolkit's shipped placeholder. gate-check calls
 * both FAIL; the office shows them as waiting so a project that has barely started doesn't look broken.
 */
export function waitsOnPerson(detail: string | undefined): boolean {
  return /✋|placeholder|Confirmed by|CONFIRMED decision|sign-?off/i.test(detail ?? '');
}

function statusOf(v: VerdictIn | undefined, d: StageDeliverablesIn | undefined): PhaseStatus {
  if (!v) return 'unknown';
  const s = v.status.toUpperCase();
  if (s === 'PASS') return 'done';
  if (s === 'WAIVED') return 'waived';
  // A ✋ gate with artifacts and no sign-off is waiting on a person, not broken.
  if (s === 'FAIL') return waitsOnPerson(v.detail) ? 'waiting' : 'failed';
  if (s === 'MANUAL') return 'waiting';
  if (s === 'PENDING') return d && d.present + d.branch + d.draft > 0 ? 'active' : 'pending';
  return 'unknown';
}

function gateMilestone(stage: ToolkitStage, v: VerdictIn | undefined, rows: readonly { decision: string; status: string }[]): Milestone {
  const signed = rows.find((r) => confirmed(r.status));
  const label = `✋ Stage ${stage.id} sign-off`;
  if (signed) return { kind: 'gate', label, status: 'passed', at: dateIn(signed.status), detail: signed.decision };
  const s = v?.status.toUpperCase();
  if (s === 'PASS') return { kind: 'gate', label, status: 'passed', detail: v?.detail };
  if (s === 'WAIVED') return { kind: 'gate', label, status: 'waived', detail: v?.detail };
  if (s === 'FAIL') return { kind: 'gate', label, status: waitsOnPerson(v?.detail) ? 'waiting' : 'failed', detail: v?.detail };
  if (s === 'PENDING' || s === 'MANUAL') return { kind: 'gate', label, status: 'pending', detail: v?.detail };
  return { kind: 'gate', label, status: 'unknown', detail: 'gate-check has not rendered a verdict for this stage' };
}

function decisionMilestones(rows: readonly { decision: string; status: string }[], skipFirstConfirmed: boolean): Milestone[] {
  let skipped = !skipFirstConfirmed;
  const out: Milestone[] = [];
  for (const r of rows) {
    if (!skipped && confirmed(r.status)) {
      skipped = true;
      continue;
    }
    out.push({ kind: 'decision', label: r.decision || 'Decision', status: confirmed(r.status) ? 'passed' : assumed(r.status) ? 'assumed' : 'waiting', at: dateIn(r.status), detail: r.status });
  }
  return out;
}

const money = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;

/** The bar's phases from what the office measured. Never invents a count or a percentage. */
export function derivePhases(input: ProgressInput): Phase[] {
  const phases: Phase[] = [];
  const stages = input.toolkit ? stagesFor(input.entry, input.verdicts) : [];
  for (const st of stages) {
    const v = input.verdicts.find((x) => x.id === st.id);
    const d = input.deliverables?.find((x) => x.stage === st.id);
    const rows = input.decisions.filter((r) => r.stage.replace(/^stage\s*/i, '').trim().toUpperCase() === st.id);
    const measures: string[] = [];
    measures.push(v ? `Gate: ${v.status.toUpperCase()}${v.detail ? ` (${v.detail})` : ''}` : 'Gate: unknown (gate-check has not rendered this stage)');
    if (d) {
      const extra = [d.branch && `${d.branch} on a branch`, d.draft && `${d.draft} draft`].filter(Boolean).join(', ');
      measures.push(`${d.present} of ${d.expected} deliverable${d.expected === 1 ? '' : 's'} on main${extra ? ` (+${extra})` : ''}`);
    } else if (input.deliverables) measures.push('No deliverables expected at this stage');
    if (st.id === '2' && input.brds !== undefined) measures.push(`${input.brds} BRD${input.brds === 1 ? '' : 's'} on main (how many are planned isn't recorded)`);
    const sp = input.spend?.[st.id];
    const milestones = [...(st.hand ? [gateMilestone(st, v, rows)] : []), ...decisionMilestones(rows, st.hand)];
    phases.push({
      id: st.id,
      title: st.title,
      kind: 'stage',
      status: statusOf(v, d),
      ...(v ? { verdict: v.status.toUpperCase() } : {}),
      measures,
      ...(d ? { deliverables: { expected: d.expected, present: d.present, branch: d.branch, draft: d.draft, missing: d.missing, items: d.items } } : {}),
      milestones,
      ...(sp && (sp.first || sp.last) ? { dates: { first: sp.first, last: sp.last } } : {}),
      ...(sp ? { spend: { ...(sp.planned !== undefined ? { planned: sp.planned } : {}), actual: sp.actual, ...(sp.partial ? { partial: true } : {}) } } : {}),
      open: ['5', '6', '7'].includes(st.id) || input.setupShown === false ? 'deliverables' : 'setup',
    });
  }
  if (!stages.length) {
    const why = !input.toolkit ? 'Not a toolkit project: there are no stages to measure' : 'Assurance only: the toolkit runs no pipeline, so there are no stages';
    phases.push({ id: 'delivery', title: 'Delivery', kind: 'delivery', status: 'unknown', measures: [why], milestones: [], open: 'deliverables' });
  }
  phases.push({ id: 'handover', title: 'Handover', kind: 'handover', status: 'unknown', measures: ["The office doesn't record a handover yet"], milestones: [], open: 'acceptance' });
  const a = input.acceptance;
  const accMeasures = a.accepted
    ? [`${a.version} accepted ${new Date(a.accepted.at).toISOString().slice(0, 10)} by ${a.accepted.by}`, ...(a.changed?.length ? [`Changed since acceptance: ${a.changed.join('; ')}`] : [])]
    : [`${a.version} not accepted yet`];
  for (const e of a.earlier) accMeasures.push(`${e.version} accepted ${new Date(e.at).toISOString().slice(0, 10)}`);
  phases.push({
    id: 'accepted',
    title: 'Accepted',
    kind: 'accepted',
    status: a.accepted ? (a.changed?.length ? 'waiting' : 'done') : 'pending',
    measures: accMeasures,
    milestones: a.accepted ? [{ kind: 'acceptance', label: `${a.version} accepted`, status: a.changed?.length ? 'waiting' : 'passed', at: new Date(a.accepted.at).toISOString().slice(0, 10), detail: a.changed?.length ? 'changed since acceptance' : `by ${a.accepted.by}` }] : [],
    open: 'acceptance',
  });
  const cur = phases.find((p) => !SETTLED.includes(p.status) && p.kind !== 'handover');
  if (cur) cur.current = true;
  return phases;
}

/** A phase's spend in words, for its tooltip: planned against actual, and when the actual is only a floor. */
export function spendText(s: PhaseSpend | undefined): string | undefined {
  if (!s) return undefined;
  const planned = s.planned === undefined ? 'no plan line' : `planned ${money(s.planned)}`;
  return `${planned} · spent ${money(s.actual)}${s.partial ? ' + calls the office could not price' : ''}`;
}

/** The bar's one-line label: where the project is, or the accepted version and its date. */
export function progressLabel(p: Pick<ProjectProgress, 'phases' | 'acceptance'>): string {
  const a = p.acceptance;
  if (a.accepted) return `${a.version} accepted · ${new Date(a.accepted.at).toISOString().slice(0, 10)}${a.changed?.length ? ' · changed since' : ''}`;
  const cur = p.phases.find((x) => x.current);
  const prefix = a.cycle > 1 ? `${a.version} · ` : '';
  if (!cur) return `${prefix}every phase settled`;
  if (cur.kind === 'accepted') return `${a.version} ready for acceptance`;
  const how = cur.status === 'waiting' ? ' · waiting on someone' : cur.status === 'failed' ? ' · failing' : '';
  return `${prefix}${cur.kind === 'stage' ? `Stage ${cur.id} · ${cur.title}` : cur.title}${how}`;
}
