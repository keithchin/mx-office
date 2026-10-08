// The busy office (the performance guard's suite 'busy'): one fresh TEST office from the big-data
// fixture, its six live workers (fake agents only, nothing spent) working the way real ones do — turns
// of tool calls with real-sized results that end with a Stop, a pause, the next prompt — on sessions
// with tens of MB of history and subagent transcripts behind them, while open pages ask for the
// ranking, the analysis, the budget and the roster every few seconds. The server's event loop must
// never block for longer than PERF_BUDGETS.serverStallMs the whole time.
//
// This is what the earlier suites never measured: periodic work driven by live workers (a run recorded
// at every turn's end, the ranking's refresh, the scrollback saves, the transcript scans). On a failure
// the result names what ran in the longest block, from a CPU profile the office records of itself
// (POST /api/perf/profile, server/perfwatch/profile.ts).
//
// Then the wake burst: six workers that were asleep are woken at once (as a safe restart or a project's
// resume does) on an agent binary the virus scanner hasn't seen (slowstart.mjs), and the event loop must
// stay under the same budget while they start. Release 19 started workers' terminals on the event loop,
// where Windows' CreateProcess held it for seconds (2.6 s in the live office); they now start in the
// terminal host (src/server/ptys.ts).
//
//   node scripts/perf/run.mjs --suite busy --root <test-offices dir> --out <dir> --id <id> [--seconds 90]
//
// run.mjs calls runBusy({ root, outDir, seconds, onProgress }); it makes its office in `root`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PERF_BUDGETS } from './budgets.mjs';
import { FAKEBIN, REPO, assertTestDir, killProcessesUnder, login, startTestOffice } from './office.mjs';
import { slowAgent } from './slowstart.mjs';

/**
 * How much history each live worker's session carries before the run, its own transcript and its
 * subagents': about what the live office's longest sessions had (10 MB and 27 subagent files, 2026-10-08).
 */
const HISTORY = { mainMB: 10, subagents: 8, subMB: 2.5 };
/** How often the open pages ask (the Workers tab, Home and the Budget view each poll about this often). */
const PAGE_POLL_MS = 4000;
const PAGE_APIS = (floor) => ['/api/ranking', `/api/ranking?floor=${floor}`, '/api/analysis', '/api/budget', `/api/roster?floor=${floor}`];

/** The wake burst: how many asleep workers wake at once, how big the fresh agent binary is (MB past the program; the scanner reads about 50 ms a MB here), and how long the starts are watched. */
const BURST = { workers: 6, mb: Number(process.env.PERF_SLOW_START_MB) || 24, watchMs: 12_000 };

const filler = (k) => 'checked the module and its tests, read the files around it, nothing to change. '.repeat(Math.ceil(k / 80)).slice(0, k);

/** `mb` of a real-shaped session (assistant tool calls with usage, tool results of a few KB) appended to `file`. */
function addHistory(file, mb, sid, sidechain) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = [];
  let size = 0;
  const t0 = Date.now() - 6 * 3_600_000;
  for (let n = 1; size < mb * 1e6; n++) {
    const ts = new Date(t0 + n * 1500).toISOString();
    const a = JSON.stringify({ parentUuid: `p${n}`, isSidechain: sidechain, sessionId: sid, type: 'assistant', timestamp: ts, uuid: `h-a${n}`, message: { id: `msg_h_${sid.slice(0, 6)}_${n}`, role: 'assistant', model: 'claude-opus-4-6', content: [n % 4 ? { type: 'tool_use', id: `toolu_h_${n}`, name: 'Bash', input: { command: `npm test ${filler(100)}` } } : { type: 'text', text: filler(300) }], usage: { input_tokens: 3, output_tokens: 180, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 700 } } });
    const u = JSON.stringify({ parentUuid: `h-a${n}`, isSidechain: sidechain, sessionId: sid, type: 'user', timestamp: ts, uuid: `h-u${n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_h_${n}`, content: filler(n % 7 ? 1800 : 24_000) }] } });
    out.push(a, u);
    size += a.length + u.length + 2;
  }
  fs.appendFileSync(file, `${out.join('\n')}\n`);
}

/**
 * Gives every live worker of the fixture its history (HISTORY), marked as read in its saved tracker as
 * the office had it, so the run measures what live work costs on top, not a first read at start.
 */
function weighSessions(floorDir) {
  const file = path.join(floorDir, '.agent-office', 'workers.json');
  const workers = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const w of workers) {
    const t = w.tracker?.transcript;
    if (!w.midTurn || !t) continue;
    addHistory(t, HISTORY.mainMB, w.sessionId ?? 'x', false);
    const subs = path.join(path.dirname(t), path.basename(t, '.jsonl'), 'subagents');
    for (let i = 0; i < HISTORY.subagents; i++) addHistory(path.join(subs, `agent-h${i}.jsonl`), HISTORY.subMB, w.sessionId ?? 'x', true);
    for (const f of [t, ...fs.readdirSync(subs).map((x) => path.join(subs, x))]) (w.tracker.files ??= {})[f] = { ...(w.tracker.files[f] ?? {}), offset: fs.statSync(f).size };
    n++;
  }
  fs.writeFileSync(file, JSON.stringify(workers, null, 2));
  return n;
}

