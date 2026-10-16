// Where a toolkit project is, worked out by the office from evidence it can date: gate-check run by the
// office itself on a temporary checkout of origin/<default> (server/wizard/gate-source.ts), never from
// PROJECT.md's "Current stage" line or a committed index.html alone. Those two are readouts the toolkit
// writes when someone runs gate-check, and nothing re-runs it after a later sign-off merges: a migration
// project read "Stage 2 — Requirements" all afternoon while its main had Stages 3 and 4 signed off and the build
// under way (release 56). So the office derives the stage, says which commit it checked and how long
// ago, and says so when the register and gate-check disagree. Pure: the server, the pages, Teams and
// the phone all read it here. It never changes how the toolkit decides a gate (gate-play.ts's rules
// stay: a MANUAL stage waits on you only when every earlier stage passed).

import { STAGE_ORDER, type VerdictLike } from './gate-play.js';

/** gate-check's stage titles (its own words), for a stage the verdicts don't name. */
export const STAGE_TITLES: Readonly<Record<string, string>> = { P: 'Kickoff', '0': 'Triage', '1': 'Analysis', '2': 'Requirements', '3': 'Architecture & Design', '4': 'Build Plan', '5': 'Build', '6': 'Test', '7': 'Cutover' };

export interface VerdictRow extends VerdictLike {
  title?: string;
  detail?: string;
}

export interface DecisionRow {
  stage: string;
  decision: string;
  status: string;
}

/** Where the verdicts came from, and how fresh they are. */
export interface StageCheck {
  /**
   * office: gate-check run by the office on `sha`. committed: the index.html committed at `sha` (nobody
   * in the office checked it). folder: the project's folder (no remote default branch).
   */
  source: 'office' | 'committed' | 'folder';
  /** The default branch read (main). */
  branch?: string;
  /** The commit the verdicts describe. */
  sha?: string;
  /** When the office's gate-check finished (source office). */
  at?: number;
  /** gate-check is running now. */
  running?: boolean;
  /** The latest try on origin/<default>'s head failed: why, and when. */
  error?: string;
  errorAt?: number;
  /** The verdicts describe an older commit than origin/<default>'s head (kept from the last good check). */
  stale?: boolean;
  /** origin/<default>'s head now, when the verdicts are stale. */
  head?: string;
}

export interface DerivedStage {
  /** A stage id (P, 0–7), or `all` once every stage through 7 passed or was waived. */
  id: string;
  title: string;
  /** gate-check's verdict for it (PENDING, MANUAL, FAIL…). */
  status?: string;
}

/** Something the office's own check says doesn't add up: shown as an info card, never a wait. */
export type StageFlag =
  | { kind: 'paperwork'; signed: string[]; failing: { id: string; title: string; detail?: string }[]; text: string }
  | { kind: 'line'; says: string; derived: string; text: string };

/** What every stage line in the office is made from. */
export interface StageEvidence {
  stage?: DerivedStage;
  check: StageCheck;
  /** PROJECT.md's "Current stage" line on the same commit, as written (the toolkit's readout). */
  line?: string;
  flags: StageFlag[];
}

const norm = (id: string) => id.trim().toUpperCase().replace(/^STAGE\s*/, '');
const settled = (s: string | undefined) => /^(PASS|WAIVED)$/i.test(s ?? '');
const isStage = (id: string) => (STAGE_ORDER as readonly string[]).includes(norm(id));
const titleOf = (verdicts: readonly VerdictRow[], id: string) => verdicts.find((v) => norm(v.id) === id)?.title || STAGE_TITLES[id] || id;

/** gate-check's per-stage lines (`Stage 2 (Requirements): FAIL — why`), for a run whose dashboard wasn't written. */
export function verdictsFromOutput(text: string): VerdictRow[] {
  const out: VerdictRow[] = [];
  for (const m of text.replace(/\r/g, '').matchAll(/^Stage (\w+) \(([^)]+)\): (PASS|FAIL|PENDING|WAIVED|MANUAL)\b[^\n]*?(?: [—·] (.*))?$/gm)) {
    if (!out.some((v) => v.id === m[1])) out.push({ id: m[1], title: m[2], status: m[3], ...(m[4] ? { detail: m[4].replace(/^Surface (MISSING: [^—]*— |present[^—]*— )/, '').slice(0, 240) } : {}) });
  }
  return out;
}

