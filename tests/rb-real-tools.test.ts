// Real-build fixes: a test office that runs the real tools on purpose runs its own mx check and microflow tests
// with them (testing/mxcli-tool.ts, testmode.ts realToolsAllowed). The real-build test's office refused "only a
// fake mxcli runs here" while its agents and live app ran that very mxcli (P2-4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mxcliFor } from '../src/server/testing/mxcli-tool.js';
import { realToolsAllowed } from '../src/server/testmode.js';

const KEYS = ['AGENT_OFFICE_TEST_MODE', 'AGENT_OFFICE_TEST_ALLOW_REAL_TOOLS', 'AGENT_OFFICE_ALLOW_REAL_AGENTS'] as const;

test('test mode refuses a real-looking mxcli unless the office runs the real tools on purpose', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-real-tools-'));
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    // Not in a test office's folder, not named fake: a real one as far as the rule can tell (it never runs here).
    const bin = path.join(dir, process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
    writeFileSync(bin, '');
    const floor = path.join(dir, 'project');
    for (const k of KEYS) delete process.env[k];
    process.env.AGENT_OFFICE_TEST_MODE = '1';
    assert.equal(realToolsAllowed(), false);
    const refused = await mxcliFor(dir, floor, () => bin);
    assert.match((refused as { why: string }).why, /Test mode is on .*only a fake mxcli runs here.*AGENT_OFFICE_TEST_ALLOW_REAL_TOOLS=1/);
    // The explicit switch, or the real-agent switch: the test-mode refusal is gone (what's left is the tool's own answer).
    for (const k of ['AGENT_OFFICE_TEST_ALLOW_REAL_TOOLS', 'AGENT_OFFICE_ALLOW_REAL_AGENTS'] as const) {
      process.env[k] = '1';
      assert.equal(realToolsAllowed(), true, k);
      const r = await mxcliFor(dir, floor, () => bin);
      assert.doesNotMatch('why' in r ? r.why : '', /Test mode is on/, k);
      delete process.env[k];
    }
    // A fake mxcli still runs in test mode as before (named fake).
    const fake = path.join(dir, 'fake-mxcli.exe');
    writeFileSync(fake, '');
    const f = await mxcliFor(dir, floor, () => fake);
    assert.doesNotMatch('why' in f ? f.why : '', /Test mode is on/);
  } finally {
    for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
    rmSync(dir, { recursive: true, force: true });
  }
});
