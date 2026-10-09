// Test mode: an office someone starts to try something out must never start a real agent CLI by
// mistake (on 2026-10-06 two builders' test offices started real Claude Code sessions, because the
// office only honoured a fake --agent for Claude workers when its file was named "claude"). On with
// --test-mode or AGENT_OFFICE_TEST_MODE=1, and by itself when the office's folder, or a floor's, is
// under scratch/test-offices or a folder whose name starts with "test-office" (a plain "scratch"
// folder isn't enough). Then every worker's launch (workers/manager.ts) asks launchRefusal first: only
// the fake configured with --agent / AGENT_OFFICE_AGENT (any file name) may start, and not even that
// when it is itself a real agent CLI (--agent codex for Claude workers); anything else (claude, codex,
// opencode, grok, muse, cursor-agent, dsh, pi…) is refused with a clear message on the worker's card
// and terminal, and the incident rules hear of it (incidents/signals.ts). AGENT_OFFICE_ALLOW_REAL_AGENTS=1
// lets real ones through anyway, and that is an incident of its own. The pages show a TEST MODE badge
// (GET /api/test-mode).

import path from 'node:path';
import type { WorkerInfo } from '../shared/protocol.js';
import { PROVIDER_META } from '../shared/providers.js';
import { signal } from './incidents/signals.js';

interface State {
  flag: boolean;
  officeDir?: string;
  agentCmd: string;
  agentExplicit: boolean;
}

let state: State | undefined;

/** What the office was started with (server.ts). Before that (tests), the environment's say. */
export function useTestMode(s: State | undefined) {
  state = s;
}

const now = (): State => state ?? { flag: false, agentCmd: process.env.AGENT_OFFICE_AGENT || 'claude', agentExplicit: !!process.env.AGENT_OFFICE_AGENT };
const envOn = () => !!process.env.AGENT_OFFICE_TEST_MODE && process.env.AGENT_OFFICE_TEST_MODE !== '0';
const allowReal = () => !!process.env.AGENT_OFFICE_ALLOW_REAL_AGENTS && process.env.AGENT_OFFICE_ALLOW_REAL_AGENTS !== '0';

/** Whether `p` is in (or is) a test office's folder: scratch/test-offices, or any folder whose name starts with "test-office". */
export function isTestPath(p: string | undefined | null): boolean {
  if (!p) return false;
  return p
    .replaceAll('\\', '/')
    .split('/')
    .some((seg) => seg.toLowerCase().startsWith('test-office'));
}

/** The agent CLIs test mode never starts: every provider's own, and a few more that might be on PATH. */
export const REAL_AGENT_CLIS: ReadonlySet<string> = new Set([...Object.values(PROVIDER_META).flatMap((m) => (m.bin ? [m.bin] : [])), 'claude-code', 'gemini', 'aider', 'amp', 'copilot', 'goose', 'qwen']);

/** A command's own name, without its folder or a launcher's extension (claude.exe, codex.cmd: claude, codex). */
const nameOf = (p: string) =>
  path
    .basename(p.replaceAll('\\', '/'))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|sh|js|mjs|cjs)$/, '');

export interface TestModeView {
  on: boolean;
  why?: string;
  /** The docs screenshots' office (docsShots below): the pages leave the TEST MODE badge off. */
  docsShots?: boolean;
}

const WHERE = 'under scratch/test-offices or a test-office… folder';

/** Whether test mode is on for the office, or for the floor in `floorDir`, and why. */
export function testModeOf(floorDir?: string): TestModeView {
  const s = now();
  if (s.flag) return { on: true, why: 'started with --test-mode' };
  if (envOn()) return { on: true, why: 'AGENT_OFFICE_TEST_MODE is set' };
  if (isTestPath(s.officeDir)) return { on: true, why: `the office's folder is ${WHERE}` };
  if (isTestPath(floorDir)) return { on: true, why: `the floor's folder is ${WHERE}` };
  return { on: false };
}

/**
 * The docs screenshots' office (scripts/docs-shots.mjs): AGENT_OFFICE_DOCS_SHOTS=1 leaves the TEST MODE
 * badge off the pages, so a published screenshot doesn't carry it. Only in test mode: outside it the
 * variable is ignored, so a real office always shows what it is.
 */
export function docsShots(): boolean {
  const v = process.env.AGENT_OFFICE_DOCS_SHOTS;
  return !!v && v !== '0' && testModeOf().on;
}

/** GET /api/test-mode's answer: test mode, and whether the badge is left off for the docs screenshots. */
export function testModeAnswer(): TestModeView {
  const mode = testModeOf();
  return docsShots() ? { ...mode, docsShots: true } : mode;
}

/** An executable that's plainly a stand-in: it lives in a test office's folder, or says it's a fake. */
const looksFake = (p: string) => isTestPath(p) || /fake|mock|stub/i.test(nameOf(p));

/** Whether what would start is a real agent CLI: by the file it was found at, else by the command's name. A fake named "claude" in a test office's folder isn't one. */
export function isRealAgentCli(command: string, commandPath: string | null | undefined): boolean {
  const target = commandPath || command;
  return REAL_AGENT_CLIS.has(nameOf(target)) && !looksFake(target);
}

/**
 * Why a worker of the floor in `floorDir` mustn't start `command` (found at `commandPath`), or
 * undefined when it may. Only asked for agents, never a shell.
 */
export function launchRefusal(floorDir: string, info: WorkerInfo, command: string, commandPath: string | null | undefined): string | undefined {
  const mode = testModeOf(floorDir);
  if (!mode.on) return undefined;
  const s = now();
  // Only the explicit fake (--agent / AGENT_OFFICE_AGENT, for the workers it runs), and never a real CLI given as one.
  const override = s.agentExplicit && command === s.agentCmd;
  const real = isRealAgentCli(command, commandPath);
  if (override && !real) return undefined;
  const worker = { id: info.id, name: info.name };
  if (allowReal()) {
    signal({ kind: 'launch.real', floorDir, worker, command });
    return undefined;
  }
  const what = real ? 'is a real agent CLI' : 'is not the fake this office was started with (--agent)';
  const why = `test mode is on (${mode.why}) and ${command} ${what}${commandPath ? ` (${commandPath})` : ''}`;
  signal({ kind: 'launch.refused', floorDir, worker, command, why });
  info.activity = `⛔ Test mode: refused to start ${real ? 'the real ' : ''}${command}`;
  return `Test mode: refused to start ${real ? 'the real ' : ''}${command} — ${why}. Start this office with --agent <your fake> (or AGENT_OFFICE_AGENT; any file name works) to run a fake agent here`;
}

const told = new Set<string>();

/**
 * Whether the office's own call of an agent CLI (not a worker's: Jeff, the analyzer, the task namer, the
 * usage-limits read, The Firm's reviewers, all `claude -p`) must not run. In test mode only the explicit
 * fake may; a real CLI is refused (and said once in the log), so a test office never spends real money
 * through them either. AGENT_OFFICE_ALLOW_REAL_AGENTS=1 lets it through, as for workers.
 */
export function officeCliRefused(command: string): boolean {
  if (!testModeOf().on || allowReal()) return false;
  const s = now();
  if (s.agentExplicit && command === s.agentCmd && !isRealAgentCli(command, command)) return false;
  if (!isRealAgentCli(command, command)) return false;
  if (!told.has(command)) {
    told.add(command);
    console.warn(`agent-office: test mode: refused the office's own call of the real ${nameOf(command)} (${command})`);
  }
  return true;
}
