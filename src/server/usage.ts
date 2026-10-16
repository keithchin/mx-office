import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Usage, UsageState } from '../shared/protocol.js';
import { BackgroundFile } from './offloop/save.js';
import { growth, maxUsage, SeenIds } from './usage-seen.js';
import { priceOf } from './prices.js';

/*
 * Where a worker's numbers come from
 * ----------------------------------
 * Claude Code hooks carry no usage, but every hook payload names the session's transcript
 * (~/.claude/projects/<dir>/<session>.jsonl). Each assistant message in it records the API's
 * `usage` (input, output, cache write, cache read) and the model, so tokens are exact and the cost
 * is priced here from PRICES. Subagents (the Agent tool) log to <session>/subagents/*.jsonl next to
 * it; those are read too. When a session ends, Claude Code appends a `cost-state` line with its own
 * tally — that also covers calls that never reach the transcript (titles, summaries). The tally is read
 * per run: what it grew by since its previous line, or all of it when it went down (a session resumed in a
 * new process starts its tally again), and each run books the larger of that and the office's own
 * estimate of the run. So the figure never goes down and a resumed session keeps its earlier runs' cost;
 * anything logged after (a resume) is estimated on top again.
 *
 * Each API request is counted once per worker. Claude Code writes a response as several lines, one
 * per content block, sharing the message id (and request id) and usage; those lines need not be next
 * to each other, and a subagent's request can show up both in the session's own transcript (an
 * `isSidechain` line) and in its subagent file. So the tracker remembers the ids it counted, across
 * all of the worker's files (SeenIds): a known id adds only what its usage grew by (streaming), and a
 * subagent's request is booked under the subagent, never under both it and the session.
 *
 * The transcript format is Claude Code's own and may change: everything below is defensive, and a
 * line it does not understand is skipped, never fatal.
 */

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 });

export function addUsage(a: Usage, b: Usage, sign = 1): Usage {
  return {
    input: a.input + sign * b.input,
    output: a.output + sign * b.output,
    cacheWrite: a.cacheWrite + sign * b.cacheWrite,
    cacheRead: a.cacheRead + sign * b.cacheRead,
    cost: a.cost + sign * b.cost,
    calls: a.calls + sign * b.calls,
  };
}

const isZero = (u: Usage) => !u.input && !u.output && !u.cacheWrite && !u.cacheRead && !u.cost && !u.calls;

// The price list (and the models it had to guess for) is prices.ts; re-exported for the modules that import it from here.
export { priceOf, resolvedModel } from './prices.js';
const WEB_SEARCH_USD = 0.01;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * One assistant message's tokens, priced. `prompt` is the request's prompt length, for a model priced by
 * it (Haiku 5.5): by default this message's own input, cache writes and cache reads; a caller that sums
 * many requests into one `u` passes their average.
 */
export function usageOfMessage(model: string, u: any, prompt?: number): Usage {
  const input = num(u?.input_tokens);
  const output = num(u?.output_tokens);
  const cacheWrite = num(u?.cache_creation_input_tokens);
  const hour = Math.min(cacheWrite, num(u?.cache_creation?.ephemeral_1h_input_tokens));
  const cacheRead = num(u?.cache_read_input_tokens);
  const [pin, pout, pread] = priceOf(model, prompt ?? input + cacheWrite + cacheRead);
  const cost = (input * pin + output * pout + (cacheWrite - hour) * pin * 1.25 + hour * pin * 2 + cacheRead * pread) / 1e6 + num(u?.server_tool_use?.web_search_requests) * WEB_SEARCH_USD;
  return { input, output, cacheWrite, cacheRead, cost, calls: 1 };
}

// ---------------------------------------------------------------------------------------------
// Per-worker tracking

export interface FileCursor {
  /** Bytes of the file already read (always at a line boundary). */
  offset: number;
  /** A subagent transcript's type, from the meta file beside it (`agent-<id>.meta.json`). */
  agent?: string;
}

