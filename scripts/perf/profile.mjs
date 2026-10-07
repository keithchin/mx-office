// Reads where the time went in a long task, for the page harness's failures: from a CDP CPU profile
// (the stretches of samples with no idle between them) and from long-animation-frame entries' scripts.
// Bundle positions are named by their source file and line when a PERF_SOURCEMAP=1 build left maps.
import fs from 'node:fs';
import path from 'node:path';

const fileOf = (url) => (url ? url.split('?')[0].split('/').pop() : '');

/** "fn src/client/x.ts:12" for a call frame (0-based line and column, as CDP gives them). */
export function frameName(cf, resolve) {
  const file = fileOf(cf.url);
  const where = (file && resolve?.(file, cf.lineNumber, cf.columnNumber)) || (file ? `${file}:${cf.lineNumber + 1}:${cf.columnNumber + 1}` : '');
  return `${cf.functionName || '(anonymous)'}${where ? ` ${where}` : ''}`;
}

/**
 * The stretches of a CPU profile at least `minMs` long with no idle sample in them, each with the frames
 * that took most of its time (by self time, then by time on the stack for the page's own code).
 */
export function longStretches(profile, minMs, resolve, top = 6) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const idle = (n) => n.callFrame.functionName === '(idle)';
  const out = [];
  let run = [];
  let runMs = 0;
  let t = 0;
  let runStart = 0;
  const flush = () => {
    if (runMs / 1000 >= minMs) {
      const self = new Map();
      const incl = new Map();
      for (const [id, dt] of run) {
        const n = byId.get(id);
        const k = frameName(n.callFrame, resolve);
        self.set(k, (self.get(k) ?? 0) + dt);
        const seen = new Set();
        for (let p = id; p !== undefined; p = parent.get(p)) {
          const cf = byId.get(p).callFrame;
          if (!cf.url || !/\/assets\//.test(cf.url)) continue;
          const name = frameName(cf, resolve);
          if (seen.has(name)) continue;
          seen.add(name);
          incl.set(name, (incl.get(name) ?? 0) + dt);
        }
      }
      const fmt = (m, label) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${Math.round(v / 1000)} ms ${label} ${k}`);
      out.push({ ms: Math.round(runMs / 1000), at: Math.round(runStart / 1000), stack: [...fmt(self, 'self'), ...fmt(incl, 'total')] });
    }
    run = [];
    runMs = 0;
  };
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    t += dt;
    const n = byId.get(profile.samples[i]);
    if (idle(n)) {
      flush();
      continue;
    }
    if (!run.length) runStart = t;
    run.push([n.id, dt]);
    runMs += dt;
  }
  flush();
  return out.map((s) => ({ ...s, ms: s.ms, at: s.at })).sort((a, b) => b.ms - a.ms);
}

/** Line and column of a character offset in a bundle (long-animation-frame scripts give offsets). */
function lineColAt(assetsDir, file, offset, cache) {
  let starts = cache.get(file);
  if (!starts) {
    starts = [0];
    try {
      const src = fs.readFileSync(path.join(assetsDir, file), 'utf8');
      for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
    } catch {
      // not on disk
    }
    cache.set(file, starts);
  }
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return [lo, offset - starts[lo]];
}

/** The scripts of a long animation frame, as stack-like lines, longest first. */
export function loafScripts(entry, assetsDir, resolve, cache = new Map()) {
  return [...(entry.scripts ?? [])]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((s) => {
      const file = fileOf(s.sourceURL);
      let where = file;
      if (file && s.sourceCharPosition >= 0) {
        const [l, c] = lineColAt(assetsDir, file, s.sourceCharPosition, cache);
        where = resolve?.(file, l, c) ?? `${file}:${l + 1}:${c + 1}`;
      }
      return `${Math.round(s.duration)} ms ${s.invoker || s.invokerType || 'script'}${s.sourceFunctionName ? ` ${s.sourceFunctionName}` : ''}${where ? ` ${where}` : ''}${s.forcedStyleAndLayoutDuration > 1 ? ` (forced layout ${Math.round(s.forcedStyleAndLayoutDuration)} ms)` : ''}`;
    });
}
