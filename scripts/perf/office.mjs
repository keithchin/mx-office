// Starts and stops a throwaway TEST office for the performance guard's harnesses. It refuses anything
// that isn't a test office: the office's folder must be under scratch/test-offices or a test-office…
// folder (src/server/testmode.ts isTestPath), test mode is forced on, only the fake agent in
// scripts/perf/fakebin may start, and port 4600 (the real office's) is never used.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAKEBIN = path.join(REPO, 'scripts', 'perf', 'fakebin');
export const FAKE_AGENT = path.join(FAKEBIN, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude');
export const PASSWORD = 'test-only-perf-guard';
const REAL_PORT = 4600;

/** Whether `p` is in a test office's folder (the same rule as src/server/testmode.ts isTestPath). */
export const isTestPath = (p) => !!p && p.replaceAll('\\', '/').split('/').some((s) => s.toLowerCase().startsWith('test-office'));

/** Refuses (throws) unless `dir` is a test office's folder. */
export function assertTestDir(dir, what = 'the test office') {
  if (!isTestPath(path.resolve(dir))) throw new Error(`refused: ${what} (${dir}) is not under scratch/test-offices or a test-office… folder`);
}

/** A free port, never the real office's. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => (port === REAL_PORT ? freePort().then(resolve, reject) : resolve(port)));
    });
    s.on('error', reject);
  });
}

/** Kills a process and everything it started. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/**
 * Real agent CLIs (claude.exe and friends) running from a folder under `root`: a test office must never
 * have started one. Windows only (wmic is gone; PowerShell's CIM query). Returns their command lines.
 */
export function realAgentsUnder(root) {
  if (process.platform !== 'win32') return [];
  try {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='codex.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)|$($_.CommandLine)" }`;
    const outp = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const r = path.resolve(root).toLowerCase().replaceAll('\\', '/');
    return outp.split(/\r?\n/).filter((l) => l.trim() && l.toLowerCase().replaceAll('\\', '/').includes(r));
  } catch {
    return [];
  }
}

/** Kills any real agent CLI found running under `root`, and says which. */
export function killRealAgentsUnder(root) {
  const found = realAgentsUnder(root);
  for (const l of found) killTree(Number(l.split('|')[0]));
  return found;
}

async function waitUp(base, ms, proc) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc.exitCode !== null) throw new Error(`the test office exited (code ${proc.exitCode}) before it answered`);
    try {
      const r = await fetch(`${base}/api/test-mode`);
      if (r.status < 500) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the test office didn't answer within ${ms} ms`);
}

/**
 * Starts the office in `home` (a folder holding .agent-office/) in test mode with the fake agent. `env`
 * adds to the office's environment (FAKE_* settings reach the fake agents); `agent` is the fake to run
 * (FAKE_AGENT by default). Returns { base, password,
 * port, log, stop }.
 */
