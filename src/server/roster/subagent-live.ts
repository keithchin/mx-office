// Who on a floor's team is at work right now, down to the Leads' subagents: each run from its Lead's
// Agent call to its end (shared/roster/subagent-live.ts), from the hooks as they come (workers/
// subagents.ts) and, every few seconds, from what's new in each Lead's transcript (subagent-transcript.ts),
// which also catches what no hook says: a background run finishing, or anything while the office was
// down. The floor's last LIVE_KEPT runs are kept in its roster file, each linked to the run record its
// Lead reviews (subagents.ts), so the Workers tab and the 2D view can show a subagent as a worker of its
// own: who hired it, what it's on, and how its work was judged.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import type { WorkerInfo } from '../../shared/protocol.js';
import { LEADS, type RoleId } from '../../shared/roster/roles.js';
import { LIVE_STALE_MS, type LiveRun, type LiveRunView } from '../../shared/roster/subagent-live.js';
import type { SubagentEvent } from '../workers/subagents.js';
import type { Roster } from './index.js';
import { applyLive, expireLive, trimLive, type LiveSignal, type LiveWho } from './subagent-runs.js';
import { cleanSubName, subKey } from './subagent-store.js';
import { SubagentTranscript } from './subagent-transcript.js';
import type { TeamFloor } from './types.js';

/** The first look at a transcript takes only its end; each look after, at most this much that's new. */
const FIRST_BYTES = 256 * 1024;
const STEP_BYTES = 512 * 1024;
/** How often the office looks at the Leads' transcripts (adapter.ts). */
export const SCAN_MS = 10_000;
/** A run record and a live run end this close together when they're the same run. */
const SAME_END_MS = 5_000;

/** A hook's run event as a live signal. */
export function signalOf(ev: SubagentEvent): LiveSignal {
  const agent = cleanSubName(ev.agent);
  if (ev.kind === 'dispatch') return { kind: 'dispatch', at: ev.at, toolUseId: ev.toolUseId, agent, task: ev.task, model: ev.model, background: ev.background };
  if (ev.kind === 'start' || ev.kind === 'stop') return { kind: ev.kind, at: ev.at, agentId: ev.agentId, agent };
  if (ev.async || ev.background) return { kind: 'launched', at: ev.at, toolUseId: ev.toolUseId, agentId: ev.agentId, agent, task: ev.task, model: ev.model };
  return { kind: 'result', at: ev.at, toolUseId: ev.toolUseId, agent, task: ev.task, model: ev.model, failed: ev.failed, durationMs: ev.durationMs };
}

interface Tail {
  file: string;
  offset?: number;
  midLine: boolean;
  parser: SubagentTranscript;
  /** Made for this look (a transcript not read before): only its recent calls count. */
  firstLook?: boolean;
}

export class SubagentLive {
  private readonly tails = new Map<string, Tail>();
  /** Floors whose scanSoon is out. */
  private readonly scanning = new Set<string>();

  /**
   * `finished`: a run the transcript alone said was over (a background run's notification, its answer
   * read off the file), for its subagent's record (subagents.ts recordFinished).
   */
  constructor(
    private readonly roster: Roster,
    private readonly finished?: (floor: TeamFloor, run: LiveRun) => void,
  ) {}

  private runs(floor: TeamFloor): LiveRun[] {
    return this.roster.data(floor.id).subagentRuns;
  }

  /** Takes in signals about runs of `who`'s subagents; the browsers are told when anything they'd see changed. */
  apply(floor: TeamFloor, who: LiveWho, signals: LiveSignal[]): boolean {
    const runs = this.runs(floor);
    const before = who.source === 'transcript' ? new Map(runs.map((r) => [r, r.status])) : undefined;
    let changed = false;
    for (const s of signals) {
      const named = 'agent' in s && s.agent !== undefined ? { ...s, agent: cleanSubName(s.agent) } : s;
      if (applyLive(runs, who, named)) changed = true;
    }
    if (!changed) return false;
    // Over by the transcript's word: a hook would have ended it first (and recorded it) otherwise.
    if (before && this.finished) for (const r of runs) if (r.status !== 'working' && r.status !== 'lost' && (before.get(r) ?? 'working') === 'working') this.finished(floor, r);
    trimLive(runs);
    this.roster.touch(floor);
    return true;
  }

