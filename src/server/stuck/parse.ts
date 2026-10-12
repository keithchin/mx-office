// Reading the project's own files for stuck detection: the build plan's pending-decisions table and its
// row states (architecture/build-plan.md), PROJECT.md's Decisions and Open questions, and every mention
// of a pull request ("#51") in them and in the test reports. Pure text in, facts with file:line out;
// the files are read at main off the event loop (./repo.ts).

export interface MdRow {
  cells: string[];
  /** 1-based line in the file. */
  line: number;
}

export interface MdTable {
  headers: string[];
  rows: MdRow[];
  /** The nearest heading above it ("## Decisions"). */
  heading: string;
  line: number;
}

const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** Every pipe table in a markdown text, with the heading it sits under. */
export function mdTables(text: string): MdTable[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: MdTable[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) heading = l.trim();
    if (!l.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) continue;
    const t: MdTable = { headers: splitRow(l), rows: [], heading, line: i + 1 };
    i += 2;
    for (; i < lines.length && lines[i].trim().startsWith('|'); i++) t.rows.push({ cells: splitRow(lines[i]), line: i + 1 });
    i--;
    out.push(t);
  }
  return out;
}

const col = (t: MdTable, re: RegExp) => t.headers.findIndex((h) => re.test(h));
const plain = (s: string) => s.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const ISO = /\b(20\d\d-[01]\d-[0-3]\d)(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?Z?)?\b/g;

/** The earliest ISO date in a text (ms), if any. */
export function earliestDate(s: string): number | undefined {
  const ts = [...s.matchAll(ISO)].map((m) => Date.parse(m[0].length > 10 ? m[0] : `${m[1]}T00:00:00Z`)).filter(Number.isFinite);
  return ts.length ? Math.min(...ts) : undefined;
}

