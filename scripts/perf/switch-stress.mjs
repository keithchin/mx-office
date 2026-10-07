// Switches projects over and over on a running TEST office, to catch a switch that only now and then
// freezes the page: the floor picker between two floors, N times, on the 1D view's Command Center (the
// view that waits on the most) or another tab, or the 2D view. Each switch is timed by the page's own
// record of the load (window.__aoFloorLoads, ui/loading/floor.ts) and by the clock here, with its long
// tasks (and the scripts in them); the CPU profiler runs throughout, and every stretch over the budget
// is named by the functions that took the time.
//
//   node scripts/perf/switch-stress.mjs --base http://127.0.0.1:49xx --floor big-spike --other small-app
//     [--times 20] [--page lite|pixel] [--tab command] [--out <dir>] [--password <pw>]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PERF_BUDGETS } from './budgets.mjs';
import { findChrome } from './pages.mjs';
import { longStretches, loafScripts } from './profile.mjs';
import { sourceMaps } from './sourcemap.mjs';
import { REPO, PASSWORD } from './office.mjs';

const ASSETS = path.join(REPO, 'dist', 'public', 'assets');

export async function switchStress({ base, floor, other, times = 20, page: which = 'lite', tab = 'command', password = PASSWORD, outDir, log = console.log }) {
  const resolve = sourceMaps(ASSETS);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!login.ok) throw new Error(`couldn't sign in (${login.status})`);
  const u = new URL(base);
  const cookies = (login.headers.getSetCookie?.() ?? []).map((c) => {
    const [nv] = c.split(';');
    const i = nv.indexOf('=');
    return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: u.hostname, path: '/' };
  });
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--enable-blink-features=LongAnimationFrameTiming'] });
  const switches = [];
  let stretches = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addCookies(cookies);
    await ctx.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Perf', color: '#00a6a6', skin: 0, hair: 0, style: 0 }));
      window.__perf = { long: [], loaf: [] };
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.long.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) }))).observe({ type: 'longtask', buffered: true });
      try {
        new PerformanceObserver((l) =>
          l.getEntries().forEach((e) => e.duration > 150 && window.__perf.loaf.push({ ms: Math.round(e.duration), at: Math.round(e.startTime), scripts: (e.scripts ?? []).map((s) => ({ duration: s.duration, invoker: s.invoker, sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, sourceCharPosition: s.sourceCharPosition, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })) })),
        ).observe({ type: 'long-animation-frame', buffered: true });
      } catch {}
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
    await page.goto(`${base}/${which}?floor=${encodeURIComponent(other)}${which === 'lite' ? `&tab=${tab}` : ''}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => (window.__aoFloorLoads ?? []).some((r) => r.outcome !== 'cancelled'), null, { timeout: 30000, polling: 100 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const cache = new Map();
    for (let i = 0; i < times; i++) {
      const to = i % 2 === 0 ? floor : other;
      const before = await page.evaluate(() => ({ n: (window.__aoFloorLoads ?? []).length, t: performance.now(), long: window.__perf.long.length }));
      const t0 = Date.now();
      await page.selectOption('#floor', to);
      let rec;
      let stuck = false;
      // Keep asking; a page that doesn't answer for 5 s is noted, and waited on (up to 60 s).
      while (Date.now() - t0 < 60000) {
        const r = await Promise.race([page.evaluate((n) => (window.__aoFloorLoads ?? []).slice(n).find((x) => x.outcome !== 'cancelled') ?? null, before.n).catch(() => null), new Promise((res) => setTimeout(() => res('hang'), 5000))]);
        if (r === 'hang') stuck = true;
        else if (r) {
          rec = r;
          break;
        }
        await new Promise((res) => setTimeout(res, 100));
      }
      const wall = Date.now() - t0;
      const after = await page.evaluate((b) => ({ long: window.__perf.long.slice(b.long), loaf: window.__perf.loaf.filter((f) => f.at >= b.t) }), before).catch(() => ({ long: [], loaf: [] }));
      const longest = Math.max(0, ...after.long.map((l) => l.ms));
      const worst = after.loaf.sort((a, b) => b.ms - a.ms)[0];
      const s = { n: i + 1, to, wallMs: wall, pageMs: rec?.total ?? null, outcome: rec?.outcome ?? 'never', steps: rec?.steps ?? {}, longestTaskMs: longest, stuck, ...(worst && worst.ms > PERF_BUDGETS.longTaskMs ? { worstFrame: { ms: worst.ms, scripts: loafScripts(worst, ASSETS, resolve, cache) } } : {}) };
      switches.push(s);
      log(`${String(i + 1).padStart(2)} → ${to.padEnd(10)} ${String(s.pageMs ?? '—').padStart(6)} ms (wall ${wall})  longest ${longest} ms  ${s.outcome}${stuck ? '  STOPPED ANSWERING' : ''}  ${Object.entries(s.steps).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    const prof = await Promise.race([cdp.send('Profiler.stop'), new Promise((r) => setTimeout(() => r(null), 30000))]);
    if (prof) stretches = longStretches(prof.profile, PERF_BUDGETS.longTaskMs, resolve).slice(0, 10);
    if (outDir) await page.screenshot({ path: path.join(outDir, `switch-stress-${which}.png`) }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  const times_ = switches.map((s) => s.pageMs ?? s.wallMs).sort((a, b) => a - b);
  const pct = (p) => times_[Math.min(times_.length - 1, Math.floor((p / 100) * times_.length))];
  const res = {
    ok: switches.every((s) => s.outcome === 'done' && !s.stuck && (s.pageMs ?? s.wallMs) <= PERF_BUDGETS.switchMs && s.longestTaskMs <= PERF_BUDGETS.longTaskMs),
    page: which,
    tab,
    times: switches.length,
    p50: pct(50),
    p90: pct(90),
    max: times_.at(-1),
    switches,
    stretches,
  };
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `switch-stress-${which}.json`), JSON.stringify(res, null, 2));
  }
  return res;
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/').replace(/^\//, '')}`) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const res = await switchStress({ base: arg('base'), floor: arg('floor'), other: arg('other'), times: Number(arg('times', 20)), page: arg('page', 'lite'), tab: arg('tab', 'command'), password: arg('password', PASSWORD), outDir: arg('out') });
  console.log(`p50 ${res.p50} ms, p90 ${res.p90} ms, max ${res.max} ms over ${res.times} switches: ${res.ok ? 'ok' : 'FAIL'}`);
  for (const s of res.stretches.slice(0, 5)) console.log(`profiled stretch ${s.ms} ms:\n  ${s.stack.slice(0, 8).join('\n  ')}`);
  process.exit(res.ok ? 0 : 1);
}