export interface UsageTracker {
  /** The session's transcript, from the hook payloads. */
  transcript?: string;
  files: Record<string, FileCursor>;
  /** The requests counted so far, across all of the worker's files (see SeenIds); made on first use. */
  seen?: SeenIds;
  /** What the runs up to Claude Code's last tally booked (see the cost-state line); `at` is the transcript time it covers up to. */
  base?: Usage & { at: number };
  /** Claude Code's own tally as its last cost-state line gave it, to read the next one against. */
  cli?: Usage;
  /** Estimated from the messages logged after `base`. */
  since: Usage;
  /** Latest transcript timestamp seen. */
  at?: number;
  /** The model the session's own latest message ran on (not a subagent's). */
  model?: string;
  /** Estimated spend by `<subagent type>|<model>` (see Usage.parts). */
  parts?: Record<string, { cost: number; calls: number }>;
}

export const newTracker = (): UsageTracker => ({ files: {}, since: zeroUsage() });

export function trackerUsage(t: UsageTracker): Usage {
  const model = { ...(t.model ? { model: t.model } : {}), ...(t.parts ? { parts: structuredClone(t.parts) } : {}) };
  if (!t.base) return { ...t.since, ...model };
  const { at: _at, ...base } = t.base;
  return { ...addUsage(base, t.since), ...model };
}

/** The subagent type Claude Code wrote beside a subagent's transcript, or "subagent" when it isn't there. */
export function agentTypeOf(file: string): string {
  try {
    const meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    if (typeof meta?.agentType === 'string' && /^[\w.:-]{1,80}$/.test(meta.agentType)) return meta.agentType;
  } catch {
    // no meta file (an older Claude Code): just "a subagent"
  }
  return 'subagent';
}

const asUsage = (v: any): Usage | undefined =>
  v && typeof v === 'object' ? { input: num(v.input), output: num(v.output), cacheWrite: num(v.cacheWrite), cacheRead: num(v.cacheRead), cost: num(v.cost), calls: num(v.calls) } : undefined;

/** Rebuilds a tracker saved by a previous run; anything odd falls back to starting over. */
export function restoreTracker(saved: any): UsageTracker {
  const t = newTracker();
  if (!saved || typeof saved !== 'object') return t;
  if (typeof saved.transcript === 'string') t.transcript = saved.transcript;
  if (Array.isArray(saved.seen)) t.seen = SeenIds.restore(saved.seen);
  if (saved.files && typeof saved.files === 'object') {
    for (const [file, c] of Object.entries<any>(saved.files)) {
      if (!c || typeof c !== 'object') continue;
      t.files[file] = { offset: num(c.offset), ...(typeof c.agent === 'string' ? { agent: c.agent } : {}) };
      // Saved before SeenIds: the last message each file counted is what there is to go on.
      const lastUsage = asUsage(c.lastUsage);
      if (typeof c.lastId === 'string' && lastUsage && !t.seen?.get([c.lastId])) (t.seen ??= new SeenIds()).add({ ids: [c.lastId], usage: lastUsage, sub: file !== saved.transcript });
    }
  }
  const base = asUsage(saved.base);
  if (base) t.base = { ...base, at: num(saved.base.at) };
  // Saved before `cli` was kept: the base was then Claude Code's last tally itself.
  const cli = asUsage(saved.cli) ?? (t.base ? { ...t.base, calls: 0 } : undefined);
  if (cli) t.cli = { input: cli.input, output: cli.output, cacheWrite: cli.cacheWrite, cacheRead: cli.cacheRead, cost: cli.cost, calls: 0 };
  t.since = asUsage(saved.since) ?? zeroUsage();
  if (num(saved.at)) t.at = saved.at;
  if (isModelId(saved.model)) t.model = saved.model;
  if (saved.parts && typeof saved.parts === 'object') {
    t.parts = {};
    for (const [k, v] of Object.entries<any>(saved.parts)) if (k.length < 200 && v && typeof v === 'object') t.parts[k] = { cost: num(v.cost), calls: num(v.calls) };
  }
  return t;
}

