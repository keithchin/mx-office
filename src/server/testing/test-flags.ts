// What this mxcli's `mxcli test` can be told, read once per binary from its `test --help` (cached by the file's
// time), so the office's microflow test run (mxcli-run.ts) picks the route that needs no PostgreSQL superuser:
//   * `--db-type hsqldb` (mxcli v0.27 and newer): the test runtime boots on the Mendix runtime's built-in file
//     database: no PostgreSQL, no role, no database to make, nothing anyone has to grant. Measured on Windows
//     with mxcli v0.27.0 and Mendix 11.12.2: a two-test suite in 33 s, JUnit written;
//   * `--app-port` / `--admin-port` / `--serve-port` (the same versions): ports the office picks, so a test run
//     never waits for (or fights over) the fixed 8081/8091;
//   * `--mxbuild-path`: the app's mxbuild, as the live app and the app instances pick it;
//   * `--constant`: the project's instance constants for the run (app-instance/constants.ts).
// An older mxcli has none of the first two: its `--local` makes `<app>_test` through `psql -U postgres` (a
// superuser) every time, even when the database is there (mxcli-run.ts says what to do about it).

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';

export interface TestFlags {
  /** `--db-type` (hsqldb: no PostgreSQL at all). */
  dbType: boolean;
  /** `--app-port`, `--admin-port` and `--serve-port`. */
  ports: boolean;
  mxbuildPath: boolean;
  /** `--constant Module.Name=value` (this run only): the project's instance constants and a generated seed password. */
  constant?: boolean;
}

export const NO_FLAGS: TestFlags = { dbType: false, ports: false, mxbuildPath: false };

/** The flags a `mxcli test --help` text lists. */
export function testFlagsIn(help: string): TestFlags {
  const has = (f: string) => new RegExp(`(^|\\s)--${f}\\b`, 'm').test(help);
  return { dbType: has('db-type'), ports: has('app-port') && has('admin-port') && has('serve-port'), mxbuildPath: has('mxbuild-path'), constant: has('constant') };
}

const cache = new Map<string, { mtime: number; flags: Promise<TestFlags> }>();

/** What `bin`'s `mxcli test` can be told (asked once per binary and file time; none when it can't be asked). */
export async function testFlags(bin: string, timeoutMs = 30_000): Promise<TestFlags> {
  const mtime = await stat(bin).then(
    (s) => s.mtimeMs,
    () => 0,
  );
  const had = cache.get(bin);
  if (had && had.mtime === mtime) return had.flags;
  const flags = new Promise<TestFlags>((resolve) => {
    execFile(bin, ['test', '--help'], { cwd: os.tmpdir(), timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (_err, stdout, stderr) => resolve(testFlagsIn(`${stdout}\n${stderr}`)));
  });
  cache.set(bin, { mtime, flags });
  return flags;
}
