// The office profiling itself: a CPU profile of its own main thread, taken in-process through
// node:inspector (no debugger attached from outside, nothing to install), saved as a .cpuprofile any
// Chrome DevTools or VS Code opens, and boiled down to what took the time. Nothing runs and nothing is
// loaded until one is asked for: the inspector session exists only while a profile is being recorded.
//
// Asked for two ways (office.ts): by an admin (POST /api/perf/profile, "Record a CPU profile"), and on
// its own when the event loop stalls again soon after a stall (at most once an hour), so the next stall
// is caught in the act and its incident says which functions blocked the loop.

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** One node of V8's CPU profile (Profiler.Profile), as much of it as is read here. */
export interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  children?: number[];
}
export interface CpuProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface FrameTime {
  /** "fn file.js:12" (1-based line). */
  frame: string;
  ms: number;
}

export interface ProfileSummary {
  /** Where the .cpuprofile was saved. */
  file: string;
  durationMs: number;
  /** The functions that ran longest themselves (not counting what they called), over the whole profile. */
  top: FrameTime[];
  /** The longest stretch with no idle sample in it: a blocked event loop, and what ran in it. */
  longest?: { at: number; ms: number; top: FrameTime[]; stack: FrameTime[] };
}

export const PROFILE = {
  /** Microseconds between samples: fine enough to name a 100 ms block, light enough to leave on for minutes. */
  intervalUs: 1000,
  /** The longest profile anyone can ask for. */
  maxMs: 5 * 60_000,
  /** Profiles kept on disk; older ones are removed. */
  keep: 10,
} as const;

const fileOf = (url: string) => (url ? url.split('?')[0].replace(/^file:\/\/\/?/, '').split(/[\\/]/).slice(-2).join('/') : '');
const META = new Set(['(idle)', '(program)', '(root)', '(garbage collector)']);

/** "fn dir/file.js:12" for a call frame (V8's lines are 0-based). */
export function frameName(cf: ProfileNode['callFrame']): string {
  if (META.has(cf.functionName)) return cf.functionName;
  const f = fileOf(cf.url);
  return `${cf.functionName || '(anonymous)'}${f ? ` ${f}:${cf.lineNumber + 1}` : ''}`;
}

const topOf = (m: Map<string, number>, n: number): FrameTime[] =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([frame, us]) => ({ frame, ms: Math.round(us / 100) / 10 }));

/**
 * What a profile says: the top `n` functions by self time over all of it (idle left out), and the
 * longest stretch of samples with no idle between them, with its top functions by self time and by
 * time on the stack (the latter names the caller that started the work, which self time alone hides).
 */
export function summarize(profile: CpuProfile, n = 10): Omit<ProfileSummary, 'file'> {
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map<number, number>();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const self = new Map<string, number>();
  let best: { from: number; to: number; us: number } | undefined;
  let runFrom = -1;
  let runUs = 0;
  const close = (to: number) => {
    if (runFrom >= 0 && (!best || runUs > best.us)) best = { from: runFrom, to, us: runUs };
    runFrom = -1;
    runUs = 0;
  };
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i]);
    if (!node) continue;
    // A sample's time is the gap to the next one.
    const dt = Math.max(0, deltas[i + 1] ?? 0);
    const idle = node.callFrame.functionName === '(idle)';
    if (idle) {
      close(i);
      continue;
    }
    const k = frameName(node.callFrame);
    self.set(k, (self.get(k) ?? 0) + dt);
    if (runFrom < 0) runFrom = i;
    runUs += dt;
  }
  close(samples.length);
  const out: Omit<ProfileSummary, 'file'> = { durationMs: Math.round((profile.endTime - profile.startTime) / 1000), top: topOf(self, n) };
  if (best && best.us > 0) {
    const s = new Map<string, number>();
    const stack = new Map<string, number>();
    let at = profile.startTime;
    for (let i = 0; i < best.from; i++) at += deltas[i] ?? 0;
    for (let i = best.from; i < best.to; i++) {
      const dt = Math.max(0, deltas[i + 1] ?? 0);
      const node = byId.get(samples[i])!;
      const k = frameName(node.callFrame);
      s.set(k, (s.get(k) ?? 0) + dt);
      const seen = new Set<string>();
      for (let p: number | undefined = node.id; p !== undefined; p = parent.get(p)) {
        const cf = byId.get(p)!.callFrame;
        // The office's own code, once per sample: who called into whatever was slow.
        if (META.has(cf.functionName) || !/[\\/](dist|src)[\\/]server[\\/]/.test(cf.url)) continue;
        const f = frameName(cf);
        if (seen.has(f)) continue;
        seen.add(f);
        stack.set(f, (stack.get(f) ?? 0) + dt);
      }
    }
    out.longest = { at: Math.round(at / 1000), ms: Math.round(best.us / 1000), top: topOf(s, n), stack: topOf(stack, n) };
  }
  return out;
}

/** The summary as lines for an incident's timeline or a log. */
export function summaryText(s: ProfileSummary): string {
  const list = (xs: FrameTime[]) => xs.map((x) => `- ${x.ms} ms ${x.frame}`).join('\n');
  const called = s.longest?.stack.length ? `\nCalled from:\n${list(s.longest.stack.slice(0, 5))}` : '';
  const longest = s.longest ? `\nLongest block: ${s.longest.ms} ms. Ran in it:\n${list(s.longest.top.slice(0, 5))}${called}` : '';
  return `CPU profile (${Math.round(s.durationMs / 1000)} s): ${path.basename(s.file)} in ${path.dirname(s.file)}${longest}\nTop functions by self time:\n${list(s.top)}`;
}

let recording: Promise<ProfileSummary> | undefined;

/** Whether a profile is being recorded right now. */
export const profiling = () => !!recording;

/**
 * Records the main thread for `ms` (or until `until` resolves first), saves it under `dir` and
 * summarizes it. One at a time: asking while one runs gets that one.
 */
export function recordProfile(dir: string, ms: number, opts: { until?: Promise<unknown>; label?: string; now?: () => number } = {}): Promise<ProfileSummary> {
  recording ??= (async () => {
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    try {
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', { interval: PROFILE.intervalUs });
      await session.post('Profiler.start');
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([new Promise((r) => (timer = setTimeout(r, Math.min(Math.max(ms, 100), PROFILE.maxMs)))), ...(opts.until ? [opts.until] : [])]);
      clearTimeout(timer);
      const { profile } = (await session.post('Profiler.stop')) as unknown as { profile: CpuProfile };
      mkdirSync(dir, { recursive: true });
      const stamp = new Date((opts.now ?? Date.now)()).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
      const file = path.join(dir, `${stamp}${opts.label ? `-${opts.label.replace(/[^\w-]/g, '')}` : ''}.cpuprofile`);
      await writeFile(file, JSON.stringify(profile));
      prune(dir);
      return { file, ...summarize(profile) };
    } finally {
      session.disconnect();
    }
  })().finally(() => {
    recording = undefined;
  });
  return recording;
}

/** Keeps the newest PROFILE.keep profiles in `dir`. */
function prune(dir: string) {
  try {
    const old = readdirSync(dir)
      .filter((f) => f.endsWith('.cpuprofile'))
      .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(PROFILE.keep);
    for (const { f } of old) unlinkSync(path.join(dir, f));
  } catch {
    // nothing to prune
  }
}
