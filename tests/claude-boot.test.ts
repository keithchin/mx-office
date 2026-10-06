// Claude workers that ask a person for nothing: a slow start (a project's long SessionStart hook) is
// not a setup prompt, the setup prompt's line goes once the session is up, and a model Claude Code's
// auto mode isn't offered for (Haiku) starts in "accept edits" mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { ACCEPT_EDITS_HINT, PROVIDER_META, claudePermissionMode } from '../src/shared/providers.js';
import { claude, claudeBlocked, permissionModeFor } from '../src/server/providers/claude.js';
import { codex } from '../src/server/providers/codex.js';
import { custom } from '../src/server/providers/custom.js';
import { BOOT_SILENT_MS, BOOT_SLOW_MS, bootSilence, watchBoot } from '../src/server/workers/lifecycle.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

const SETUP = 'Waiting on a setup prompt (trust / login) — open the terminal';

function info(status: WorkerStatus, activity?: string): WorkerInfo {
  return { id: 'w1', kind: 'agent', provider: 'claude', name: 'Widget', status, activity, viewers: [], viewerIds: [], createdAt: 0 } as unknown as WorkerInfo;
}

/** A worker's handle as the Claude adapter sees it, its status changes kept. */
function handle(i: WorkerInfo, bootBlocked = false) {
  const statuses: WorkerStatus[] = [];
  const h = {
    info: i,
    state: undefined,
    running: true,
    bootBlocked,
    leftNeedsInputAt: 0,
    failStreak: 0,
    tracker: { transcript: undefined },
    setStatus: (s: WorkerStatus) => {
      i.status = s;
      statuses.push(s);
    },
    emit: () => {},
    persist: () => {},
    notePrompt: () => {},
    noteTool: () => {},
    notePr: () => {},
    clearTask: () => {},
    scheduleScan: () => {},
    prompt: () => undefined,
  } as unknown as WorkerHandle;
  return { h, statuses };
}

/** Runs watchBoot with its timer caught, and fires it. */
function boot(adapter: Parameters<typeof watchBoot>[2], status: WorkerStatus = 'starting') {
  const proc = {};
  const w = { info: info(status), pty: proc as never, bootBlocked: false };
  const set: WorkerStatus[] = [];
  let ms = 0;
  let fire = () => {};
  watchBoot(w, proc, adapter, (s) => (w.info.status = s, set.push(s)), (fn, after) => ((fire = fn), (ms = after)));
  fire();
  return { w, set, ms };
}

test('a slow SessionStart is not a setup prompt: a Claude worker stays starting, then goes idle, never needs input', () => {
  assert.deepEqual(bootSilence(claude), { after: BOOT_SLOW_MS, status: 'idle' });
  const { w, set, ms } = boot(claude);
  assert.equal(ms, BOOT_SLOW_MS);
  assert.ok(ms > 60_000, 'a SessionStart hook that syncs tools for a minute is still fine');
  assert.deepEqual(set, ['idle']);
  assert.equal(w.bootBlocked, false);
  assert.equal(w.info.activity, undefined);
  // Its session came up in time: the timer has nothing to do.
  assert.deepEqual(boot(claude, 'idle').set, []);
});

test('a provider that can only go by silence still flags it after 12 s; one with no hooks is idle', () => {
  const { w, set, ms } = boot(codex);
  assert.equal(ms, BOOT_SILENT_MS);
  assert.deepEqual(set, ['needs_input']);
  assert.equal(w.bootBlocked, true);
  assert.equal(w.info.activity, codex.bootHint);
  assert.deepEqual(boot(custom).set, ['idle']);
});

