// The toolkit's intake.md: reading its questions from the toolkit's one template, and writing the
// wizard's answers into a project's copy in the form gate-check's Stage P accepts. The toolkit keeps
// the template in bin/lib/intake-template.sh (a heredoc both of its writers source), so reading it
// from there means a question added to the toolkit shows up in the wizard without a change here.

import type { AnswerKind, IntakeAnswer, IntakeQuestion } from '../../shared/wizard.js';

const PLACEHOLDER = '_Not yet asked._';

/** The questions in the toolkit's intake template (the text of its heredoc), in order. */
export function parseIntakeTemplate(script: string): IntakeQuestion[] {
  const body = /<<'MXTK_INTAKE_EOF'\n([\s\S]*?)\nMXTK_INTAKE_EOF/.exec(script.replace(/\r/g, ''))?.[1] ?? script;
  return sections(body).map(({ n, title, lines }) => ({
    n,
    title,
    help: lines
      .join('\n')
      .replace(PLACEHOLDER, '')
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n'),
  }));
}

interface Section {
  n: number;
  title: string;
  /** Index of its "## N." heading in the file's lines. */
  at: number;
  /** Where the next section starts (or the file ends). */
  end: number;
  lines: string[];
}

function sections(md: string): Section[] {
  const lines = md.split('\n');
  const out: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(\d+)\.\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^##\s/.test(lines[end])) end++;
    out.push({ n: Number(m[1]), title: m[2].trim(), at: i, end, lines: lines.slice(i + 1, end) });
  }
  return out;
}

/** A line gate-check's check_stage_P counts as an answer (the same normalising and the same markers). */
export function isAnswerLine(raw: string): boolean {
  const l = raw.replace(/^[ \t>*_-]+/, '').replace(/\*/g, '').toLowerCase();
  if (/^(answered|answer|a|decision|assumed)[ \t]*(\([^)]*\))?[ \t]*:/.test(l)) return true;
  return /^unverified/.test(l) && l.includes('how to verify');
}

const PREFIX: Record<AnswerKind, string> = {
  answered: 'Answered (CONFIRMED): ',
  assumed: 'Assumed: ',
  unverified: 'Unverified — how to verify: ',
};

/** An answer as the lines it's written as: its marker first, no blank lines, so it's one paragraph. */
export function answerLines(a: IntakeAnswer): string[] {
  const lines = a.text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  return [PREFIX[a.kind] + lines[0], ...lines.slice(1)];
}

/**
 * intake.md with `answers` written in. An answer already there (a marker line, from the wizard or the
 * interview) is replaced, paragraph and all; otherwise the "_Not yet asked._" placeholder goes and the
 * answer is put in front of the guidance, which stays for whoever reads the file next. Blank answers
 * leave their question as it is, for the Chief Analyst to ask. Running it twice changes nothing more.
 */
export function writeIntakeAnswers(md: string, answers: IntakeAnswer[]): string {
  const crlf = md.includes('\r\n');
  let lines = md.replace(/\r\n/g, '\n').split('\n');
  for (const a of answers) {
    const para = answerLines(a);
    if (!para.length) continue;
    const sec = sections(lines.join('\n')).find((s) => s.n === a.n);
    if (!sec) continue;
    const from = sec.at + 1;
    const marked = lines.slice(from, sec.end).findIndex(isAnswerLine);
    if (marked >= 0) {
      const start = from + marked;
      let stop = start + 1;
      while (stop < sec.end && lines[stop].trim() && !/^##\s/.test(lines[stop])) stop++;
      lines = [...lines.slice(0, start), ...para, ...lines.slice(stop)];
      continue;
    }
    const ph = lines.slice(from, sec.end).findIndex((l) => l.trimStart().startsWith(PLACEHOLDER));
    if (ph >= 0) {
      const at = from + ph;
      const rest = lines[at].trimStart().slice(PLACEHOLDER.length).trim();
      lines = [...lines.slice(0, at), ...para, '', ...(rest ? [rest] : []), ...lines.slice(at + 1)];
      continue;
    }
    lines = [...lines.slice(0, from), '', ...para, ...lines.slice(from)];
  }
  const out = lines.join('\n');
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

/** The questions with no answer marker yet: the live half of Stage P, without running gate-check. */
export function unansweredQuestions(md: string): IntakeQuestion[] {
  return sections(md.replace(/\r/g, ''))
    .filter((s) => !s.lines.some(isAnswerLine))
    .map((s) => ({ n: s.n, title: s.title, help: '' }));
}

/** A question's current answer, as the wizard shows it when editing (marker stripped). */
export function existingAnswers(md: string): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  for (const s of sections(md.replace(/\r/g, ''))) {
    const i = s.lines.findIndex(isAnswerLine);
    if (i < 0) continue;
    const para: string[] = [];
    for (let j = i; j < s.lines.length && s.lines[j].trim(); j++) para.push(s.lines[j].trim());
    const first = para[0];
    const kind: AnswerKind = /^assumed/i.test(first) ? 'assumed' : /^unverified/i.test(first) ? 'unverified' : 'answered';
    const head = kind === 'unverified' ? first.replace(/^[^:]*how to verify:\s*/i, '') : first.replace(/^(answered|answer|a|decision|assumed)\s*(\([^)]*\))?\s*:\s*/i, '');
    const text = [head, ...para.slice(1)].join('\n');
    out.push({ n: s.n, kind, text });
  }
  return out;
}
