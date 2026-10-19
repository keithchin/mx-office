// How a start of an office-run app instance (./index.ts) is followed: which phase mxcli is in from what it
// prints, how long each took, which failures are worth exactly one more try, and what a failure says (the
// phase, why, and what to do). Pure but for the one `mxcli run --help` a flag probe asks (cached).
//
// Two failures are transient and get one more try, never more:
//   * the runtime couldn't bind its port ("Runtime port '8110' is already in use", after which the runtime
//     only says "No Runtime Jetty server available. Please call update_appcontainer_configuration"): the
//     office picks its ports minutes before the runtime binds them, and something else on the machine took
//     one in between; the next try gets other ports;
//   * mxcli's web client bundle ran past its limit ("web client build timed out after 5m0s"): a cold bundle
//     on a busy machine; the next try is warm (the same workspace) and takes seconds.

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { BOOT_PHASE_TITLE, durationWords, goDurationMs, type BootPhase, type BootTiming } from '../../shared/app-instance.js';

/** What mxcli's web client bundle may take when this mxcli can be told (`--web-client-timeout`). */
export const WEB_CLIENT_TIMEOUT = '15m';
export const WEB_CLIENT_TIMEOUT_MS = 15 * 60_000;
/** mxcli's own limit when it can't be told (its default). */
export const MXCLI_BUNDLE_LIMIT_MS = 5 * 60_000;

/** The phase a line of `mxcli run --local` starts, if it starts one. */
export function phaseOfLine(line: string): BootPhase | undefined {
  const l = line.trim();
  if (/^Ensuring database/i.test(l)) return 'database';
  if (/^Starting mxbuild --serve|^Building\b/i.test(l)) return 'building';
  if (/^Bundling web client/i.test(l)) return 'bundling';
  if (/^Web client bundled in|^Starting (the )?runtime|bundles the client itself|skipping the (web client )?bundle/i.test(l)) return 'runtime';
  return undefined;
}

/** What mxcli says the bundle took ("  Web client bundled in 1m38.933s"), in ms. */
export function bundledMsOf(line: string): number | undefined {
  const m = /Web client bundled in\s+(\S+)/i.exec(line);
  return m ? goDurationMs(m[1]) : undefined;
}

export type Transient = { kind: 'port'; words: string; port?: number } | { kind: 'bundle'; words: string };

/** A line that says the start failed for a reason one more try can clear. */
export function transientOfLine(line: string): Transient | undefined {
  const port = /Runtime port '(\d+)' is already in use/i.exec(line);
  if (port) return { kind: 'port', port: Number(port[1]), words: `port ${port[1]} was taken by something else on this machine when the runtime started` };
  if (/No Runtime Jetty server available/i.test(line)) return { kind: 'port', words: 'the runtime couldn’t open its web server (No Runtime Jetty server available)' };
  const t = /web client build timed out after (\S+)/i.exec(line);
  if (t) return { kind: 'bundle', words: `bundling the web client timed out after ${t[1]}` };
  return undefined;
}

/** Follows the phases of one start. */
export class BootClock {
  phase: BootPhase;
  phaseAt: number;
  readonly at: number;
  readonly phases: Partial<Record<BootPhase, number>> = {};
  bundleMs?: number;
  constructor(
    first: BootPhase,
    private now: () => number = Date.now,
    private onPhase?: (p: BootPhase, at: number) => void,
  ) {
    this.at = now();
    this.phase = first;
    this.phaseAt = this.at;
    onPhase?.(first, this.at);
  }

  /** Moves to `p`; false when it's there already. */
  enter(p: BootPhase): boolean {
    if (p === this.phase) return false;
    const t = this.now();
    this.phases[this.phase] = (this.phases[this.phase] ?? 0) + (t - this.phaseAt);
    this.phase = p;
    this.phaseAt = t;
    this.onPhase?.(p, t);
    return true;
  }

  /** A line of mxcli's output: the phase it starts, and the bundle time it says. */
  line(l: string): void {
    const ms = bundledMsOf(l);
    if (ms !== undefined) this.bundleMs = ms;
    const p = phaseOfLine(l);
    if (p) this.enter(p);
  }

  elapsed(): number {
    return this.now() - this.at;
  }

  phaseElapsed(): number {
    return this.now() - this.phaseAt;
  }

  /** The timing so far (the phase running now counted up to now). */
  timing(extra: Pick<BootTiming, 'workspace' | 'retried'> = {}): BootTiming {
    const phases = { ...this.phases, [this.phase]: (this.phases[this.phase] ?? 0) + this.phaseElapsed() };
    return { ms: this.elapsed(), phases, ...(this.bundleMs !== undefined ? { bundleMs: this.bundleMs } : {}), ...extra };
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What to do after a failure of `kind`. */
function hint(kind: 'port' | 'bundle' | 'timeout' | 'other', logFile: string): string {
  switch (kind) {
    case 'bundle':
      return 'The machine was too busy to bundle the web client in time (often another app building at the same moment): record again; the next start reuses the warm workspace and is much faster.';
    case 'port':
      return 'Something else on this machine holds the app’s ports: record again (the office picks other ports), or stop what holds them.';
    case 'timeout':
      return `Record again once the machine is less busy; the instance log (${logFile}) shows where it stopped.`;
    default:
      return `The instance log (${logFile}) has mxcli’s whole output; a build error needs fixing in the project.`;
  }
}

/** A failed start in plain words: the phase, after how long, why, and what to do. */
export function bootFailure(phase: BootPhase, phaseMs: number, why: string, logFile: string, kind: 'port' | 'bundle' | 'timeout' | 'other', retried?: string): string {
  const again = retried ? ` It had failed once before (${retried}) and was tried again.` : '';
  return `${lower(BOOT_PHASE_TITLE[phase])} failed after ${durationWords(phaseMs)}: ${why}.${again} ${hint(kind, logFile)}`;
}

const flagCache = new Map<string, { mtime: number; ok: boolean }>();

/** Whether this mxcli takes `--web-client-timeout` (mxcli.org: `mxcli run`; older builds have a fixed 5 min). */
export function supportsWebClientTimeout(mxcli: string, timeoutMs = 20_000): Promise<boolean> {
  let mtime = 0;
  try {
    mtime = statSync(mxcli).mtimeMs;
  } catch {
    // A name on PATH: asked every time (once a start).
  }
  const had = flagCache.get(mxcli);
  if (had && mtime && had.mtime === mtime) return Promise.resolve(had.ok);
  return new Promise((resolve) => {
    execFile(mxcli, ['run', '--help'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (_err, stdout, stderr) => {
      const ok = /--web-client-timeout\b/.test(`${stdout ?? ''}${stderr ?? ''}`);
      if (mtime) flagCache.set(mxcli, { mtime, ok });
      resolve(ok);
    });
  });
}
