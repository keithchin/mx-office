// The runtime log's tail for the Console: reads what was added to <live checkout>/.mxcli/runtime.log since
// the last read (asynchronous reads off the event loop, from where it stopped: never the whole file
// again), parses it into entries (shared/liveapp/console.ts) and keeps the last LOG_KEEP of them.
//
// It runs only while someone has the Console showing: a watch on the log's folder says when it changed,
// and a stat once a second covers what the watch misses (on Windows a file another process appends to
// isn't always reported until it's flushed). Stopped, it keeps where it was and its entries, so showing
// the Console again reads only what came since. A first read starts in the last LOG_START_BYTES; a log
// that got shorter (begun again) is read afresh and the page told to start over.

import { watch, type FSWatcher } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { LOG_KEEP, LogParser, type LiveLogEntry } from '../../../shared/liveapp/console.js';

/** How far back a first read starts. */
export const LOG_START_BYTES = 256 * 1024;
/** The most one read takes; more follows straight after. */
const CHUNK = 512 * 1024;
const STAT_MS = 1_000;

export interface TailNews {
  /** New entries, or grown ones (same id); `reset` when everything before is gone. */
  entries(list: LiveLogEntry[], reset: boolean): void;
  /** The log isn't there (yet), or is again. */
  missing(yes: boolean): void;
}

export class LogTail {
  private offset = -1;
  private parser = new LogParser();
  private decoder = new StringDecoder('utf8');
  private ring: LiveLogEntry[] = [];
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private reading: Promise<void> | undefined;
  private again = false;
  private lastSize = -1;
  private lastMtime = 0;
  missing = false;
  running = false;

  constructor(
    readonly file: string,
    private news: TailNews,
    private opts: { statMs?: number } = {},
  ) {}

  /** What it has, oldest first. */
  snapshot(): LiveLogEntry[] {
    return [...this.ring];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.watchDir();
    this.timer = setInterval(() => void this.check(), this.opts.statMs ?? STAT_MS);
    this.timer.unref?.();
    void this.read();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.watcher?.close();
    this.watcher = undefined;
  }

  /** Resolves once any read under way (and one asked for meanwhile) is done. */
  async settled(): Promise<void> {
    while (this.reading) await this.reading;
  }

  /** Reads what's new now (the watch and the stat call it). */
  read(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.readNew()
      .catch((err) => console.error('agent-office: live app log', err))
      .finally(() => {
        this.reading = undefined;
        if (this.again && this.running) {
          this.again = false;
          void this.read();
        }
      });
    return this.reading;
  }

  private watchDir() {
    try {
      const name = path.basename(this.file);
      this.watcher = watch(path.dirname(this.file), { persistent: false }, (_ev, f) => {
        if (!f || String(f) === name) void this.read();
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // No folder yet (the app never ran here): the stat finds the log once it's there.
    }
  }

  private async check() {
    if (!this.running) return;
    try {
      const s = await stat(this.file);
      if (s.size !== this.lastSize || s.mtimeMs !== this.lastMtime) void this.read();
      if (!this.watcher) this.watchDir();
    } catch {
      if (!this.missing) void this.read();
    }
  }

  private async readNew() {
    let size: number;
    try {
      const s = await stat(this.file);
      size = s.size;
      this.lastSize = s.size;
      this.lastMtime = s.mtimeMs;
    } catch {
      if (!this.missing) {
        this.missing = true;
        this.news.missing(true);
      }
      return;
    }
    if (this.missing) {
      this.missing = false;
      this.news.missing(false);
    }
    let reset = false;
    if (this.offset < 0 || size < this.offset) {
      // A first read, or a log that began again: start near its end, in a fresh parser (ids keep counting up).
      reset = this.offset >= 0;
      this.offset = Math.max(0, size - LOG_START_BYTES);
      this.parser = new LogParser(this.parser.nextId, { fromMiddle: this.offset > 0 });
      this.decoder = new StringDecoder('utf8');
      if (reset) this.ring = [];
    }
    if (size === this.offset) {
      if (reset) this.news.entries([], true);
      return;
    }
    const fh = await open(this.file, 'r');
    try {
      while (this.offset < size) {
        const want = Math.min(CHUNK, size - this.offset);
        const buf = Buffer.alloc(want);
        const { bytesRead } = await fh.read(buf, 0, want, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        const got = this.parser.push(this.decoder.write(buf.subarray(0, bytesRead)));
        const changed = [...got.entries, ...(got.open ? [got.open] : [])];
        for (const e of changed) this.keep(e);
        if (changed.length || reset) this.news.entries(changed.map((e) => ({ ...e })), reset);
        reset = false;
      }
    } finally {
      await fh.close();
    }
  }

  private keep(e: LiveLogEntry) {
    const last = this.ring[this.ring.length - 1];
    if (last && last.id === e.id) this.ring[this.ring.length - 1] = { ...e };
    else this.ring.push({ ...e });
    if (this.ring.length > LOG_KEEP) this.ring.splice(0, this.ring.length - LOG_KEEP);
  }
}
