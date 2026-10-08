import * as pty from '@lydell/node-pty';

/**
 * A terminal started in this very process (node-pty), for where no host runs it (ptys.ts): the host
 * itself, an office whose host couldn't be had, AGENT_OFFICE_PTY_HOST=off. On Windows, starting one
 * holds the thread that asks for as long as CreateProcess takes (seconds, for a big binary the virus
 * scanner looks at): in the office, that's its event loop. The office's own terminals go to the host.
 */
export interface LocalSpawn {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export function spawnLocal(opts: LocalSpawn): pty.IPty {
  return releaseOnExit(pty.spawn(opts.file, opts.args, { name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env: opts.env }));
}

/**
 * On Windows, node-pty leaves a terminal's input pipe open, and its output thread running, once its
 * process has gone (it only closes the output side): one pipe and one worker thread leaked per worker
 * run, which kept a test run (and an office shutting down, and the pty host) alive for good. Let go of
 * both shortly after the exit, once any last output is in.
 */
export function releaseOnExit(p: pty.IPty): pty.IPty {
  if (process.platform !== 'win32') return p;
  p.onExit(() => {
    const t = setTimeout(() => {
      const agent = (p as unknown as { _agent?: { _inSocket?: { destroy(): void }; _conoutSocketWorker?: { dispose(): void } } })._agent;
      try {
        agent?._inSocket?.destroy();
        agent?._conoutSocketWorker?.dispose();
      } catch {
        // already let go
      }
    }, 1000);
    t.unref();
  });
  return p;
}
