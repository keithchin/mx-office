// 🔌 Connections › Folders › mxcli: the office's own mxcli (officeSettings().mxcliPath, the value first-run setup
// saves) can be set and cleared there, audited, and every resolver honours it the same way: officeMxcli, the
// live apps' liveAppConfig and the model reader's findMxcli all take the saved path first, so the "Needs a
// newer mxcli" reason's one setting really is the one that moves them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeConnections, officeSettings, openConnections } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { mxcliState, setOfficeMxcli } from '../src/server/connections/paths.js';
import { officeMxcli } from '../src/server/wizard/config.js';
import { liveAppConfig } from '../src/server/liveapp/config.js';
import { findMxcli } from '../src/server/model/mxcli.js';
import { MXCLI_SETTING, superuserWords } from '../src/shared/testing/test-reason.js';
import { useAudit } from '../src/server/audit/index.js';
import type { AuditInput } from '../src/shared/audit.js';

const exeName = process.platform === 'win32' ? 'mxcli.exe' : 'mxcli';

test('the mxcli row: set, shown with where it came from, audited, and cleared', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cx-mxcli-'));
  const events: AuditInput[] = [];
  useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);
  openConnections(dir, fileCipher);
  try {
    const exe = path.join(dir, exeName);
    writeFileSync(exe, '');
    assert.match(setOfficeMxcli('mxcli.exe', { name: 'Ada' })!, /full path/);
    assert.match(setOfficeMxcli(path.join(dir, 'missing', exeName), { name: 'Ada' })!, /no mxcli/);
    assert.equal(setOfficeMxcli(dir, { name: 'Ada', id: 'a1' }), undefined, 'a folder means the mxcli in it');
    assert.equal(officeSettings().mxcliPath, exe);
    const shown = mxcliState({});
    assert.equal(shown.source, 'settings');
    assert.equal(shown.problem, undefined);
    const set = events.find((e) => e.target?.id === 'mxcliPath');
    assert.ok(set, 'audited');
    assert.equal(set!.actor.name, 'Ada');
    assert.match(set!.summary, /set mxcli to/);

    // Every resolver takes the saved path first, even over the launcher's variables.
    const env = { AGENT_OFFICE_MXCLI: '/opt/env/mxcli', AGENT_OFFICE_LIVE_MXCLI: '/opt/live/mxcli' };
    assert.equal(officeMxcli(env)?.path, exe);
    assert.equal(liveAppConfig(dir, env, dir).mxcli, exe, 'the live apps run the saved mxcli');
    assert.equal(findMxcli(dir, env), exe, 'and so do the model reader and Testing');

    assert.equal(setOfficeMxcli('', { name: 'Ada' }), undefined);
    assert.equal(officeSettings().mxcliPath, undefined);
    assert.ok(events.some((e) => e.target?.id === 'mxcliPath' && /cleared/.test(e.summary)), 'clearing is audited too');
    assert.equal(liveAppConfig(dir, env, dir).mxcli, '/opt/live/mxcli', 'cleared: the launcher’s variable again');
    assert.equal(mxcliState({ AGENT_OFFICE_MXCLI: exe }).source, 'env');
  } finally {
    closeConnections();
    useAudit(undefined);
  }
});

test('the "Needs a newer mxcli" reason names the setting that exists', () => {
  assert.match(MXCLI_SETTING, /^Connections > Folders > mxcli/);
  assert.match(MXCLI_SETTING, /AGENT_OFFICE_MXCLI/);
  assert.doesNotMatch(superuserWords('v0.26.0'), /Paths/);
  assert.match(superuserWords('v0.26.0'), /Connections > Folders > mxcli/);
});
