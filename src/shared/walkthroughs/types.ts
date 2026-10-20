// Walkthrough videos of a project's workflows (server/walkthroughs/): a recording of one test journey
// played against the live app, with captions, click highlights and step screenshots, and a manifest that
// ties it to the exact build it recorded. Evidence for that commit only; a failed step is a failed video.
// Pure types (no Node imports): the page reads them too.

import type { BootPhase, BootTiming } from '../app-instance.js';
import type { IdentityHint, IdentitySource } from './identity.js';
import type { WalkPlan } from './plan.js';
import type { StartState } from './start-state.js';

/**
 * Where a widget action looks (the journey runner's `within` + `hasText`): inside the first container
 * matching `within` whose text has `hasText` (plain text, any case), not the first match on the page.
 */
export interface WalkTarget {
  within?: string;
  hasText?: string;
}

/**
 * One thing the recorder does in a step (the toolkit journey-runner's vocabulary, same semantics:
 * server/walkthroughs/actions.ts). `settleMs`: the wait after it (the runner's 1200 ms when not given).
 */
export type WalkAction = (
  | ({ do: 'click'; selector: string } & WalkTarget)
  | ({ do: 'fill'; selector: string; value: string; blur?: true } & WalkTarget)
  | ({ do: 'combobox'; selector: string; match: string } & WalkTarget)
  | ({ do: 'setFiles'; selector: string; files: string[] } & WalkTarget)
  | { do: 'nav'; group?: string; item: string }
  | { do: 'pickLanguage'; match: string }
  | { do: 'dismissModal' }
  | { do: 'wait'; ms: number }
  | { do: 'goto'; path: string }
) & { caption: string; settleMs?: number };

/** What must be true once a step's actions are done. */
export interface WalkChecks {
  /** A CSS selector that must be visible. */
  ready?: string;
  /** Selectors that must be visible. */
  visible: string[];
  textPresent: string[];
  textAbsent: string[];
}

export interface WalkStep {
  n: number;
  /** The caption: the step's name, in the journey's own words. */
  caption: string;
  actions: WalkAction[];
  checks: WalkChecks;
  /** Why it can't be walked as written (a seed only a database query gives): the step fails with this. */
  blocked?: string;
  /** What of the step a recording doesn't check (its `data` OQL, its `spans`), said beside the step. */
  unchecked?: string;
}

export interface WalkScript {
  journey: string;
  title: string;
  file: string;
  /** Use cases and rows it proves (UC-01, F101#/useCases/0/mainFlow/0, "build-plan row 10"). */
  requirement: string[];
  persona?: string;
  /** Who the journey says runs it (./identity.ts). */
  identity?: IdentityHint;
  /** Its `$comment` lines about time windows and start states, shown when a recording of it fails. */
  notes?: string[];
  /** What it needs from the database before it starts (./start-state.ts), as the file says it. */
  start?: StartState;
  steps: WalkStep[];
}

/** skipped: the batch's plan didn't play it (its time window, an order that can't hold), with the reason. */
export type RecordingStatus = 'queued' | 'recording' | 'passed' | 'failed' | 'cancelled' | 'error' | 'skipped';
export type RecordingTrigger = 'manual' | 'auto';

export interface ManifestStep {
  n: number;
  caption: string;
  status: 'passed' | 'failed' | 'not-run';
  /** Milliseconds from the video's start. */
  startMs?: number;
  endMs?: number;
  /** steps/01.png, relative to the recording's folder. */
  screenshot?: string;
  why?: string;
  /** What the app showed (a Mendix error, warning or validation message) when the step failed. */
  said?: string;
  /** Said beside the step: checks a recording doesn't run, dialogs the step closed (with their words). */
  notes?: string[];
}

export interface SavedToRepo {
  branch: string;
  at: number;
  by: string;
  pr?: number;
  url?: string;
  /** Where it went in the repo: docs/walkthroughs/<workflow>/. */
  path: string;
  lfs: boolean;
}

export interface WalkManifest {
  schema: 1;
  id: string;
  floor: string;
  kind: 'workflow' | 'tour';
  journey: { id: string; title: string; file: string; requirement: string[]; notes?: string[] };
  /** The batch it was recorded in (one recording app, one fresh database). */
  batch?: string;
  /** The milestone an auto-recording was made for. */
  milestone?: { id: string; title: string };
  trigger: RecordingTrigger;
  by: string;
  /** The build it recorded: a video is evidence for this commit only. */
  app: { commit: string; origin: string; user?: string; userFrom?: IdentitySource; instance?: boolean };
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: RecordingStatus;
  failure?: { step?: number; why: string; said?: string };
  /**
   * Where it played in its batch's plan (shared/walkthroughs/plan.ts): its group (one fresh database each),
   * the journeys played first, unfilmed, to set up its start state, and how its database was made fresh.
   */
  start?: { group: number; groups: number; setup?: string[]; db?: 'boot' | 'fresh-db' | 'new-instance'; dbMs?: number; boot?: BootTiming };
  steps: ManifestStep[];
  outputs: {
    video?: string;
    format?: 'mp4' | 'webm';
    captions?: string;
    chapters?: string;
    narration: 'kokoro' | 'fake' | 'none';
    /** Why there's no voice, or why it's WebM ("ffmpeg isn't installed"). */
    notes: string[];
    bytes?: number;
  };
  /** For a guided tour: the recordings it chains, in order. */
  parts?: { id: string; journey: string; title: string; startMs: number; endMs: number }[];
  saved?: SavedToRepo;
}

