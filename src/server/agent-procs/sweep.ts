// Which processes an earlier agent session left running (./index.ts runs it): the rebuild run found an agent's
// background shells (`until curl … ; do sleep …; done` loops) still looping a day after the office restarted.
// The office knows the terminal process (pid) it started for each agent (the worker's pty); it records each one,
// with when it first saw it and, once listed, when the process started. A recorded root that is gone (or whose pid
// a newer process took) leaves its children orphaned; those are what is stopped, by their parent pid and their
// start time, never by matching names or command lines. A root that is still alive is never touched (it may have
// been taken over again), nor anything under a terminal a worker runs now, nor the office itself. Pure.

/** A process as the machine lists it. */
export interface ProcRow {
  pid: number;
  ppid: number;
  /** When it started (ms), when the listing says. */
  created?: number;
  cmd: string;
}

/** A terminal process the office started for an agent. */
export interface RootEntry {
  floor: string;
  workerId: string;
  name: string;
  pid: number;
  /** When the office first saw it running (it started before then). */
  seenAt: number;
  /** When it started, once a listing said (pins its identity against pid reuse). */
  created?: number;
  /** The office process that started it. */
  officePid: number;
}

/** What to stop for one gone root: the topmost orphans (each stopped with its tree) and how many processes that is. */
export interface OrphanFind {
  entry: RootEntry;
  tops: ProcRow[];
  count: number;
}

/** Root processes started earlier than this before the office first saw them are not assumed (12 h). */
const SLACK_MS = 12 * 3_600_000;

function childrenOf(procs: readonly ProcRow[]): Map<number, ProcRow[]> {
  const m = new Map<number, ProcRow[]>();
  for (const p of procs) {
    const l = m.get(p.ppid) ?? [];
    l.push(p);
    m.set(p.ppid, l);
  }
  return m;
}

/** A process and everything under it that started after its parent (a reused pid's children excluded). */
function treeOf(top: ProcRow, kids: Map<number, ProcRow[]>, seen = new Set<number>()): ProcRow[] {
  const out: ProcRow[] = [];
  const walk = (p: ProcRow) => {
    if (seen.has(p.pid)) return;
    seen.add(p.pid);
    out.push(p);
    for (const c of kids.get(p.pid) ?? []) if (c.created === undefined || p.created === undefined || c.created >= p.created - 1000) walk(c);
  };
  walk(top);
  return out;
}

/**
 * The orphans of every recorded root that is gone: its children that started after it (and before any newer
 * process took its pid), with their trees. `live` are the terminal pids workers run now; `self` the office's pid
 * and its ancestors, never touched.
 */
export function findOrphans(entries: readonly RootEntry[], procs: readonly ProcRow[], live: ReadonlySet<number>, self: ReadonlySet<number>): OrphanFind[] {
  const kids = childrenOf(procs);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // Nothing under a terminal a worker runs now.
  const protectedPids = new Set<number>(self);
  for (const pid of live) {
    const p = byPid.get(pid);
    if (p) for (const x of treeOf(p, kids)) protectedPids.add(x.pid);
    protectedPids.add(pid);
  }
  const out: OrphanFind[] = [];
  for (const e of entries) {
    if (live.has(e.pid)) continue;
    const now = byPid.get(e.pid);
    const from = e.created ?? e.seenAt - SLACK_MS;
    const same = !!now && (e.created !== undefined ? Math.abs((now.created ?? -1) - e.created) < 2000 : now.created === undefined || now.created <= e.seenAt);
    if (same) continue; // still alive: never touched
    const until = now?.created; // a newer process took the pid: its children aren't ours
    const tops = (kids.get(e.pid) ?? []).filter((c) => c.created !== undefined && c.created >= from - 1000 && (until === undefined || c.created < until) && !protectedPids.has(c.pid));
    if (!tops.length) continue;
    const all = new Set<number>();
    for (const t of tops) for (const x of treeOf(t, kids)) if (!protectedPids.has(x.pid)) all.add(x.pid);
    out.push({ entry: e, tops, count: all.size });
  }
  return out;
}

/** Parses Win32_Process rows (ConvertTo-Json): CreationDate as "/Date(ms)/" or an ISO/DMTF string. */
export function parseWinRows(raw: unknown): ProcRow[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((r: { ProcessId?: unknown; ParentProcessId?: unknown; CreationDate?: unknown; CommandLine?: unknown }) => {
    if (typeof r?.ProcessId !== 'number') return [];
    const d = typeof r.CreationDate === 'string' ? r.CreationDate : '';
    const ms = /\/Date\((\d+)\)\//.exec(d)?.[1];
    const dmtf = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{3})/.exec(d);
    const created = ms ? Number(ms) : dmtf ? Date.UTC(+dmtf[1], +dmtf[2] - 1, +dmtf[3], +dmtf[4], +dmtf[5], +dmtf[6], +dmtf[7]) : Date.parse(d) || undefined;
    return [{ pid: r.ProcessId, ppid: typeof r.ParentProcessId === 'number' ? r.ParentProcessId : 0, ...(created ? { created } : {}), cmd: typeof r.CommandLine === 'string' ? r.CommandLine : '' }];
  });
}

/** Parses `ps -eo pid=,ppid=,etimes=,args=` (elapsed seconds since start) at `now`. */
export function parsePsRows(out: string, now: number): ProcRow[] {
  return out.split('\n').flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), created: now - Number(m[3]) * 1000, cmd: m[4] }] : [];
  });
}

/** "bash -c until curl …" shortened for a report. */
export const shortCmd = (cmd: string) => cmd.replace(/\s+/g, ' ').trim().slice(0, 80);