/**
 * The stages the register records as signed off: a CONFIRMED row for the stage whose decision says it was
 * signed off (the toolkit's has_confirmed_decision for a ✋ stage, the office's own sign-off row, "BRD F001
 * signed off as the Stage 2 baseline"). Any other CONFIRMED row (a scope answer at Stage 0) isn't a sign-off.
 */
export function signedOffStages(decisions: readonly DecisionRow[] | undefined): string[] {
  const out = new Set<string>();
  for (const r of decisions ?? []) {
    const id = norm(r.stage);
    if (isStage(id) && /^confirmed\b/i.test(r.status.trim()) && /\bsign(?:ed)?[- ]?off\b/i.test(r.decision)) out.add(id);
  }
  return STAGE_ORDER.filter((s) => out.has(s));
}

/** The stage PROJECT.md's "Current stage" line names: an id, `all`, or undefined when it names none. */
export function lineStage(projectMd: string | undefined): string | undefined {
  const sec = /^##\s*Current stage\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec((projectMd ?? '').replace(/\r/g, ''));
  const bold = sec ? /\*\*([^*]+)\*\*/.exec(sec[1]) : null;
  if (!bold) return undefined;
  if (/all gates passed/i.test(bold[1])) return 'all';
  const m = /^Stage\s+(\w+)\b/i.exec(bold[1].trim());
  return m && isStage(m[1]) ? norm(m[1]) : undefined;
}

/** The line itself, without its markdown ("Stage 2 — Requirements, in progress — gates passed: …"). */
export function lineText(projectMd: string | undefined): string | undefined {
  const sec = /^##\s*Current stage\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec((projectMd ?? '').replace(/\r/g, ''));
  const l = sec?.[1].split('\n').find((x) => x.trim().startsWith('**'));
  return l ? l.replace(/\*\*/g, '').replace(/\s*\(derived by gate-check[^)]*\)\.?/, '').trim() : undefined;
}

/** The stages gate-check reports, in pipeline order (the checks' rows ⟳, ?, ⚑… left out). */
const stageRows = (verdicts: readonly VerdictRow[]) => STAGE_ORDER.filter((s) => verdicts.some((v) => norm(v.id) === s)).map((s) => verdicts.find((v) => norm(v.id) === s)!);

/**
 * What gate-check itself would write into "Current stage" from these verdicts: the first stage neither
 * PASS nor WAIVED, a MANUAL one holding the position until a later stage has something in it.
 */
export function toolkitPosition(verdicts: readonly VerdictRow[]): DerivedStage | undefined {
  const rows = stageRows(verdicts);
  if (!rows.length) return undefined;
  let prev: VerdictRow | undefined;
  for (const v of rows) {
    const s = v.status.toUpperCase();
    if (settled(s) || s === 'MANUAL') {
      prev = v;
      continue;
    }
    const at = s !== 'FAIL' && prev?.status.toUpperCase() === 'MANUAL' ? prev : v;
    return { id: norm(at.id), title: titleOf(verdicts, norm(at.id)), status: at.status.toUpperCase() };
  }
  if (prev?.status.toUpperCase() === 'MANUAL') return { id: norm(prev.id), title: titleOf(verdicts, norm(prev.id)), status: 'MANUAL' };
  return { id: 'all', title: 'All gates passed' };
}

/**
 * Where the work is: past the latest stage that passed, was waived or is signed off in the register, the
 * first stage that hasn't settled. A paperwork gap at Stage P doesn't pull a project whose Stage 4 is
 * signed off back to Kickoff (that gap is a flag of its own: stageFlags). With nothing reached yet it is
 * the toolkit's own position.
 */
export function deriveStage(verdicts: readonly VerdictRow[], decisions?: readonly DecisionRow[]): DerivedStage | undefined {
  const rows = stageRows(verdicts);
  if (!rows.length) return undefined;
  const signed = new Set(signedOffStages(decisions));
  let reached = -1;
  rows.forEach((v, i) => {
    if (settled(v.status) || signed.has(norm(v.id))) reached = i;
  });
  if (reached < 0) return toolkitPosition(verdicts);
  const next = rows.slice(reached + 1).find((v) => !settled(v.status) && !signed.has(norm(v.id)));
  if (!next) return { id: 'all', title: 'All gates passed' };
  const id = norm(next.id);
  return { id, title: titleOf(verdicts, id), status: next.status.toUpperCase() };
}

