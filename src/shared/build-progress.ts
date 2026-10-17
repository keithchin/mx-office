// What the office can see of a toolkit project's build (Stage 5), for the progress bar and the stage line.
// gate-check reports Build as MANUAL on every run ("not file-existence-checkable — fill in status
// manually"), so on its own the bar showed "Build · not started" over a build half merged (a migration project,
// release 56: PR #3 merged with rows 4–14, PR #6 open, BUILD-LOG entries). Everything here is read
// deterministically from origin/<default> and the team's pushed branches (server/wizard/build-evidence.ts).
//
// The build plan's own State column (brd-to-build-plan.md's row schema: built / partial / not built /
// blocked) is read but not trusted alone: on a migration project it said "not built" for all 33 rows on main and on
// the build branch while the commits said "Row 14: seed proven by OQL read-back". So each row's evidence
// comes from what the team wrote as it worked: commit subjects naming the row ("Row 16: sheet form page
// applied", "Rows 19-21: …") on a commit that changed build files or says applied / proven / done / PASS
// (a "Draft row 16" or "Journal: row 3" commit only mentions it), "### <date> — Row N" notes in
// docs/BUILD-LOG.md, and the rows a merged build PR's title names ("rows 4-14"). A row is "on main" when
// that evidence is reachable from the default branch, "on a branch" when only an unmerged branch has it, and
// "mentioned" when nothing but a mention exists. The counts are said as "rows with build evidence", never
// as a percentage, and when the plan's State column disagrees the stage card asks the lead to fix the
// paperwork (shared/stage-derive.ts). It makes Build "in progress", never "done": only its gate does that (a
// CONFIRMED sign-off row, or gate-check's PASS). Pure.

export interface BuildPr {
  number: number;
  title: string;
  /** Build files it changed. */
  files: number;
  /** The build-plan rows its title names. */
  rows?: number[];
}

export interface BuildBranch {
  branch: string;
  /** Commits it has that the default branch hasn't (undefined: the branch isn't fetched here). */
  ahead?: number;
  /** Build files it changes against the default branch. */
  files?: number;
  /** Its open pull request, when GitHub lists one. */
  pr?: { number: number; title: string; draft?: boolean };
  /** The build-plan rows with build evidence on it and not on the default branch (its commits, its BUILD-LOG, its PR's title). */
  rows?: number[];
}

/** The build plan's numbered rows by State (brd-to-build-plan.md: built / partial / not built / blocked). */
export interface BuildPlanCount {
  total: number;
  built: number;
  partial: number;
  blocked: number;
  /** Each row's State cell, lower-cased, by row number. */
  states?: Record<string, string>;
}

export interface BuildLogInfo {
  /** Gated rows (script runs) and "Row N" notes in docs/BUILD-LOG.md. */
  entries: number;
  last?: { at: string; what: string };
  /** The rows its "### <date> — Row N" notes are about. */
  rows?: number[];
}

/** Each build-plan row's evidence, by where it is. */
export interface BuildRows {
  /** Rows with build evidence reachable from the default branch. */
  main: number[];
  /** Rows with build evidence only on unmerged branches. */
  branch: number[];
  /** Rows only mentioned (a draft, a journal line), with no build evidence anywhere. */
  mentioned: number[];
}

export interface BuildEvidence {
  /** The default branch and the commit read. */
  branch?: string;
  sha?: string;
  plan?: BuildPlanCount;
  merged: BuildPr[];
  open: BuildBranch[];
  log?: BuildLogInfo;
  /** MDL scripts under mdlsource/ on the default branch. */
  scripts?: number;
  rows?: BuildRows;
}

