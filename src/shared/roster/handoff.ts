// The automatic hand-off of the build plan's next rows (release 82, team flow #5), pure. On the real build the
// Lead Developer stopped after every batch of build-plan rows and waited for a Project Manager's nudge. Now, when
// a Lead's turn ends with its batch done, the office hands it the plan's next rows for its role
// (server/roster/handoff.ts), within these rules:
//   - the plan is the toolkit's architecture/build-plan.md: tables with a `#` and a `Step` column, optionally
//     Kind, State (or Status), Depends on, and an Owner / Role / Lead / Team column;
//   - a row's role is its Owner column when it has one (a role title, a team, or a word of either), else its
//     Kind: BUILD, RUN and HARNESS rows are Development's, PROVE rows Testing's, BRIEF rows Analysis's;
//   - done is a row with build evidence (on main or a branch: shared/build-progress.ts), or a State of built /
//     done; a blocked row is never handed; a row whose Depends on names a row not done (and not in the batch) ends it;
//   - a checkpoint row (Kind CHECKPOINT / GATE / SIGN-OFF / REVIEW / DEMO, or a step that says checkpoint, sign-off,
//     Project Manager review, demo or acceptance) not done stops the hand-off before it, whoever's it is: past a
//     checkpoint the Project Manager decides;
//   - a batch is at most HANDOFF_BATCH rows of one phase, in plan order.

import type { TeamId } from './roles.js';

/** At most this many rows in one hand-off. */
export const HANDOFF_BATCH = 4;

