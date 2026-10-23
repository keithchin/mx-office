// Guided validation (C5 of the App Workspace proposal): the scenarios to try on the version on screen, each
// with its result at exactly that version, the person's own findings ("Works as expected" / "Something's
// wrong") and the correction a finding becomes. This is the part both sides read. Pure.
//
//   scenarios   the project's test journeys (tests/**/*.journey.json) as they are at that version, their
//               steps in the journey's own words (shared/walkthroughs/script.ts reads them)
//   results     a test-run record counts for a scenario only when its tested revision is that version
//               (shared/testing/record.ts sameRevision): a result on another version is never this
//               version's, it can only be told as a note ("passed on an earlier version")
//   findings    what a person marked, per project and version (server/guided-validation/, its own small
//               file, audited); evidence shown beside the business status, never part of it: the business
//               status (shared/business-status.ts) has no business-review input, so verification is unchanged
//   correction  "Something's wrong" goes to the team as a change request (server/change-requests/, a real
//               task id), linked to the scenario and the version by the finding that made it

import { isKnown, sameRevision, statusOf, type TestRunRecord } from './testing/record.js';
import type { WalkStep } from './walkthroughs/types.js';
import { requestTitle } from './change-requests.js';

export type ScenarioResult = 'passed' | 'failed' | 'not-run';
export type Verdict = 'works' | 'wrong';

/** The words each result is shown with. */
export const RESULT_WORDS: Record<ScenarioResult, string> = { passed: 'Passed', failed: 'Failed', 'not-run': 'Not run on this version' };
export const RESULT_TONE: Record<ScenarioResult, 'good' | 'bad' | 'idle'> = { passed: 'good', failed: 'bad', 'not-run': 'idle' };
export const VERDICT_WORDS: Record<Verdict, string> = { works: 'Works as expected', wrong: 'Something’s wrong' };

/** A finding's note at most, and the shortest note "Something's wrong" takes. */
export const NOTE_MAX = 2000;
export const WRONG_MIN = 4;

/** One mark a person made on one scenario at one version (server/guided-validation/: <data>/guided-validation/<project>.json). */
export interface FindingRecord {
  /** GV-<n>, per project. */
  id: string;
  /** The version it was marked on (the served revision then). */
  revision: string;
  scenario: string;
  /** The scenario's title then. */
  title: string;
  verdict: Verdict;
  note?: string;
  /** The page of the app on screen, captured as a change request captures it. */
  page?: string;
  pageMoved?: boolean;
  by: string;
  owner?: string;
  at: number;
  /** The change request "Something's wrong" made: its id and task id. */
  correction?: { id: string; taskId: string };
}

/** Where a scenario starts, when its journey says: a page of the app (opened in the canvas), or a menu item. */
export interface ScenarioStart {
  path?: string;
  /** "Open Visitors › Today" (the menu), when there is no page address. */
  words?: string;
}

export interface ScenarioView {
  id: string;
  title: string;
  /** The steps in the journey's own words. */
  steps: string[];
  start?: ScenarioStart;
  /** Its result at exactly the version shown. */
  result: ScenarioResult;
  /** When it hasn't run on this version: the newest result on another one (only ever a note). */
  earlier?: { status: 'passed' | 'failed'; revision: string };
  /** The newest mark at this version, and how many marks it has here in all. */
  finding?: FindingRecord;
  marks: number;
}

/** GET /api/guided-validation's answer, for one version. */
export interface ValidationView {
  floor: string;
  revision: string;
  scenarios: ScenarioView[];
  /** The other automatic checks that ran on exactly this version (unit tests and the like), counted. */
  checks: { passed: number; failed: number; skipped: number };
  /** Every correction a finding made on this project, any version, newest first (its state is the request's). */
  corrections: { id: string; taskId: string; scenario: string; title: string; revision: string; at: number }[];
  /** Why the office can't list scenarios for it (the version isn't readable here). */
  note?: string;
}

/** A journey script's steps in the journey's own words: each step's name, else its first action said plainly. */
export function stepWords(steps: readonly WalkStep[]): string[] {
  return steps.map((s) => plainCaption(s.caption)).filter(Boolean).slice(0, 40);
}

