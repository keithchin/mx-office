// The toolkit's decision register, PROJECT.md: writing the wizard's kickoff decisions into it. Two
// places, on purpose. gate-check reads a project's entry mode (and the waivers) from flat
// "Label: value" lines and skips table rows (its reg_field() never strips a leading "|"), so the
// decisions it acts on get a flat line; the human-facing record is the "## Decisions" table, where
// every gate decision lands as CONFIRMED or ASSUMED.

export interface DecisionRow {
  stage: string;
  decision: string;
  status: string;
  notes: string;
}

const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
/** The part of a decision before its colon ("Entry mode"), which says which row it is. */
const keyOf = (decision: string) => decision.split(':')[0].trim().toLowerCase();

/** Lines that aren't inside an HTML comment: gate-check ignores labels in comments, and so do we. */
function uncommented(lines: string[]): boolean[] {
  let inComment = false;
  return lines.map((l) => {
    if (l.includes('<!--')) inComment = true;
    const out = !inComment;
    if (inComment && l.includes('-->')) inComment = false;
    return out && !l.includes('-->');
  });
}

/**
 * PROJECT.md with each `flat` label set ("Entry mode: greenfield"), replacing the line if it's there
 * or adding it under the register's header lines, and each row in the Decisions table, replacing the
 * row for the same stage and decision label. Running it again with the same input changes nothing.
 */
