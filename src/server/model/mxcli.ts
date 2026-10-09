// Running mxcli for the Model tab: which mxcli (the live app's, else the wizard's, else PATH), a few
// at a time across the office (it's a heavy process), off the event loop, and its "vibe-coded PoC"
// warning and other chatter stripped before the output is read.

import { liveAppConfig } from '../liveapp/config.js';
import { execFileOffP, type OffError } from '../offloop/exec.js';
import { wizardConfig } from '../wizard/config.js';
import { resolveCommand } from '../workers/process.js';

/** Runs at most `n` tasks at once; the rest wait their turn, first come first served. */
export class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly n: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  get busy(): number {
    return this.active;
  }
  get queued(): number {
    return this.waiting.length;
  }
}

/** The mxcli to run, or null when there is none on this machine. */
export function findMxcli(dataDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.AGENT_OFFICE_LIVE_MXCLI, liveAppConfig(dataDir, env).mxcli, wizardConfig(env).mxcli, 'mxcli'];
  for (const c of candidates) {
    if (!c) continue;
    const found = resolveCommand(c);
    if (found) return found;
  }
  return null;
}

const NOISE = /^(WARNING: This is a vibe-coded PoC.*|Connected to: .*|Disconnected\.?)$/;

/** mxcli's output without its warning banner and connection chatter. */
export function stripNoise(out: string): string {
  return out
    .split(/\r?\n/)
    .filter((l) => !NOISE.test(l.trim()))
    .join('\n')
    .trim();
}

/** The JSON in mxcli's output (from its first `{` or `[`), or throws with what it said instead. */
export function parseJsonOut<T>(out: string): T {
  const s = stripNoise(out);
  const i = s.search(/[[{]/);
  if (i < 0) throw new Error(s.split('\n').slice(-3).join(' ') || 'mxcli printed nothing');
  return JSON.parse(s.slice(i)) as T;
}

export type MxRun = (args: string[], opts: { cwd: string; timeout?: number }) => Promise<string>;

/** A runner for `bin` that keeps to `limiter`. Rejects with mxcli's own last words. */
export function mxRunner(bin: string, limiter: Limiter): MxRun {
  return (args, { cwd, timeout = 90_000 }) =>
    limiter.run(async () => {
      try {
        const { stdout } = await execFileOffP(bin, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
        return stdout;
      } catch (err) {
        const e = err as OffError;
        const said = stripNoise(`${e.stderr ?? ''}\n${e.stdout ?? ''}`).split('\n').filter(Boolean).slice(-2).join(' ');
        throw new Error(said || e.message);
      }
    });
}