  /** A hook's run event, for a Lead's worker. */
  onEvent(floor: TeamFloor, lead: RoleId, workerId: string, ev: SubagentEvent) {
    this.apply(floor, { lead, workerId, source: 'hooks' }, [signalOf(ev)]);
  }

  /** What run `agentId` of the Lead's was asked to do, when the office heard its call go out. */
  taskOf(floor: TeamFloor, workerId: string, agentId?: string): string | undefined {
    if (!agentId) return undefined;
    return this.runs(floor).filter((r) => r.workerId === workerId && r.agentId === agentId && r.task).at(-1)?.task;
  }

  /** Looks at what's new in each Lead's transcript. True when that changed anything. */
  scan(floor: TeamFloor, now = this.roster.deps.now()): boolean {
    let changed = false;
    for (const { lead, w, file } of this.leadsOf(floor)) if (this.take(floor, lead, w, file, this.read(w, file), now)) changed = true;
    return changed;
  }

  /**
   * scan(), with the transcripts read off the event loop (fs/promises), for the office's timer: the
   * synchronous open and read held the loop up to half a second on a loaded machine, where the virus
   * scanner looks at every open (the busy office check, 2026-10-08). One at a time: a look asked for
   * while one is out is skipped (the next timer's look catches up).
   */
  async scanSoon(floor: TeamFloor): Promise<boolean> {
    if (this.scanning.has(floor.id)) return false;
    this.scanning.add(floor.id);
    try {
      let changed = false;
      for (const { lead, w, file } of this.leadsOf(floor)) {
        const signals = await this.readSoon(w, file);
        if (this.take(floor, lead, w, file, signals, this.roster.deps.now())) changed = true;
      }
      return changed;
    } finally {
      this.scanning.delete(floor.id);
    }
  }

  /** Each Lead at its desk with a transcript to read. */
  private leadsOf(floor: TeamFloor): { lead: RoleId; w: WorkerInfo; file: string }[] {
    const d = this.roster.data(floor.id);
    const out: { lead: RoleId; w: WorkerInfo; file: string }[] = [];
    for (const lead of LEADS) {
      const m = d.members[lead.id];
      const w = m.workerId ? floor.worker(m.workerId) : undefined;
      const file = w && floor.transcript?.(w);
      if (w && file) out.push({ lead: lead.id, w, file });
    }
    return out;
  }

  /** Applies what was read from a Lead's transcript. */
  private take(floor: TeamFloor, lead: RoleId, w: WorkerInfo, file: string, signals: LiveSignal[] | undefined, now: number): boolean {
    if (!signals?.length) return false;
    // An old call read off the end of a long transcript, with nothing after it, may be long over.
    const fresh = this.tails.get(w.id)?.firstLook ? signals.filter((s) => now - s.at < LIVE_STALE_MS) : signals;
    return this.apply(floor, { lead, workerId: w.id, source: 'transcript' }, fresh);
  }

  /** The tail kept for `w`'s transcript (a new one when the transcript changed). */
  private tailOf(w: WorkerInfo, file: string): Tail {
    const had = this.tails.get(w.id);
    if (had && had.file === file) {
      had.firstLook = false;
      return had;
    }
    const t: Tail = { file, midLine: false, parser: new SubagentTranscript(), firstLook: true };
    this.tails.set(w.id, t);
    return t;
  }