export interface HandoffRow {
  n: number;
  step: string;
  kind?: string;
  phase: string;
  /** The team whose row it is. */
  team?: TeamId;
  state?: string;
  deps: number[];
  checkpoint: boolean;
}

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/[`*]/g, '').trim());

const TEAM_WORDS: [RegExp, TeamId][] = [
  [/\b(dev(elop(er|ment))?|build(er)?|engineer(ing)?|programm(er|ing))\b/i, 'development'],
  [/\b(test(er|ing)?|qa|quality)\b/i, 'testing'],
  [/\b(design(er)?|ux|ui)\b/i, 'design'],
  [/\b(analys(t|is)|business analyst|ba)\b/i, 'analysis'],
  [/\b(coordinat(or|ion)|management|pm)\b/i, 'management'],
];

/** The team an Owner cell names, or undefined. */
export function teamOfOwner(cell: string | undefined): TeamId | undefined {
  if (!cell?.trim()) return undefined;
  for (const [re, t] of TEAM_WORDS) if (re.test(cell)) return t;
  return undefined;
}

/** The team a row's Kind gives it, when it has no Owner. */
export function teamOfKind(kind: string | undefined): TeamId | undefined {
  const k = (kind ?? '').toUpperCase();
  if (/^(BUILD|RUN|HARNESS)\b/.test(k)) return 'development';
  if (/^PROVE\b/.test(k)) return 'testing';
  if (/^BRIEF\b/.test(k)) return 'analysis';
  return k ? undefined : 'development';
}

const CHECKPOINT_KIND = /^(CHECKPOINT|GATE|SIGN-?OFF|REVIEW|DEMO|MILESTONE)\b/i;
const CHECKPOINT_STEP = /\b(checkpoint|sign[- ]?off|(project manager|pm)('s)? (review|approval|sign)|demo to|acceptance)\b/i;

/** The plan's rows in order, with what the hand-off needs of each. */
export function handoffRows(md: string | undefined): HandoffRow[] {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: HandoffRow[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{2,4}\s/.test(l)) heading = l.replace(/^#+\s*/, '').trim();
    if (!l.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) continue;
    const head = cells(l).map((c) => c.toLowerCase());
    const nCol = head.indexOf('#');
    const stepCol = head.findIndex((c) => c === 'step');
    if (nCol < 0 || stepCol < 0) continue;
    const kindCol = head.indexOf('kind');
    const stateCol = head.findIndex((c) => c === 'state' || c === 'status');
    const depCol = head.findIndex((c) => /^depends( on)?$/.test(c));
    const ownerCol = head.findIndex((c) => /^(owner|role|lead|team|who|assignee)$/.test(c));
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const c = cells(lines[i]);
      if (!/^\d+$/.test(c[nCol] ?? '')) continue;
      const kind = kindCol >= 0 && c[kindCol] ? c[kindCol].toUpperCase() : undefined;
      const step = c[stepCol] ?? '';
      const team = (ownerCol >= 0 ? teamOfOwner(c[ownerCol]) : undefined) ?? teamOfKind(kind);
      const deps = depCol >= 0 ? [...(c[depCol] ?? '').matchAll(/\d+/g)].map((m) => Number(m[0])) : [];
      out.push({ n: Number(c[nCol]), step, ...(kind ? { kind } : {}), phase: heading, ...(team ? { team } : {}), ...(stateCol >= 0 && c[stateCol] ? { state: c[stateCol].toLowerCase() } : {}), deps, checkpoint: (!!kind && CHECKPOINT_KIND.test(kind)) || CHECKPOINT_STEP.test(step) });
    }
    i--;
  }
  return out;
}

const BUILT = /^(✅\s*)?(built|done|complete[d]?)\b/;
const BLOCKED = /^(⛔\s*)?blocked\b/;

export interface NextRows {
  rows: HandoffRow[];
  /** A checkpoint (or a dependency not done) the hand-off stopped before, when it did. */
  stoppedAt?: { n: number; why: 'checkpoint' | 'depends'; step: string };
}

/** The next rows for `teams` (the teams the Lead covers): not done, not blocked, before any checkpoint not done. */
export function nextRows(rows: readonly HandoffRow[], done: ReadonlySet<number>, teams: readonly TeamId[], batch = HANDOFF_BATCH): NextRows {
  const isDone = (r: HandoffRow) => done.has(r.n) || BUILT.test(r.state ?? '');
  const byN = new Map(rows.map((r) => [r.n, r]));
  const out: HandoffRow[] = [];
  for (const r of rows) {
    if (isDone(r)) continue;
    if (r.checkpoint) return { rows: out, stoppedAt: { n: r.n, why: 'checkpoint', step: r.step } };
    if (!r.team || !teams.includes(r.team) || BLOCKED.test(r.state ?? '')) continue;
    if (out.length && r.phase !== out[0].phase) break;
    const waiting = r.deps.find((d) => d !== r.n && byN.has(d) && !isDone(byN.get(d)!) && !out.some((o) => o.n === d));
    if (waiting !== undefined) return out.length ? { rows: out } : { rows: out, stoppedAt: { n: r.n, why: 'depends', step: r.step } };
    out.push(r);
    if (out.length >= batch) break;
  }
  return { rows: out };
}

/** "rows 12–15" / "row 12" / "rows 12, 14 and 15". */
export function rowsWords(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b);
  if (s.length === 1) return `row ${s[0]}`;
  const consecutive = s.every((n, i) => i === 0 || n === s[i - 1] + 1);
  return consecutive ? `rows ${s[0]}–${s[s.length - 1]}` : `rows ${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`;
}

/** The message the Lead gets: the rows, where they are, and the usual rule for the end of the batch. */
export function handoffPrompt(rows: readonly HandoffRow[], level: number): string {
  const list = rows.map((r) => `- Row ${r.n}${r.kind ? ` (${r.kind})` : ''}: ${r.step}`).join('\n');
  return [
    `Your last batch is done. Next in architecture/build-plan.md for you: ${rowsWords(rows.map((r) => r.n))}${rows[0]?.phase ? ` (${rows[0].phase})` : ''}:`,
    list,
    '',
    `Build them as you did the last batch: commit each with "Row N: …" in the subject, run the checks, and record them in docs/BUILD-LOG.md. When they're done, say so in one line and stop; the office hands you the next rows (or stops at the next checkpoint for the Project Manager). Escalate anything you can't decide at autonomy level ${level}.`,
    '(Handed over automatically by the office from the build plan.)',
  ].join('\n');
}