/** Subagent transcripts live in <transcript dir>/<session id>/subagents/. */
export const subagentDir = (transcript: string) => path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');

function subagentFiles(transcript: string): string[] {
  const dir = subagentDir(transcript);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export interface ScanOptions {
  /** Read at most about this many bytes (across the session's files) in this call; the rest waits for the next. */
  maxBytes?: number;
  /** Hears every line of the session's own transcript (not a subagent's), parsed, as it's read. */
  onLine?: (line: any) => void;
}

/** Reads whatever was appended to the session's transcripts. True when the totals changed. */
export function scanTracker(t: UsageTracker): boolean {
  return scanTrackerStep(t).changed;
}

/**
 * One step of scanTracker: at most `maxBytes` read, so a long backlog (a whole session read for the
 * first time) can be taken a slice at a time with the event loop free in between. `done` once
 * everything there was read.
 */
export function scanTrackerStep(t: UsageTracker, opts: ScanOptions = {}): { changed: boolean; done: boolean } {
  if (!t.transcript) return { changed: false, done: true };
  const budget = opts.maxBytes === undefined ? undefined : { left: opts.maxBytes, more: false };
  let changed = false;
  for (const file of [t.transcript, ...subagentFiles(t.transcript)]) {
    if (budget && budget.left <= 0) {
      budget.more = true;
      break;
    }
    const cur = (t.files[file] ??= { offset: 0 });
    const main = file === t.transcript;
    if (!main && cur.agent === undefined) cur.agent = agentTypeOf(file);
    for (const line of readNewLines(file, cur, budget)) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (applyLine(t, cur, obj, main)) changed = true;
      if (main) opts.onLine?.(obj);
    }
  }
  return { changed, done: !budget?.more };
}

/** A model id as a session logs it: Claude Code's own placeholder messages ("<synthetic>") aren't one. */
const isModelId = (v: unknown): v is string => typeof v === 'string' && /^[\w.:/@[\]-]{1,120}$/.test(v);

/** One transcript line; `main` when it's from the session's own transcript rather than a subagent's. */
export function applyLine(t: UsageTracker, cur: FileCursor, line: any, main: boolean): boolean {
  if (!line || typeof line !== 'object') return false;
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (at > (t.at ?? 0)) t.at = at;
  if (line.type === 'assistant') {
    const msg = line.message;
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string' || !msg.usage) return false;
    if (main && !line.isSidechain && isModelId(msg.model)) t.model = msg.model;
    const u = usageOfMessage(typeof msg.model === 'string' ? msg.model : '', msg.usage);
    const ids = [msg.id, ...(typeof line.requestId === 'string' && line.requestId ? [`req:${line.requestId}`] : [])];
    // A subagent's request: from its own file, or an isSidechain line in the session's transcript.
    const key = `${main && !line.isSidechain ? '' : (cur.agent ?? 'subagent')}|${isModelId(msg.model) ? msg.model : ''}`;
    const seen = (t.seen ??= new SeenIds());
    const known = seen.get(ids);
    // Already inside Claude Code's own tally: remembered, so a later line of it isn't counted either.
    if (t.base && at <= t.base.at) {
      if (known) known.usage = maxUsage(known.usage, u);
      else seen.add({ ids, usage: u, part: key, sub: !main });
      return false;
    }
    let delta = u;
    let moved = false;
    if (!known) seen.add({ ids, usage: u, part: key, sub: !main });
    else {
      // Counted before: only what its usage grew by (a streamed response's climbs), never less.
      const booked = known.usage;
      delta = growth(booked, u);
      known.usage = maxUsage(booked, u);
      // First met as an isSidechain line in the session's transcript, now in the subagent's own file:
      // it moves to the subagent's type, so it sits under one part only.
      if (!main && !known.sub) {
        known.sub = true;
        if (known.part !== undefined && known.part !== key) moved = movePart(t, known.part, key, booked);
        known.part = key;
      }
    }
    if (isZero(delta)) return moved;
    t.since = addUsage(t.since, delta);
    const part = ((t.parts ??= {})[known?.part ?? key] ??= { cost: 0, calls: 0 });
    part.cost += delta.cost;
    part.calls += delta.calls;
    return true;
  }
  if (line.type === 'cost-state' && typeof line.totalCostUSD === 'number' && line.modelUsage && typeof line.modelUsage === 'object' && !line.hasUnknownModelCost) {
    const cli = zeroUsage();
    for (const m of Object.values<any>(line.modelUsage)) {
      if (!m || typeof m !== 'object') continue;
      cli.input += num(m.inputTokens);
      cli.output += num(m.outputTokens);
      cli.cacheWrite += num(m.cacheCreationInputTokens);
      cli.cacheRead += num(m.cacheReadInputTokens);
    }
    cli.cost = num(line.totalCostUSD);
    // This run, as Claude Code counts it: what its tally grew by, or all of it when the tally started again
    // (a resume in a new process; seen in the office's own transcripts, a cost-state far below the messages
    // before it). Booked at the larger of that and the office's estimate of the run, field by field: Claude
    // Code's figure has the calls that never reach the transcript, the estimate has the runs it doesn't.
    const run = t.cli && cli.cost >= t.cli.cost ? growth(t.cli, cli) : cli;
    const booked = maxUsage(t.since, { ...run, calls: 0 });
    const calls = trackerUsage(t).calls;
    t.base = { ...addUsage(t.base ?? zeroUsage(), booked), calls, at: t.at ?? 0 };
    t.cli = cli;
    t.since = zeroUsage();
    return true;
  }
  return false;
}

