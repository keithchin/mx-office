// Reading a transcript as it grows, a bounded piece at a time: the first read takes only the last
// TAIL_BYTES of the file (a long session's start isn't worth reading for a chat that shows the latest),
// and each read after starts where the last stopped. A file that got shorter (replaced, or a new
// session written over it) is read again from its tail.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { TranscriptReader } from './transcript.js';
import type { ConvoMsg } from '../../shared/protocol/convo.js';

/** How much of a transcript's end the first read takes. */
export const TAIL_BYTES = 256 * 1024;
/** The most one read after that takes; the rest waits for the next. */
export const STEP_BYTES = 512 * 1024;

export class TranscriptTail {
  /** Where the next read starts; undefined before the first. */
  offset: number | undefined;
  reader = new TranscriptReader();
  /** The next read starts inside a line, whose rest is dropped. */
  private midLine = false;

  constructor(
    readonly file: string,
    private readonly tailBytes = TAIL_BYTES,
    private readonly stepBytes = STEP_BYTES,
  ) {}

  /**
   * Reads what's new. `messages` is what it made or changed; `reset` means the file started over and
   * `reader.messages` is the whole conversation again. Undefined when the file can't be read.
   */
  read(): { messages: ConvoMsg[]; reset: boolean } | undefined {
    let fd: number | undefined;
    try {
      fd = openSync(this.file, 'r');
      const size = fstatSync(fd).size;
      let reset = false;
      if (this.offset !== undefined && size < this.offset) {
        this.offset = undefined;
        this.reader = new TranscriptReader();
        this.midLine = false;
        reset = true;
      }
      const start = this.offset ?? Math.max(0, size - this.tailBytes);
      const first = this.offset === undefined;
      // Started in the middle of the file (or of a line too long to take whole): its first line is only the end of one.
      const midLine = this.midLine || (first && start > 0);
      const len = Math.min(size - start, this.stepBytes);
      if (len <= 0) {
        this.offset = start;
        return { messages: [], reset: reset || first };
      }
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const n = readSync(fd, buf, got, len - got, start + got);
        if (n <= 0) break;
        got += n;
      }
      const bytes = buf.subarray(0, got);
      // Whole lines only, counted in bytes: a line (or a character) cut off at the end waits for the next read.
      const from = midLine ? bytes.indexOf(0x0a) + 1 : 0;
      const end = bytes.lastIndexOf(0x0a) + 1;
      if (midLine && from === 0) {
        // Still inside that line: skip what was read of it, unless it's still being written.
        this.midLine = true;
        this.offset = got === this.stepBytes ? start + got : start;
        return { messages: [], reset: reset || first };
      }
      if (end === 0 && got === this.stepBytes) {
        // One line longer than a whole step (a huge tool result): it's skipped, not waited for.
        this.midLine = true;
        this.offset = start + got;
        return { messages: [], reset: reset || first };
      }
      this.midLine = false;
      this.offset = start + end;
      const text = end > from ? bytes.subarray(from, end).toString('utf8') : '';
      return { messages: this.reader.feed(text), reset: reset || first };
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}
