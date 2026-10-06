// The Chat view's conversations (ui/pm/chat/ in the browser): each watched worker's Claude Code
// transcript, tailed a bounded piece at a time (tail.ts), made into messages (transcript.ts) and sent
// to the browsers watching it, and to nobody else. Claude Code's hooks name the transcript
// (providers/claude.ts calls noteTranscript); after an office restart, before its next hook, it's
// looked up by the worker's session id. A worker with no Claude transcript (Codex, OpenCode, a shell)
// gets "unavailable", and the browser shows its terminal's text instead.

import type { ConvoMsg, ConvoServerMsg } from '../../shared/protocol/convo.js';
import { findTranscript } from '../analysis/transcript.js';
import type { Client } from '../office/client.js';
import type { Ctx } from '../office/context.js';
import { TranscriptTail } from './tail.js';

/** How often a watched transcript is looked at for what's new. */
const POLL_MS = 1000;
/** How long after a failed lookup by session id before trying again (it reads a folder listing). */
const MISS_MS = 10_000;

/** Every worker's transcript, as its hooks last named it. */
const noted = new Map<string, string>();

/** From Claude Code's hooks: this worker's session transcript is `file` now. */
export function noteTranscript(workerId: string, file: unknown) {
  if (typeof file === 'string' && file && file.length < 4096 && file.endsWith('.jsonl')) noted.set(workerId, file);
}

type Deps = Pick<Ctx, 'cfg' | 'sendTo' | 'workerFloor'>;

export class ConvoService {
  private readonly watchers = new Map<string, Map<string, Client>>();
  private readonly tails = new Map<string, TranscriptTail>();
  private readonly misses = new Map<string, { at: number; file?: string }>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly ctx: Deps) {}

  /** `c` starts watching `workerId`: what there is now, then what's new as it comes. */
  watch(c: Client, workerId: string) {
    let set = this.watchers.get(workerId);
    if (!set) this.watchers.set(workerId, (set = new Map()));
    set.set(c.id, c);
    const tail = this.tailOf(workerId);
    if (tail && tail.offset === undefined) tail.read();
    this.ctx.sendTo(c, this.snapshot(workerId, tail));
    this.timer ??= setInterval(() => this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  unwatch(c: Client, workerId: string) {
    const set = this.watchers.get(workerId);
    if (!set?.delete(c.id) || set.size) return;
    this.watchers.delete(workerId);
    this.tails.delete(workerId);
    this.misses.delete(workerId);
    if (!this.watchers.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** `c` left the floor or the office: it watches nothing now. */
  unwatchAll(c: Client) {
    for (const id of [...this.watchers.keys()]) this.unwatch(c, id);
  }

  /** Looks at every watched transcript once: what's new goes to its watchers. */
  poll() {
    for (const [workerId, set] of this.watchers) {
      const had = this.tails.get(workerId);
      const tail = this.tailOf(workerId);
      if (!tail) {
        if (had) this.send(set, this.snapshot(workerId, undefined));
        continue;
      }
      const r = tail.read();
      if (!r) continue;
      // A new transcript (a /clear, a new session), or the same one started over: everything again.
      if (tail !== had || r.reset) this.send(set, this.snapshot(workerId, tail));
      else if (r.messages.length) this.send(set, { t: 'convo.append', workerId, messages: r.messages.map(copy) });
    }
  }

  private send(set: Map<string, Client>, msg: ConvoServerMsg) {
    for (const c of set.values()) this.ctx.sendTo(c, msg);
  }

  private snapshot(workerId: string, tail: TranscriptTail | undefined): ConvoServerMsg {
    if (!tail) return { t: 'convo.snapshot', workerId, available: false, reason: this.ctx.workerFloor(workerId) ? 'no-transcript' : 'not-found', messages: [] };
    return { t: 'convo.snapshot', workerId, available: true, messages: tail.reader.messages.map(copy) };
  }

  /** The tail of the worker's transcript now, made (or made again, for a new file) when needed. */
  private tailOf(workerId: string): TranscriptTail | undefined {
    const file = this.fileOf(workerId);
    if (!file) {
      this.tails.delete(workerId);
      return undefined;
    }
    const had = this.tails.get(workerId);
    if (had?.file === file) return had;
    const tail = new TranscriptTail(file);
    this.tails.set(workerId, tail);
    return tail;
  }

  private fileOf(workerId: string): string | undefined {
    const file = noted.get(workerId);
    if (file) return file;
    const info = this.ctx.workerFloor(workerId)?.workers.get(workerId);
    if (!info || info.kind !== 'agent' || !info.sessionId) return undefined;
    const miss = this.misses.get(workerId);
    if (miss && Date.now() - miss.at < MISS_MS) return miss.file;
    const found = findTranscript(info.sessionId);
    this.misses.set(workerId, { at: Date.now(), file: found });
    return found;
  }
}

/** A message as it is now (the reader keeps changing its own copy). */
const copy = (m: ConvoMsg): ConvoMsg => ({ ...m, ...(m.kind === 'ask' ? { options: [...m.options] } : {}) });

const offices = new WeakMap<object, ConvoService>();

/** The office's one conversation service, made the first time someone watches. */
export function convoOf(ctx: Deps): ConvoService {
  let s = offices.get(ctx.cfg);
  if (!s) offices.set(ctx.cfg, (s = new ConvoService(ctx)));
  return s;
}