/** Moves what was booked of one request (`booked`) from part `from` to part `to`. True when anything moved. */
function movePart(t: UsageTracker, from: string, to: string, booked: Usage): boolean {
  const parts = (t.parts ??= {});
  const old = parts[from];
  if (!old) return false;
  const cost = Math.min(old.cost, booked.cost);
  const calls = Math.min(old.calls, booked.calls);
  old.cost -= cost;
  old.calls -= calls;
  if (old.cost <= 1e-12 && old.calls <= 0) delete parts[from];
  const next = (parts[to] ??= { cost: 0, calls: 0 });
  next.cost += cost;
  next.calls += calls;
  return cost > 0 || calls > 0;
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Complete lines appended since the cursor; a half-written last line waits for the next read. With a
 * `budget`, it stops once that many bytes were read (at a line's end) and says whether more is there.
 */
function* readNewLines(file: string, cur: FileCursor, budget?: { left: number; more: boolean }): Generator<string> {
  let fd: number;
  try {
    // Not grown since: no need to open it (on Windows the virus scanner looks at every open for reading).
    if (statSync(file).size === cur.offset) return;
    fd = openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const size = fstatSync(fd).size;
    if (size < cur.offset) {
      // Shorter than last time: not the file we knew. Start over.
      cur.offset = 0;
    }
    // With a budget, a slice of what is left of it (a line longer than that still grows the read until it ends).
    const step = () => (budget ? Math.max(64 * 1024, Math.min(CHUNK, budget.left)) : CHUNK);
    let want = step();
    while (cur.offset < size) {
      if (budget && budget.left <= 0) {
        budget.more = true;
        return;
      }
      const len = Math.min(want, size - cur.offset);
      const buf = Buffer.allocUnsafe(len);
      let got = 0;
      while (got < len) {
        const n = readSync(fd, buf, got, len - got, cur.offset + got);
        if (n <= 0) break;
        got += n;
      }
      if (!got) return;
      const end = buf.lastIndexOf(10, got - 1);
      if (end < 0) {
        if (got < size - cur.offset) {
          want *= 2; // one line longer than the chunk: read more of it
          continue;
        }
        return; // the tail is still being written
      }
      const text = buf.toString('utf8', 0, end);
      cur.offset += end + 1;
      if (budget) budget.left -= end + 1;
      want = step();
      for (const line of text.split('\n')) if (line) yield line;
    }
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------------
// Office-wide ledger

export interface LedgerOptions {
  /** Daily budget in USD. */
  budget?: number;
  /** Refuse new hires for the rest of the day once the budget is spent. */
  pauseHiring: boolean;
}

const KEEP_DAYS = 90;

function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

/**
 * What the office has spent, all time and per day, so totals survive restarts and outlive the
 * workers they came from. Spend lands on the day it is read, which is the day it happened unless
 * the office was down at the time.
 */
export class Ledger {
  private file: string;
  private total = zeroUsage();
  private days: Record<string, Usage> = {};
  private warnedDay = '';
  private shownDay = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private out: BackgroundFile;
  private emitTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout;

  constructor(
    dataDir: string,
    private opts: LedgerOptions,
    private onChange: (state: UsageState) => void,
    private toast: (text: string, level: 'info' | 'warn') => void,
  ) {
    this.file = path.join(dataDir, 'usage.json');
    this.out = new BackgroundFile(this.file);
    this.load();
    this.shownDay = localDay();
    // Midnight: "today" starts over and a paused office hires again.
    this.tick = setInterval(() => {
      if (localDay() !== this.shownDay) this.emit();
    }, 30_000);
    this.tick.unref();
  }

  state(): UsageState {
    const day = localDay();
    return { total: { ...this.total }, today: { ...(this.days[day] ?? zeroUsage()) }, day, budget: this.opts.budget, pauseHiring: this.opts.pauseHiring };
  }

  get overBudget(): boolean {
    return this.opts.budget !== undefined && (this.days[localDay()]?.cost ?? 0) >= this.opts.budget;
  }

  /** Why a new agent can't be hired right now, when it can't. */
  get hiringPaused(): string | undefined {
    if (!this.opts.pauseHiring || !this.overBudget) return undefined;
    return `Today's ${fmtUsd(this.opts.budget!)} budget is spent — no new hires until tomorrow`;
  }

  add(delta: Usage) {
    if (isZero(delta)) return;
    const day = localDay();
    this.total = addUsage(this.total, delta);
    this.days[day] = addUsage(this.days[day] ?? zeroUsage(), delta);
    for (const d of Object.keys(this.days).sort().slice(0, -KEEP_DAYS)) delete this.days[d];
    this.save();
    this.emit();
    if (this.opts.budget !== undefined && this.overBudget && this.warnedDay !== day) {
      this.warnedDay = day;
      const spent = fmtUsd(this.days[day].cost);
      this.toast(`💸 Today's spend passed the ${fmtUsd(this.opts.budget)} budget (${spent})${this.opts.pauseHiring ? ' — no new hires until tomorrow' : ''}`, 'warn');
    }
  }

  flush() {
    clearInterval(this.tick);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.write();
    }
  }

  private emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.shownDay = localDay();
      this.onChange(this.state());
    }, 200);
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeSoon();
    }, 1000);
  }

  /**
   * The save, without blocking the event loop (a temporary file, then renamed): on a loaded machine the
   * synchronous write of this small file held it 0.4–1 s (the busy office check, 2026-10-08).
   */
  private writeSoon() {
    void this.out.write(JSON.stringify({ total: this.total, days: this.days }, null, 2));
  }

  private write() {
    this.out.flush(JSON.stringify({ total: this.total, days: this.days }, null, 2));
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      this.total = asUsage(saved?.total) ?? zeroUsage();
      if (saved?.days && typeof saved.days === 'object') {
        for (const [day, u] of Object.entries(saved.days)) {
          const usage = asUsage(u);
          if (usage && /^\d{4}-\d{2}-\d{2}$/.test(day)) this.days[day] = usage;
        }
      }
    } catch {
      // corrupt file: start fresh
    }
  }
}