test('a real trust prompt on the screen needs input; the same words after it started do not', () => {
  const trust = ' Do you trust the files in this folder?\n\n ❯ 1. Yes, proceed\n   2. No, exit';
  assert.equal(claudeBlocked(trust, true), SETUP);
  assert.equal(claudeBlocked(trust, false), undefined);
  assert.equal(claudeBlocked('SessionStart:startup hook running… mxcli init --sync-skills', true), undefined);
  assert.match(claudeBlocked('Not logged in · Run /login', false) ?? '', /isn't signed in/);
});

test("SessionStart clears the setup prompt's line and flag, whatever the worker's status", () => {
  // Stuck on a prompt and flagged, then the session started: idle, nothing left on its desk.
  const a = handle(info('needs_input', SETUP), true);
  claude.hook!.handle(a.h, 'SessionStart', { session_id: 's1', source: 'startup' });
  assert.equal(a.h.bootBlocked, false);
  assert.equal(a.h.info.activity, undefined);
  assert.deepEqual(a.statuses, ['idle']);
  // Idle already, with the line left over from an older office: the line goes.
  const b = handle(info('idle', SETUP));
  claude.hook!.handle(b.h, 'SessionStart', { session_id: 's1', source: 'resume' });
  assert.equal(b.h.info.activity, undefined);
  assert.deepEqual(b.statuses, []);
  // Still starting (a slow hook): idle once it's up.
  const c = handle(info('starting'));
  claude.hook!.handle(c.h, 'SessionStart', { session_id: 's1' });
  assert.deepEqual(c.statuses, ['idle']);
  // Asking a real question isn't a setup prompt: SessionStart leaves it be.
  const d = handle(info('needs_input', 'Wants permission: Write'));
  claude.hook!.handle(d.h, 'SessionStart', { session_id: 's1', source: 'compact' });
  assert.deepEqual(d.statuses, []);
  assert.equal(d.h.info.activity, 'Wants permission: Write');
});

test('any later hook shows the session is alive: the flag and the line go', () => {
  const a = handle(info('done', SETUP), true);
  claude.hook!.handle(a.h, 'Stop', { last_assistant_message: 'Done.' });
  assert.equal(a.h.bootBlocked, false);
  assert.equal(a.h.info.activity, undefined);
  const b = handle(info('needs_input', SETUP), true);
  claude.hook!.handle(b.h, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } });
  assert.equal(b.h.bootBlocked, false);
  assert.equal(b.h.info.activity, 'Read: a.ts');
  assert.deepEqual(b.statuses, ['working']);
});

/** The command line the Claude adapter builds for a worker. */
function launch(model: string | undefined, args: string[] = [], prompt?: string) {
  const i = info('starting');
  i.model = model;
  return claude.launch({ h: handle(i).h as never, args, prompt, setup: { settings: 'hooks.json' } } as never).args;
}

test('Haiku starts in accept edits mode; the others are left to their settings', () => {
  assert.equal(claudePermissionMode('haiku'), 'acceptEdits');
  assert.equal(claudePermissionMode('claude-haiku-4-5-20251001'), 'acceptEdits');
  for (const m of ['opus', 'sonnet', 'fable', 'claude-opus-5-5', undefined]) assert.equal(claudePermissionMode(m), undefined, m);
  assert.deepEqual(launch('haiku', [], '- fix login'), ['--settings', 'hooks.json', '--model', 'haiku', '--permission-mode', 'acceptEdits', '--', '- fix login']);
  assert.deepEqual(launch('sonnet'), ['--settings', 'hooks.json', '--model', 'sonnet']);
  assert.deepEqual(launch(undefined), ['--settings', 'hooks.json']);
});

test("the office's --agent-args decide: their model when none is picked, and their own permission mode stands", () => {
  assert.equal(permissionModeFor(['--model', 'haiku'], undefined), 'acceptEdits');
  assert.equal(permissionModeFor(['--model=claude-haiku-4-5'], undefined), 'acceptEdits');
  // A model picked for the worker comes after --agent-args on the command line, and wins.
  assert.equal(permissionModeFor(['--model', 'haiku', '--model', 'opus'], undefined), undefined);
  assert.deepEqual(launch('opus', ['--model', 'haiku']), ['--settings', 'hooks.json', '--model', 'haiku', '--model', 'opus']);
  for (const mode of [['--permission-mode', 'default'], ['--permission-mode=plan'], ['--dangerously-skip-permissions']]) {
    assert.equal(permissionModeFor([...mode, '--model', 'haiku'], 'haiku'), undefined, mode.join(' '));
    assert.ok(!launch('haiku', [...mode]).includes('acceptEdits'));
  }
});

test('the hire dialog says Haiku runs in accept edits mode', () => {
  const field = PROVIDER_META.claude.models!;
  assert.equal(field.modelHint?.('haiku'), ACCEPT_EDITS_HINT);
  assert.match(ACCEPT_EDITS_HINT, /accept edits/);
  assert.equal(field.modelHint?.('opus'), undefined);
});
