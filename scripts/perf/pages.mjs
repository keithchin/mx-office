// The page-responsiveness harness: opens every main view of a running TEST office in headless Chromium,
// one at a time, and holds each to the budgets (budgets.mjs): no main-thread task over longTaskMs, usable
// within timeToUsableMs, and a JS heap that grows no more than heapGrowthPct over soakSeconds of live
// events. A view that fails is opened once more under the CPU profiler to say where the time went.
//
//   node scripts/perf/pages.mjs --base http://127.0.0.1:49xx --floor big-spike --out <dir>
//     [--password <pw>] [--soak 60] [--only cc-chat,board] [--chrome <chrome.exe>] [--no-profile]
//
// run.mjs starts the test office and calls runPages; this CLI is for an office you started yourself (a
// TEST one: it signs in and watches like a person would).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PERF_BUDGETS } from './budgets.mjs';
import { views as allViews } from './views.mjs';
import { longStretches, loafScripts } from './profile.mjs';
import { sourceMaps } from './sourcemap.mjs';
import { REPO, PASSWORD } from './office.mjs';

const ASSETS = path.join(REPO, 'dist', 'public', 'assets');
const MB = 1024 * 1024;
const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** The Chromium playwright-core installed, or undefined to let it find one. */
export function findChrome() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = path.join(root, d, sub);
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // none there
  }
  return undefined;
}

const INIT = ({ storage, budget }) => {
  localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Perf', color: '#00a6a6', skin: 0, hair: 0, style: 0 }));
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  window.__perf = { long: [], loaf: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.long.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        if (e.duration > budget)
          window.__perf.loaf.push({
            ms: Math.round(e.duration),
            at: Math.round(e.startTime),
            scripts: (e.scripts ?? []).map((s) => ({ duration: s.duration, invoker: s.invoker, invokerType: s.invokerType, sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, sourceCharPosition: s.sourceCharPosition, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })),
          });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
};

async function heapMB(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const u = await cdp.send('Runtime.getHeapUsage').catch(() => undefined);
  return u ? u.usedSize / MB : null;
}

/** Waits for `expr` to be true in the page; the ms it took, or null on timeout. */
async function until(page, expr, timeoutMs) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(expr, null, { timeout: timeoutMs, polling: 50 });
    await page.evaluate(() => 1);
    return Date.now() - t0;
  } catch {
    return null;
  }
}

