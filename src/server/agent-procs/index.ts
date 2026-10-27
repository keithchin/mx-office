// Orphaned agent processes (./sweep.ts has the rule): the office records the terminal process it started for each
// agent (each project's worker manager owners(), agents only) in <data>/agent-procs.json, and looks for what a gone
// one left running a little after the office starts and then every few minutes, so a ⏸ paused team's leftovers
// (its agents' terminals stopped) go too. Each orphan is stopped with its tree, and the office says so: the audit
// log (per project, with the agent's name, the pids and what they ran) and its own log. Only processes whose
// parent was one of the office's own recorded terminals are touched, never a name match. The listing runs off the
// event loop, and only while a recorded terminal is gone or not yet pinned by its start time.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { Ctx } from '../office/context.js';
import { audit, office } from '../audit/index.js';
import { writeJsonAtomic } from '../flow/store.js';
import { execFileOffP } from '../offloop/exec.js';
import { killTreeNow } from '../liveapp/process.js';
import { findOrphans, parsePsRows, parseWinRows, shortCmd, type OrphanFind, type ProcRow, type RootEntry } from './sweep.js';

const KEEP_MS = 14 * 86_400_000;
const FIRST_MS = 45_000;
const EVERY_MS = 3 * 60_000;

export interface ProcsDeps {
  dataDir: string;
  /** Each project's agent terminals running now. */
  roots(): { floor: string; workerId: string; name: string; pid: number }[];
  /** The listing; undefined when it failed (then nothing is stopped or forgotten). */
  list?(): Promise<ProcRow[] | undefined>;
  kill?(pid: number): void;
  now?(): number;
  /** The office's pid and its ancestors (never touched). */
  self?: ReadonlySet<number>;
  report?(floor: string, f: OrphanFind): void;
}

const fileOf = (dataDir: string) => path.join(dataDir, 'agent-procs.json');

function readEntries(dataDir: string): RootEntry[] {
  try {
    const v = JSON.parse(readFileSync(fileOf(dataDir), 'utf8')) as { roots?: RootEntry[] };
    return Array.isArray(v.roots) ? v.roots.filter((r) => r && typeof r.pid === 'number' && typeof r.floor === 'string') : [];
  } catch {
    return [];
  }
}

/** The machine's processes with parent pids and start times (Windows: Win32_Process; elsewhere ps). */
export async function listTree(now = Date.now()): Promise<ProcRow[] | undefined> {
  try {
    if (process.platform === 'win32') {
      const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress';
      const { stdout } = await execFileOffP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      return parseWinRows(JSON.parse(stdout.trim() || '[]'));
    }
    const { stdout } = await execFileOffP('ps', ['-eo', 'pid=,ppid=,etimes=,args='], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    return parsePsRows(stdout, now);
  } catch {
    return undefined;
  }
}

/** One look: records the terminals running now, stops what gone ones left. Returns what it stopped. */
export async function sweepOnce(d: ProcsDeps): Promise<OrphanFind[]> {
  const now = d.now?.() ?? Date.now();
  const entries = readEntries(d.dataDir).filter((e) => now - e.seenAt < KEEP_MS);
  const live = d.roots().filter((r) => r.pid > 0);
  for (const r of live) if (!entries.some((e) => e.pid === r.pid && e.workerId === r.workerId)) entries.push({ ...r, seenAt: now, officePid: process.pid });
  const liveSet = new Set(live.map((r) => r.pid));
  const gone = entries.filter((e) => !liveSet.has(e.pid));
  const unpinned = entries.filter((e) => e.created === undefined);
  let found: OrphanFind[] = [];
  let keep = entries;
  if (gone.length || unpinned.length) {
    const procs = await (d.list ?? (() => listTree(now)))();
    if (procs) {
      const byPid = new Map(procs.map((p) => [p.pid, p]));
      // Pin the running ones by their start time (identity against pid reuse).
      for (const e of entries) if (e.created === undefined && liveSet.has(e.pid) && byPid.get(e.pid)?.created) e.created = byPid.get(e.pid)!.created;
      found = findOrphans(entries, procs, liveSet, d.self ?? new Set([process.pid, process.ppid]));
      for (const f of found) {
        for (const t of f.tops) (d.kill ?? killTreeNow)(t.pid);
        d.report?.(f.entry.floor, f);
      }
      // A gone root with nothing left under it is forgotten.
      const left = new Set(found.map((f) => f.entry));
      keep = entries.filter((e) => liveSet.has(e.pid) || left.has(e));
    }
  }
  writeJsonAtomic(fileOf(d.dataDir), { roots: keep });
  return found;
}

/** The report of one root's orphans, in words. */
export const orphanWords = (f: OrphanFind) => `Stopped ${f.count} process${f.count === 1 ? '' : 'es'} an earlier session of ${f.entry.name} left running (its terminal, pid ${f.entry.pid}, is gone): ${f.tops.map((t) => `pid ${t.pid} ${shortCmd(t.cmd)}`).join('; ')}`;

/** At the office's start: the first look after a short while, then every few minutes. Returns what stops it. */
export function startAgentProcs(ctx: Ctx): () => void {
  const deps: ProcsDeps = {
    dataDir: ctx.cfg.dataDir,
    roots: () =>
      [...ctx.floors.values()].flatMap((f) => {
        try {
          const names = new Map(f.workers.list().map((w) => [w.id, w.name]));
          return f.workers.owners().flatMap((o) => (o.agent && o.pid ? [{ floor: f.id, workerId: o.workerId, name: names.get(o.workerId) ?? o.workerId, pid: o.pid }] : []));
        } catch {
          return [];
        }
      }),
    report(floor, f) {
      const words = orphanWords(f);
      console.log(`agent-office: ${floor}: ${words}`);
      audit.record({ floor, actor: office('Agent processes'), action: 'agent-procs.stopped', target: { kind: 'worker', id: f.entry.workerId, label: f.entry.name }, summary: words, details: { root: f.entry.pid, pids: f.tops.map((t) => t.pid), count: f.count, commands: f.tops.map((t) => shortCmd(t.cmd)) }, severity: 'warning' });
    },
  };
  let busy = false;
  const look = () => {
    if (busy) return;
    busy = true;
    void sweepOnce(deps)
      .catch(() => [])
      .finally(() => (busy = false));
  };
  const first = setTimeout(look, FIRST_MS);
  const every = setInterval(look, EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
