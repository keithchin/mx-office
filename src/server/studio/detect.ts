// Studio mode's eyes (watch.ts polls them): which studiopro.exe processes run on the office's machine
// and with what command line, whether a floor's .mpr.lock is there, and whether Studio Pro's MCP
// server answers. All of it cheap enough to ask every few seconds: tasklist for the process ids (one
// call for every floor), PowerShell's Win32_Process for their command lines only when a new id shows
// up (a running process's command line never changes), a stat for the lock, and one HTTP request to
// localhost for the MCP server, only while a project is open. The parsing and the matching are pure,
// for the tests.

import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

/** A running studiopro.exe. */
export interface StudioProcess {
  pid: number;
  /** Its command line, as Windows has it (empty when it couldn't be read). */
  cmd: string;
}

/** What Studio mode makes of one floor. */
export interface FloorSighting {
  open: boolean;
  pid?: number;
  via?: 'process' | 'lock';
  /** The lock is there with no Studio Pro running at all. */
  staleLock: boolean;
}

/** Where Studio Pro 11.10 and up serve MCP (its log: "McpDedicatedHttpServer MCP server listening on http://localhost:7782/mcp/"). */
export const DEFAULT_STUDIO_MCP_URL = 'http://localhost:7782/mcp';

/** The MCP server's address: $AGENT_OFFICE_STUDIO_MCP_URL, or $AGENT_OFFICE_STUDIO_MCP_PORT on localhost, else port 7782. */
export function studioMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.AGENT_OFFICE_STUDIO_MCP_URL?.trim();
  if (url && /^https?:\/\/[^\s]+$/.test(url)) return url.replace(/\/+$/, '');
  const port = Number(env.AGENT_OFFICE_STUDIO_MCP_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? `http://localhost:${port}/mcp` : DEFAULT_STUDIO_MCP_URL;
}

/** The process ids in `tasklist /FO CSV /NH` output ("INFO: No tasks…" when there are none). */
export function parseTasklist(out: string): number[] {
  const pids: number[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
    if (m && /^studiopro\.exe$/i.test(m[1])) pids.push(Number(m[2]));
  }
  return pids;
}

