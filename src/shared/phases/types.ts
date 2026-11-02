// Phased delivery (docs/site/using-the-office/phased-delivery.md): Build cut into business-outcome phases, a
// foundation phase first. The team proposes the phases at the Build Plan gate (Stage 4) from its build plan
// (architecture/build-plan.md rows) and the journeys that prove each one; the Project Manager approves or edits
// them on the Roadmap. Every later change (split, merge, reorder, move rows, a switch, starting a phase early)
// is a recorded change with an id (C-n), who proposed it, who decided and why. Exit criteria are filled in by
// the office from what it recorded itself (journey runs on main, the mx check, data-impact holds), never by an
// agent. A phase's budget is a soft warning only: the project total keeps its auto-pause.
// Pure types and constants: the server (server/phases/) and the page (ui/roadmap/) both read them.

export type PhaseStatus = 'planned' | 'active' | 'checkpoint' | 'done' | 'stopped';
export const PHASE_STATUSES: readonly PhaseStatus[] = ['planned', 'active', 'checkpoint', 'done', 'stopped'];

/** A journey's state for a phase's exit: passed or failed on a commit on main, or not run there yet. */
export type ExitJourney = 'pass' | 'fail' | 'owed';

/** What the office recorded against a phase's exit criteria (never written by an agent). */
export interface PhaseExit {
  at: number;
  /** Main's head the criteria were read at. */
  commit?: string;
  journeys: Record<string, ExitJourney>;
  modelCheck: { status: 'pass' | 'fail' | 'none'; errors?: number; commit?: string };
  openDataImpacts: number;
  /** Every journey passed, the model check has 0 errors and no data impact is open. */
  met: boolean;
}

/** Publishing a phase to the sandbox (part 2 fills it: the Studio Pro hand-off or the pipeline). */
export interface PhaseDeploy {
  mode: 'studio-pro' | 'pipeline';
  state: 'ready' | 'deploying' | 'published' | 'failed';
  revision?: string;
  at?: number;
}

/** A phase started before the one in front of it ended (design ahead, usually): who works on it early. */
export interface PhaseEarly {
  since: number;
  /** The teams working on it early (shared/roster/roles.ts TeamId: 'design', 'development'…). */
  teams: string[];
  /** "design", "wireframes": what is done early, in a word or two. */
  what: string;
}

export interface Phase {
  /** 'ph-3': stable; a new phase gets the next free number. */
  id: string;
  name: string;
  /** The business outcome, one sentence. */
  goal: string;
  foundation: boolean;
  /** Build-plan row numbers (architecture/build-plan.md's `#` column). */
  rows: number[];
  useCases: string[];
  /** The journeys that prove it (tests/e2e/*.journey.json ids). A journey belongs to one phase. */
  journeys: string[];
  /** The team's estimate in USD. */
  estimate: { min: number; max: number };
  /** The team's estimate in working days (the timeline's planned bars). */
  days?: number;
  /** Stop for the Project Manager's review at the end. */
  checkpoint: boolean;
  /** Publish to the sandbox at the end. */
  publish: boolean;
  status: PhaseStatus;
  /** Phase ids worked on at the same time (a later phase's design started early). */
  overlapsWith: string[];
  early?: PhaseEarly;
  startedAt?: number;
  endedAt?: number;
  exit?: PhaseExit;
  deploy?: PhaseDeploy;
  /** The phase-end report (Documents › Phase N), part 2. */
  reportDocId?: string;
}

export type ChangeKind = 'approve' | 'split' | 'merge' | 'reorder' | 'move-rows' | 'toggle' | 'rename' | 'overlap' | 'estimate' | 'add' | 'edit';

export interface Who {
  kind: 'agent' | 'pm' | 'office';
  name: string;
  /** The agent's role title ("Project Coordinator"). */
  role?: string;
}

/** One phase as it was before or after a change (what the history shows). */
export interface PhaseLite {
  id: string;
  name: string;
  rows: number[];
  status: PhaseStatus;
  checkpoint: boolean;
  publish: boolean;
}

