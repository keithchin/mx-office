// One Chief Analyst planning call through the `claude` CLI the office already needs (the analyzer's way,
// analysis/llm.ts): print mode, an answer that fits a JSON schema, no settings, hooks, MCP servers or
// session, a timeout, and `--max-budget-usd` set to what the draft has left, so a call can never spend past
// the draft's cap. Attached PDFs are the one thing it reads itself: copies in a fresh temporary folder, with
// only the Read tool, confined to that folder (`--restricted`). Every answer is metered as office spend.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnOff, type OffChild } from '../../offloop/exec.js';
import { meterCliResult, spendOfCliResult } from '../../budget/meter.js';
import { officeCliRefused } from '../../testmode.js';
import { resolvedModel } from '../../usage.js';

export interface CliCall {
  model: string;
  system: string;
  input: string;
  schema: object;
  timeoutMs: number;
  /** What the call may spend at most, USD (`--max-budget-usd`). */
  budgetUsd: number;
  /** Files it may read with the Read tool (copies are made in a sandbox folder). */
  files?: { name: string; path: string }[];
}

export interface CliResult {
  value: any | null;
  /** What it cost, USD, as metered. */
  cost: number;
  error?: string;
  /** It stopped because it reached its budget. */
  budgetHit?: boolean;
}

export type CliRunner = (claude: string, env: Record<string, string>, args: string[], input: string, cwd: string, timeoutMs: number) => Promise<{ code: number | null; out: string; timedOut: boolean }>;

/** Starts the CLI off the event loop (offloop/exec.ts), as the analyzer does. */
export const spawnRunner: CliRunner = (claude, env, args, input, cwd, timeoutMs) =>
  new Promise((resolve) => {
    let out = '';
    let settled = false;
    let child: OffChild;
    const finish = (code: number | null, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    };
    try {
      child = spawnOff(claude, args, { cwd, env: { ...env, MAX_THINKING_TOKENS: '0' }, stdin: true });
    } catch {
      return resolve({ code: null, out: '', timedOut: false });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null, true);
    }, timeoutMs);
    child.on('stdout', (d: string) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code: number | null) => finish(code));
    child.write(input);
    child.end();
  });

/** How to read an attached PDF: whole, in one Read call with only its file_path. */
export const PDF_READ = 'Read each one whole with the Read tool, before you answer: one Read call per file with only its file_path, and WITHOUT the pages parameter (a page range fails on this machine). List each file you read in filesRead.';

/** The arguments of one call. */
export function cliArgs(c: CliCall, withFiles: boolean): string[] {
  return [
    '-p',
    '--model', c.model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(c.schema),
    '--system-prompt', c.system,
    '--max-budget-usd', c.budgetUsd.toFixed(2),
    ...(withFiles ? ['--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--max-turns', '12'] : ['--tools', '', '--max-turns', '2']),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
}

/** Runs one call; never throws. Refused outright in test mode (testmode.ts officeCliRefused). */
export async function runPlannerCall(claude: string, env: Record<string, string>, c: CliCall, run: CliRunner = spawnRunner): Promise<CliResult> {
  if (officeCliRefused(claude)) return { value: null, cost: 0, error: 'Test mode: the office doesn’t call the real Claude here' };
  if (c.budgetUsd < 0.01) return { value: null, cost: 0, error: 'The draft’s planning budget is used up', budgetHit: true };
  const files = c.files ?? [];
  // A fresh, empty folder per call: the only place its Read tool can look.
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'ao-planner-'));
  try {
    for (const f of files) copyFileSync(f.path, path.join(sandbox, f.name));
    // Whole, without `pages`: a page range makes the Read tool render pages with pdftoppm, which isn't on the office's machine (rehearsal 2).
    const input = files.length ? `${c.input}\n\nThe attached PDF files are in your working folder: ${files.map((f) => f.name).join(', ')}. ${PDF_READ}` : c.input;
    const r = await run(claude, env, cliArgs(c, files.length > 0), input, sandbox, c.timeoutMs);
    if (r.timedOut) return { value: null, cost: 0, error: `The Chief Analyst took longer than ${Math.round(c.timeoutMs / 1000)} s and was stopped` };
    meterCliResult(r.out || null, 'planner', resolvedModel(c.model));
    const cost = r.out ? (spendOfCliResult(r.out, resolvedModel(c.model))?.usage.cost ?? 0) : 0;
    const parsed = parseAnswer(r.out);
    if (parsed.value) return { value: parsed.value, cost };
    return { value: null, cost, error: parsed.error ?? (r.code === 0 ? 'The Chief Analyst’s answer didn’t fit the brief’s shape' : `claude exited ${r.code ?? 'abnormally'}`), budgetHit: parsed.budgetHit };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/** The structured answer of a `claude -p --output-format json` result, or why there's none. */
export function parseAnswer(out: string): { value?: any; error?: string; budgetHit?: boolean } {
  let res: any;
  try {
    res = JSON.parse(out);
  } catch {
    return { error: out.trim() ? 'The Chief Analyst’s answer couldn’t be read' : undefined };
  }
  const budgetHit = /budget/i.test(String(res?.subtype ?? '')) || /max.?budget/i.test(String(res?.result ?? ''));
  if (res?.is_error || budgetHit) return { error: budgetHit ? 'The call reached the draft’s planning budget and stopped' : String(res?.result ?? 'The Chief Analyst reported an error').slice(0, 200), budgetHit };
  try {
    const v = res?.structured_output ?? (typeof res?.result === 'string' ? JSON.parse(res.result.replace(/^```(json)?|```$/g, '')) : null);
    return v && typeof v === 'object' ? { value: v } : { error: 'The Chief Analyst sent no structured answer' };
  } catch {
    return { error: 'The Chief Analyst’s answer wasn’t JSON' };
  }
}
