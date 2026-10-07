// The analyzer's one cheap model call: Claude Haiku through the `claude` CLI the office already needs,
// asked for JSON that fits a schema, the same way the task namer asks (tasks.ts). Calls go one at a
// time, a few failures in a row pause it for a while, and there's a cap per hour, so a bug elsewhere
// can never turn it into a loop that spends money. Everything that uses it has a fallback without it.

import { spawn } from 'node:child_process';
import os from 'node:os';
import { meterCliResult } from '../budget/meter.js';
import { officeCliRefused } from '../testmode.js';

const TIMEOUT_MS = 60_000;
const FAILS_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 10 * 60_000;
/** The most calls in any hour, whatever asks for them. */
const MAX_PER_HOUR = 40;

export class Haiku {
  private chain: Promise<unknown> = Promise.resolve();
  private fails = 0;
  private pausedUntil = 0;
  private recent: number[] = [];

  /** @param claude the `claude` binary, or null for no model at all (the callers' fallbacks only). */
  constructor(
    private claude: string | null,
    private env: Record<string, string>,
  ) {}

  get enabled(): boolean {
    return this.claude !== null && Date.now() >= this.pausedUntil;
  }

  /** The model's answer as an object, or null when there's no model, it failed, or the cap is reached. */
  ask(system: string, input: string, schema: object): Promise<any | null> {
    const next = this.chain.then(() => this.once(system, input, schema));
    this.chain = next.catch(() => null);
    return next;
  }

  private async once(system: string, input: string, schema: object): Promise<any | null> {
    if (!this.enabled) return null;
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 3_600_000);
    if (this.recent.length >= MAX_PER_HOUR) return null;
    this.recent.push(now);
    const out = await run(this.claude!, this.env, system, input, JSON.stringify(schema));
    // Priced and booked on the floor it served (budget/meter.ts): the analyzer's, Jeff's or the summary's.
    meterCliResult(out, 'analyzer');
    const v = out === null ? null : parse(out);
    if (v) this.fails = 0;
    else if (++this.fails >= FAILS_BEFORE_BACKOFF) {
      this.fails = 0;
      this.pausedUntil = Date.now() + BACKOFF_MS;
    }
    return v;
  }
}

function run(claude: string, env: Record<string, string>, system: string, input: string, schema: string): Promise<string | null> {
  if (officeCliRefused(claude)) return Promise.resolve(null);
  const args = [
    '-p',
    '--model', 'haiku',
    '--output-format', 'json',
    '--json-schema', schema,
    '--system-prompt', system,
    '--tools', '',
    // Not the user's or the project's settings: no hooks, no MCP servers, no plugins, no transcript.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child;
    try {
      // A neutral directory, so it doesn't pick up a project's CLAUDE.md.
      child = spawn(claude, args, { cwd: os.tmpdir(), env: { ...env, MAX_THINKING_TOKENS: '0' }, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out : null));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function parse(out: string): any | null {
  try {
    const res = JSON.parse(out);
    if (res?.is_error) return null;
    const v = res?.structured_output ?? (typeof res?.result === 'string' ? JSON.parse(res.result.replace(/^```(json)?|```$/g, '')) : null);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
