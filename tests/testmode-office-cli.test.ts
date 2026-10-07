// Test mode covers the office's own `claude -p` calls too (found by the performance guard's fixture work,
// 2026-10-07): Jeff, the analyzer, the task namer, the usage-limits read and The Firm's reviewers ran
// the real Claude Code in a test office, since test mode only checked worker launches. Each now asks
// officeCliRefused first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { officeCliRefused, useTestMode } from '../src/server/testmode.js';

test('in test mode the office never runs a real agent CLI for itself, only the explicit fake', () => {
  useTestMode({ flag: true, agentCmd: 'C:\\t\\fakebin\\fake-claude.cmd', agentExplicit: true });
  try {
    assert.equal(officeCliRefused('C:\\Users\\me\\.local\\bin\\claude.exe'), true);
    assert.equal(officeCliRefused('/usr/local/bin/claude'), true);
    assert.equal(officeCliRefused('C:\\t\\fakebin\\fake-claude.cmd'), false, 'the fake it was started with');
    assert.equal(officeCliRefused('C:\\tools\\something-else.exe'), false, 'not an agent CLI at all');
  } finally {
    useTestMode(undefined);
  }
});

test('outside test mode nothing changes', () => {
  useTestMode({ flag: false, officeDir: 'C:\\Users\\me\\agent-office', agentCmd: 'claude', agentExplicit: false });
  try {
    assert.equal(officeCliRefused('C:\\Users\\me\\.local\\bin\\claude.exe'), false);
  } finally {
    useTestMode(undefined);
  }
});

test("every place the office runs claude -p for itself asks first", () => {
  for (const f of ['analysis/llm.ts', 'tasks.ts', 'limits.ts', 'firm/runner.ts']) {
    const src = readFileSync(new URL(`../src/server/${f}`, import.meta.url), 'utf8');
    const ask = src.indexOf('officeCliRefused(');
    const spawn = src.indexOf('spawn(', src.indexOf('officeCliRefused') + 1);
    assert.ok(ask > 0 && spawn > ask, `${f} asks officeCliRefused before it spawns`);
  }
});