/**
 * Each live worker's run record as an open pull request last looked at almost 15 minutes ago: the
 * analyzer looks at those again (merged yet?) all at once, about 45 s from now (a little into the run),
 * as the live office's did every quarter of an hour (analysis/index.ts OPEN_PR_REFRESH_MS).
 */
function openPrsDue(dataDir, floorDir) {
  const live = new Set(JSON.parse(fs.readFileSync(path.join(floorDir, '.agent-office', 'workers.json'), 'utf8')).filter((w) => w.midTurn).map((w) => w.id));
  const file = path.join(dataDir, 'analysis', 'runs.jsonl');
  const due = Date.now() - 15 * 60_000 + 45_000;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const [i, r] of lines.entries()) if (live.has(r.workerId)) Object.assign(r, { outcome: 'open', excluded: undefined, updatedAt: due, pr: { ...(r.pr ?? { number: 900 + i, url: '', title: 'Open work', additions: 1, deletions: 0 }), state: 'OPEN' } });
  fs.writeFileSync(file, `${lines.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

/**
 * The office's own background `claude` (the analyzer's, the summaries', Jeff's Claude Haiku calls) as a
 * binary as big as the real one: a fresh copy of node, named claude, in the test office's folder (so test
 * mode lets it run: it isn't the real CLI). It answers nothing (`bad option`, exit 9), so nothing is
 * asked of a model; what it brings is the start itself, which on Windows holds the thread that starts it
 * while the virus scanner looks at the new binary (1.3 s here; the real claude.exe holds it 0.65 s at
 * every start). The live office stalled on exactly that (the stall pass, 2026-10-08).
 */
function bigClaude(root) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
  return dir;
}

function makeFixture(root) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '3', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`the fixture generator failed: ${err.slice(-800)}`))));
  });
}

/**
 * Wakes up to BURST.workers asleep workers of `floor` at once (the page's ▶ on each, over the office's
 * WebSocket), right after a fresh agent binary went in, and returns the event-loop blocks while they start.
 */
async function wakeBurst({ base, cookie, floor, slow }) {
  const overview = () => fetch(`${base}/api/home/overview`, { headers: { cookie } }).then((r) => r.json());
  // The busy floor's first, then the other's (the fixture has three asleep on each).
  const floors = (await overview()).floors.sort((a, b) => (b.id === floor) - (a.id === floor));
  const asleep = floors.flatMap((f) => f.workers ?? []).filter((w) => w.status === 'offline' || w.status === 'exited').slice(0, BURST.workers);
  const fresh = slow.freshen(BURST.mb);
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?floor=${encodeURIComponent(floor)}&name=perf-burst`, { headers: { cookie, origin: base } });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const t0 = Date.now();
  try {
    for (const w of asleep) ws.send(JSON.stringify({ t: 'worker.resume', workerId: w.id }));
    await new Promise((r) => setTimeout(r, BURST.watchMs));
  } finally {
    ws.close();
  }
  const stalls = (await fetch(`${base}/api/perf/stalls?since=${t0}`, { headers: { cookie } }).then((x) => x.json())).stalls ?? [];
  const ids = new Set(asleep.map((w) => w.id));
  const started = (await overview()).floors.flatMap((f) => f.workers ?? []).filter((w) => ids.has(w.id) && w.status !== 'offline').length;
  return { workers: asleep.length, started, freshMB: fresh ? BURST.mb : 0, stalls, maxStallMs: Math.max(0, ...stalls.map((s) => s.ms)) };
}

const sizeOf = (files) => files.reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);

