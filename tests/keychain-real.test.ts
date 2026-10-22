// The macOS Keychain store against the real /usr/bin/security: only on a Mac, and only when asked
// (MX_OFFICE_REAL_KEYCHAIN=1, as the macOS CI job does), because it writes items to the login Keychain.
// It uses a service of its own (com.mxoffice.connections.selftest), never the office's, and deletes
// what it made. Everywhere else it's skipped: tests/keychain.test.ts covers the same code with a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keychainAvailable, keychainCipher } from '../src/server/connections/keychain.js';
import { Vault, fileCipher } from '../src/server/connections/vault.js';

const SERVICE = 'com.mxoffice.connections.selftest';
const on = process.platform === 'darwin' && process.env.MX_OFFICE_REAL_KEYCHAIN === '1' && keychainAvailable();

test('the real login Keychain: save, read back after a restart, replace, remove (a selftest service, cleaned up)', { skip: !on && 'only on a Mac with MX_OFFICE_REAL_KEYCHAIN=1' }, async (t) => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'kc-real-')), 'credentials.json');
  const cipher = () => keychainCipher({ service: SERVICE, fallback: fileCipher });
  const v = new Vault(file, cipher()).load();
  const account = v.keyOf('github-agents');
  t.after(() => {
    try {
      execFileSync('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' });
    } catch {
      // gone already
    }
  });
  const value = `selftest-${Date.now()}-é-✓`;
  await v.set('github-agents', value, 'CI');
  assert.equal(v.entry('github-agents')?.scheme, 'keychain', 'the Keychain took it (not the fallback file)');
  assert.equal(new Vault(file, cipher()).load().get('github-agents'), value, 'read back exactly, non-ASCII too');
  await v.set('github-agents', `${value}-2`, 'CI');
  assert.equal(new Vault(file, cipher()).load().get('github-agents'), `${value}-2`);
  // Nothing of it in a process's command line: the add went through security -i (keychain.ts); here, the item really exists.
  execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' });
  v.remove('github-agents');
  let gone = false;
  for (let i = 0; i < 50 && !gone; i++) {
    try {
      execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      gone = true;
    }
  }
  assert.ok(gone, 'removing the credential deleted its Keychain item');
});
