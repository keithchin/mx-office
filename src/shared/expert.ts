// Expert mode (docs/features.md › Expert mode): a project that is one person's own Claude Code session in the
// project folder, with the office round it (preview, phases, budget, proof) and no coordinator, roster or
// injected prompts. The project record says which mode it's in (`mode` on floors.json's entry; absent is
// Team mode, so every project from before stays as it was). This file is the shapes both sides share, and
// the pure rules of the session screen's split and its asked → visible timer, so tests run them.

/** How a project is run: Team mode (the coordinator and roles, the default) or Expert mode (one session). */
export type ProjectMode = 'expert' | 'team';

/** A saved mode, or undefined for anything else (absent and unknown read as Team mode). */
export function projectMode(v: unknown): ProjectMode | undefined {
  return v === 'expert' || v === 'team' ? v : undefined;
}

/** Whether a project record is an Expert-mode project. */
export const isExpertMode = (p: { mode?: unknown } | undefined | null): boolean => p?.mode === 'expert';

/** What the session's header shows of it: busy, waiting for you, starting, or not running. */
export type SessionState = 'busy' | 'waiting' | 'starting' | 'off';

/** One asked → visible measurement: a prompt, the model change it led to, the reload that showed it. */
export interface LoopSample {
  askedAt: number;
  changedAt: number;
  visibleAt: number;
  /** visibleAt − askedAt. */
  ms: number;
}

/** The timer as the preview header shows it. */
export interface LoopView {
  /** The Claude session the samples are of (the median is per session). */
  session?: string;
  /** The newest sample's ms. */
  lastMs?: number;
  /** The median over this session's samples. */
  medianMs?: number;
  count: number;
  /** A prompt is timing now: when it was asked, and whether the model has changed since. */
  pending?: { askedAt: number; changed: boolean };
  /** The newest samples, oldest first (for a sparkline). */
  recent: number[];
}

/** GET /api/expert?floor=: what the session screen draws besides the live app and phases (each has its own source). */
export interface ExpertView {
  floor: string;
  mode: ProjectMode;
  /** The session's worker, once there is one. */
  workerId?: string;
  /** The folder's branch, Mendix version, toolkit pin and mxcli, when known. */
  branch?: string;
  mendix?: string;
  toolkit?: string;
  mxcli?: string;
  loop: LoopView;
}

/** A page of the app the preview can open (from the model at the served commit), and the roles it may be seen as. */
export interface PreviewChoices {
  rev?: string;
  pages: { qn: string; label: string; url: string }[];
  roles: string[];
  /** Demo users (names and roles only, never a password): allowed for local work. */
  demoUsers: { user: string; roles: string[] }[];
  demoOn?: boolean;
  problem?: string;
}

/**
 * The background proof strip's source (slice 2 owns it: GET /api/expert/proof?floor=). Mirrored here so the
 * session screen can draw it once it exists; until then the route answers 404 and the strip says so.
 */
export interface ExpertProof {
  branch: string;
  commit: { sha: string; message: string; at: number; push: 'ok' | 'pending' | 'failed' | 'off'; error?: string } | null;
  budget: { spentUsd: number; totalUsd: number; todayUsd: number; paused: boolean } | null;
  stuck: { stuck: boolean; idleSec: number; reason?: string } | null;
  decisions: number;
}

// ---- The split between the preview and the session ------------------------------------------------------

/** The narrowest either side gets, in px. */
export const SPLIT_MIN_PX = 320;
/** Arrow keys move the divider this much (percent of the width); Shift moves it SPLIT_BIG. */
export const SPLIT_STEP = 2;
export const SPLIT_BIG = 10;

export type SplitFocus = 'app' | 'both' | 'chat';

/** What the session screen remembers per project (in this browser): the split, the focus preset, which side the app is on. */
export interface SplitPrefs {
  /** The preview's share of the width, in percent (the side it's on doesn't change it). */
  pct: number;
  focus: SplitFocus;
  swapped: boolean;
}

export const DEFAULT_SPLIT: SplitPrefs = { pct: 50, focus: 'both', swapped: false };

/** `pct` kept so both sides are at least SPLIT_MIN_PX wide in `width` px (50 when the width can't hold both). */
export function clampSplit(pct: number, width: number): number {
  const p = Number.isFinite(pct) ? pct : 50;
  if (!(width > 0)) return Math.min(90, Math.max(10, p));
  const minPct = (SPLIT_MIN_PX / width) * 100;
  if (minPct >= 50) return 50;
  return Math.round(Math.min(100 - minPct, Math.max(minPct, p)) * 10) / 10;
}

/** Where a key on the focused divider moves it; undefined for a key it doesn't take. `side` is the preview's side. */
export function splitKey(pct: number, key: string, shift: boolean, width: number, side: 'left' | 'right' = 'left'): number | undefined {
  const step = shift ? SPLIT_BIG : SPLIT_STEP;
  // The divider moves the way the arrow points; the preview grows when it's on the side the divider moves away from.
  const dir = side === 'left' ? 1 : -1;
  if (key === 'ArrowLeft') return clampSplit(pct - step * dir, width);
  if (key === 'ArrowRight') return clampSplit(pct + step * dir, width);
  if (key === 'Home') return clampSplit(side === 'left' ? 0 : 100, width);
  if (key === 'End') return clampSplit(side === 'left' ? 100 : 0, width);
  if (key === 'Enter') return 50;
  return undefined;
}

/** Saved prefs read back, anything odd replaced by the default. */
export function readSplit(v: unknown): SplitPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<SplitPrefs>;
  const pct = typeof o.pct === 'number' && o.pct >= 5 && o.pct <= 95 ? o.pct : DEFAULT_SPLIT.pct;
  const focus = o.focus === 'app' || o.focus === 'chat' ? o.focus : 'both';
  return { pct, focus, swapped: o.swapped === true };
}

/** "41 s", "2 min 5 s". */
export function loopWords(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
}
