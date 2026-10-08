// Live performance warnings in the real office: a page that runs one task for longer than half a second
// (its own PerformanceObserver, src/client/shared/perfwatch.ts, reports it to POST /api/perf/longtask),
// and the server's own event loop blocked for longer than a second (perf_hooks' monitorEventLoopDelay,
// read every few seconds), each open an incident (or count again into the open one) with what's known:
// the view and the top frames for a page, how long and when for the server. Both are throttled so a
// page stuck in a bad loop, or a slow minute, can't flood the incident list.

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Detection } from '../incidents/index.js';

export const PERF_WATCH = {
  /** A page's task longer than this is reported (the client filters too). */
  pageLongTaskMs: 500,
  /** The server's event loop blocked longer than this is a stall. */
  serverStallMs: 1000,
  /** How often the server's loop delay is read. */
  loopWindowMs: 5000,
  /** At most one report per view (and one server stall) per this long. */
  throttleMs: 60_000,
} as const;

export interface PageReport {
  view: string;
  ms: number;
  floor?: string;
  stack: string[];
  url?: string;
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');

/** A report as the page sent it, made safe; undefined when it isn't one (or is under the threshold). */
export function readPageReport(body: unknown): PageReport | undefined {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const ms = Number(b.ms);
  const view = line(b.view, 60);
  if (!view || !Number.isFinite(ms) || ms < PERF_WATCH.pageLongTaskMs || ms > 3_600_000) return undefined;
  const stack = (Array.isArray(b.stack) ? b.stack : []).map((s) => line(s, 200)).filter(Boolean).slice(0, 8);
  const floor = line(b.floor, 80) || undefined;
  const url = line(b.url, 200) || undefined;
  return { view, ms: Math.round(ms), stack, ...(floor ? { floor } : {}), ...(url ? { url } : {}) };
}

/** Lets a key through at most once per `ms`. */
export function throttle(ms: number, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (key: string) => {
    const t = now();
    if (t - (last.get(key) ?? -Infinity) < ms) return false;
    last.set(key, t);
    if (last.size > 500) last.delete(last.keys().next().value!);
    return true;
  };
}

/** The incident a page report raises. `floorKnown` says whether its floor is one of the office's. */
export function pageDetection(r: PageReport, who: string, floorKnown: boolean): Detection {
  const where = r.stack.length ? `\n\nWhere the time went:\n${r.stack.map((s) => `- ${s}`).join('\n')}` : '';
  return {
    rule: 'pageStall',
    ...(floorKnown && r.floor ? { floor: r.floor } : {}),
    severity: r.ms >= 5000 ? 'sev2' : 'sev3',
    title: `A page froze for ${r.ms} ms (${r.view})`,
    summary: `${who}'s ${r.view} page ran one task for ${r.ms} ms${r.url ? ` at ${r.url}` : ''}.${where}`,
    again: `Froze again: ${r.view}, ${r.ms} ms${r.stack[0] ? ` (${r.stack[0]})` : ''}`,
  };
}

/** The incident a server stall raises. */
export function serverDetection(ms: number): Detection {
  return {
    rule: 'serverStall',
    severity: ms >= 10_000 ? 'sev2' : 'sev3',
    title: `The office server stalled for ${Math.round(ms)} ms`,
    summary: `The server's event loop was blocked for ${Math.round(ms)} ms: pages, hooks and workers waited that long for an answer.`,
    again: `Stalled again: ${Math.round(ms)} ms`,
  };
}

/**
 * A gap this long, with signs the whole machine stopped rather than the office (the process used almost
 * no CPU through it, or the wall clock moved on further than the monotonic one), is the computer
 * sleeping: a notice, never a stall. A blocked event loop burns CPU the whole time it's blocked.
 */
export const SLEEP_GAP = {
  /** Shorter gaps are always taken at their word. */
  minMs: 60_000,
  /** At most this share of the gap spent on the CPU reads as a suspended machine. */
  maxCpuShare: 0.2,
  /** The wall clock running ahead of the monotonic one by this much is a suspend (Linux/macOS: the monotonic clock stops while asleep). */
  clockSkewMs: 30_000,
} as const;

/** What a gap in the event loop was: `monoMs` by the monotonic clock, `wallMs` by Date.now, `cpuMs` the process's CPU time (user + system) over it. */
export function gapKind(g: { monoMs: number; wallMs: number; cpuMs: number }): 'sleep' | 'stall' {
  if (g.wallMs - g.monoMs > SLEEP_GAP.clockSkewMs) return 'sleep';
  const gap = Math.max(g.monoMs, g.wallMs);
  if (gap >= SLEEP_GAP.minMs && g.cpuMs < gap * SLEEP_GAP.maxCpuShare) return 'sleep';
  return 'stall';
}

export interface LoopWatchOptions {
  stallMs?: number;
  windowMs?: number;
  throttleMs?: number;
  /** Every stall, throttled or not (the self-profiler counts them, office.ts). */
  onStall?: (ms: number) => void;
  /** A gap that was the machine asleep, not the office: logged, no incident. */
  onSleep?: (ms: number) => void;
  /** Clocks, for tests. */
  clocks?: { mono: () => number; wall: () => number; cpuMs: () => number };
}

const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

/** Starts watching the server's event loop; `raise` hears each stall (throttled). Returns stop. */
export function watchEventLoop(raise: (d: Detection) => void, opts: LoopWatchOptions = {}) {
  const stallMs = opts.stallMs ?? PERF_WATCH.serverStallMs;
  const clocks = opts.clocks ?? { mono: () => performance.now(), wall: Date.now, cpuMs };
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const allow = throttle(opts.throttleMs ?? PERF_WATCH.throttleMs);
  let last = { mono: clocks.mono(), wall: clocks.wall(), cpu: clocks.cpuMs() };
  const windowMs = opts.windowMs ?? PERF_WATCH.loopWindowMs;
  const timer = setInterval(() => {
    const now = { mono: clocks.mono(), wall: clocks.wall(), cpu: clocks.cpuMs() };
    // The histogram's longest delay, or how late this timer itself fired: whichever is worse.
    const worst = Math.max(h.max / 1e6, now.mono - last.mono - windowMs);
    const gap = { monoMs: now.mono - last.mono, wallMs: now.wall - last.wall, cpuMs: now.cpu - last.cpu };
    last = now;
    h.reset();
    if (worst <= stallMs) return;
    if (gapKind(gap) === 'sleep') return opts.onSleep?.(Math.max(gap.monoMs, gap.wallMs));
    opts.onStall?.(worst);
    if (allow('server')) raise(serverDetection(worst));
  }, windowMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    h.disable();
  };
}

export interface StallRecord {
  /** When the block started (epoch ms). */
  at: number;
  ms: number;
}

/**
 * Records every event-loop block over `thresholdMs` with when it started, by how late a short timer
 * fires: what the journey's server budget reads (GET /api/perf/stalls, test mode only). Keeps the
 * newest `keep`. Returns { list, stop }.
 */
export function recordStalls(opts: { thresholdMs?: number; intervalMs?: number; keep?: number } = {}) {
  const thresholdMs = opts.thresholdMs ?? 100;
  const intervalMs = opts.intervalMs ?? 50;
  const keep = opts.keep ?? 500;
  const stalls: StallRecord[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const late = now - last - intervalMs;
    last = now;
    if (late > thresholdMs) {
      stalls.push({ at: Math.round(Date.now() - late), ms: Math.round(late) });
      if (stalls.length > keep) stalls.shift();
    }
  }, intervalMs);
  timer.unref();
  return { list: (since = 0) => stalls.filter((s) => s.at >= since), stop: () => clearInterval(timer) };
}
