// How a reviewer runs: Claude Code headless (`claude -p`, stream-json), one process per turn in the
// reviewer's own folder, carrying its session on with --resume. No PTY, no desk, no office hooks: a
// reviewer isn't one of the floor's workers. Each turn's stream says what it costs as it goes
// (priced per message from the office's price table, then snapped to Claude Code's own total at the
// end), which is what the engagement's budget is held to. The tests use a fake runner instead.

import { spawn, type ChildProcess } from 'node:child_process';
import { usageOfMessage } from '../usage.js';
import { officeCliRefused } from '../testmode.js';

export interface RunSpec {
  cwd: string;
  env: Record<string, string>;
  model: string;
  prompt: string;
  sessionId?: string;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RunEvents {
  session(id: string): void;
  /** More spend: USD (may be negative when the end-of-turn total corrects the estimate) and tokens. */
  usage(usd: number, tokens: Tokens): void;
  /** A line of what it's doing, for the live view. */
  activity(text: string): void;
  exit(code: number | null, error?: string): void;
}

export interface RunHandle {
  stop(): void;
}

export interface ReviewerRunner {
  start(spec: RunSpec, events: RunEvents): RunHandle;
}

/** The tools a reviewer has: reading, its tests and tools through Bash, and writing in its folder. Never the web. */
export const REVIEWER_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'Bash', 'Write', 'Edit', 'TodoWrite', 'Task'];

/** The command line of one turn (the prompt goes in on stdin, so it's never parsed as an option). */
export function claudeArgs(spec: Pick<RunSpec, 'model' | 'sessionId'>): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', spec.model,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', REVIEWER_TOOLS.join(','),
    '--disallowedTools', 'WebFetch,WebSearch',
    // No MCP servers at all: not the user's (a GitHub one could write), not the office's.
    '--strict-mcp-config',
    ...(spec.sessionId ? ['--resume', spec.sessionId] : []),
  ];
}

/** Reads one stream-json line into events; `seen` keeps the per-turn tally between lines. */
export function readStreamLine(line: string, seen: { ids: Set<string>; usd: number }, ev: RunEvents) {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof m?.session_id === 'string' && (m.type === 'system' || m.type === 'result')) ev.session(m.session_id);
  if (m?.type === 'assistant' && m.message) {
    const id = String(m.message.id ?? '');
    if (id && seen.ids.has(id)) return;
    if (id) seen.ids.add(id);
    const u = usageOfMessage(String(m.message.model ?? ''), m.message.usage);
    seen.usd += u.cost;
    ev.usage(u.cost, { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite });
    for (const c of Array.isArray(m.message.content) ? m.message.content : []) {
      if (c?.type === 'tool_use') ev.activity(`🔧 ${c.name}${c.input?.command ? `: ${String(c.input.command).slice(0, 120)}` : c.input?.file_path ? `: ${String(c.input.file_path).split(/[\\/]/).slice(-2).join('/')}` : ''}`);
      else if (c?.type === 'text' && c.text?.trim()) ev.activity(`💬 ${String(c.text).trim().split('\n')[0].slice(0, 160)}`);
    }
  }
  if (m?.type === 'result' && typeof m.total_cost_usd === 'number') {
    const fix = m.total_cost_usd - seen.usd;
    if (Math.abs(fix) > 1e-6) ev.usage(fix, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    seen.usd = m.total_cost_usd;
  }
}

/** The real runner: `claude` (the office's own Claude Code) for each turn. */
export class ClaudeHeadlessRunner implements ReviewerRunner {
  constructor(private claude: string | null) {}

  start(spec: RunSpec, ev: RunEvents): RunHandle {
    if (!this.claude || officeCliRefused(this.claude)) {
      queueMicrotask(() => ev.exit(1, this.claude ? 'Test mode: the office does not run the real Claude Code for reviewers' : "Claude Code isn't installed where the office can find it"));
      return { stop() {} };
    }
    let child: ChildProcess;
    const win = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.claude);
    try {
      child = spawn(this.claude, claudeArgs(spec), { cwd: spec.cwd, env: spec.env, windowsHide: true, shell: win, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      queueMicrotask(() => ev.exit(1, (err as Error).message));
      return { stop() {} };
    }
    const seen = { ids: new Set<string>(), usd: 0 };
    let buf = '';
    let err = '';
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) readStreamLine(line, seen, ev);
      }
    });
    child.stderr?.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-2000)));
    child.on('error', (e) => (err = e.message));
    child.on('close', (code) => {
      if (buf.trim()) readStreamLine(buf.trim(), seen, ev);
      ev.exit(code, code ? err.trim().split('\n').slice(-2).join(' ') || `claude exited with ${code}` : undefined);
    });
    child.stdin?.end(spec.prompt);
    return {
      stop() {
        try {
          if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          else child.kill();
        } catch {
          // already gone
        }
      },
    };
  }
}