export interface PhaseChange {
  /** 'C-4'. */
  id: string;
  kind: ChangeKind;
  summary: string;
  reason: string;
  proposedBy: Who;
  decidedBy?: Who;
  decision?: 'accepted' | 'declined';
  /** The proposal it came from (P-n), when the team proposed it. */
  proposal?: string;
  at: number;
  diff: { before: PhaseLite[]; after: PhaseLite[] };
}

/** One edit to the phases: what the team's proposals, the gate editor and Edit phases all send. */
export type PhaseOp =
  | { op: 'rename'; phase: string; name?: string; goal?: string }
  | { op: 'move-rows'; rows: number[]; to: string }
  | { op: 'reorder'; order: string[] }
  | { op: 'split'; phase: string; rows: number[]; name: string; goal?: string }
  | { op: 'merge'; phases: string[] }
  | { op: 'toggle'; phase: string; checkpoint?: boolean; publish?: boolean; foundation?: boolean }
  | { op: 'overlap'; phase: string; teams: string[]; what: string }
  | { op: 'estimate'; phase: string; min: number; max: number; days?: number }
  | { op: 'journeys'; phase: string; journeys: string[] }
  | { op: 'add'; name: string; goal?: string; rows?: number[]; after?: string };

/** What the team proposes for a phase when it proposes the whole plan. */
export interface PhaseDraft {
  name: string;
  goal: string;
  foundation?: boolean;
  rows: number[];
  useCases?: string[];
  journeys?: string[];
  estimate: { min: number; max: number };
  days?: number;
  checkpoint?: boolean;
  publish?: boolean;
}

export interface PhaseProposal {
  /** 'P-2'. */
  id: string;
  /** plan: the whole set at the Build Plan gate; change: edits to the approved phases. */
  kind: 'plan' | 'change';
  by: Who;
  at: number;
  summary: string;
  reason: string;
  /** For a plan. */
  phases?: PhaseDraft[];
  /** For a change. */
  ops?: PhaseOp[];
  /** How many changes the plan had when it was proposed (an accepted change since makes it re-apply its ops). */
  base: number;
  status: 'open' | 'accepted' | 'declined' | 'superseded';
  decidedAt?: number;
  decidedBy?: Who;
  /** The words the decision came with (a decline's reason). */
  note?: string;
}

export interface DeliveryPrefs {
  publishAtPhaseEnd: boolean;
  checkpointAtPhaseEnd: boolean;
  envelope: 'team-estimate' | { warnAbove: number };
}

export interface PhasePlan {
  version: 1;
  /** Chosen in the New project wizard's Delivery step (part 2); 'phases' once the team proposed or the PM set them up. */
  delivery: 'one-go' | 'phases';
  prefs: DeliveryPrefs;
  /** none: no phases; proposed: waiting for the Build Plan gate; approved: Build runs in phases. */
  state: 'none' | 'proposed' | 'approved';
  phases: Phase[];
  /** Cutover's estimate (after the last phase), from the team. */
  cutover?: { min: number; max: number; days?: number };
  changes: PhaseChange[];
  proposals: PhaseProposal[];
  approvedAt?: number;
}

export const DEFAULT_PREFS: DeliveryPrefs = { publishAtPhaseEnd: true, checkpointAtPhaseEnd: true, envelope: 'team-estimate' };

export const emptyPlan = (): PhasePlan => ({ version: 1, delivery: 'one-go', prefs: { ...DEFAULT_PREFS }, state: 'none', phases: [], changes: [], proposals: [] });

/** At most this many phases, rows per phase, changes and proposals kept. */
export const LIMITS = { phases: 20, rows: 400, journeys: 80, changes: 500, proposals: 200, name: 80, goal: 300, reason: 1000 } as const;

/** "Small app": the wizard's default is "in one go" under this size (part 2's Delivery step). */
export const SMALL_APP = { rows: 40, areas: 3 } as const;

/** How many times a phase may fail its exit criteria before the office suggests a split (never forces one). */
export const SPLIT_HINT_AFTER_DAYS = 5;
