// Portfolios, called clients on screen and in the docs (docs/site/using-the-office/clients.md): an optional grouping of projects for one client
// or organisation, with at most one connected company brain (the toolkit's curated knowledge folder).
// A portfolio organises knowledge; it is NOT access control: every agent on the office's machine can still
// read every folder by path (portfolio-phase0-findings.md §2, §7). The office keeps only the grouping,
// the brain's path and the context manifests (what each hire was offered); the brain owns all the text.
// Pure: the server, the pages and the tests import it.

import { ulid } from './evidence/ids.js';

/** Said wherever portfolios are shown (S01/S03 and the probe: no boundary). */
export const NOT_ACCESS_CONTROL = 'Clients organise knowledge; they aren’t access control';
export const NOT_ACCESS_CONTROL_LONG =
  'Each client (the company) groups its projects so their agents are pointed at the same company brain. It isn’t a boundary between clients: agents on this machine can still read any folder by path, including other clients’ brains and projects.';

export interface PortfolioBrainRef {
  /** Windows form (C:/…) on Windows. */
  path: string;
  connectedAt: number;
  by: string;
}

export interface Portfolio {
  /** pfl_<ulid>. */
  id: string;
  label: string;
  /** Floor ids (the routing key everywhere in the office); one project is in at most one portfolio. */
  projectIds: string[];
  brain?: PortfolioBrainRef;
  createdAt?: number;
  createdBy?: string;
}

export const mintPortfolioId = (now = Date.now()) => `pfl_${ulid(now)}`;
export const isPortfolioId = (v: unknown): v is string => typeof v === 'string' && /^pfl_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);

/** ok: a git repository, read; unversioned: read, but no snapshot (not a git repository); unavailable: missing or not a brain. */
export type BrainStatus = 'ok' | 'unavailable' | 'unversioned';
export type ExcludeReason = 'inbox' | 'handoffs' | 'proposals' | 'patches' | 'missing-file' | 'unrouted';
/** Folders the toolkit keeps out of routing by convention: candidates, handoffs, proposals, patches. */
export const EXCLUDED_DIRS = ['inbox', 'handoffs', 'proposals', 'patches'] as const;

export interface RoutedFile {
  /** Relative to the brain, forward slashes. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExcludedFile {
  path: string;
  reason: ExcludeReason;
}

/** What the office read of a brain at one moment (cached on the server by its HEAD and ROUTING.md). */
export interface BrainRead {
  path: string;
  status: BrainStatus;
  /** HEAD sha, or null when unversioned or unavailable. */
  snapshot: string | null;
  dirty: boolean;
  routed: RoutedFile[];
  excluded: ExcludedFile[];
  /** ROUTING.md itself: its hash, size and table rows. */
  routing?: { sha256: string; bytes: number; rows: number };
  /** Why it is unavailable. */
  why?: string;
  /** ROUTING.md over 40 rows or 8 KB. */
  warnings: string[];
  readAt: number;
}

/** Big routing tables cost every session that follows the pointer: warn past these. */
export const ROUTING_MAX_ROWS = 40;
export const ROUTING_MAX_BYTES = 8 * 1024;

export function routingWarnings(rows: number, bytes: number): string[] {
  return [rows > ROUTING_MAX_ROWS ? `ROUTING.md has ${rows} rows (over ${ROUTING_MAX_ROWS}): keep it short, it is read before every terminology or convention answer.` : '', bytes > ROUTING_MAX_BYTES ? `ROUTING.md is ${(bytes / 1024).toFixed(1)} KB (over 8 KB).` : ''].filter(Boolean);
}

/**
 * One line of <data>/context-manifests/<floor>.jsonl, appended at each hire of a project in a portfolio
 * with a brain. It records what the hire was OFFERED (the pointer and the routed files at that snapshot),
 * never what the agent read or obeyed.
 */
export interface ContextManifest {
  /** The stable prj_ id when the floor has one, else the floor id. */
  projectId: string;
  floor: string;
  role: string;
  /** The worker id of the hire. */
  agentInstanceId: string;
  sessionId?: string;
  preparedAt: number;
  portfolioId: string;
  brain: Pick<BrainRead, 'path' | 'snapshot' | 'dirty' | 'routed' | 'excluded' | 'status'> & { routing?: BrainRead['routing'] };
}

// ---- ROUTING.md -----------------------------------------------------------------------------------

/** A relative file path as a routing row names it (`skills/glossary.md`): no absolute paths, no `..`. */
const RELATIVE_FILE = /^(?![\\/])(?![A-Za-z]:)[A-Za-z0-9_][A-Za-z0-9_./ -]*\.[A-Za-z0-9]{1,8}$/;

/** The files ROUTING.md's table rows point at (each once, in order) and how many rows it has. */
export function parseRouting(md: string): { paths: string[]; rows: number } {
  const paths: string[] = [];
  let rows = 0;
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|?$/.test(line)) continue; // the separator
    const cells = line.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    // The header row ("When | Read this") names no file.
    const found = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim().replace(/\\/g, '/'));
    const files = found.filter((p) => RELATIVE_FILE.test(p) && !p.split('/').includes('..'));
    if (!files.length && !found.length && /read this|when/i.test(line)) continue;
    rows++;
    for (const f of files) if (!paths.includes(f)) paths.push(f);
  }
  return { paths, rows };
}

