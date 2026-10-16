// Reading an append-only JSONL store safely (store safety, 2026-10-17). Only a missing file is empty; a
// locked or refused one throws StoreUnavailableError and blocks its writes, as read.ts does for JSON. A
// line that isn't JSON (most often the torn tail of an append cut off by a crash) is not silently skipped
// any more, because the next append would have been glued onto the torn bytes and been unreadable too:
// the file as it was is copied to <file>.corrupt-<time> (the torn bytes kept there, never deleted), the
// file is rewritten with every whole line in order (atomically: a temporary file, fsync, rename), and an
// incident names the aside file and says how many lines were dropped. A whole last line that only lacks
// its newline gets one, so the next append starts on a line of its own.

import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { appendFile, copyFile, readFile } from 'node:fs/promises';
import { noteStoreProblem, StoreUnavailableError, unblockWrites, writeBlocked } from './health.js';
import { asideName, codeOf, READ_RETRY_MS, readFault, TRANSIENT } from './read.js';
import { writeTextDurable, writeTextDurableSync } from './write.js';

export interface JsonlRead {
  /** The whole lines, as text, oldest first. */
  lines: string[];
  missing: boolean;
  /** Where the file as it was is kept, when lines were dropped. */
  aside?: string;
  dropped: number;
}

type Split = { lines: string[]; bad: number; tornTail: boolean; needsNewline: boolean };

function split(text: string): Split {
  const parts = text.split('\n');
  const lines: string[] = [];
  let bad = 0;
  let tornTail = false;
  parts.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    try {
      JSON.parse(line);
      lines.push(line);
    } catch {
      bad++;
      if (i === parts.length - 1) tornTail = true;
    }
  });
  const needsNewline = !bad && text.length > 0 && !text.endsWith('\n') && !!text.trim();
  return { lines, bad, tornTail, needsNewline };
}

function failed(file: string, err: unknown): never {
  const error = (err as Error)?.message ?? String(err);
  noteStoreProblem({ file, kind: 'locked', error });
  throw new StoreUnavailableError(file, error);
}

function report(file: string, s: Split, aside: string) {
  noteStoreProblem({
    file,
    kind: 'corrupt',
    error: s.tornTail && s.bad === 1 ? 'its last line was cut off (a write interrupted by a crash)' : `${s.bad} line${s.bad === 1 ? '' : 's'} not readable`,
    aside,
    lost: `Kept ${s.lines.length} whole line${s.lines.length === 1 ? '' : 's'}; ${s.bad} dropped (their bytes are in the aside file)`,
  });
}

const rejoin = (lines: string[]) => (lines.length ? `${lines.join('\n')}\n` : '');

/** Reads and, when needed, repairs `file` (see the top of this file). Rejects with StoreUnavailableError when it can't be read. */
export async function readJsonlStore(file: string): Promise<JsonlRead> {
  let text: string | undefined;
  for (let i = 0; text === undefined; i++) {
    try {
      const f = readFault(file);
      if (f) throw f;
      text = await readFile(file, 'utf8');
    } catch (err) {
      if (codeOf(err) === 'ENOENT') return { lines: [], missing: true, dropped: 0 };
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) failed(file, err);
      await new Promise((r) => setTimeout(r, READ_RETRY_MS[i]));
    }
  }
  if (writeBlocked(file)) unblockWrites(file);
  const s = split(text);
  if (s.needsNewline) await appendFile(file, '\n');
  if (!s.bad) return { lines: s.lines, missing: false, dropped: 0 };
  const aside = asideName(file);
  await copyFile(file, aside);
  await writeTextDurable(file, rejoin(s.lines));
  report(file, s, aside);
  return { lines: s.lines, missing: false, aside, dropped: s.bad };
}

/** The same on the event loop, for the stores read once at start-up. */
export function readJsonlStoreSync(file: string): JsonlRead {
  let text: string | undefined;
  for (let i = 0; text === undefined; i++) {
    try {
      const f = readFault(file);
      if (f) throw f;
      text = readFileSync(file, 'utf8');
    } catch (err) {
      if (codeOf(err) === 'ENOENT') return { lines: [], missing: true, dropped: 0 };
      if (!TRANSIENT.has(codeOf(err)) || i >= READ_RETRY_MS.length) failed(file, err);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, READ_RETRY_MS[i]);
    }
  }
  if (writeBlocked(file)) unblockWrites(file);
  const s = split(text);
  if (s.needsNewline) appendFileSync(file, '\n');
  if (!s.bad) return { lines: s.lines, missing: false, dropped: 0 };
  const aside = asideName(file);
  copyFileSync(file, aside);
  writeTextDurableSync(file, rejoin(s.lines));
  report(file, s, aside);
  return { lines: s.lines, missing: false, aside, dropped: s.bad };
}