/** A caption without a widget's technical name: "Click btnSubmitVisitor" reads "Click Submit visitor". */
export function plainCaption(caption: string): string {
  return caption
    .replace(/\.mx-name-([\w-]+)/g, '$1')
    .replace(/\b(btn|txt|lbl|dd|chk|ref|ds|dg|lv|tab|nav|act)([A-Z][\w]*)/g, '$2')
    .replace(/\b([a-z]+|[A-Z][a-z]+)((?:[A-Z][a-z0-9]+)+)\b/g, (_all, a: string, b: string) => `${a} ${b.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where a script starts: its first step's page address (opened in the canvas) or its menu item. */
export function startOf(steps: readonly WalkStep[]): ScenarioStart | undefined {
  const first = steps[0]?.actions.find((a) => a.do === 'goto' || a.do === 'nav');
  if (!first) return undefined;
  if (first.do === 'goto' && first.path.startsWith('/') && !first.path.startsWith('//')) return { path: first.path };
  if (first.do === 'nav') return { words: first.caption };
  return undefined;
}

/**
 * Each journey's newest decided result among test runs of exactly `revision`, and, apart, its newest result on
 * any other revision. A record names a journey by a result's name or link, or by its suite ("journey J-01")
 * when it has one result. Records whose tested revision is unknown count for no version.
 */
export function resultsAt(records: readonly TestRunRecord[], revision: string, ids: readonly string[]): { at: Map<string, 'passed' | 'failed'>; earlier: Map<string, { status: 'passed' | 'failed'; revision: string }> } {
  const at = new Map<string, 'passed' | 'failed'>();
  const earlier = new Map<string, { status: 'passed' | 'failed'; revision: string }>();
  const want = new Set(ids);
  for (const rec of [...records].sort((a, b) => b.ingestedAt - a.ingestedAt)) {
    const here = sameRevision(rec.testedRevision, revision);
    if (!here && !isKnown(rec.testedRevision)) continue; // an unknown tested revision is no version's
    const suiteJourney = /^journey\s+(\S+)/i.exec(rec.suite)?.[1];
    for (const res of rec.results) {
      const status = statusOf(res.status);
      if (status !== 'passed' && status !== 'failed') continue;
      const named = new Set([res.name, ...res.links.map((l) => l.target), ...(suiteJourney && rec.results.length === 1 ? [suiteJourney] : [])]);
      for (const id of named) {
        if (!want.has(id)) continue;
        if (here) {
          if (!at.has(id)) at.set(id, status);
        } else if (!earlier.has(id)) earlier.set(id, { status, revision: rec.testedRevision });
      }
    }
  }
  return { at, earlier };
}

/** The other automatic checks on exactly `revision`: every decided result that isn't one of the scenarios. */
export function checksAt(records: readonly TestRunRecord[], revision: string, scenarioIds: readonly string[]): ValidationView['checks'] {
  const ids = new Set(scenarioIds);
  const out = { passed: 0, failed: 0, skipped: 0 };
  for (const rec of records) {
    if (!sameRevision(rec.testedRevision, revision)) continue;
    if (/^journey\s/i.test(rec.suite)) continue;
    for (const res of rec.results) {
      if (ids.has(res.name) || res.links.some((l) => ids.has(l.target))) continue;
      const s = statusOf(res.status);
      if (s === 'passed') out.passed++;
      else if (s === 'failed') out.failed++;
      else out.skipped++;
    }
  }
  return out;
}

/** A scenario's view from its definition, its results and the marks at this version (newest last in `marks`). */
export function scenarioView(def: { id: string; title: string; steps: string[]; start?: ScenarioStart }, r: ReturnType<typeof resultsAt>, marks: readonly FindingRecord[]): ScenarioView {
  const result: ScenarioResult = r.at.get(def.id) ?? 'not-run';
  const earlier = result === 'not-run' ? r.earlier.get(def.id) : undefined;
  const mine = marks.filter((m) => m.scenario === def.id);
  const finding = mine.reduce<FindingRecord | undefined>((a, m) => (!a || m.at >= a.at ? m : a), undefined);
  return { id: def.id, title: def.title, steps: def.steps, ...(def.start ? { start: def.start } : {}), result, ...(earlier ? { earlier } : {}), ...(finding ? { finding } : {}), marks: mine.length };
}

/** How the scenarios stand on a version: results, and the person's marks. */
export function scenarioSummary(list: readonly ScenarioView[]): { total: number; passed: number; failed: number; notRun: number; works: number; wrong: number; unmarked: number } {
  const n = (f: (s: ScenarioView) => boolean) => list.filter(f).length;
  return { total: list.length, passed: n((s) => s.result === 'passed'), failed: n((s) => s.result === 'failed'), notRun: n((s) => s.result === 'not-run'), works: n((s) => s.finding?.verdict === 'works'), wrong: n((s) => s.finding?.verdict === 'wrong'), unmarked: n((s) => !s.finding) };
}

const short = (sha: string) => sha.slice(0, 7);

/**
 * The correction's words for the team: the first line of what the person saw (so the request's title is
 * theirs, not a generic "Something's wrong…"), then which guided check, on which version, and the whole note.
 */
export function correctionText(title: string, scenario: string, revision: string, note: string): string {
  const head = requestTitle(note);
  return `${head ? `${head}\n\n` : ''}Something's wrong in the guided check "${title}" (${scenario}) on version ${short(revision)}: ${note}`;
}

/** The scenario summary in a line, for the Release section and the panel. */
export function summaryLine(s: ReturnType<typeof scenarioSummary>): string {
  if (!s.total) return 'No guided checks are written for this version yet';
  const parts = [`${s.passed} of ${s.total} passed`];
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.notRun) parts.push(`${s.notRun} not run on this version`);
  const marked = [s.works ? `${s.works} marked working` : '', s.wrong ? `${s.wrong} with something wrong` : ''].filter(Boolean);
  return `${parts.join(', ')}${marked.length ? `; ${marked.join(', ')}` : ''}`;
}
