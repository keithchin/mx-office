// Processes an agent's app instance left behind (the real rebuild test: a stale Mendix rollup-runner from an
// agent's failed `mxcli run --local` held `deployment/web` in a worktree for a day, and every mxbuild gate
// failed until a person found and killed it). The instance's tree is ended by its pid (app-instance stop());
// after that, and at the office's start for instances a crashed office left, anything whose command line names
// the instance's workspace folder is ended too. A folder counts only as a whole path (studio/detect.ts
// normPath + hasPath: the folder itself, or something under it with a slash after the folder's name), so
// "instance-ag1" never matches "instance-ag12". Off the event loop; never throws.

import { execFileOffP } from '../offloop/exec.js';
import { killTreeNow } from '../liveapp/process.js';
import { hasPath, normPath } from '../studio/detect.js';

export interface Proc {
  pid: number;
  cmd: string;
}

/** Whether a command line names `dir` as a whole path, or a path under it. */
export function namesDir(cmd: string, dir: string): boolean {
  const c = normPath(cmd);
  const d = normPath(dir).replace(/\/+$/, '');
  if (!c || d.length < 4) return false;
  return hasPath(c, d) || c.includes(`${d}/`);
}

/** The machine's processes with their command lines (Windows: Win32_Process; elsewhere ps). */
export async function listProcesses(): Promise<Proc[]> {
  try {
    if (process.platform === 'win32') {
      const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
      const { stdout } = await execFileOffP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      const raw = JSON.parse(stdout.trim() || '[]') as unknown;
      return (Array.isArray(raw) ? raw : [raw]).flatMap((p: { ProcessId?: unknown; CommandLine?: unknown }) => (typeof p?.ProcessId === 'number' && typeof p.CommandLine === 'string' ? [{ pid: p.ProcessId, cmd: p.CommandLine }] : []));
    }
    const { stdout } = await execFileOffP('ps', ['-eo', 'pid=,args='], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout.split('\n').flatMap((l) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(l);
      return m ? [{ pid: Number(m[1]), cmd: m[2] }] : [];
    });
  } catch {
    return [];
  }
}

export interface LeftoverDeps {
  list?: () => Promise<Proc[]>;
  kill?: (pid: number) => void;
}

/** Ends every process (and its tree) whose command line names one of `dirs`; the ones it ended. */
export async function killLeftovers(dirs: readonly string[], d: LeftoverDeps = {}): Promise<Proc[]> {
  if (!dirs.length) return [];
  const procs = await (d.list ?? listProcesses)();
  const hits = procs.filter((p) => p.pid !== process.pid && dirs.some((dir) => namesDir(p.cmd, dir)));
  for (const p of hits) (d.kill ?? killTreeNow)(p.pid);
  return hits;
}
