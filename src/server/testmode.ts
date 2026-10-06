// Test mode: an office someone starts to try something out must never start a real agent CLI by
// mistake (on 2026-10-06 two builders' test offices started real Claude Code sessions, because the
// office only honoured a fake --agent for Claude workers when its file was named "claude"). On with
// --test-mode or AGENT_OFFICE_TEST_MODE=1, and by itself when the office's folder, or a floor's, is
// under a folder named "scratch" or "test-offices". Then every worker's launch (workers/manager.ts)
// asks launchRefusal first: only the fake configured with --agent / AGENT_OFFICE_AGENT (any file name),
// or an executable that itself lives under a scratch or test folder, may start; anything else (claude,
// codex, opencode…) is refused with a clear message on the worker's card and terminal, and the
// incident rules hear of it (incidents/signals.ts). AGENT_OFFICE_ALLOW_REAL_AGENTS=1 lets real ones
// through anyway, and that is an incident of its own. The pages show a TEST MODE badge (GET /api/test-mode).

import path from 'node:path';
import type { WorkerInfo } from '../shared/protocol.js';
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

const TEST_DIRS = new Set(['scratch', 'test-offices']);

/** Whether `p` is in (or is) a folder named scratch or test-offices. */
export function isTestPath(p: string | undefined | null): boolean {
  if (!p) return false;
  return p
    .replaceAll('\\', '/')
    .split('/')
    .some((seg) => TEST_DIRS.has(seg.toLowerCase()));
}

export interface TestModeView {
  on: boolean;
  why?: string;
}

/** Whether test mode is on for the office, or for the floor in `floorDir`, and why. */
export function testModeOf(floorDir?: string): TestModeView {
  const s = now();
  if (s.flag) return { on: true, why: 'started with --test-mode' };
  if (envOn()) return { on: true, why: 'AGENT_OFFICE_TEST_MODE is set' };
  if (isTestPath(s.officeDir)) return { on: true, why: `the office's folder is under a scratch or test-offices folder` };
  if (isTestPath(floorDir)) return { on: true, why: `the floor's folder is under a scratch or test-offices folder` };
  return { on: false };
}

/** An executable that's plainly a stand-in: it lives under a scratch or test folder, or says it's a fake. */
const looksFake = (p: string | undefined | null) => !!p && (isTestPath(p) || /fake|mock|stub/i.test(path.basename(p)));

/**
 * Why a worker of the floor in `floorDir` mustn't start `command` (found at `commandPath`), or
 * undefined when it may. Only asked for agents, never a shell.
 */
export function launchRefusal(floorDir: string, info: WorkerInfo, command: string, commandPath: string | null | undefined): string | undefined {
  const mode = testModeOf(floorDir);
  if (!mode.on) return undefined;
  const s = now();
  const override = s.agentExplicit && command === s.agentCmd;
  if (override || looksFake(commandPath) || looksFake(command)) return undefined;
  const worker = { id: info.id, name: info.name };
  if (allowReal()) {
    signal({ kind: 'launch.real', floorDir, worker, command });
    return undefined;
  }
  const why = `test mode is on (${mode.why}) and ${command} is a real agent CLI${commandPath ? ` (${commandPath})` : ''}`;
  signal({ kind: 'launch.refused', floorDir, worker, command, why });
  info.activity = `⛔ Test mode: refused to start the real ${command}`;
  return `Test mode: refused to start the real ${command} — ${why}. Start this office with --agent <your fake> (or AGENT_OFFICE_AGENT; any file name works) to run a fake agent here`;
}
