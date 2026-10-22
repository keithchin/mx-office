// 🔌 Connections on macOS (server/connections/keychain.ts, vault.ts): each saved value is an item in the
// login Keychain, made and read through /usr/bin/security, here a fake (tests/support/fake-security.mjs,
// run with this Node) that keeps its items in a JSON file and records every command line. Every value is
// a made-up stand-in. Runs on every platform: nothing here needs a Mac.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_SERVICE, addLine, keychainAvailable, keychainCipher, safeAccount } from '../src/server/connections/keychain.js';
import { Vault, defaultCipher, fileCipher } from '../src/server/connections/vault.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'fake-security.mjs');
const SECRET = `github_pat_${'K3y5Ch41n'.repeat(4)}fake`;
const OTHER = `github_pat_${'0th3rV4l'.repeat(4)}fake`;

/** A fresh fake Keychain and a vault file beside it. */
function setup(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keychain-'));
  const db = path.join(dir, 'keychain.json');
  const prev = { k: process.env.FAKE_KEYCHAIN, l: process.env.FAKE_KEYCHAIN_LOCKED };
  process.env.FAKE_KEYCHAIN = db;
  delete process.env.FAKE_KEYCHAIN_LOCKED;
  t.after(() => {
    for (const [k, v] of [['FAKE_KEYCHAIN', prev.k], ['FAKE_KEYCHAIN_LOCKED', prev.l]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const cipher = () => keychainCipher({ cmd: { file: process.execPath, prefix: [FAKE] }, fallback: fileCipher });
  const items = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(db, 'utf8'));
    } catch {
      return {};
    }
  };
  const argvLog = (): string => {
    try {
      return readFileSync(`${db}.argv`, 'utf8');
    } catch {
      return '';
    }
  };
  return { dir, file: path.join(dir, 'credentials.json'), cipher, items, argvLog };
}

test('a saved value goes into the Keychain (base64, as hex on security -i’s stdin) and the file only names the item', async (t) => {
  const s = setup(t);
  const v = new Vault(s.file, s.cipher()).load();
  assert.equal(v.scheme, 'keychain');
  await v.set('github-agents', SECRET, 'Probe');
  assert.equal(v.get('github-agents'), SECRET);
  const raw = readFileSync(s.file, 'utf8');
  assert.ok(!raw.includes(SECRET) && !raw.includes(Buffer.from(SECRET).toString('base64')), 'no trace of the value in the file');
  const entry = JSON.parse(raw).entries['github-agents'];
  assert.equal(entry.scheme, 'keychain');
  assert.equal(entry.data, v.keyOf('github-agents'));
  assert.match(entry.data, /^[0-9a-f]{12}\/github-agents$/);
  assert.deepEqual(s.items(), { [`${KEYCHAIN_SERVICE}|${entry.data}`]: Buffer.from(SECRET).toString('base64') });
  // Never on a command line, in any form.
  const log = s.argvLog();
  for (const form of [SECRET, Buffer.from(SECRET).toString('base64'), Buffer.from(Buffer.from(SECRET).toString('base64')).toString('hex')]) assert.ok(!log.includes(form), 'the value was on a command line');
  assert.ok(log.split('\n').some((l) => l === '["-i"]'), 'the add went through security -i');
  // Read back by a fresh vault (a restart).
  const again = new Vault(s.file, s.cipher()).load();
  assert.equal(again.get('github-agents'), SECRET);
  assert.equal(again.entry('github-agents')?.unreadable, false);
});

test('saving again replaces the item (-U), and removing a credential deletes its Keychain item', async (t) => {
  const s = setup(t);
  const v = new Vault(s.file, s.cipher()).load();
  await v.set('github-agents', SECRET, 'Probe');
  await v.set('github-agents', OTHER, 'Probe');
  assert.deepEqual(Object.values(s.items()), [Buffer.from(OTHER).toString('base64')]);
  assert.equal(new Vault(s.file, s.cipher()).load().get('github-agents'), OTHER);
  assert.ok(v.remove('github-agents'));
  // forget is fire-and-forget: wait for the fake to run.
  for (let i = 0; i < 50 && Object.keys(s.items()).length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(s.items(), {});
});

test('values an older office kept base64’d in the file move into the Keychain on the first read', async (t) => {
  const s = setup(t);
  const old = new Vault(s.file, fileCipher).load();
  await old.set('github-agents', SECRET, 'Probe');
  await old.set('mendix', OTHER, 'Probe');
  const v = new Vault(s.file, s.cipher()).load();
  // Readable straight away, before the move finishes.
  assert.equal(v.get('github-agents'), SECRET);
  assert.equal(await v.migration, 2);
  const raw = readFileSync(s.file, 'utf8');
  assert.ok(!raw.includes(Buffer.from(SECRET).toString('base64')) && !raw.includes(Buffer.from(OTHER).toString('base64')), 'the base64 copies are gone from the file');
  const entries = JSON.parse(raw).entries;
  assert.equal(entries['github-agents'].scheme, 'keychain');
  assert.equal(entries['mendix'].scheme, 'keychain');
  assert.equal(entries['github-agents'].savedBy, 'Probe', 'who saved it and when stay');
  assert.equal(Object.keys(s.items()).length, 2);
  const again = new Vault(s.file, s.cipher()).load();
  assert.equal(again.get('mendix'), OTHER);
  assert.equal(await again.migration, 0);
});

test('a locked Keychain: a new value falls back to the 0600 file (and says so), and moves in at a later start', async (t) => {
  const s = setup(t);
  process.env.FAKE_KEYCHAIN_LOCKED = '1';
  const v = new Vault(s.file, s.cipher()).load();
  await v.set('github-agents', SECRET, 'Probe');
  assert.equal(v.get('github-agents'), SECRET);
  assert.equal(v.entry('github-agents')?.scheme, 'file');
  assert.deepEqual(s.items(), {});
  // Still locked at the next start: readable from the file, nothing moved.
  const locked = new Vault(s.file, s.cipher()).load();
  assert.equal(locked.get('github-agents'), SECRET);
  assert.equal(await locked.migration, 0);
  // Unlocked: it moves in.
  delete process.env.FAKE_KEYCHAIN_LOCKED;
  const open = new Vault(s.file, s.cipher()).load();
  assert.equal(await open.migration, 1);
  assert.equal(open.entry('github-agents')?.scheme, 'keychain');
});

test('an item someone deleted from Keychain Access is unreadable, not garbage', async (t) => {
  const s = setup(t);
  const v = new Vault(s.file, s.cipher()).load();
  await v.set('github-agents', SECRET, 'Probe');
  writeFileSync(process.env.FAKE_KEYCHAIN!, '{}');
  const again = new Vault(s.file, s.cipher()).load();
  assert.equal(again.get('github-agents'), undefined);
  assert.equal(again.entry('github-agents')?.unreadable, true);
});

test('the Keychain only takes the office’s own account names, and the stdin line carries the value as hex only', () => {
  assert.ok(safeAccount('0123456789ab/github-agents'));
  for (const bad of ['', 'no-slash', 'a b/c', 'a/b;rm -rf', 'a/"b"', 'a/b\nadd-generic-password']) assert.ok(!safeAccount(bad), bad);
  const line = addLine('0123456789ab/github-agents', SECRET);
  assert.match(line, /^add-generic-password -U -s com\.mxoffice\.connections -a 0123456789ab\/github-agents -X [0-9a-f]+\n$/);
  assert.ok(!line.includes(SECRET));
});

test('which store each platform gets: DPAPI on Windows, the Keychain on macOS (AGENT_OFFICE_KEYCHAIN=0 opts out), the file on Linux', () => {
  assert.equal(keychainAvailable('darwin', () => true), true);
  assert.equal(keychainAvailable('darwin', () => false), false);
  assert.equal(keychainAvailable('linux', () => true), false);
  assert.equal(defaultCipher('linux', {}).scheme, 'file');
  assert.equal(defaultCipher('win32', {}).scheme, 'dpapi');
  if (process.platform === 'darwin') {
    assert.equal(defaultCipher('darwin', {}).scheme, keychainAvailable() ? 'keychain' : 'file');
    assert.equal(defaultCipher('darwin', { AGENT_OFFICE_KEYCHAIN: '0' }).scheme, 'file');
  }
});