export async function runBusy({ root, outDir, seconds = 90, onProgress = () => {}, log = console.log }) {
  assertTestDir(root);
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(outDir, { recursive: true });
  onProgress({ done: 0, of: 3, label: 'Making the busy test office' });
  await makeFixture(root);
  const home = path.join(root, 'office');
  const floors = JSON.parse(fs.readFileSync(path.join(home, '.agent-office', 'floors.json'), 'utf8'));
  const floor = floors[0];
  const live = weighSessions(floor.dir);
  openPrsDue(path.join(home, '.agent-office'), floor.dir);
  const transcripts = JSON.parse(fs.readFileSync(path.join(floor.dir, '.agent-office', 'workers.json'), 'utf8')).filter((w) => w.midTurn).map((w) => w.tracker.transcript);
  const before = sizeOf(transcripts);
  onProgress({ done: 1, of: 3, label: `Starting it: ${live} live workers, ${Math.round(before / 1e6)} MB of sessions` });
  const bin = bigClaude(root);
  const slow = slowAgent(path.join(root, 'agent'));
  const office = await startTestOffice({
    home,
    agent: slow.agent,
    env: { PATH: `${bin}${path.delimiter}${FAKEBIN}${path.delimiter}${process.env.PATH}`, FAKE_MODE: 'cycle', FAKE_BIG: '1', FAKE_RATE_MS: '700', FAKE_WORK_MS: '12000', FAKE_IDLE_MS: '5000', ...slow.env },
  });
  const res = { ok: false, seconds, live, stalls: [], maxStallMs: 0, budgetMs: PERF_BUDGETS.serverStallMs };
  try {
    const cookie = await login(office.base);
    const get = (p) => fetch(office.base + p, { headers: { cookie } }).then((r) => r.status, () => 0);
    // Let the office come up and the workers wake, then measure from there.
    await new Promise((r) => setTimeout(r, 6000));
    const t0 = Date.now();
    onProgress({ done: 2, of: 3, label: `Busy for ${seconds} s` });
    const prof = fetch(`${office.base}/api/perf/profile`, { method: 'POST', headers: { cookie, origin: office.base, 'content-type': 'application/json' }, body: JSON.stringify({ seconds }) })
      .then((r) => r.json())
      .catch((e) => ({ error: String(e) }));
    const pages = setInterval(() => PAGE_APIS(floor.id).forEach((p) => void get(p)), PAGE_POLL_MS);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    clearInterval(pages);
    const r = await fetch(`${office.base}/api/perf/stalls?since=${t0}`, { headers: { cookie } }).then((x) => x.json());
    res.stalls = r.stalls ?? [];
    res.maxStallMs = Math.max(0, ...res.stalls.map((s) => s.ms));
    res.grewMB = Math.round((sizeOf(transcripts) - before) / 1e5) / 10;
    const profile = await prof;
    if (profile?.longest) res.longest = profile.longest;
    if (profile?.file) res.profile = profile.file;
    const over = res.stalls.filter((s) => s.ms > PERF_BUDGETS.serverStallMs);
    onProgress({ done: 2, of: 3, label: `Waking ${BURST.workers} asleep workers at once on a fresh agent binary` });
    res.burst = await wakeBurst({ base: office.base, cookie, floor: floor.id, slow });
    const burstOver = res.burst.stalls.filter((s) => s.ms > PERF_BUDGETS.serverStallMs);
    res.failures = [
      ...over.map((s) => `the event loop blocked ${s.ms} ms at +${Math.round((s.at - t0) / 1000)} s (budget ${PERF_BUDGETS.serverStallMs} ms)`),
      ...(res.grewMB < 1 ? [`the workers hardly worked (${res.grewMB} MB of transcript in ${seconds} s): the run measured an idle office`] : []),
      ...burstOver.map((s) => `waking ${res.burst.workers} workers at once, the event loop blocked ${s.ms} ms (budget ${PERF_BUDGETS.serverStallMs} ms)`),
      ...(res.burst.started < res.burst.workers ? [`the wake burst started ${res.burst.started} of ${res.burst.workers} workers`] : []),
    ];
    res.ok = res.failures.length === 0;
    log(`${res.ok ? 'ok  ' : 'FAIL'} busy office: ${live} workers, ${res.grewMB} MB written, ${res.stalls.length} blocks over 100 ms, longest ${res.maxStallMs} ms (budget ${PERF_BUDGETS.serverStallMs} ms)`);
    log(`     wake burst: ${res.burst.started}/${res.burst.workers} woken at once${res.burst.freshMB ? ` on a fresh ${res.burst.freshMB} MB agent binary` : ''}, longest block ${res.burst.maxStallMs} ms`);
    if (!res.ok && res.longest) log(`     longest busy stretch ${res.longest.ms} ms: ${res.longest.stack.slice(0, 4).map((f) => f.frame).join(' < ')}`);
  } catch (e) {
    res.error = String(e?.message ?? e);
    res.failures = [res.error];
  } finally {
    await office.stop().catch((e) => {
      res.ok = false;
      (res.failures ??= []).push(String(e.message));
    });
  }
  onProgress({ done: 3, of: 3, label: 'done' });
  return res;
}

/** The run as summary.md. */
export function busySummary(res) {
  const lines = [`# Busy office: ${res.ok ? 'pass' : 'FAIL'}`, '', `${res.live ?? 0} live workers for ${res.seconds} s, ${res.grewMB ?? 0} MB of transcript written; ${res.stalls?.length ?? 0} event-loop blocks over 100 ms, the longest ${res.maxStallMs ?? 0} ms (budget ${res.budgetMs} ms).`];
  if (res.burst) lines.push('', `Wake burst: ${res.burst.started} of ${res.burst.workers} asleep workers woken at once${res.burst.freshMB ? ` on a fresh ${res.burst.freshMB} MB agent binary` : ''}; ${res.burst.stalls.length} blocks over 100 ms while they started, the longest ${res.burst.maxStallMs} ms.`);
  for (const f of res.failures ?? []) lines.push(`- FAIL ${f}`);
  if (res.longest) lines.push('', `Longest busy stretch in the office's own CPU profile: ${res.longest.ms} ms`, ...res.longest.stack.slice(0, 8).map((f) => `- ${f.ms} ms ${f.frame}`));
  return `${lines.join('\n')}\n`;
}
