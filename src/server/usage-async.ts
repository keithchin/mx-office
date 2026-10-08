// scanTracker (usage.ts) off the event loop. A worker's session is its own transcript and one file per
// subagent it ran (27 on the live office's longest), and the office looks at every one of them for every
// worker every 10 s and a moment after each burst of hooks. Done with readSync, each file's open, stat
// and read held the event loop: on Windows the virus scanner looks at every open for reading, so with
// six busy workers on a loaded machine the scans ran into one another and the server stalled for over
// a second at a time (the busy office, 2026-10-08: 11 blocks over 100 ms, the longest 1.3 s).
//
// Here the stat, open and reads go to libuv's thread pool, a file that hasn't grown isn't opened at
// all, and what the event loop does is parse what was read, a slice (SLICE bytes) at a time with the
// loop free between slices. A slice is applied only if nobody read that file further in the meantime
// (the office's last, synchronous scan at shutdown), so nothing is booked twice.

import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { agentTypeOf, applyLine, subagentDir, type UsageTracker } from './usage.js';

/** Bytes read and parsed per turn of the event loop: about 10 ms of JSON.parse. */
const SLICE = 512 * 1024;

async function subagentFiles(transcript: string): Promise<string[]> {
  const dir = subagentDir(transcript);
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Reads whatever was appended to the session's transcripts, without holding the event loop. True when the totals changed. */
/** `onLine` hears every line of the session's own transcript (not a subagent's), parsed, as scanTrackerStep's does. */
export async function scanTrackerAsync(t: UsageTracker, slice = SLICE, onLine?: (line: any) => void): Promise<boolean> {
  const transcript = t.transcript;
  if (!transcript) return false;
  let changed = false;
  for (const file of [transcript, ...(await subagentFiles(transcript))]) {
    // A new session took over meanwhile (a /clear, a resume): the next scan reads that one.
    if (t.transcript !== transcript) break;
    if (await readAppended(t, file, file === transcript, slice, onLine)) changed = true;
  }
  return changed;
}

async function readAppended(t: UsageTracker, file: string, main: boolean, slice: number, onLine?: (line: any) => void): Promise<boolean> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return false;
  }
  const known = t.files[file];
  if (known && size === known.offset) return false;
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    return false;
  }
  let changed = false;
  try {
    let want = slice;
    for (;;) {
      const cur = (t.files[file] ??= { offset: 0 });
      if (!main && cur.agent === undefined) cur.agent = agentTypeOf(file);
      if (size < cur.offset) {
        // Shorter than last time: not the file we knew. Start over.
        cur.offset = 0;
        cur.lastId = undefined;
        cur.lastUsage = undefined;
      }
      if (cur.offset >= size) break;
      const start = cur.offset;
      const len = Math.min(want, size - start);
      const buf = Buffer.allocUnsafe(len);
      let got = 0;
      while (got < len) {
        const { bytesRead } = await fh.read(buf, got, len - got, start + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      // Read further by someone else while this read was out (the synchronous scan at shutdown): theirs counts.
      if (t.files[file] !== cur || cur.offset !== start || !got) break;
      const end = buf.lastIndexOf(10, got - 1);
      if (end < 0) {
        if (got < size - start) {
          want *= 2; // one line longer than the slice: read more of it
          continue;
        }
        break; // the tail is still being written
      }
      cur.offset = start + end + 1;
      want = slice;
      for (const line of buf.toString('utf8', 0, end).split('\n')) {
        if (!line) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (applyLine(t, cur, obj, main)) changed = true;
        if (main) onLine?.(obj);
      }
      if (cur.offset < size) await new Promise((r) => setImmediate(r));
      else size = (await fh.stat()).size; // still being written: take what came meanwhile too
    }
  } finally {
    await fh.close().catch(() => {});
  }
  return changed;
}

/**
 * One scan of `w`'s transcripts at a time: one asked for while one is out runs after it. `book` hears
 * when the totals changed. An unreadable transcript is simply tried again on the next scan.
 */
export function scanApart(w: { tracker: UsageTracker; scanning?: boolean; rescan?: boolean }, book: () => void): void {
  if (w.scanning) {
    w.rescan = true;
    return;
  }
  w.scanning = true;
  const done = (changed: boolean) => {
    w.scanning = false;
    if (changed) book();
    if (w.rescan) {
      w.rescan = false;
      scanApart(w, book);
    }
  };
  scanTrackerAsync(w.tracker).then(done, () => done(false));
}
