// How loaded the machine is when a microflow test run gets the test runtime (release 83, a real build: three
// single-file runs were stopped at their 15-min limit while another project's runtimes loaded the machine). The
// run's limit is sized to the tests it selected (shared/testing/test-files.ts autoLimitMinutes); this adds headroom
// for what else is running then:
//   * the office's own app runtimes (agents' instances, app-instance/index.ts runtimesRunning), in memory;
//   * other `mxcli test` processes on the machine that aren't this office's run (another office, an agent's own
//     run): one process list, off the event loop, at most every 30 s, with a time limit; none read on failure.
// Each counts once, at most two: the factor is 1 + 0.5 a runtime (at most 2x). The office's own test runs never
// overlap (test-db.ts serialTestRuntime), and the wait for one is shown, never counted (mxcli-office.ts).

import { execFileOffP } from '../offloop/exec.js';
import { runtimesRunning } from '../app-instance/index.js';

export interface LoadDeps {
  /** The office's own app runtimes running now. */
  runtimes?: () => number;
  /** Other `mxcli test` processes on the machine now. */
  otherTests?: () => Promise<number>;
}

const MXCLI_TEST = /\bmxcli(\.exe)?["']?\s+(.*\s)?test\s/i;

/** The `mxcli test` command lines in a process list's output (one command line a line). */
export function mxcliTestsIn(lines: string): number {
  return lines.split(/\r?\n/).filter((l) => MXCLI_TEST.test(`${l.trim()} `)).length;
}

let seen: { at: number; n: number } | undefined;

/** Other `mxcli test` processes on this machine (cached 30 s); 0 when the list can't be read. */
export async function otherMxcliTests(now = Date.now()): Promise<number> {
  if (seen && now - seen.at < 30_000) return seen.n;
  let n = 0;
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await execFileOffP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='mxcli.exe'\" | ForEach-Object { $_.CommandLine }"], { timeout: 15_000, windowsHide: true })
        : await execFileOffP('ps', ['-eo', 'args'], { timeout: 10_000 });
    n = mxcliTestsIn(stdout);
  } catch {
    n = 0;
  }
  seen = { at: now, n };
  return n;
}

/** The headroom for a run starting now: a factor over its limit and why, or undefined when the machine is quiet. */
export async function headroomNow(d: LoadDeps = {}): Promise<{ factor: number; why: string } | undefined> {
  const runtimes = (d.runtimes ?? runtimesRunning)();
  const tests = await (d.otherTests ?? otherMxcliTests)().catch(() => 0);
  const busy = Math.min(2, runtimes + tests);
  if (!busy) return undefined;
  const parts = [runtimes ? `${runtimes} app runtime${runtimes === 1 ? '' : 's'} running` : '', tests ? `${tests} other mxcli test run${tests === 1 ? '' : 's'} on the machine` : ''].filter(Boolean);
  return { factor: 1 + 0.5 * busy, why: `x${1 + 0.5 * busy} while ${parts.join(' and ')}` };
}

/** Tests: forget the cached process list. */
export const forgetLoad = () => void (seen = undefined);