/** Opens one view and measures it. With `profile`, under the CPU profiler (to attribute long tasks only). */
async function measure(browser, base, cookie, v, opts) {
  const { budgets, soakSeconds, outDir, profile, resolve } = opts;
  const ctx = await browser.newContext({ viewport: v.viewport ?? { width: 1400, height: 900 }, isMobile: !!v.mobile, hasTouch: !!v.mobile, extraHTTPHeaders: {} });
  await ctx.addCookies(cookie);
  await ctx.addInitScript(INIT, { storage: v.storage ?? {}, budget: budgets.longTaskMs });
  const page = await ctx.newPage();
  const pageErrors = [];
  // What the page fetched from the office, and how long each took (a switch lists those after it).
  const fetched = [];
  page.on('requestfinished', (rq) => {
    const u = new URL(rq.url());
    if (!u.pathname.startsWith('/api/') || fetched.length > 200) return;
    const t = rq.timing();
    fetched.push({ path: u.pathname + u.search, at: Date.now() - Math.max(0, t.responseEnd), ms: Math.round(t.responseEnd) });
  });
  // The office's side of a project switch: when the page asked (floor.go) and when the floor came (floor.enter).
  const wsLog = {};
  page.on('websocket', (ws) => {
    ws.on('framesent', (fr) => typeof fr.payload === 'string' && fr.payload.includes('"floor.go"') && (wsLog.go = Date.now()));
    ws.on('framereceived', (fr) => {
      if (typeof fr.payload === 'string' && fr.payload.startsWith('{"t":"floor.enter"') && wsLog.go && !wsLog.enter) {
        wsLog.enter = Date.now();
        wsLog.bytes = fr.payload.length;
      }
    });
  });
  page.on('pageerror', (e) => pageErrors.length < 10 && pageErrors.push(String(e.message).slice(0, 300)));
  const cdp = await ctx.newCDPSession(page);
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
  }
  const failures = [];
  let ttuMs = null;
  let switchMs = null;
  let marks = [];
  const t0 = Date.now();
  try {
    await page.goto(base + v.path, { waitUntil: 'commit', timeout: 20000 });
    const first = await until(page, v.ready, Math.max(budgets.timeToUsableMs * 4, 15000));
    if (first == null) failures.push(`never became usable (waited ${Math.max(budgets.timeToUsableMs * 4, 15000)} ms)`);
    else ttuMs = Date.now() - t0;
    // Then each step (open the phone, pick a channel): clicked, and usable within the same budget.
    for (const st of first != null ? (v.steps ?? []) : []) {
      // A project switch: settle first, so what's timed is the switch, not the first load.
      if (st.switch) await new Promise((r) => setTimeout(r, 2000));
      const pt0 = st.select ? await page.evaluate(() => performance.now()).catch(() => 0) : 0;
      const tc = Date.now();
      const act = st.select ? page.selectOption(st.select, st.value, { timeout: 5000 }) : page.click(st.click, { timeout: 5000 });
      const clicked = await act.then(
        () => true,
        (e) => (failures.push(`couldn't ${st.select ? 'pick' : 'click'} ${st.select ?? st.click}: ${e.message.split('\n')[0]}`), false),
      );
      if (!clicked) break;
      if (st.nav) await page.waitForURL((u) => u.pathname === st.nav, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
      const after = await until(page, st.ready, Math.max(budgets.timeToUsableMs * 4, 15000));
      if (after == null) {
        failures.push(`${st.select ?? st.click} never opened`);
        break;
      }
      if (st.switch) {
        // …and drawn: what the floor event asked for lands on the next frames.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
        switchMs = Date.now() - tc;
        await new Promise((r) => setTimeout(r, 1500));
        for (const x of fetched.filter((x) => x.at >= tc - 50)) marks.push({ name: `fetch ${x.path}`, at: x.at - tc, ms: x.ms });
        if (wsLog.go && wsLog.enter) marks.push({ name: 'office: floor.go → floor.enter', at: wsLog.go - tc, ms: wsLog.enter - wsLog.go, bytes: wsLog.bytes });
        // The floor change's own timings, where the page marks them (performance.mark / measure).
        marks = (await page
          .evaluate(
            (from) =>
              [...performance.getEntriesByType('measure'), ...performance.getEntriesByType('mark')]
                .filter((e) => e.startTime >= from)
                .map((e) => ({ name: e.name, at: Math.round(e.startTime - from), ms: Math.round(e.duration) }))
                .slice(0, 30),
            pt0,
          )
          .catch(() => [])).concat(marks);
      } else ttuMs = Math.max(ttuMs, Date.now() - tc);
    }
  } catch (e) {
    failures.push(`couldn't open: ${e.message.split('\n')[0]}`);
  }
  if (ttuMs != null && ttuMs > budgets.timeToUsableMs) failures.push(`time to usable ${ttuMs} ms (budget ${budgets.timeToUsableMs})`);
  if (switchMs != null && switchMs > budgets.switchMs) failures.push(`project switch ${switchMs} ms (budget ${budgets.switchMs})`);
  // Let it settle, then watch the heap over the soak while live events come in.
  await new Promise((r) => setTimeout(r, 1500));
  const heapStart = await heapMB(cdp);
  const soakEnd = Date.now() + soakSeconds * 1000;
  let hung = false;
  while (Date.now() < soakEnd) {
    const r = await Promise.race([page.evaluate(() => 'ok').catch(() => 'gone'), new Promise((res) => setTimeout(() => res('hang'), 5000))]);
    if (r !== 'ok') {
      hung = true;
      failures.push(`the page stopped answering (${r}) during the soak`);
      break;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  const heapEnd = hung ? null : await heapMB(cdp);
  const perf = hung ? { long: [], loaf: [], nodes: null } : await page.evaluate(() => ({ ...window.__perf, nodes: document.getElementsByTagName('*').length }));
  let stretches = [];
  if (profile) {
    const prof = await Promise.race([cdp.send('Profiler.stop'), new Promise((r) => setTimeout(() => r(null), 20000))]);
    if (prof) stretches = longStretches(prof.profile, budgets.longTaskMs, resolve);
  }
  const loafCache = new Map();
  const longTasks = perf.long
    .filter((l) => l.ms > 50)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 12)
    .map((l) => {
      const frame = perf.loaf.find((f) => f.at <= l.at + 5 && f.at + f.ms >= l.at + l.ms - 5);
      const stack = frame ? loafScripts(frame, ASSETS, resolve, loafCache) : [];
      return { ms: l.ms, at: l.at, ...(stack.length ? { stack } : {}) };
    });
  const longestTaskMs = Math.max(0, ...perf.long.map((l) => l.ms));
  if (longestTaskMs > budgets.longTaskMs) failures.push(`a task ran ${longestTaskMs} ms (budget ${budgets.longTaskMs})`);
  const growth = heapStart && heapEnd != null ? ((heapEnd - heapStart) / heapStart) * 100 : null;
  if (growth != null && growth > budgets.heapGrowthPct && heapEnd - heapStart > budgets.heapSlackMB)
    failures.push(`heap grew ${round(growth)}% (${round(heapStart)} → ${round(heapEnd)} MB) over ${soakSeconds} s (budget ${budgets.heapGrowthPct}%)`);
  let screenshot;
  if (outDir && !hung) {
    screenshot = `${v.id}${profile ? '-profiled' : ''}.png`;
    await page.screenshot({ path: path.join(outDir, screenshot), timeout: 10000 }).catch(() => (screenshot = undefined));
  }
  await ctx.close().catch(() => {});
  return {
    id: v.id,
    name: v.name,
    path: v.path,
    ok: failures.length === 0,
    ttuMs,
    longestTaskMs,
    longTasks,
    heapStartMB: round(heapStart),
    heapEndMB: round(heapEnd),
    heapGrowthPct: round(growth),
    domNodes: perf.nodes,
    ...(switchMs != null ? { switchMs } : {}),
    ...(marks.length ? { marks } : {}),
    failures,
    ...(screenshot ? { screenshot } : {}),
    ...(pageErrors.length ? { pageErrors } : {}),
    ...(stretches.length ? { profiled: stretches.slice(0, 5) } : {}),
  };
}

/**
 * Runs every view (or `only` those) against `base`. `onProgress({ done, of, label })` hears each view
 * start. Returns { ok, budgets, views }.
 */
export async function runPages({ base, floor, other, password = PASSWORD, outDir, soakSeconds = PERF_BUDGETS.soakSeconds, only, chrome, profileFailures = true, retryTiming = true, onProgress = () => {}, log = console.log }) {
  const budgets = { ...PERF_BUDGETS, soakSeconds };
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!login.ok) throw new Error(`couldn't sign in to the test office (${login.status})`);
  const u = new URL(base);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => {
    const [nv] = c.split(';');
    const i = nv.indexOf('=');
    return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: u.hostname, path: '/' };
  });
  const list = allViews(floor, other).filter((v) => !only?.length || only.includes(v.id));
  const resolve = sourceMaps(ASSETS);
  const browser = await chromium.launch({ headless: true, executablePath: chrome ?? findChrome(), args: ['--enable-blink-features=LongAnimationFrameTiming'] });
  const results = [];
  try {
    for (const [i, v] of list.entries()) {
      onProgress({ done: i, of: list.length, label: v.name });
      let r = await measure(browser, base, cookie, v, { budgets, soakSeconds: v.soak ?? soakSeconds, outDir, profile: false, resolve });
      // A busy machine (the office's own laptop runs Studio Pro and more) makes one long task now and
      // then: a view that failed on time alone is opened once more, and fails only if it fails again.
      const timing = (x) => x.failures.every((f) => /^a task ran|^time to usable|^project switch/.test(f));
      if (!r.ok && retryTiming && timing(r)) {
        log(`  ${v.id}: ${r.failures.join('; ')}; opening it once more to rule out a busy machine…`);
        const again = await measure(browser, base, cookie, v, { budgets, soakSeconds: v.soak ?? soakSeconds, outDir, profile: false, resolve });
        again.firstTry = { longestTaskMs: r.longestTaskMs, ttuMs: r.ttuMs, failures: r.failures };
        r = again;
      }
      if (!r.ok && profileFailures && r.longestTaskMs > budgets.longTaskMs) {
        log(`  ${v.id}: profiling to see where the time went…`);
        const p = await measure(browser, base, cookie, v, { budgets, soakSeconds: Math.min(v.soak ?? soakSeconds, 15), outDir, profile: true, resolve });
        if (p.profiled) r.profiled = p.profiled;
      }
      log(`${r.ok ? 'ok  ' : 'FAIL'} ${v.id.padEnd(14)} ttu ${String(r.ttuMs ?? '—').padStart(5)} ms  longest ${String(r.longestTaskMs).padStart(4)} ms  heap ${r.heapStartMB ?? '—'}→${r.heapEndMB ?? '—'} MB  nodes ${r.domNodes ?? '—'}${r.ok ? '' : `  ${r.failures.join('; ')}`}`);
      results.push(r);
    }
    onProgress({ done: list.length, of: list.length, label: 'done' });
  } finally {
    await browser.close().catch(() => {});
  }
  return { ok: results.every((r) => r.ok), budgets, views: results };
}