const listIds = (ids: readonly string[]) => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`);
const stageName = (id: string) => (id === 'all' ? 'all gates passed' : `Stage ${id}`);

/**
 * What doesn't add up, from the office's own check of one commit: stages signed off in PROJECT.md while
 * gate-check still fails (or hasn't started) an earlier one, and a "Current stage" line that isn't what
 * gate-check would write from the same commit now.
 */
export function stageFlags(verdicts: readonly VerdictRow[], decisions: readonly DecisionRow[] | undefined, projectMd: string | undefined): StageFlag[] {
  const flags: StageFlag[] = [];
  const rows = stageRows(verdicts);
  if (!rows.length) return flags;
  const signed = signedOffStages(decisions);
  const top = signed.length ? STAGE_ORDER.indexOf(signed[signed.length - 1] as (typeof STAGE_ORDER)[number]) : -1;
  const failing = rows
    .filter((v) => STAGE_ORDER.indexOf(norm(v.id) as (typeof STAGE_ORDER)[number]) < top && /^(FAIL|PENDING)$/i.test(v.status))
    .map((v) => ({ id: norm(v.id), title: titleOf(verdicts, norm(v.id)), ...(v.detail ? { detail: v.detail } : {}) }));
  if (failing.length) {
    const first = STAGE_ORDER.indexOf(failing[0].id as (typeof STAGE_ORDER)[number]);
    const later = signed.filter((s) => STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]) > first);
    const why = failing.map((f) => `Stage ${f.id} ${/^PENDING$/i.test(rows.find((r) => norm(r.id) === f.id)?.status ?? '') ? 'pending' : 'failing'}${f.detail ? `: ${clip(f.detail, 160)}` : ''}`).join('; ');
    flags.push({ kind: 'paperwork', signed: later, failing, text: `Stage ${listIds(later)} ${later.length === 1 ? 'is' : 'are'} signed off in PROJECT.md, but gate-check still reports ${why}` });
  }
  const says = lineStage(projectMd);
  const pos = toolkitPosition(verdicts);
  if (says && pos && says !== pos.id) flags.push({ kind: 'line', says, derived: pos.id, text: `PROJECT.md's stage line is out of date: it says ${stageName(says)}; gate-check on main says ${stageName(pos.id)}` });
  return flags;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "3 min ago", "just now", "2 h ago". */
export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5);

/** How fresh the evidence is, in words: "checked on main @abc1234, 3 min ago", "checking…", "couldn't check: …". */
export function freshnessText(c: StageCheck, now: number): string {
  const branch = c.branch ?? 'main';
  const at = c.sha ? `${branch} @${c.sha.slice(0, 7)}` : branch;
  const parts: string[] = [];
  if (c.source === 'office' && c.at !== undefined) parts.push(`checked on ${at}, ${agoText(c.at, now)}`);
  else if (c.source === 'committed') parts.push(`from the dashboard committed on ${at}; the office hasn't checked it yet`);
  else if (c.source === 'folder') parts.push("from the project folder's gate dashboard");
  if (c.stale) parts.push(`stale: ${branch} has moved on${c.head ? ` to @${c.head.slice(0, 7)}` : ''}`);
  if (c.error) parts.push(`couldn't check${c.errorAt !== undefined ? ` at ${hhmm(c.errorAt)}` : ''}: ${clip(c.error, 140)}`);
  if (c.running) parts.push('checking…');
  return parts.join(' · ');
}

/** "Stage 5 · Build", or "All gates passed". */
export function stageLabel(s: DerivedStage): string {
  return s.id === 'all' ? 'All gates passed' : `Stage ${s.id} · ${s.title}`;
}

/** The one line every stage display shows: "Stage 5 · Build · checked on main @abc1234, 3 min ago". */
export function stageHeadline(e: StageEvidence, now: number): string {
  const fresh = freshnessText(e.check, now);
  return [e.stage ? stageLabel(e.stage) : 'Stage unknown', fresh].filter(Boolean).join(' · ');
}
