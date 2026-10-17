// Which build-plan rows a commit gives evidence for, read the way the team writes as it works: a commit
// subject naming the row ("Row 16: sheet form page applied", "Rows 19-21: …", a merged PR whose title
// says "rows 4-14") on a commit that changed build files or says applied / proven / done / PASS, and the
// "### <date> — Row N" notes in docs/BUILD-LOG.md. A "Draft row 16" or "Journal: row 3" commit only
// mentions it. The plan's own State column is never trusted for this: agents don't update it (PackTrack,
// release 56: all 33 rows "not built" while main had rows 3–14 merged).
//
// The same rules as feat/build-progress's shared/build-progress.ts (rowsIn, rowEvidence), which wasn't on
// staging when the live app's readiness needed them; the live app needs them per commit (which commits are
// in the running build), so this small copy keeps the commit with each row. Fold the two together once
// both are merged. Pure.

/** A commit as the office reads it: its sha, its subject (a merge commit's PR title after it), the files it changed. */
export interface RowCommit {
  sha: string;
  subject: string;
  files: readonly string[];
}

/** A file that is the build itself: an MDL script, the model, the app's widgets and sources, its theme. */
export function isBuildPath(f: string): boolean {
  return /^mdlsource\//.test(f) || /(^|\/)[^/]+\.mpr$/.test(f) || /(^|\/)mprcontents\//.test(f) || /^(widgets|javascriptsource|javasource|themesource|theme)\//.test(f);
}

const NUM = String.raw`\d+[a-z]?`;
const RANGE = String.raw`${NUM}\s*(?:[-–—]|to)\s*${NUM}|${NUM}`;
const ROWS_RE = new RegExp(String.raw`\brows?\s+((?:${RANGE})(?:\s*(?:,|/|and|&)\s*(?:${RANGE}))*)`, 'gi');

/** The rows a line names: "Row 14:", "rows 4-14", "Rows 19–21", "rows 3, 5 and 7", "rows 19/20"; "20b" is row 20. */
export function rowsIn(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(ROWS_RE)) {
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

/** The rows one commit gives build evidence for (none for a draft, a journal line or a bare mention). */
export function commitRows(c: Pick<RowCommit, 'subject' | 'files'>): number[] {
  const rows = rowsIn(c.subject);
  if (!rows.length || /^\s*(draft|journal)\b/i.test(c.subject)) return [];
  return c.files.some(isBuildPath) || /\b(applied|proven|proved|done|pass(?:ed)?|built)\b/i.test(c.subject) ? rows : [];
}

/** The rows docs/BUILD-LOG.md's "### <date> — Row N" notes are about. */
export function buildLogRows(md: string | undefined): number[] {
  const out = new Set<number>();
  for (const line of (md ?? '').replace(/\r/g, '').split('\n')) {
    const note = /^###\s+\d{4}-\d{2}-\d{2}\s+[—–-]\s+(Rows?\s+\d+.*)$/i.exec(line);
    if (note) for (const r of rowsIn(note[1])) out.add(r);
  }
  return [...out].sort((a, b) => a - b);
}

/** Every row with build evidence in a run of commits (and the BUILD-LOG at its tip). */
export function rowsWithEvidence(commits: readonly Pick<RowCommit, 'subject' | 'files'>[], buildLog?: string): Set<number> {
  const out = new Set<number>(buildLogRows(buildLog));
  for (const c of commits) for (const r of commitRows(c)) out.add(r);
  return out;
}

/** "4–14, 17": rows as ranges. */
export function rowRanges(rows: Iterable<number>): string {
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

/** "row 7" / "rows 3–14" / "rows 3, 5". */
export const rowsWord = (rows: readonly number[]) => `row${rows.length === 1 ? '' : 's'} ${rowRanges(rows)}`;
