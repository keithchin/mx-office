// Expert mode's background checks (server/expert-checks/, docs/mockups/expert-mode slice 6): what the proof strip's
// TESTS and LINT cells and their popover show, and the short prompt "Send to session" puts in the session's input.
// Pure: the browser imports it too.
//
// When the session goes idle after a change, the office runs the affected microflow tests, the affected journeys
// and a lint delta against the project's baseline at the commit it just made, records them in the testing ledger
// at that commit, and the strip shows the outcome. Never while the session works; one run per project at a time.

/** What a run can do: microflow tests, journeys, lint (new findings against the baseline), mx check. */
export type CheckKind = 'tests' | 'journeys' | 'lint' | 'mxcheck';
export const CHECK_KINDS: readonly CheckKind[] = ['tests', 'journeys', 'lint', 'mxcheck'];
/** The background run's kinds (mx check is heavy: Lock in asks for it). */
export const IDLE_KINDS: readonly CheckKind[] = ['tests', 'journeys', 'lint'];

/** affected: what the change since the last run owes; all: every test and journey at the commit. */
export type CheckScope = 'affected' | 'all';

/** running, finished, stopped because the session started working again, or not run (and why, in `notes`). */
export type CheckState = 'running' | 'done' | 'cancelled' | 'skipped';

export interface CheckCounts {
  passed: number;
  failed: number;
  /** Selected but never reached a verdict (a harness error, the instance gone, stopped early). */
  notRun: number;
  total: number;
}

export interface CheckFailure {
  kind: 'journey' | 'microflow';
  /** The journey id (J04b) or the microflow test's name. */
  id: string;
  /** What failed, as the runner said it (a step, an assertion). */
  detail?: string;
  /** It passed at this earlier commit: a regression of this change. */
  passedAt?: string;
  /** The testing ledger's record of the run. */
  record?: string;
}

/** The TESTS cell: microflow tests and journeys of the latest run. */
export interface ProofTests {
  state: CheckState;
  /** The commit they ran (or run) on. */
  commit: string;
  /** When it started, and when it ended. */
  startedAt: number;
  endedAt?: number;
  scope: CheckScope;
  journeys: CheckCounts;
  microflow: CheckCounts;
  failures: CheckFailure[];
  /** What runs right now ("journey J04b"), while running. */
  now?: string;
  /** Plain notes: "No microflow tests yet", why something didn't run, how the set was chosen. */
  notes: string[];
}

export interface LintFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  module?: string;
  document?: string;
  message: string;
}

/** The LINT cell: findings that are new against the project's lint baseline. */
export interface ProofLint {
  state: CheckState;
  commit: string;
  startedAt: number;
  endedAt?: number;
  /** New error- and warning-severity findings (infos and hints are counted in `findings` only). */
  errors: number;
  warnings: number;
  /** The new findings (at most LINT_KEEP). */
  findings: LintFinding[];
  /** Whether the project has a baseline (without one, every finding would read as new: only counts are shown). */
  baseline: boolean;
  note?: string;
}

export const LINT_KEEP = 50;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const short = (sha: string) => sha.slice(0, 7);

/** The TESTS cell in words: "33/34 journeys · J04b regressed · 0 microflow". */
export function testsWords(t: ProofTests): string {
  if (t.state === 'running') return `running${t.now ? ` · ${t.now}` : ''}…`;
  if (t.state === 'skipped' && !t.journeys.total && !t.microflow.total) return t.notes[0] ?? 'not run';
  const bits: string[] = [];
  const j = t.journeys;
  bits.push(j.total ? `${j.passed}/${j.total} journeys` : '0 journeys');
  const reg = t.failures.filter((f) => f.passedAt);
  const bad = t.failures.filter((f) => !f.passedAt);
  if (reg.length) bits.push(reg.length === 1 ? `${reg[0].id} regressed` : `${reg.length} regressed`);
  if (bad.length) bits.push(bad.length === 1 ? `${bad[0].id} failed` : `${bad.length} failing`);
  const m = t.microflow;
  bits.push(m.total ? `${m.passed}/${m.total} microflow` : '0 microflow');
  if (t.state === 'cancelled') bits.push('stopped');
  return bits.join(' · ');
}

/** The LINT cell in words: "0 errors +1 warn". */
export function lintWords(l: ProofLint): string {
  if (l.state === 'running') return l.note ? `running · ${l.note}…` : 'running…';
  if (l.state === 'skipped') return l.note ?? 'not run';
  return `${plural(l.errors, 'error')} +${l.warnings} warn`;
}

/** good / warn / bad for a cell's dot. */
export function testsTone(t: ProofTests | null): 'good' | 'warn' | 'bad' | 'idle' {
  if (!t || t.state === 'running' || t.state === 'skipped') return 'idle';
  if (t.failures.length) return 'bad';
  return t.state === 'cancelled' || t.journeys.notRun || t.microflow.notRun ? 'warn' : 'good';
}

export function lintTone(l: ProofLint | null): 'good' | 'warn' | 'bad' | 'idle' {
  if (!l || l.state === 'running' || l.state === 'skipped') return 'idle';
  return l.errors ? 'bad' : l.warnings ? 'warn' : 'good';
}

/** Most this many characters go into the session's input. */
export const SEND_MAX = 400;

/** One line, no control characters, at most SEND_MAX: what may be put in the session's input line. */
export function oneLine(text: string, max = SEND_MAX): string {
  // Every control character (C0, DEL, C1: newlines, carriage returns, escapes) and the line and paragraph separators.
  const flat = text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The short prompt for a failed journey or microflow test (the user reads it, maybe edits it, and presses Enter). */
export function failurePrompt(f: CheckFailure, commit: string): string {
  const what = f.kind === 'journey' ? `Journey ${f.id}` : `Microflow test ${f.id}`;
  const since = f.passedAt ? ` It passed at ${short(f.passedAt)}, before this change.` : '';
  return oneLine(`${what} failed in the background check at ${short(commit)}${f.detail ? `: ${f.detail}` : ''}.${since} Find the cause and fix it.`);
}

/** The short prompt for new lint findings. */
export function lintPrompt(l: ProofLint, picked?: LintFinding): string {
  const fs = picked ? [picked] : l.findings.filter((f) => f.severity !== 'info').slice(0, 3);
  const where = (f: LintFinding) => [f.module, f.document].filter(Boolean).join('.') || 'the model';
  const list = fs.map((f) => `${f.rule} (${f.severity}) in ${where(f)}: ${f.message}`).join('; ');
  return oneLine(`The background lint at ${short(l.commit)} found ${picked ? 'a new finding' : plural(fs.length, 'new finding')}: ${list}. Fix ${picked || fs.length === 1 ? 'it' : 'them'} without changing the baseline.`);
}

/**
 * Why the session can't take a filled-in prompt now (its worker's status), or undefined when it can: only while it
 * waits at its prompt, never while it works, starts, or has a question or permission prompt open.
 */
export function fillBlocked(status: string | undefined): string | undefined {
  switch (status) {
    case 'idle':
    case 'done':
      return undefined;
    case 'working':
      return 'The session is working: wait until it’s idle';
    case 'needs_input':
      return 'The session is asking you something: answer it first';
    case 'starting':
      return 'The session is starting: try again in a moment';
    default:
      return 'The session isn’t running: start it first';
  }
}