/** A short Markdown summary of a pages run. */
export function pagesSummary(res) {
  const rows = res.views.map((v) => `| ${v.ok ? 'pass' : '**FAIL**'} | ${v.name} | ${v.switchMs != null ? `switch ${v.switchMs}` : (v.ttuMs ?? '—')} | ${v.longestTaskMs} | ${v.heapGrowthPct ?? '—'} | ${v.domNodes ?? '—'} | ${v.failures.join('; ')} |`);
  const b = res.budgets;
  return [
    `# Page responsiveness: ${res.views.filter((v) => v.ok).length}/${res.views.length} views within budget`,
    '',
    `Budgets: longest task ≤ ${b.longTaskMs} ms, time to usable ≤ ${b.timeToUsableMs} ms, heap growth ≤ ${b.heapGrowthPct}% over ${b.soakSeconds} s.`,
    '',
    '| Result | View | Time to usable (ms) | Longest task (ms) | Heap growth (%) | DOM nodes | Why |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/').replace(/^\//, '')}`) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const outDir = arg('out', path.join(process.cwd(), 'perf-pages'));
  const res = await runPages({
    base: arg('base'),
    floor: arg('floor'),
    other: arg('other'),
    password: arg('password', PASSWORD),
    outDir,
    soakSeconds: Number(arg('soak', PERF_BUDGETS.soakSeconds)),
    only: arg('only')?.split(','),
    chrome: arg('chrome'),
    profileFailures: !process.argv.includes('--no-profile'),
    retryTiming: !process.argv.includes("--no-retry"),
  });
  fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(res, null, 2));
  fs.writeFileSync(path.join(outDir, 'summary.md'), pagesSummary(res));
  process.exit(res.ok ? 0 : 1);
}