/** The processes in `Get-CimInstance Win32_Process | Select ProcessId,CommandLine | ConvertTo-Json` output: one object, or a list. */
export function parseCimProcesses(out: string): StudioProcess[] {
  let raw: unknown;
  try {
    raw = JSON.parse(out.trim() || '[]');
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const procs: StudioProcess[] = [];
  for (const p of list as { ProcessId?: unknown; CommandLine?: unknown }[]) {
    if (!p || typeof p.ProcessId !== 'number') continue;
    procs.push({ pid: p.ProcessId, cmd: typeof p.CommandLine === 'string' ? p.CommandLine : '' });
  }
  return procs;
}

/** A path, or a command line, the way they're compared: forward slashes, one at a time, lower case, no single quotes. */
export const normPath = (p: string) => p.replace(/'/g, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();

/**
 * Whether `hay` (a command line, normalized) has `needle` in it as a whole path: what comes after it
 * ends the argument (a quote, the end, or a space unless the path has spaces of its own, when only a
 * quote or the end can tell "Shop App" from "Shop App 2"), or a trailing slash that does.
 */
function hasPath(hay: string, needle: string): boolean {
  const ends = (s: string) => s === '' || s.startsWith('"') || (!needle.includes(' ') && s.startsWith(' '));
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const rest = hay.slice(at + needle.length);
    if (ends(rest) || (rest.startsWith('/') && ends(rest.slice(1)))) return true;
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * Whether a studiopro.exe's command line names this project: the .mpr itself (the Version Selector
 * hands it the path it was given with /file:, and Studio Pro takes the path as its argument), or the
 * project's folder (Studio Pro opened on the folder). Any case, either slash, spaces and all.
 */
export function namesProject(cmd: string, mpr: string): boolean {
  const c = normPath(cmd);
  if (!c) return false;
  if (hasPath(c, normPath(mpr))) return true;
  const dir = normPath(path.win32.dirname(mpr.replace(/\//g, '\\')));
  // The folder, but only as an argument: not the folder the program itself is in.
  const args = c.replace(/^("[^"]*studiopro(\.exe)?"|\S*studiopro(\.exe)?)\s*/, '');
  return dir.length > 3 && hasPath(args, dir);
}

/** Whether a command line names any .mpr at all. */
export const namesAnyMpr = (cmd: string) => /\.mpr\b(?!\.lock)/i.test(cmd);

/**
 * The Studio Pro that holds a lock: Studio Pro writes {"SessionId":"…","ProcessId":38256} into
 * <app>.mpr.lock (seen on 10.24 and 11.x), and leaves the file behind when it closes.
 */
export function lockOwner(text: string | undefined): number | undefined {
  if (!text) return undefined;
  try {
    const pid = (JSON.parse(text) as { ProcessId?: unknown }).ProcessId;
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One floor, from the processes and its lock (`lock`: the lock file's text, undefined without one):
 * open when a studiopro.exe names its .mpr, or when the lock's owner (its ProcessId) is a running
 * studiopro.exe. A lock that names none, unreadable, counts when a studiopro.exe runs that names no
 * project (opened from Studio Pro's own start page). Any other lock is stale: its Studio Pro is gone.
 */
export function sightFloor(mpr: string, lock: string | undefined, procs: readonly StudioProcess[]): FloorSighting {
  const named = procs.find((p) => namesProject(p.cmd, mpr));
  if (named) return { open: true, pid: named.pid, via: 'process', staleLock: false };
  if (lock === undefined) return { open: false, staleLock: false };
  const owner = lockOwner(lock);
  if (owner !== undefined) return procs.some((p) => p.pid === owner) ? { open: true, pid: owner, via: 'lock', staleLock: false } : { open: false, staleLock: true };
  const loose = procs.find((p) => !namesAnyMpr(p.cmd));
  if (loose) return { open: true, pid: loose.pid, via: 'lock', staleLock: false };
  return { open: false, staleLock: procs.length === 0 };
}

/** Studio Pro's lock beside the project: <app>.mpr.lock. */
export const lockOf = (mpr: string) => `${mpr}.lock`;

/** The project's name, from its .mpr. */
export const appName = (mpr: string) => path.basename(mpr.replace(/\\/g, '/'), path.extname(mpr));

// ---------------------------------------------------------------------------------------------
// The machine

/** What detection takes from the machine; the tests stand in for it. */
export interface DetectDeps {
  platform: NodeJS.Platform;
  /** The studiopro.exe process ids. */
  pids(): Promise<number[]>;
  /** Their command lines. */
  commandLines(pids: number[]): Promise<StudioProcess[]>;
  /** Whether something answers HTTP at `url`. */
  answers(url: string): Promise<boolean>;
}

const run = (cmd: string, args: string[], timeout = 8000) =>
  new Promise<string>((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out))));

/** Any HTTP answer (a 4xx too: an MCP server wants a POST) means it's there. */
export function httpAnswers(url: string, timeout = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return resolve(false);
    }
    const req = http.get(u, { timeout, headers: { accept: 'application/json, text/event-stream' } }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

export function machineDetect(): DetectDeps {
  return {
    platform: process.platform,
    async pids() {
      if (process.platform !== 'win32') return [];
      return parseTasklist(await run('tasklist', ['/FI', 'IMAGENAME eq studiopro.exe', '/FO', 'CSV', '/NH']));
    },
    async commandLines(pids) {
      if (process.platform !== 'win32' || !pids.length) return [];
      const ps = `Get-CimInstance Win32_Process -Filter "Name='studiopro.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
      return parseCimProcesses(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 15000));
    },
    answers: (url) => httpAnswers(url),
  };
}

/**
 * The studiopro.exe processes now, with their command lines: tasklist every time, PowerShell only
 * when an id shows up that wasn't there last time. `known` is last time's, by id.
 */
export async function studioProcesses(d: DetectDeps, known: Map<number, string>): Promise<StudioProcess[]> {
  const pids = await d.pids();
  for (const pid of [...known.keys()]) if (!pids.includes(pid)) known.delete(pid);
  if (pids.some((p) => !known.has(p))) {
    const got = await d.commandLines(pids);
    // One PowerShell didn't see (it closed in between) stays unknown, and is asked about again next time.
    for (const p of got) if (pids.includes(p.pid)) known.set(p.pid, p.cmd);
  }
  return pids.map((pid) => ({ pid, cmd: known.get(pid) ?? '' }));
}