export function recordDecisions(md: string, flat: [label: string, value: string][], rows: DecisionRow[]): string {
  const crlf = md.includes('\r\n');
  const lines = md.replace(/\r\n/g, '\n').split('\n');

  for (const [label, value] of flat) {
    const open = uncommented(lines);
    const want = `${label}: ${value.replace(/\r?\n/g, ' ').trim()}`;
    const i = lines.findIndex((l, n) => open[n] && l.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    if (i >= 0) {
      lines[i] = want;
      continue;
    }
    // Under the last of the header's flat lines ("Toolkit commit:", "Exec approval:", ours), before its comment.
    let after = -1;
    const firstSection = lines.findIndex((l, n) => n > 0 && /^##\s/.test(l) && !/^##\s*Current stage/i.test(l));
    for (let n = 0; n < (firstSection < 0 ? lines.length : firstSection); n++) if (open[n] && /^[A-Z][A-Za-z ]{2,40}:\s\S/.test(lines[n])) after = n;
    if (after < 0) after = Math.max(0, (firstSection < 0 ? lines.length : firstSection) - 1);
    lines.splice(after + 1, 0, want);
  }

  const head = lines.findIndex((l) => /^##\s*Decisions\s*$/i.test(l));
  if (head < 0) {
    lines.push('', '## Decisions', '', '| Stage | Decision | Status | Notes |', '|---|---|---|---|');
    return finish(recordRows(lines, lines.length - 5, rows), crlf);
  }
  return finish(recordRows(lines, head, rows), crlf);
}

function recordRows(lines: string[], head: number, rows: DecisionRow[]): string[] {
  for (const r of rows) {
    let end = head + 1;
    while (end < lines.length && !/^##\s/.test(lines[end])) end++;
    const tableRows: number[] = [];
    for (let n = head + 1; n < end; n++) if (lines[n].trim().startsWith('|')) tableRows.push(n);
    const text = `| ${cell(r.stage)} | ${cell(r.decision)} | ${cell(r.status)} | ${cell(r.notes)} |`;
    const same = tableRows.find((n) => {
      const c = lines[n].split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());
      return c.length >= 2 && c[0].toLowerCase() === r.stage.toLowerCase() && keyOf(c[1]) === keyOf(r.decision);
    });
    if (same !== undefined) {
      lines[same] = text;
      continue;
    }
    if (tableRows.length) lines.splice(tableRows[tableRows.length - 1] + 1, 0, text);
    else lines.splice(head + 1, 0, '', '| Stage | Decision | Status | Notes |', '|---|---|---|---|', text);
  }
  return lines;
}

const finish = (lines: string[], crlf: boolean) => (crlf ? lines.join('\r\n') : lines.join('\n'));

export interface QuestionRow {
  question: string;
  /** Where it was raised: "Stage 0: project brief q3 (docs/project-brief.md)". */
  raised: string;
  /** OPEN until someone answers it. */
  status: string;
}

/** The lines of a "## <title>" section (after the heading, up to the next "## "), or undefined when there is none. */
function sectionRange(lines: string[], title: RegExp): [head: number, end: number] | undefined {
  const head = lines.findIndex((l) => title.test(l));
  if (head < 0) return undefined;
  let end = head + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return [head, end];
}

/**
 * PROJECT.md with the brief's open questions in "## Open questions" (the toolkit's table: # | Question |
 * Raised at | Status, numbered OQ-01… so no row reads as a stage) and its assumptions in "## Assumptions
 * (ASSUMED, unresolved)", replacing its "None yet.". A question or an assumption already there (the same
 * words) isn't added again, so running it twice changes nothing; what anyone else wrote there stays.
 */
export function recordBriefRegister(md: string, questions: QuestionRow[], assumptions: string[]): string {
  if (!questions.length && !assumptions.length) return md;
  const crlf = md.includes('\r\n');
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  if (questions.length) {
    let r = sectionRange(lines, /^##\s*Open questions\s*$/i);
    if (!r) {
      const before = sectionRange(lines, /^##\s*Assumptions\b/i)?.[0] ?? lines.length;
      lines.splice(before, 0, '## Open questions', '', '| # | Question | Raised at | Status |', '|---|---|---|---|', '');
      r = sectionRange(lines, /^##\s*Open questions\s*$/i)!;
    }
    const [head, end] = r;
    const rows: number[] = [];
    for (let n = head + 1; n < end; n++) if (lines[n].trim().startsWith('|')) rows.push(n);
    const cells = (n: number) => lines[n].split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const have = new Set(rows.map((n) => (cells(n)[1] ?? '').toLowerCase()));
    let num = Math.max(0, ...rows.map((n) => Number(/^OQ-(\d+)$/i.exec(cells(n)[0] ?? '')?.[1] ?? 0)));
    const add = questions.filter((q) => !have.has(cell(q.question).toLowerCase())).map((q) => `| OQ-${String(++num).padStart(2, '0')} | ${cell(q.question)} | ${cell(q.raised)} | ${cell(q.status)} |`);
    if (add.length) {
      if (rows.length) lines.splice(rows[rows.length - 1] + 1, 0, ...add);
      else lines.splice(head + 1, 0, '', '| # | Question | Raised at | Status |', '|---|---|---|---|', ...add);
    }
  }
  if (assumptions.length) {
    let r = sectionRange(lines, /^##\s*Assumptions\b/i);
    if (!r) {
      lines.push('', '## Assumptions (ASSUMED, unresolved)', '');
      r = sectionRange(lines, /^##\s*Assumptions\b/i)!;
    }
    const [head, end] = r;
    const body = lines.slice(head + 1, end);
    const have = new Set(body.map((l) => l.trim()));
    const add = assumptions.map((a) => a.replace(/\r?\n/g, ' ').trim()).filter((a) => !have.has(a));
    if (add.length) {
      const kept = body.filter((l) => !/^none yet\.?$/i.test(l.trim()));
      while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
      while (kept.length && !kept[0].trim()) kept.shift();
      lines.splice(head + 1, end - head - 1, '', ...kept, ...add, '');
    }
  }
  return finish(lines, crlf);
}

/** A flat "Label: value" line's value, outside comments (as gate-check's reg_field reads it). */
export function registerField(md: string, label: string): string | undefined {
  const lines = md.replace(/\r/g, '').split('\n');
  const open = uncommented(lines);
  const want = label.toLowerCase();
  for (let n = 0; n < lines.length; n++) {
    if (!open[n]) continue;
    const line = lines[n].replace(/^[ \t>*_-]+/, '');
    const i = line.indexOf(':');
    if (i < 0) continue;
    if (line.slice(0, i).replace(/\*\*/g, '').trim().toLowerCase() !== want) continue;
    const v = line.slice(i + 1).replace(/\*/g, '').trim();
    if (v) return v;
  }
  return undefined;
}

/** The register's open questions: rows of "## Open questions" whose status isn't settled. */
export function openQuestions(md: string): string[] {
  const sec = /^##\s*Open questions\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(md.replace(/\r/g, ''));
  if (!sec) return [];
  return sec[1]
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && c[0] !== '#' && c[1] && !/^question$/i.test(c[1]) && !/^(closed|resolved|answered|done|confirmed)/i.test(c[3] ?? ''))
    .map((c) => c[1]);
}