export async function startTestOffice({ home, port, env = {}, log, fakeDir, timeoutMs = 60000, agent = FAKE_AGENT }) {
  assertTestDir(home);
  if (!fs.existsSync(path.join(REPO, 'dist', 'server', 'server', 'cli.js'))) throw new Error('the office is not built: run npm run build first');
  port = port ?? (await freePort());
  if (port === REAL_PORT) throw new Error('refused: port 4600 is the real office');
  const logFile = log ?? path.join(home, 'office.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const sep = process.platform === 'win32' ? ';' : ':';
  const childEnv = {
    ...process.env,
    PATH: `${FAKEBIN}${sep}${process.env.PATH}`,
    AGENT_OFFICE_HOME: home,
    AGENT_OFFICE_PROJECTS: path.join(home, 'projects'),
    AGENT_OFFICE_AGENT: agent,
    AGENT_OFFICE_TEST_MODE: '1',
    AGENT_OFFICE_NO_OPEN: '1',
    AGENT_OFFICE_ALLOW_REAL_AGENTS: '',
    FAKE_DIR: fakeDir ?? path.join(home, 'fake-transcripts'),
    ...env,
  };
  delete childEnv.AGENT_OFFICE_PASSWORD;
  // PERF_OFFICE_NODE_ARGS adds node flags (say --cpu-prof --cpu-prof-dir=<dir>, to profile the office; the profile is written when it exits on its own).
  const nodeArgs = (process.env.PERF_OFFICE_NODE_ARGS ?? '').split(' ').filter(Boolean);
  const proc = spawn(process.execPath, [...nodeArgs, path.join(REPO, 'bin', 'agent-office.js'), '--home', home, '--port', String(port), '--password', PASSWORD, '--agent', agent, '--test-mode', '--no-open'], {
    cwd: home,
    env: childEnv,
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    killTree(proc.pid);
    await new Promise((r) => (proc.exitCode !== null ? r() : (proc.once('exit', r), setTimeout(r, 5000))));
    try {
      fs.closeSync(out);
    } catch {
      // closed
    }
    // The workers' terminal host outlives the office on purpose (for the next one): not a test office's.
    killProcessesUnder(home);
    const real = killRealAgentsUnder(home);
    if (real.length) throw new Error(`real agent CLIs were running under the test office and were killed: ${real.join('; ')}`);
  };
  try {
    await waitUp(base, timeoutMs, proc);
    // GET /api/test-mode wants a signed-in session.
    const cookie = await login(base);
    const mode = await (await fetch(`${base}/api/test-mode`, { headers: { cookie } })).json().catch(() => ({}));
    if (!mode.on) throw new Error('refused: the office did not come up in test mode');
  } catch (e) {
    await stop().catch(() => {});
    throw e;
  }
  return { base, port, password: PASSWORD, log: logFile, proc, stop };
}

/** Signs in to a test office and returns the session cookie header. */
export async function login(base, password = PASSWORD) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const c = r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')];
  return c.map((s) => s.split(';')[0]).join('; ');
}

/**
 * Removes a test office's folder. Links inside it (a junction to node_modules, say) are unlinked first
 * and never followed, so nothing outside the folder can go with it. Refuses a folder that isn't a test one.
 */
export function removeTestDir(dir) {
  assertTestDir(dir);
  if (!fs.existsSync(dir)) return;
  const unlinkLinks = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      let st;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        try {
          fs.unlinkSync(p);
        } catch {
          fs.rmdirSync(p);
        }
      } else if (st.isDirectory()) unlinkLinks(p);
    }
  };
  unlinkLinks(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

/** What Windows says while something still has a file in the folder open for a moment (the office's
 * terminal host, a virus scanner, the search indexer letting go): worth another try. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);

/**
 * removeTestDir at the end of a run, made to never fail it: a folder Windows still holds is tried again
 * `attempts` times, `delayMs` apart, and if it still won't go, `warn` says so and it's left for later.
 * Resolves true when it's gone. A run's result never depends on its cleanup.
 */
export async function cleanupTestDir(dir, { attempts = 6, delayMs = 1000, remove = removeTestDir, warn = (m) => console.warn(m), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try {
      remove(dir);
      return true;
    } catch (e) {
      if (TRANSIENT.has(e?.code) && i < attempts) {
        await sleep(delayMs);
        continue;
      }
      warn(`perf: couldn't remove ${dir} after ${i} tr${i === 1 ? 'y' : 'ies'} (${e?.code ?? e?.message ?? e}); left in place, delete it by hand. The run's result stands.`);
      return false;
    }
  }
}

/**
 * Kills every process whose command line names `root` (the workers' terminal host the office leaves
 * running for the next one, fake agents started in its checkouts), and everything they started. For a
 * test office's folder only. Returns how many it killed.
 */
export function killProcessesUnder(root) {
  assertTestDir(root);
  const r = path.resolve(root).toLowerCase().replaceAll('\\', '/');
  let lines = [];
  try {
    if (process.platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
      lines = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }).split(/\r?\n/);
    } else {
      lines = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().replace(/\s+/, '|'));
    }
  } catch {
    return 0;
  }
  let n = 0;
  for (const l of lines) {
    const [pid, ...rest] = l.split('|');
    if (!pid || Number(pid) === process.pid || !rest.join('|').toLowerCase().replaceAll('\\', '/').includes(r)) continue;
    killTree(Number(pid));
    n++;
  }
  return n;
}