  /** Where the next read starts and how long it is, for a file of `size` bytes. */
  private span(t: Tail, size: number): { start: number; len: number; midLine: boolean } {
    if (t.offset !== undefined && size < t.offset) {
      t.offset = undefined;
      t.parser.reset();
    }
    const start = t.offset ?? Math.max(0, size - FIRST_BYTES);
    const midLine = t.midLine || (t.offset === undefined && start > 0);
    return { start, len: Math.min(size - start, STEP_BYTES), midLine };
  }

  /** The signals in `got` bytes read at `start`, the tail moved past the whole lines. */
  private parse(t: Tail, start: number, midLine: boolean, buf: Buffer, got: number): LiveSignal[] {
    const bytes = buf.subarray(0, got);
    const from = midLine ? bytes.indexOf(0x0a) + 1 : 0;
    const end = bytes.lastIndexOf(0x0a) + 1;
    if ((midLine && from === 0) || end === 0) {
      // Inside one long line: skipped when it's longer than a whole step, else waited for.
      t.midLine = midLine || got === STEP_BYTES;
      t.offset = got === STEP_BYTES ? start + got : start;
      return [];
    }
    t.midLine = false;
    t.offset = start + end;
    return t.parser.feed(bytes.subarray(from, end).toString('utf8'));
  }

  /** What's new in `file` since the last look, as signals (undefined when it can't be read). */
  private read(w: WorkerInfo, file: string): LiveSignal[] | undefined {
    const t = this.tailOf(w, file);
    let fd: number | undefined;
    try {
      fd = openSync(file, 'r');
      const { start, len, midLine } = this.span(t, fstatSync(fd).size);
      if (len <= 0) {
        t.offset = start;
        return [];
      }
      const buf = Buffer.alloc(len);
      return this.parse(t, start, midLine, buf, readSync(fd, buf, 0, len, start));
    } catch {
      return undefined;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  /** read(), off the event loop. A tail moved meanwhile (a synchronous scan) keeps its own reading. */
  private async readSoon(w: WorkerInfo, file: string): Promise<LiveSignal[] | undefined> {
    const t = this.tailOf(w, file);
    const before = t.offset;
    let fh: FileHandle | undefined;
    try {
      fh = await open(file, 'r');
      const size = (await fh.stat()).size;
      if (this.tails.get(w.id) !== t || t.offset !== before) return undefined;
      const { start, len, midLine } = this.span(t, size);
      if (len <= 0) {
        t.offset = start;
        return [];
      }
      const buf = Buffer.alloc(len);
      const offset = t.offset;
      const { bytesRead } = await fh.read(buf, 0, len, start);
      if (this.tails.get(w.id) !== t || t.offset !== offset) return undefined;
      return this.parse(t, start, midLine, buf, bytesRead);
    } catch {
      return undefined;
    } finally {
      await fh?.close().catch(() => undefined);
    }
  }

  /** Forgets a worker that went home. */
  forget(workerId: string) {
    this.tails.delete(workerId);
  }

  /** The minute look: runs not heard of for hours are lost. */
  tick(floor: TeamFloor, now: number) {
    if (expireLive(this.runs(floor), now)) this.roster.touch(floor);
  }

  /** The floor's runs, newest first, each with its Lead's verdict when its record has one. */
  views(floor: TeamFloor): LiveRunView[] {
    const d = this.roster.data(floor.id);
    return [...this.runs(floor)]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => {
        const rec = d.subagents[subKey(r.lead, r.name)];
        const run =
          (r.agentId ? rec?.runs.filter((x) => x.id === r.agentId).at(-1) : undefined) ??
          (r.endedAt !== undefined ? rec?.runs.find((x) => x.endedAt !== undefined && Math.abs(x.endedAt - r.endedAt!) <= SAME_END_MS) : undefined);
        if (!run) return { ...r };
        if (run.outcome === 'pending') return { ...r, outcome: run.outcome };
        return { ...r, outcome: run.outcome, ...(run.note ? { note: run.note } : {}), ...(run.reviewedAt !== undefined ? { reviewedAt: run.reviewedAt } : {}) };
      });
  }
}
