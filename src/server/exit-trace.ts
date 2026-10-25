// A line in the office's log on every exit it can see, so an office that ends never does so silently: a normal
// exit (its code), the event loop running dry, a signal (Ctrl+C, a restart's SIGTERM, the console window closed),
// and an uncaught exception (seen, not handled: the process still ends as it would). Written synchronously, so it
// reaches the log file even from the 'exit' handler. What it can't see: a hard kill from outside (taskkill /F,
// SIGKILL, TerminateProcess) ends the process before any of this runs, so an office.log that stops without an
// "exiting" line now means exactly that: something outside the office killed it. cli.ts installs it at start.

import { writeSync } from 'node:fs';

/** Signals that end the process unless someone listens; listening here logs, then ends it the same way. */
const ENDING: readonly NodeJS.Signals[] = process.platform === 'win32' ? ['SIGHUP', 'SIGBREAK'] : ['SIGHUP'];
const NUM: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15, SIGBREAK: 21 };

export interface ExitTraceDeps {
  /** Writes one line (the office's stderr, which its launchers send to office.log). */
  write(line: string): void;
  now(): Date;
  /** The process to listen on (tests pass a stand-in). */
  proc: Pick<NodeJS.Process, 'on' | 'pid' | 'exit' | 'listenerCount'>;
  uptime(): number;
}

const stderrLine = (line: string) => {
  try {
    writeSync(2, `${line}\n`);
  } catch {
    // stderr closed: nowhere to say it
  }
};

const defaults = (): ExitTraceDeps => ({ write: stderrLine, now: () => new Date(), proc: process, uptime: () => process.uptime() });

let installed = false;

/** Installs the exit lines (once). Returns the reason it last noted, for tests. */
export function installExitTrace(d: ExitTraceDeps = defaults()): { reason: () => string | undefined } {
  if (installed && d.proc === process) return { reason: () => undefined };
  if (d.proc === process) installed = true;
  let reason: string | undefined;
  const say = (what: string) => d.write(`agent-office: ${what} (pid ${d.proc.pid}, ${d.now().toISOString()}, up ${Math.round(d.uptime())} s)`);
  // Ctrl+C and SIGTERM have the office's own handlers (cli.ts): this only notes which one came.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) d.proc.on(sig, () => (reason ??= `signal ${sig}`));
  // These would end the process with no word: say so, then end it as the default would.
  for (const sig of ENDING) {
    d.proc.on(sig, () => {
      reason = `signal ${sig}`;
      say(`received ${sig} (the console window closed, or the session ended): exiting`);
      d.proc.exit(128 + (NUM[sig] ?? 1));
    });
  }
  d.proc.on('uncaughtExceptionMonitor', (err: Error, origin: string) => {
    reason = `${origin === 'unhandledRejection' ? 'unhandled rejection' : 'uncaught exception'}: ${(err?.stack ?? String(err)).split('\n').slice(0, 4).join(' | ')}`;
    say(`fatal ${reason}`);
  });
  d.proc.on('beforeExit', (code: number) => say(`event loop empty, exiting (code ${code})`));
  d.proc.on('exit', (code: number) => say(`exiting with code ${code}${reason ? ` after ${reason}` : ''}`));
  return { reason: () => reason };
}