/** "59, 60, 61, 62 (Phase 9…)", "rows 59–62", "21 real-name…": the row numbers, parentheses left out. */
export function rowNumbers(cell: string): string[] {
  const s = cell.replace(/\([^)]*\)/g, ' ');
  if (/^\s*(none|n\/a|-|—)?\s*$/i.test(s) || /^\s*none\b/i.test(s)) return [];
  const out: string[] = [];
  const ranges = /\b(\d{1,3})\s*(?:–|—|-|to)\s*(\d{1,3})\b/g;
  let rest = s;
  for (const m of s.matchAll(ranges)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b >= a && b - a < 100) for (let n = a; n <= b; n++) out.push(String(n));
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(/\b(\d{1,3}[a-z]?)\b/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** "rows 59–62" for a run of numbers, else "rows 7, 9 and 12". */
export function rowsWords(rows: readonly string[]): string {
  if (!rows.length) return '';
  if (rows.length === 1) return `row ${rows[0]}`;
  const ns = rows.map(Number);
  const run = ns.every((n, i) => Number.isInteger(n) && (i === 0 || n === ns[i - 1] + 1));
  return run ? `rows ${ns[0]}–${ns.at(-1)}` : `rows ${rows.slice(0, -1).join(', ')} and ${rows.at(-1)}`;
}

// ---- The build plan ------------------------------------------------------------------------------

export interface PlanRow {
  n: string;
  produces: string;
  state: string;
  line: number;
}

/** The script-sequence rows (| # | Kind | Step | Produces / Proves | … | State |), by number. */
export function planRows(text: string): Map<string, PlanRow> {
  const out = new Map<string, PlanRow>();
  for (const t of mdTables(text)) {
    const n = col(t, /^#$/);
    const st = col(t, /^state$/i);
    if (n < 0 || st < 0) continue;
    const pr = col(t, /^produces/i);
    for (const r of t.rows) if (r.cells[n]) out.set(r.cells[n], { n: r.cells[n], produces: pr >= 0 ? (r.cells[pr] ?? '') : '', state: r.cells[st] ?? '', line: r.line });
  }
  return out;
}

/** A row still waiting: not built, done or waived. */
export const rowOpen = (r: PlanRow | undefined) => !r || !/^\s*(built|done|passed|waived|dropped)\b/i.test(r.state);

const DECIDED = /\b(DECIDED|RESOLVED|CONFIRMED|ANSWERED|CLOSED)\b/;

export interface PendingDecision {
  id: string;
  question: string;
  raised: string;
  rows: string[];
  workaround?: string;
  line: number;
}

/** The build plan's pending decisions (| ID | Question | Raised | Blocks (rows) | Build proceeds on |) that are still pending. */
export function pendingDecisions(text: string): PendingDecision[] {
  const out: PendingDecision[] = [];
  for (const t of mdTables(text)) {
    const id = col(t, /^id$/i);
    const q = col(t, /^question$/i);
    const blocks = col(t, /^blocks/i);
    if (id < 0 || q < 0 || blocks < 0) continue;
    const raised = col(t, /^raised/i);
    const on = col(t, /proceeds on|workaround/i);
    for (const r of t.rows) {
      if (r.cells.some((c) => DECIDED.test(c))) continue;
      const rid = plain(r.cells[id] ?? '');
      if (!rid) continue;
      const workaround = on >= 0 ? plain(r.cells[on] ?? '') : '';
      out.push({ id: rid, question: plain(r.cells[q] ?? ''), raised: raised >= 0 ? plain(r.cells[raised] ?? '') : '', rows: rowNumbers(r.cells[blocks] ?? ''), ...(workaround && !/^(none|-|—)$/i.test(workaround) ? { workaround } : {}), line: r.line });
    }
  }
  return out;
}

/** Journeys (J-09) a set of rows produces or names. */
export function journeysOf(rows: Map<string, PlanRow>, ns: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of ns) for (const m of `${rows.get(n)?.produces ?? ''}`.matchAll(/\bJ-\d+[a-z]?\b/g)) out.add(m[0]);
  return [...out];
}

/** "J-08 fails on #51", "J-08 visibility leg fails on #51": a failing journey and the PR it waits on, with the line. */
export function failingClaims(text: string): { name: string; pr: number; line: number }[] {
  const out: { name: string; pr: number; line: number }[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((l, i) => {
      for (const m of l.matchAll(/\b(J-\d+(?:\.\d+)?[a-z]?)\b[^|;.]{0,40}?\b(?:fails|failing|failed|red)\b[^|;.]{0,20}?\b(?:on|until|waits? on)\s+(?:PR\s+)?#(\d+)\b/gi)) out.push({ name: m[1], pr: Number(m[2]), line: i + 1 });
    });
  return out;
}

// ---- Mentions of a pull request --------------------------------------------------------------------

export interface PrRefs {
  /** Journeys, page and flow names held up by it. */
  blocks: string[];
  /** Each line that names it. */
  lines: { file: string; line: number }[];
  rows: string[];
}

/** Clauses split on ";" outside parentheses. */
function clauses(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  return [...out, cur];
}

const NAME = /\b[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g;
/** A clause where the PR fixes something rather than is waited on still counts: the thing it fixes is what waits. */
const WAITS = /\b(blocked|blocks|fails?|failing|waits?|waiting|until|with|holds?|open)\b/i;

/** Where `#n` is mentioned in each file, and what those mentions say it holds up (the build plan's rows first). */
export function prRefs(n: number, files: readonly { file: string; text: string }[], plan?: Map<string, PlanRow>): PrRefs {
  const re = new RegExp(`(?:^|[^\\w&])#${n}(?!\\d)`);
  const blocks = new Set<string>();
  const rows = new Set<string>();
  const lines: PrRefs['lines'] = [];
  for (const f of files) {
    f.text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .forEach((l, i) => {
        if (!re.test(l)) return;
        lines.push({ file: f.file, line: i + 1 });
        const row = plan && [...plan.values()].find((r) => r.line === i + 1 && /build-plan.(md|json)$/.test(f.file));
        if (row) rows.add(row.n);
        for (const c of clauses(row ? row.state : l)) {
          if (!re.test(c) || !WAITS.test(c)) continue;
          for (const m of c.matchAll(/\bJ-\d+(?:\.\d+)?[a-z]?\b/g)) blocks.add(m[0]);
          for (const m of c.matchAll(NAME)) blocks.add(m[0]);
        }
      });
  }
  const js = [...blocks].filter((b) => b.startsWith('J-')).sort();
  const names = [...blocks].filter((b) => !b.startsWith('J-')).sort();
  return { blocks: [...js, ...names], lines, rows: [...rows] };
}

// ---- PROJECT.md --------------------------------------------------------------------------------------

/** Words that say a CONFIRMED decision only defers it ("named when known; parked on stubs until then"). */
const DEFERS = /\b(when known|until then|for now|for this slice|parked|deferred|later)\b/i;

export interface ProjectFacts {
  /** A CONFIRMED decision that names the id and answers it (not one that only defers it). */
  confirmed?: { line: number; text: string };
  /** A CONFIRMED decision that names the id and accepts waiting ("for this slice"). */
  accepted?: { line: number; text: string; at?: number };
  /** The earliest date on a row of PROJECT.md whose id is `ref` ("PROJECT.md OI-1"), or that names the id. */
  since?: number;
}

const names = (s: string, id: string) => new RegExp(`(?:^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]*\\d)`).test(s);

/** What PROJECT.md says about decision `id` (raised by `raised`, e.g. "PROJECT.md OI-1"). */
export function projectFacts(text: string, id: string, raised = ''): ProjectFacts {
  const out: ProjectFacts = {};
  const ref = /PROJECT\.md\s+([A-Z]{1,4}-\d+)/.exec(raised)?.[1];
  const refDates: number[] = [];
  const nameDates: number[] = [];
  for (const t of mdTables(text)) {
    const status = col(t, /^status$/i);
    const decisions = /^##\s+Decisions\b/i.test(t.heading);
    for (const r of t.rows) {
      const row = r.cells.join(' | ');
      const first = plain(r.cells[0] ?? '');
      if (ref && first === ref) {
        const d = earliestDate(row);
        if (d !== undefined) refDates.push(d);
      }
      if (!names(row, id)) continue;
      const d = earliestDate(row);
      if (d !== undefined) nameDates.push(d);
      if (!decisions || status < 0 || !/\bCONFIRMED\b/.test(r.cells[status] ?? '')) continue;
      const what = plain(r.cells.filter((_, i) => i !== status).join(' · '));
      if (DEFERS.test(row)) out.accepted ??= { line: r.line, text: what, ...(d !== undefined ? { at: d } : {}) };
      else out.confirmed ??= { line: r.line, text: what };
    }
  }
  const dates = refDates.length ? refDates : nameDates;
  if (dates.length) out.since = Math.min(...dates);
  return out;
}

export interface OpenQuestion {
  id: string;
  question: string;
  owner: string;
  line: number;
  since?: number;
}

const OPEN = /\b(open|pending|decision needed|waiting|to decide|unanswered|asked)\b/i;
const FOR_PM = /\b(PM|Project Manager|client|customer|sponsor)\b/i;

/** PROJECT.md's Open questions (and the tables under that heading) still open and the PM's or the client's to answer. */
export function openQuestions(text: string): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  let inOpen = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const openLines = new Set<number>();
  lines.forEach((l, i) => {
    if (/^##\s/.test(l)) inOpen = /^##\s+Open questions\b/i.test(l);
    if (inOpen) openLines.add(i + 1);
  });
  for (const t of mdTables(text)) {
    if (!openLines.has(t.line)) continue;
    const status = col(t, /^(status|type)$/i);
    const q = col(t, /^(question|item)$/i);
    const owner = col(t, /owner|resolution/i);
    if (status < 0 || q < 0) continue;
    for (const r of t.rows) {
      const st = r.cells[status] ?? '';
      if (!OPEN.test(st) || DECIDED.test(st) || /\bdeferred\b/i.test(st)) continue;
      const who = owner >= 0 ? (r.cells[owner] ?? '') : '';
      if (owner >= 0 && who.trim() && !FOR_PM.test(`${who} ${st}`)) continue;
      const since = earliestDate(r.cells.join(' '));
      out.push({ id: plain(r.cells[0] ?? ''), question: plain(r.cells[q] ?? ''), owner: plain(who), line: r.line, ...(since !== undefined ? { since } : {}) });
    }
  }
  return out;
}

/** The text of PROJECT.md's "## Current stage" section: a change there is a stage change. */
export function currentStage(text: string): string {
  const m = /^##\s+Current stage\b[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(text.replace(/\r\n?/g, '\n'));
  return (m?.[1] ?? '').trim();
}

/** A short question: parentheses dropped, cut at about 150 characters. */
export function shortQuestion(q: string): string {
  const s = plain(q.replace(/\([^)]*\)/g, '')).replace(/\s+([,.;:])/g, '$1').replace(/[.;:,\s]+$/, '');
  return s.length > 150 ? `${s.slice(0, 145).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '')}…` : s;
}

/** build-plan.json (the derived render) as the script-sequence table, for a project with no build-plan.md. */
export function planJsonAsMarkdown(json: string): string {
  try {
    const j = JSON.parse(json) as { phases?: { steps?: { number?: unknown; produces?: unknown; state?: unknown }[] }[] };
    const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
    const rows = (j.phases ?? []).flatMap((p) => p.steps ?? []).map((s) => `| ${cell(s.number)} | ${cell(s.produces)} | ${cell(s.state)} |`);
    return ['| # | Produces | State |', '|---|---|---|', ...rows].join('\n');
  } catch {
    return '';
  }
}