/** A file that is the build itself: an MDL script, the model (.mpr, mprcontents/), the app's widgets and JavaScript/Java sources. */
export function isBuildPath(f: string): boolean {
  return /^mdlsource\//.test(f) || /^[^/]+\.mpr$/.test(f) || /^mprcontents\//.test(f) || /^(widgets|javascriptsource|javasource|themesource)\//.test(f);
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** The build plan's numbered rows by their State cell, from every table whose header has `#` first and a State (or Status) column; undefined when it has none. */
export function planRows(md: string | undefined): BuildPlanCount | undefined {
  const lines = (md ?? '').replace(/\r/g, '').split('\n');
  const seen = new Map<number, string>();
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trim().startsWith('|') ? cells(lines[i]) : undefined;
    if (!head || head[0] !== '#' || !/^\|\s*:?-/.test(lines[i + 1]?.trim() ?? '')) continue;
    const col = head.findIndex((c) => /^(state|status)$/i.test(c.replace(/\*/g, '')));
    if (col < 0) continue;
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const c = cells(lines[i]);
      const n = /^\d+$/.test(c[0] ?? '') ? Number(c[0]) : NaN;
      if (Number.isFinite(n) && c[col] !== undefined) seen.set(n, c[col].replace(/[`*_]/g, '').trim().toLowerCase());
    }
  }
  if (!seen.size) return undefined;
  const states = [...seen.values()];
  const count = (re: RegExp) => states.filter((s) => re.test(s)).length;
  return { total: seen.size, built: count(BUILT), partial: count(/^partial\b/), blocked: count(/^blocked\b/), states: Object.fromEntries([...seen].map(([n, s]) => [String(n), s])) };
}

const BUILT = /^(✅\s*)?(built|done)\b/;
const NUM = String.raw`\d+[a-z]?`;
const RANGE = String.raw`${NUM}\s*(?:[-–—]|to)\s*${NUM}|${NUM}`;
const ROWS_RE = new RegExp(String.raw`\brows?\s+((?:${RANGE})(?:\s*(?:,|/|and|&)\s*(?:${RANGE}))*)`, 'gi');

/** The build-plan rows a title names: "rows 4-14", "Rows 19–21", "Row 14:", "rows 3, 5 and 7", "rows 19/20"; "20b" counts as row 20. */
export function rowsIn(title: string): number[] {
  const out = new Set<number>();
  for (const m of title.matchAll(ROWS_RE)) {
    for (const part of m[1].split(/\s*(?:,|\/|and|&)\s*/)) {
      const r = /^(\d+)[a-z]?\s*(?:[-–—]|to)\s*(\d+)[a-z]?$/i.exec(part.trim());
      if (r) {
        const [a, b] = [Number(r[1]), Number(r[2])];
        if (b >= a && b - a < 200) for (let n = a; n <= b; n++) out.add(n);
      } else if (/^\d+[a-z]?$/i.test(part.trim())) out.add(parseInt(part.trim(), 10));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** "4–14, 17": the rows as ranges. */
export function rowRanges(rows: readonly number[]): string {
  const s = [...new Set(rows)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(', ');
}

/** A commit as the office reads it: its subject and the files it changed. */
export interface CommitLine {
  subject: string;
  files: readonly string[];
}

/**
 * The rows commits give build evidence for, and the rows they only mention. Evidence: the subject names the
 * row and the commit changed build files or says it was applied / proven / done / passed / built. A subject
 * starting "Draft" or "Journal" only mentions its rows, whatever it changed.
 */
export function rowEvidence(commits: readonly CommitLine[]): { evidence: number[]; mentioned: number[] } {
  const ev = new Set<number>();
  const named = new Set<number>();
  for (const c of commits) {
    const rows = rowsIn(c.subject);
    if (!rows.length) continue;
    for (const r of rows) named.add(r);
    if (/^\s*(draft|journal)\b/i.test(c.subject)) continue;
    if (c.files.some(isBuildPath) || /\b(applied|proven|proved|done|pass(?:ed)?|built)\b/i.test(c.subject)) for (const r of rows) ev.add(r);
  }
  const sort = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { evidence: sort(ev), mentioned: sort(new Set([...named].filter((r) => !ev.has(r)))) };
}

/** docs/BUILD-LOG.md's build entries: gated script rows (`| when | \`script\` | gate | result | detail |`) and "### date — Row N" notes. Stage 1's SOURCE-WAIVED lines aren't build. */
export function buildLog(md: string | undefined): BuildLogInfo | undefined {
  if (!md) return undefined;
  let entries = 0;
  let last: BuildLogInfo['last'];
  const rows = new Set<number>();
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const row = /^\|\s*(\d{4}-\d{2}-\d{2}[T ][\d:]+)[^|]*\|\s*`?([^|`]+?)`?\s*\|\s*[^|]*\|\s*([^|]*?)\s*\|/.exec(line);
    if (row) {
      entries++;
      last = { at: row[1].replace('T', ' ').slice(0, 16), what: `${row[2]} ${row[3]}`.trim() };
      continue;
    }
    const note = /^###\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(Rows?\s+\d+.*)$/i.exec(line);
    if (note) {
      entries++;
      last = { at: note[1], what: note[2].trim() };
      for (const r of rowsIn(note[2])) rows.add(r);
    }
  }
  return entries ? { entries, ...(last ? { last } : {}), ...(rows.size ? { rows: [...rows].sort((a, b) => a - b) } : {}) } : undefined;
}

/**
 * Each row's evidence by where it is: on main (its commits, its BUILD-LOG notes, the rows merged build PRs'
 * titles name), only on an unmerged branch (`branches`: each branch's own evidence), or only mentioned.
 * Rows past the plan's last row are left out when there is a plan.
 */
export function rowsByPlace(main: { commits: readonly CommitLine[]; log?: BuildLogInfo; merged: readonly BuildPr[] }, branches: readonly { commits: readonly CommitLine[]; log?: BuildLogInfo; prRows?: readonly number[] }[], total?: number): BuildRows & { perBranch: number[][] } {
  const keep = (n: number) => total === undefined || (n >= 1 && n <= total);
  const m = rowEvidence(main.commits);
  const onMain = new Set([...m.evidence, ...(main.log?.rows ?? []), ...main.merged.flatMap((p) => p.rows ?? [])].filter(keep));
  const named = new Set(m.mentioned.filter(keep));
  const perBranch = branches.map((b) => {
    const e = rowEvidence(b.commits);
    for (const r of e.mentioned) if (keep(r)) named.add(r);
    return [...new Set([...e.evidence, ...(b.log?.rows ?? []), ...(b.prRows ?? [])])].filter((r) => keep(r) && !onMain.has(r)).sort((a, b) => a - b);
  });
  const onBranch = new Set(perBranch.flat());
  const sort = (s: Iterable<number>) => [...s].sort((a, b) => a - b);
  return { main: sort(onMain), branch: sort(onBranch), mentioned: sort([...named].filter((r) => !onMain.has(r) && !onBranch.has(r))), perBranch };
}

/** Anything at all says the build has started (merged or open build work, a row with evidence or marked built, a gated BUILD-LOG row, a script on main). */
export function buildUnderWay(e: BuildEvidence | undefined): boolean {
  if (!e) return false;
  return e.merged.length > 0 || e.open.length > 0 || !!(e.plan && e.plan.built + e.plan.partial > 0) || !!e.log?.entries || !!e.scripts || !!(e.rows && e.rows.main.length + e.rows.branch.length > 0);
}

const prWord = (n: number) => `PR${n === 1 ? '' : 's'}`;
const rowsWord = (n: number) => `row${n === 1 ? '' : 's'}`;

/** Where the unmerged rows are: "office/pixel-b1e9 (PR #6, open)", "2 open branches (PR #6, #7)". */
function branchWhere(e: BuildEvidence): string {
  const withRows = e.open.filter((b) => b.rows?.length);
  const bs = withRows.length ? withRows : e.open;
  const prs = bs.filter((b) => b.pr).map((b) => `#${b.pr!.number}`);
  if (bs.length === 1) return `${bs[0].branch} (${bs[0].pr ? `PR #${bs[0].pr.number}, open` : 'no PR yet'})`;
  return `${bs.length} open branches${prs.length ? ` (${prWord(prs.length)} ${prs.join(', ')})` : ''}`;
}

/**
 * The build in one line, from the best count there is: the plan's own State column when it marks at least
 * as many rows built as the evidence shows, else the rows with build evidence (on main, then more on the
 * branches) against the plan's row total, else what merged and what is open.
 * "11 of 33 build-plan rows with build evidence on main (rows 4–14), 9 more on office/pixel-b1e9 (PR #6, open)".
 */
export function buildSummary(e: BuildEvidence): string {
  const parts: string[] = [];
  const main = e.rows?.main ?? [];
  const branch = e.rows?.branch ?? [];
  const planned = e.plan ? e.plan.built + e.plan.partial : 0;
  if (e.plan && planned > 0 && planned >= main.length) {
    parts.push(`${e.plan.built} of ${e.plan.total} build-plan rows built${e.plan.partial ? `, ${e.plan.partial} partial` : ''} (the plan's State column)`);
  } else if (main.length) {
    parts.push(`${e.plan ? `${main.length} of ${e.plan.total} build-plan rows` : `${main.length} build-plan ${rowsWord(main.length)}`} with build evidence on ${e.branch ?? 'main'} (${rowsWord(main.length)} ${rowRanges(main)})`);
  } else if (e.merged.length) {
    parts.push(`${e.merged.length} build ${prWord(e.merged.length)} merged (${e.merged.map((p) => `#${p.number}`).join(', ')})`);
  }
  if (branch.length) parts.push(`${branch.length}${parts.length ? ' more' : ` build-plan ${rowsWord(branch.length)} with build evidence`} on ${branchWhere(e)}`);
  else if (e.open.length) parts.push(`work on ${branchWhere(e)}`);
  if (!parts.length && e.log?.last) parts.push(`last BUILD-LOG entry ${e.log.last.at}: ${e.log.last.what}`);
  if (!parts.length && e.scripts) parts.push(`${e.scripts} MDL script${e.scripts === 1 ? '' : 's'} on ${e.branch ?? 'main'}`);
  return parts.join(', ');
}

/** The rows on main with build evidence that the plan's State column still calls not built (none when the plan has no State column). */
export function planBehind(e: BuildEvidence | undefined): number[] {
  const states = e?.plan?.states;
  if (!states || !e?.rows) return [];
  return e.rows.main.filter((r) => states[String(r)] !== undefined && !BUILT.test(states[String(r)]) && !/^partial\b/.test(states[String(r)]));
}

/** The evidence, a line each, for the phase's tooltip. */
export function buildMeasures(e: BuildEvidence): string[] {
  const out: string[] = [];
  const main = e.branch ?? 'main';
  if (e.rows?.main.length) out.push(`Rows with build evidence on ${main}: ${rowRanges(e.rows.main)} (commits naming the row, BUILD-LOG notes, merged PR titles)`);
  for (const b of e.open.filter((x) => x.rows?.length).slice(0, 3)) out.push(`Rows with build evidence on ${b.branch} only: ${rowRanges(b.rows!)}`);
  if (e.rows?.mentioned.length) out.push(`Rows only mentioned (a draft or a journal line): ${rowRanges(e.rows.mentioned)}`);
  for (const p of e.merged.slice(0, 4)) out.push(`Merged: PR #${p.number} ${p.title}, ${p.files} build file${p.files === 1 ? '' : 's'}`);
  if (e.merged.length > 4) out.push(`… and ${e.merged.length - 4} more merged build ${prWord(e.merged.length - 4)}`);
  for (const b of e.open.slice(0, 3)) {
    const ahead = b.ahead !== undefined ? `, ${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead of ${main}` : '';
    out.push(b.pr ? `Open: PR #${b.pr.number} ${b.pr.title}${b.pr.draft ? ' (draft)' : ''} on ${b.branch}${ahead}` : `Branch ${b.branch}${ahead}, no PR yet`);
  }
  if (e.plan) out.push(`Build plan: ${e.plan.total} rows; ${e.plan.built + e.plan.partial ? `${e.plan.built} built${e.plan.partial ? `, ${e.plan.partial} partial` : ''}${e.plan.blocked ? `, ${e.plan.blocked} blocked` : ''}` : 'none marked built'} in its State column`);
  if (e.log?.last) out.push(`docs/BUILD-LOG.md: ${e.log.entries} build entr${e.log.entries === 1 ? 'y' : 'ies'}, the last ${e.log.last.at}: ${e.log.last.what}`);
  if (e.scripts) out.push(`${e.scripts} MDL script${e.scripts === 1 ? '' : 's'} under mdlsource/ on ${main}`);
  return out;
}
