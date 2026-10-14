// Build-plan rows whose State starts with "blocked" (surface asks, S5). A pending decision already raises
// the rows it parks (detect.ts, rule 2), but a row can say "blocked - OW-1" long after OW-1 was decided, or
// be blocked on something no pending decision names. Rows blocked on the same thing are one item: what the
// row names as the blocker, or, when that is a decision that's resolved, "update the build plan or name the
// real blocker". Pure text in, drafts out.

import type { StuckDraft } from '../../shared/stuck.js';
import { earliestDate, mdTables, pendingDecisions, planRows, projectFacts, rowsWords, type PlanRow } from './parse.js';

const H = 3_600_000;
const DECIDED = /\b(DECIDED|RESOLVED|CONFIRMED|ANSWERED|CLOSED)\b/i;
const ID = /\b[A-Z]{1,5}-\d+\b/g;

/** What a blocked row's State names as its blocker: the words after "blocked", up to the first ";" or the end. */
export function blockerOf(state: string): string {
  return state
    .replace(/`/g, '')
    .replace(/^\s*blocked\w*\s*(?:on|by)?\s*[-–—:]?\s*/i, '')
    .split(/;\s/)[0]
    .trim();
}

/** Whether decision or question `id` is settled: not pending in the build plan, and decided where it's listed (a table row starting with it), or a CONFIRMED PROJECT.md decision answers it. */
export function resolvedId(id: string, plan: string, project: string | undefined): boolean {
  if (pendingDecisions(plan).some((p) => p.id === id)) return false;
  const listed = [...mdTables(plan), ...(project ? mdTables(project) : [])].flatMap((t) => t.rows).filter((r) => r.cells[0]?.replace(/[`*]/g, '').trim() === id);
  if (listed.some((r) => DECIDED.test(r.cells.slice(1).join(' ')))) return true;
  return !!project && !!projectFacts(project, id).confirmed;
}

export interface BlockedRowsInput {
  now: number;
  decisionHours: number;
  plan: { file: string; text: string };
  project?: { file: string; text: string };
  /** Open pull request numbers: a row blocked on one is the stale-PR rule's. */
  openPrs: ReadonlySet<number>;
  firstSeen(id: string): number;
}

/** The blocked rows as stuck items, rows blocked on the same thing together. */
export function blockedRows(i: BlockedRowsInput): StuckDraft[] {
  const rows = [...planRows(i.plan.text).values()].filter((r) => /^\s*`?blocked/i.test(r.state));
  if (!rows.length) return [];
  // Rows a pending decision already parks are rule 2's.
  const parked = new Set(pendingDecisions(i.plan.text).flatMap((p) => p.rows));
  const groups = new Map<string, { blocker: string; ids: string[]; rows: PlanRow[] }>();
  for (const r of rows) {
    if (parked.has(r.n)) continue;
    const blocker = blockerOf(r.state);
    if ([...blocker.matchAll(/#(\d+)\b/g)].some((m) => i.openPrs.has(Number(m[1])))) continue;
    const ids = [...new Set(blocker.match(ID) ?? [])];
    const key = ids[0] ?? blocker.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    const g = groups.get(key) ?? { blocker, ids, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const out: StuckDraft[] = [];
  for (const [key, g] of groups) {
    const id = `blocked-${key.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 60)}`;
    const since = earliestDate(g.rows.map((r) => r.state).join(' ')) ?? i.firstSeen(id);
    if (i.now - since < i.decisionHours * H) continue;
    const resolved = g.ids.slice(0, 1).filter((x) => resolvedId(x, i.plan.text, i.project?.text));
    const words = rowsWords(g.rows.map((r) => r.n));
    out.push({
      id,
      kind: 'blocked-row',
      since,
      blocks: [words],
      evidence: g.rows.slice(0, 3).map((r) => (i.plan.file.endsWith('.json') ? { label: `${i.plan.file} (row ${r.n})`, file: i.plan.file } : { label: `${i.plan.file}:${r.line} (row ${r.n})`, file: i.plan.file, line: r.line })),
      row: { rows: words, blocker: g.blocker, ...(resolved.length ? { resolved: resolved[0] } : {}) },
    });
  }
  return out;
}
