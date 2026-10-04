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
