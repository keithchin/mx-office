// Walkthrough videos of a project's workflows (server/walkthroughs/): a recording of one test journey
// played against the live app, with captions, click highlights and step screenshots, and a manifest that
// ties it to the exact build it recorded. Evidence for that commit only; a failed step is a failed video.
// Pure types (no Node imports): the page reads them too.

/** One thing the recorder does in a step (the toolkit journey-runner's vocabulary). */
export type WalkAction =
  | { do: 'nav'; group?: string; item: string; caption: string }
  | { do: 'click'; selector: string; caption: string }
  | { do: 'fill'; selector: string; value: string; caption: string }
  | { do: 'combobox'; selector: string; match: string; caption: string }
  | { do: 'dismissModal'; caption: string }
  | { do: 'wait'; ms: number; caption: string }
  | { do: 'goto'; path: string; caption: string };

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
}

export interface WalkScript {
  journey: string;
  title: string;
  file: string;
  /** Use cases and rows it proves (UC-01, F101#/useCases/0/mainFlow/0, "build-plan row 10"). */
  requirement: string[];
  persona?: string;
  steps: WalkStep[];
}

export type RecordingStatus = 'queued' | 'recording' | 'passed' | 'failed' | 'cancelled' | 'error';
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
  journey: { id: string; title: string; file: string; requirement: string[] };
  /** The milestone an auto-recording was made for. */
  milestone?: { id: string; title: string };
  trigger: RecordingTrigger;
  by: string;
  /** The build it recorded: a video is evidence for this commit only. */
  app: { commit: string; origin: string; user?: string };
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: RecordingStatus;
  failure?: { step?: number; why: string };
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
  /** Record each passing journey of a milestone when it becomes ready in the live app. */
  autoRecord: boolean;
  /** Narrate (local TTS) when it's available. */
  narrate: boolean;
  /** The demo account the recorder signs in with (never an admin). */
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

export interface WalkJob {
  id: string;
  floor: string;
  journey: string;
  kind: 'workflow' | 'tour';
  trigger: RecordingTrigger;
  status: 'queued' | 'running';
  /** "Step 2 of 5: Click New request", "Making the MP4…". */
  line?: string;
  at: number;
}

/** A recording as the page lists it (the manifest without what only the files need). */
export type WalkCardRecording = Pick<WalkManifest, 'id' | 'kind' | 'journey' | 'milestone' | 'trigger' | 'by' | 'app' | 'startedAt' | 'durationMs' | 'status' | 'failure' | 'steps' | 'outputs' | 'saved' | 'parts'>;

export interface WalkView {
  floor: string;
  settings: Omit<WalkSettings, 'demoPassword'>;
  available: WalkAvailability;
  /** The running build, when the app runs through its proxy. */
  live?: { commit: string; running: boolean };
  /** The journeys of the running build (what Record offers). */
  journeys: { id: string; title: string; file: string; requirement: string[] }[];
  jobs: WalkJob[];
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
