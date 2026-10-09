// A stand-in agent that is slow to start, for the busy office's wake burst (busy.mjs): on Windows,
// starting a program (CreateProcess) holds the thread that asks while the virus scanner looks at a
// binary it hasn't seen, and the real claude.exe (256 MB) held the live office's event loop 0.65–2.6 s
// at every worker start (release 19's stall, 2026-10-08). Workers' terminals now start in the terminal
// host (src/server/ptys.ts); this makes the start slow again on purpose, so a regression shows.
//
// On Windows the agent is the tests' shim (tests/support/shim.cs: `<name>.exe` runs `node <dir>\<name>
// <args…>`), named fake-claude.exe and running the perf fake agent, so it behaves exactly as
// fakebin/fake-claude.cmd does. `freshen(mb)` swaps in a fresh copy with `mb` MB of random bytes after
// the program, which the scanner reads through on its first start (about 50 ms a MB here). The copy in
// use is renamed aside first (Windows lets a running program be renamed, not replaced). Elsewhere the
// agent is fakebin's fake-claude and freshen does nothing.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FAKEBIN, FAKE_AGENT, REPO } from './office.mjs';

const SHIM_CS = path.join(REPO, 'tests', 'support', 'shim.cs');

/** The compiled shim, shared with the tests (tests/support/winshim.ts makes the same file). */
function shimExe() {
  const src = fs.readFileSync(SHIM_CS, 'utf8');
  const dir = path.join(os.tmpdir(), 'agent-office-test-shim');
  const exe = path.join(dir, `shim-${createHash('sha256').update(src).digest('hex').slice(0, 12)}.exe`);
  if (fs.existsSync(exe)) return exe;
  const root = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET');
  const csc = ['Framework64', 'Framework'].map((fw) => path.join(root, fw, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
  if (!csc) throw new Error('no csc.exe (.NET Framework 4) to build the slow-start agent with');
  const tmp = path.join(dir, `build-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'shim.cs'), src);
  execFileSync(csc, ['/nologo', '/optimize', `/out:${path.join(tmp, 'shim.exe')}`, path.join(tmp, 'shim.cs')], { stdio: 'pipe', windowsHide: true });
  try {
    fs.renameSync(path.join(tmp, 'shim.exe'), exe);
  } catch {
    // made meanwhile
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return exe;
}

/** The slow-start agent in `dir`: { agent, env, freshen(mb) → whether it made a fresh one }. */
export function slowAgent(dir) {
  if (process.platform !== 'win32') return { agent: FAKE_AGENT, env: {}, freshen: () => false };
  fs.mkdirSync(dir, { recursive: true });
  const agent = path.join(dir, 'fake-claude.exe');
  // What the shim runs: the perf fake agent, with every argument as given.
  fs.writeFileSync(path.join(dir, 'fake-claude'), `import(${JSON.stringify(pathToFileURL(path.join(FAKEBIN, 'fake-agent.mjs')).href)});\n`);
  const shim = shimExe();
  fs.copyFileSync(shim, agent);
  let n = 0;
  return {
    agent,
    env: { TEST_SHIM_NODE: process.execPath },
    freshen(mb) {
      fs.renameSync(agent, path.join(dir, `fake-claude.old-${++n}.exe`));
      const fd = fs.openSync(agent, 'w');
      try {
        fs.writeSync(fd, fs.readFileSync(shim));
        for (let i = 0; i < mb; i++) fs.writeSync(fd, randomBytes(1 << 20));
      } finally {
        fs.closeSync(fd);
      }
      return true;
    },
  };
}
