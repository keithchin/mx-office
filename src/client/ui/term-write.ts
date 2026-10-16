// Feeding a terminal a big write in slices. xterm.js parses what it's given in slices of about 12 ms and
// lets the page breathe between them, but one write is one slice however long it is: a snapshot of a long
// session (the whole scrollback, a few hundred KB of wide, coloured lines) was parsed in one task, and
// the write's callback (fitting the window, drawing it) ran in the same one (the Command Center's
// "page froze" incidents, the terminal-freeze pass, 2026-10-16). In CHUNK pieces, the parser yields
// between them, and `done` runs once the last is on the screen. Splitting inside an escape sequence or a
// surrogate pair is fine: xterm.js's parser carries a half-read one on to the next write.

import type { Terminal } from '@xterm/xterm';

/** The most handed to xterm.js at once (about a few ms of parsing). */
export const CHUNK = 32 * 1024;

/** The pieces `data` is written in. Pure, so a test can pin it. */
export function slices(data: string, size = CHUNK): string[] {
  if (data.length <= size) return [data];
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out;
}

/** Writes `data` into `term` in slices; `done` once all of it is parsed. */
export function writeInSlices(term: Pick<Terminal, 'write'>, data: string, done?: () => void): void {
  const parts = slices(data);
  parts.forEach((p, i) => term.write(p, i === parts.length - 1 ? done : undefined));
}
