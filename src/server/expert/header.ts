// The session screen's header facts: the folder's branch, the app's Mendix version (the .mpr's own), the
// toolkit pin and the mxcli the office runs. Each is cheap but touches the disk or runs mxcli once, so the
// answer is kept per floor for a little while: the header asks again on every session state change.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Floor } from '../floor.js';
import { findMpr } from '../liveapp/checkout.js';
import { mprVersion } from '../studio/open.js';
import { pinnedCommit } from '../toolkit-pin/index.js';
import { findMxcli } from '../model/mxcli.js';
import { mxcliVersion } from '../testing/mxcli-tool.js';

export interface HeaderFacts {
  branch?: string;
  mendix?: string;
  toolkit?: string;
  mxcli?: string;
}

const KEEP_MS = 30_000;
const kept = new Map<string, { at: number; facts: Promise<HeaderFacts> }>();

/** The branch the folder is on, from .git/HEAD (a worktree's .git file points at its own). */
async function branchOf(dir: string): Promise<string | undefined> {
  try {
    let gitDir = path.join(dir, '.git');
    const dotGit = await readFile(gitDir, 'utf8').catch(() => undefined);
    const m = dotGit && /^gitdir:\s*(.+)$/m.exec(dotGit);
    if (m) gitDir = path.resolve(dir, m[1].trim());
    const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return ref ? ref[1] : head.slice(0, 7);
  } catch {
    return undefined;
  }
}

async function read(floor: Floor, dataDir: string): Promise<HeaderFacts> {
  const facts: HeaderFacts = {};
  const branch = await branchOf(floor.dir);
  if (branch) facts.branch = branch;
  // Off the hot path: the header asks at most every KEEP_MS per project.
  await new Promise((r) => setImmediate(r));
  try {
    const mpr = findMpr(floor.dir);
    const v = mpr && mprVersion(mpr);
    if (v) facts.mendix = v;
  } catch {
    // no .mpr, or not readable: no version shown
  }
  const pin = pinnedCommit(floor.dir);
  if (pin) facts.toolkit = pin.slice(0, 7);
  const bin = findMxcli(dataDir);
  if (bin) {
    const v = await mxcliVersion(bin).catch(() => undefined);
    if (v) facts.mxcli = v;
  }
  return facts;
}

export function headerOf(floor: Floor, dataDir: string, now = Date.now()): Promise<HeaderFacts> {
  const had = kept.get(floor.id);
  if (had && now - had.at < KEEP_MS) return had.facts;
  const facts = read(floor, dataDir).catch(() => ({}));
  kept.set(floor.id, { at: now, facts });
  return facts;
}