/** Why a routed path is excluded by convention (its first folder), if it is. */
export function excludedDirOf(rel: string): ExcludeReason | undefined {
  const first = rel.split('/')[0];
  return (EXCLUDED_DIRS as readonly string[]).includes(first) ? (first as ExcludeReason) : undefined;
}

// ---- Paths ----------------------------------------------------------------------------------------

/** A path as the office writes it for agents: Windows form with forward slashes (C:/a/b); /c/a/b → C:/a/b. */
export function windowsForm(p: string): string {
  const s = p.replace(/\\/g, '/');
  const msys = /^\/([A-Za-z])\/(.*)$/.exec(s);
  if (msys) return `${msys[1].toUpperCase()}:/${msys[2]}`;
  const drive = /^([A-Za-z]):\/(.*)$/.exec(s);
  return drive ? `${drive[1].toUpperCase()}:/${drive[2]}` : s;
}

// ---- The prime-prompt line (one line, ≤ 300 characters, never brain content) -----------------------

export const PRIME_LINE_MAX = 300;
export const BRAIN_UNAVAILABLE_LINE = "Company brain unavailable this session: don't assume its conventions.";

const cleanLabel = (s: string) => s.replace(/[\r\n`]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The line a hire's first message gets for a project in a portfolio with a brain (action-first, §7.2). */
export function primeLine(label: string, read: Pick<BrainRead, 'status' | 'snapshot' | 'path'>): string {
  if (read.status === 'unavailable') return BRAIN_UNAVAILABLE_LINE;
  const at = read.snapshot ? read.snapshot.slice(0, 7) : 'unversioned';
  const routing = `${windowsForm(read.path).replace(/\/+$/, '')}/ROUTING.md`;
  const make = (l: string) => `Company brain ${l ? `${l} ` : ''}@${at}: before answering terminology or convention questions, read ${routing}. Don't search other company folders.`;
  let l = cleanLabel(label);
  let line = make(l);
  while (line.length > PRIME_LINE_MAX && l.length > 0) {
    l = l.slice(0, Math.max(0, l.length - (line.length - PRIME_LINE_MAX) - 1)).trim();
    line = make(l ? `${l}…` : '');
    if (!l) break;
  }
  // A path so long the line can't fit: never cut the path; say it's unavailable rather than point at half a path.
  return line.length <= PRIME_LINE_MAX ? line : BRAIN_UNAVAILABLE_LINE;
}

// ---- Brain changes -------------------------------------------------------------------------------

export interface RoutedDiff {
  corrected: string[];
  withdrawn: string[];
  added: string[];
}

/** What changed in the routed set since a manifest: same path, new hash = corrected; gone = withdrawn. */
export function diffRouted(before: readonly RoutedFile[], now: readonly RoutedFile[]): RoutedDiff {
  const was = new Map(before.map((r) => [r.path, r.sha256]));
  const is = new Map(now.map((r) => [r.path, r.sha256]));
  return {
    corrected: [...was].filter(([p, h]) => is.has(p) && is.get(p) !== h).map(([p]) => p),
    withdrawn: [...was.keys()].filter((p) => !is.has(p)),
    added: [...is.keys()].filter((p) => !was.has(p)),
  };
}

export const diffEmpty = (d: RoutedDiff) => !d.corrected.length && !d.withdrawn.length && !d.added.length;

/** "Company brain changed: 1 corrected, 1 withdrawn since Ada's session was prepared". */
export function changeWords(d: RoutedDiff, who: string): string {
  const parts = [d.corrected.length ? `${d.corrected.length} corrected` : '', d.withdrawn.length ? `${d.withdrawn.length} withdrawn` : '', d.added.length ? `${d.added.length} added` : ''].filter(Boolean);
  return `Company brain changed: ${parts.join(', ') || 'routing changed'} since ${who}'s session was prepared`;
}

/** One project's brain change waiting on the Project Manager (one Needs-you card per project). */
export interface BrainChange {
  floor: string;
  portfolioId: string;
  label: string;
  /** The snapshot it is against (HEAD sha, or a hash of the routed set when unversioned): Dismiss is per key. */
  key: string;
  /** The hired members whose session was prepared before the change, newest first. */
  roles: { role: string; name: string; workerId: string; preparedAt: number }[];
  diff: RoutedDiff;
  /** When the office noticed it. */
  since: number;
  /** A Rehire pressed: benching first, hired again once benched. */
  rehiring?: string[];
}

/** A project whose wiring the office's completion check found incomplete (a partial result is never success). */
export interface WiringProblem {
  floor: string;
  portfolioId: string;
  label: string;
  problems: string[];
  since: number;
}

/** GET /api/portfolios/changes?floor=: what Needs you reads. */
export interface BrainChangeView {
  floor: string;
  change?: BrainChange;
  wiring?: WiringProblem;
  admin: boolean;
}

/** A Needs-you card's buttons for a brain item. */
export type BrainAct = 'rehire' | 'dismiss' | 'rewire' | 'dismiss-wiring';
export const BRAIN_ACTS: readonly BrainAct[] = ['rehire', 'dismiss', 'rewire', 'dismiss-wiring'];
export const isBrainAct = (v: unknown): v is BrainAct => typeof v === 'string' && (BRAIN_ACTS as readonly string[]).includes(v);

// ---- The views -----------------------------------------------------------------------------------

export interface PortfolioProject {
  id: string;
  name: string;
  /** Whether the office's own completion check found its wiring complete (undefined: no brain, or not checked). */
  wiring?: { ok: boolean; problems: string[] };
}

export interface PortfolioView extends Portfolio {
  projects: PortfolioProject[];
  /** The brain as last read (status, snapshot, routed files, warnings), when it has one. */
  read?: BrainRead;
}

/** GET /api/portfolios. */
export interface PortfoliosView {
  portfolios: PortfolioView[];
  /** Floors in no portfolio (Add to portfolio offers only these). */
  ungrouped: { id: string; name: string }[];
  admin: boolean;
}

/** What a project already has wired, shown before Add to portfolio (the existing-context review, S03). */
export interface ExistingContext {
  floor: string;
  portfolio?: { id: string; label: string };
  /** Instruction files with a COMPANY-BRAIN block, and the brain path each names. */
  blocks: { file: string; brain?: string }[];
  /** Context manifests already recorded for it (it consumed a brain before). */
  manifests: number;
  /** A brain it consumed before, per its last manifest. */
  consumed?: { portfolioId: string; path: string };
  surfaces: string[];
}

/** The office's completion check of one project's wiring. */
export interface WiringCheckView {
  ok: boolean;
  problems: string[];
  surfaces: string[];
}
