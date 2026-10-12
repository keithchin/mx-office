// Which mxcli the office's own Testing runs use (the Model tab's: the live app's, else the wizard's,
// else PATH), its version (asked once per binary), and the test-mode rule: in test mode only a plainly
// fake mxcli runs (a file in a test office's folder, or one named fake / mock / stub), so a test office
// never boots a Mendix runtime or rewrites a real project's files.

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { findMxcli } from '../model/mxcli.js';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { isTestPath, testModeOf } from '../testmode.js';

export interface MxTool {
  bin: string;
  version: string;
}

const versions = new Map<string, { mtime: number; version: string }>();

/** "nightly-20261003-14a0a7c0c" from `mxcli --version` ("mxcli version nightly-… (date)"). */
export function versionOf(out: string): string | undefined {
  return /\bversion\s+(\S+)/i.exec(out)?.[1];
}

export async function mxcliVersion(bin: string): Promise<string> {
  const mtime = await stat(bin).then(
    (s) => s.mtimeMs,
    () => 0,
  );
  const had = versions.get(bin);
  if (had && had.mtime === mtime) return had.version;
  let out = '';
  try {
    out = (await execFileOffP(bin, ['--version'], { timeout: 30_000, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } })).stdout;
  } catch (err) {
    out = (err as OffError).stdout ?? '';
  }
  const version = versionOf(out);
  if (!version) throw new Error(`could not read mxcli's version from ${bin}`);
  versions.set(bin, { mtime, version });
  return version;
}

export const looksFakeTool = (p: string) => isTestPath(p) || /fake|mock|stub/i.test(path.basename(p));

/** The mxcli for a floor's Testing runs, or why there is none. */
export async function mxcliFor(dataDir: string, floorDir: string, find: (dataDir: string) => string | null = findMxcli): Promise<MxTool | { why: string }> {
  const bin = find(dataDir);
  if (!bin) return { why: "mxcli isn't on the office's machine (set AGENT_OFFICE_LIVE_MXCLI or AGENT_OFFICE_MXCLI)" };
  const mode = testModeOf(floorDir);
  if (mode.on && !looksFakeTool(bin)) return { why: `Test mode is on (${mode.why}): only a fake mxcli runs here, and ${bin} is not one` };
  try {
    return { bin, version: await mxcliVersion(bin) };
  } catch (err) {
    return { why: (err as Error).message };
  }
}
