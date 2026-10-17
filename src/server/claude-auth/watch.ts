// Watches the Claude agents' transcripts for how their last turn ended (transcript.ts): an authentication
// failure, or a turn that worked. Every POLL_MS it looks at each transcript's size and time (one stat), and
// reads its last TAIL_BYTES only when it changed: off the event loop (fs/promises), a bounded read, so a big
// office costs a few stats a tick.

import { open, stat } from 'node:fs/promises';
import { lastVerdict, type TurnVerdict } from './transcript.js';

export const POLL_MS = 15_000;
const TAIL_BYTES = 64 * 1024;
/** A failure older than this (an office restarted long after) isn't news. */
export const STALE_MS = 2 * 3_600_000;

export interface WatchedWorker {
  id: string;
  name: string;
  floor?: string;
}

export interface WatchDeps {
  /** The Claude agents to look at now (with their transcript, when their hooks named one). */
  workers(): (WatchedWorker & { transcript?: string })[];
  onFail(w: WatchedWorker, at: number): void;
  onOk(w: WatchedWorker, at: number): void;
  now(): number;
  /** The file's size and time, undefined when it can't be read. */
  stat?(file: string): Promise<{ size: number; mtimeMs: number } | undefined>;
  /** Its last `bytes` (of `size`). */
  tail?(file: string, size: number, bytes: number): Promise<string>;
}

async function statOf(file: string) {
  try {
    const s = await stat(file);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return undefined;
  }
}

async function tailOf(file: string, size: number, bytes: number): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const n = Math.min(size, bytes);
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, size - n);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

export class AuthWatch {
  private seen = new Map<string, string>();
  private running = false;

  constructor(private readonly deps: WatchDeps) {}

  /** One look at every transcript that changed since the last. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const next = new Map<string, string>();
      for (const w of this.deps.workers()) {
        if (!w.transcript) continue;
        const st = await (this.deps.stat ?? statOf)(w.transcript);
        if (!st) continue;
        const mark = `${w.transcript}|${st.size}|${st.mtimeMs}`;
        next.set(w.id, mark);
        if (this.seen.get(w.id) === mark) continue;
        let v: TurnVerdict | undefined;
        try {
          v = lastVerdict(await (this.deps.tail ?? tailOf)(w.transcript, st.size, TAIL_BYTES));
        } catch {
          next.delete(w.id); // read it again next time
          continue;
        }
        if (v?.kind === 'auth-failed' && this.deps.now() - v.at < STALE_MS) this.deps.onFail(w, v.at);
        else if (v?.kind === 'ok') this.deps.onOk(w, v.at);
      }
      this.seen = next;
    } finally {
      this.running = false;
    }
  }
}
