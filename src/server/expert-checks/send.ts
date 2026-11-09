// "Send to session" (the proof strip's popover): fills the session's input with a short prompt about a failure and
// never submits it. The office never types into an Expert session (design notes, answer 4): this is the user's
// own click, the text lands on the input line, and the user reads it and presses Enter (or doesn't).
//   * Only while the session waits at its prompt (idle, or done with its turn): never while it works, never over
//     a question or permission prompt it has open (a keystroke there would answer it), never while it starts.
//   * One line, no control characters (shared/expert-checks.ts oneLine: no newline, no carriage return, no escape
//     sequence can get through), sent as one bracketed paste: the terminal takes it as pasted text, so nothing in it
//     runs as a shortcut ("!" or "/" at the start) and nothing in it submits.
// Pure apart from the worker it's handed.

import type { WorkerInfo } from '../../shared/protocol.js';
import { fillBlocked, oneLine } from '../../shared/expert-checks.js';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** Why the session can't take a filled-in prompt now, or undefined when it can. */
export const cantFill = (w: Pick<WorkerInfo, 'status'> | undefined): string | undefined => fillBlocked(w?.status);

/** The bytes for the terminal: the text as one pasted line, never a newline or carriage return. */
export function fillBytes(text: string): string | undefined {
  const line = oneLine(text);
  if (!line) return undefined;
  const bytes = `${PASTE_START}${line}${PASTE_END}`;
  // oneLine has taken every control character out; this is the promise, kept where it's made.
  if (/[\r\n]/.test(bytes)) throw new Error('a filled prompt must never hold a newline');
  return bytes;
}

export interface FillTarget {
  get(id: string): Pick<WorkerInfo, 'status' | 'session'> | undefined;
  /** The terminal's input, as the user's own keystrokes (workers/manager.ts write). */
  write(id: string, data: string, by: string): void;
}

/** Fills session worker `id`'s input with `text` for `by`; why not, or undefined when it's there. */
export function fillSession(t: FillTarget, id: string | undefined, text: string, by: string): string | undefined {
  const w = id ? t.get(id) : undefined;
  if (w && !w.session) return 'Not an Expert session';
  const why = cantFill(w);
  if (why) return why;
  const bytes = fillBytes(text);
  if (!bytes) return 'Nothing to send';
  t.write(id!, bytes, by);
  return undefined;
}