/** The per-project settings. */
export interface WalkSettings {
  /** Record the journeys that passed against a commit on main (a passing build, a milestone ready), once per commit. */
  autoRecord: boolean;
  /** Narrate (local TTS) when it's available. */
  narrate: boolean;
  /** The demo account the recorder signs in with when the project has no journey-runner config (never an admin). */
  demoUser: string;
  demoPassword: string;
}

export const DEFAULT_SETTINGS: WalkSettings = { autoRecord: true, narrate: true, demoUser: 'demo_test_user', demoPassword: 'Demo2025!' };

/** What the recorder can do on this machine. */
export interface WalkAvailability {
  recorder: boolean;
  ffmpeg: boolean;
  narration: 'kokoro' | 'fake' | 'none';
  notes: string[];
}

/** Where a batch is: waiting its turn, starting its own copy of the app, recording, putting the videos together. */
export type BatchPhase = 'queued' | 'booting' | 'recording' | 'finishing';

/**
 * One go of recording: the journeys of one commit, played one after another against the office's own
 * throwaway copy of the app at that commit (a fresh database), stopped when the last one is done. A guided
 * tour is a batch too (no app: it joins videos). One batch at a time per office.
 */
export interface WalkBatch {
  id: string;
  floor: string;
  kind: 'workflows' | 'tour';
  commit: string;
  trigger: RecordingTrigger;
  milestone?: { id: string; title: string };
  by: string;
  journeys: { id: string; title: string; rec?: string }[];
  phase: BatchPhase;
  /** The journey being recorded (1-based; 0 before the first). */
  n: number;
  /** "Step 2 of 5: Click New request", "Making the MP4…". */
  line?: string;
  at: number;
  /** Its plan: groups (each on a fresh database), their order, the unfilmed setup plays, what it skips. */
  plan?: WalkPlan;
  /** The group playing now (1-based), of how many. */
  group?: { n: number; of: number };
  /** While the recording app starts: its boot phase, how long that phase and the whole start have taken (ms, the office's clock). */
  boot?: { phase: BootPhase; phaseMs: number; ms: number };
}

/** A recording as the page lists it (the manifest without what only the files need). */
export type WalkCardRecording = Pick<WalkManifest, 'id' | 'kind' | 'journey' | 'milestone' | 'trigger' | 'by' | 'app' | 'startedAt' | 'durationMs' | 'status' | 'failure' | 'start' | 'steps' | 'outputs' | 'saved' | 'parts'>;

export interface WalkView {
  floor: string;
  settings: Omit<WalkSettings, 'demoPassword'>;
  available: WalkAvailability;
  /** Main's newest commit in the project's folder: what Record and Re-record all record. */
  main?: { commit: string };
  /** The journeys at that commit (what Record offers; templates aren't among them). */
  journeys: { id: string; title: string; file: string; requirement: string[] }[];
  /** What Re-record all would do at that commit: groups, order, setup plays, skipped templates and why. */
  plan?: WalkPlan;
  /** Who recordings sign in as by default, and where that came from (never a password). */
  identity?: { user: string; from: IdentitySource };
  /** This project's batches: the running one first, then the queued ones in order. */
  batches: WalkBatch[];
  /** Batches of other projects ahead in the office's one queue. */
  ahead: number;
  /** Newest first. */
  recordings: WalkCardRecording[];
  /** Working copies' disk use and the office's quota. */
  disk: { bytes: number; quota: number };
  admin: boolean;
}

/** Shorter than this is a "short workflow video". */
export const SHORT_MS = 60_000;
/** A recording is stopped after this long. */
export const RECORDING_CAP_MS = 3 * 60_000;
/** A video over this is warned about before it goes to the repo; over HARD_BYTES (without LFS) it's refused. */
export const WARN_BYTES = 20 * 1024 * 1024;
export const HARD_BYTES = 95 * 1024 * 1024;

export const isRecId = (v: unknown): v is string => typeof v === 'string' && /^wt_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
/** A journey id as a folder name in the repo. */
export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workflow';
