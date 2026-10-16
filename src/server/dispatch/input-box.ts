// What sits in an agent's input box, read off its terminal screen (the office's headless mirror of it): the
// typed-evidence watch (typed-watch.ts) presses Enter once more only when the dispatch's own text is still
// there unsent. Claude Code draws its input box between two rules (──── lines; older versions a ╭─╮ … ╰─╯
// box), the prompt line starting with > or ❯, and shows a long paste as "[Pasted text #1 +12 lines]". A screen
// it can't read as that says nothing (undefined), and nothing is pressed.

import type { DispatchRecord } from '../../shared/dispatch.js';

const RULE = /^\s*[─━]{8,}\s*$/;
const TOP = /^\s*╭─+╮\s*$/;
const BOTTOM = /^\s*╰─+╯\s*$/;

/** The input box's text (its prompt sign taken off), or undefined when the screen shows no input box. */
export function inputBoxText(screen: string): string | undefined {
  const lines = screen.replace(/\r/g, '').split('\n');
  let end = -1;
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (end < 0 && (RULE.test(lines[i]) || BOTTOM.test(lines[i]))) end = i;
    else if (end >= 0 && (RULE.test(lines[i]) || TOP.test(lines[i]))) {
      start = i;
      break;
    }
  }
  if (start < 0 || end - start < 2) return undefined;
  const body = lines.slice(start + 1, end).map((l) => l.replace(/^\s*│ ?/, '').replace(/ ?│\s*$/, ''));
  if (!/^\s*[>❯]/.test(body[0] ?? '')) return undefined;
  body[0] = body[0].replace(/^\s*[>❯]\s?/, '');
  return body.map((l) => l.replace(/\s+$/, '')).join('\n').trim();
}

/**
 * Whether the input box still holds this dispatch's text: its marker line, or a collapsed paste about as long as
 * its payload (the office's notes may go before it, so never shorter). undefined: no input box to read.
 */
export function inputBoxHolds(screen: string | undefined, r: Pick<DispatchRecord, 'payload' | 'marker'>): boolean | undefined {
  if (!screen) return undefined;
  const text = inputBoxText(screen);
  if (text === undefined) return undefined;
  if (!text) return false;
  // The terminal wraps long lines anywhere: compared with every space taken out.
  if (text.replace(/\s+/g, '').includes(r.marker.replace(/\s+/g, ''))) return true;
  const m = /\[Pasted text #\d+ \+(\d+) lines?\]/.exec(text);
  if (!m) return false;
  const lines = r.payload.replace(/\r\n?/g, '\n').trim().split('\n').length;
  return Number(m[1]) + 1 >= lines;
}
