// Microflow tests that actually run (P0-2 of the real rebuild test): why a run gave no results, said
// precisely from mxcli's own words (the real "no local PostgreSQL superuser" run, captured with mxcli nightly
// 2026-10-03), and the office's preparation before each run: the lower-case test database owned by "mendix",
// made with the office's own database user and never a superuser, one the office made made again, someone
// else's left alone, the fixed ports checked first.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mxcliErrorLine, testBlocker, testRunWhy } from '../src/shared/testing/test-reason.js';
import { OFFICE_TEST_DB, prepareTestRun } from '../src/server/testing/test-db.js';
import { draftFromMxcliRun } from '../src/shared/testing/junit.js';

// What the office's run printed in the real test (stdout's last lines), with mxcli's reason on stderr.
const REAL = {
  code: 1,
  stdout: 'Created microflow: MxTest.Test_test_2\n  After-startup set to MxTest.RegisterEndpoint\nStarting local runtime (no Docker)...\nCleaning up...\n  project restored\n',
  stderr: "Error: local runtime: ensuring database: no local PostgreSQL superuser available to create the role/database (tried a direct 'psql -U postgres' connection over the cluster socket and TCP, and non-interactive 'sudo -u postgres' both directly and via root)\n",
};

test('the real failure: an older mxcli demands a superuser; said as needing a newer mxcli (one setting), never a missing database or a Prepare button', () => {
  assert.match(String(mxcliErrorLine(REAL)), /^local runtime: ensuring database: no local PostgreSQL superuser/);
  const why = testRunWhy(REAL, 'shop_test', { mxcliVersion: 'nightly-20261003' });
  assert.match(why, /^Needs a newer mxcli, not a database: mxcli nightly-20261003 makes its test database only through a PostgreSQL superuser/);
  assert.match(why, /mxcli v0\.27\.0 or newer runs the tests on the Mendix runtime's built-in database/);
  assert.match(why, /Connections > Folders > mxcli/);
  assert.doesNotMatch(why, /Prepare the test database|database is missing|no JUnit file/);
  // ASCII punctuation only: the reason travels through consoles that may not read UTF-8 (the mojibake in the run).
  assert.doesNotMatch(why.replace(/mxcli said:.*$/, ''), /[^ -~]/);
  // It is the one thing only a person can clear: a Needs-you ask with the setting.
  const ask = testBlocker(`Not started: ${why}`);
  assert.match(String(ask?.title), /until the office uses mxcli v0\.27\.0 or newer/);
  assert.match(String(ask?.recommendation), /no database change and no superuser needed/);
  assert.equal(testBlocker('Timed out after 16 min with no results'), undefined);
  // On the built-in database the PostgreSQL reasons never apply.
  assert.doesNotMatch(testRunWhy(REAL, undefined, { hsql: true }), /newer mxcli/);
  // In the record: the harness error is this, never "mxcli wrote no JUnit file" with stdout's last lines.
  const d = draftFromMxcliRun({ runId: 'mt_1', floor: 'shop', commit: 'c'.repeat(40), paths: [], environment: { runner: 'x', mxcliVersion: 'n', runtime: 'local', workFolder: '/w' }, startedAt: '', finishedAt: '', exitCode: 1, actor: 'Ann', failure: why }, undefined);
  assert.equal(d.harnessError, why.slice(0, 600));
});

test("the other reasons: the role's password, the fixed ports, the build, the timeout, mxcli not starting, anything else", () => {
  assert.match(testRunWhy({ code: 1, stdout: '', stderr: 'Error: FATAL: password authentication failed for user "mendix"' }), /ALTER ROLE mendix LOGIN PASSWORD 'mendix'/);
  assert.match(testRunWhy({ code: 1, stdout: '', stderr: 'Error: listen tcp 127.0.0.1:8081: bind: address already in use' }), /always uses ports 8081 and 8091/);
  assert.match(testRunWhy({ code: 1, stdout: '', stderr: 'Error: listen tcp 127.0.0.1:8401: bind: address already in use' }, undefined, { hsql: true }), /picks other free ports each time/);
  assert.match(testRunWhy({ code: 1, stdout: '', stderr: 'Error: mxbuild failed with 2 errors' }), /didn't build/);
  assert.match(testRunWhy({ code: null, stdout: 'Starting local runtime (no Docker)...', stderr: '', killed: true, minutes: 16 }), /Timed out after 16 min .*Starting local runtime/);
  assert.match(testRunWhy({ code: null, stdout: '', stderr: '', startError: 'ENOENT spawn mxcli' }), /mxcli could not start: ENOENT/);
  assert.match(testRunWhy({ code: 2, stdout: '', stderr: 'Error: something new' }), /stopped before any result \(exit 2\): something new/);
  assert.match(testRunWhy({ code: 1, stdout: 'just words', stderr: '' }), /gave no results \(exit 1\); its last words: just words/);
});

/** A fake psql over a tiny database server: roles and databases with their comments, every statement kept. */
function fakePg(init: { role?: boolean; dbs?: Record<string, string> } = {}) {
  const roles = new Set(init.role ? ['mendix'] : []);
  const dbs = new Map(Object.entries(init.dbs ?? {}));
  const sql: string[] = [];
  const psql = async (s: string, db: { user: string; password: string }) => {
    sql.push(s);
    assert.equal(db.user, 'office_db');
    if (/CREATE ROLE mendix/.test(s)) return void roles.add('mendix'), '';
    if (/FROM pg_roles/.test(s)) return roles.has('mendix') ? '1\n' : '0\n';
    const named = /datname = '([^']+)'/.exec(s)?.[1];
    if (/^SELECT 'db:'/.test(s)) return dbs.has(named!) ? `db:${dbs.get(named!)}\n` : '';
    if (/^SELECT count\(\*\) FROM pg_database/.test(s)) return dbs.has(named!) ? '1\n' : '0\n';
    const made = /^CREATE DATABASE "([^"]+)" OWNER mendix$/.exec(s)?.[1];
    if (made) return void dbs.set(made, ''), '';
    const dropped = /^DROP DATABASE IF EXISTS "([^"]+)"/.exec(s)?.[1];
    if (dropped) return void dbs.delete(dropped), '';
    const comment = /^COMMENT ON DATABASE "([^"]+)" IS '(.*)'$/.exec(s);
    if (comment) return void dbs.set(comment[1], comment[2].replace(/''/g, "'")), '';
    throw new Error(`unexpected ${s}`);
  };
  return { psql, sql, roles, dbs };
}

const ENV = { AGENT_OFFICE_LIVE_DB_HOST: '127.0.0.1:5432', AGENT_OFFICE_LIVE_DB_USER: 'office_db', AGENT_OFFICE_LIVE_DB_PASSWORD: 'pw-test-only' } as NodeJS.ProcessEnv;

test('before each run: the lower-case database owned by "mendix", made with the office user, never a superuser; made again next time', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-db-'));
  try {
    const pg = fakePg({ dbs: { Shop_test: '' } });
    const r = await prepareTestRun('Shop', { dataDir: dir, env: ENV, psql: pg.psql, portFree: async () => true });
    assert.ok('db' in r, JSON.stringify(r));
    assert.equal(r.db, 'shop_test', 'the name mxcli looks for (PostgreSQL folds it)');
    assert.equal(pg.dbs.get('shop_test'), OFFICE_TEST_DB);
    assert.ok(pg.roles.has('mendix'));
    assert.match(r.notes.join(' '), /made the login role "mendix"/);
    assert.match(r.notes.join(' '), /"Shop_test" \(made before this fix\) isn't the one mxcli uses \(shop_test\)/);
    for (const s of pg.sql) assert.doesNotMatch(s, /\bSUPERUSER\b(?! )|ALTER ROLE|CREATEDB(?! )/, s);
    assert.ok(pg.sql.some((s) => /NOSUPERUSER NOCREATEDB NOCREATEROLE/.test(s)));
    assert.ok(pg.dbs.has('Shop_test'), 'the old mixed-case one is never dropped');
    // Next run: the office's own is dropped and made again, so every run starts empty.
    pg.sql.length = 0;
    const again = await prepareTestRun('Shop', { dataDir: dir, env: ENV, psql: pg.psql, portFree: async () => true });
    assert.ok('db' in again);
    assert.ok(pg.sql.some((s) => /^DROP DATABASE IF EXISTS "shop_test"/.test(s)));
    assert.match(again.notes.join(' '), /made again shop_test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("someone else's test database is used as it is; a taken port or a refusal is the reason the run does not start", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-db-'));
  try {
    const pg = fakePg({ role: true, dbs: { shop_test: '' } });
    const r = await prepareTestRun('Shop', { dataDir: dir, env: ENV, psql: pg.psql, portFree: async () => true });
    assert.ok('db' in r);
    assert.match(r.notes.join(' '), /isn't the office's: used as it is \(never dropped\)/);
    assert.ok(!pg.sql.some((s) => /DROP|CREATE DATABASE/.test(s)));
    const busy = await prepareTestRun('Shop', { dataDir: dir, env: ENV, psql: pg.psql, portFree: async (p) => p !== 8091 });
    assert.match(String('why' in busy && busy.why), /Port 8091 is in use .*always uses ports 8081 and 8091/);
    const denied = await prepareTestRun('Shop', { dataDir: dir, env: ENV, psql: async () => Promise.reject(new Error('psql: permission denied to create database')), portFree: async () => true });
    assert.match(String('why' in denied && denied.why), /couldn't get the test database shop_test ready with its database user office_db: psql: permission denied.*no superuser is needed by anyone/);
    const remote = await prepareTestRun('Shop', { dataDir: dir, env: { ...ENV, AGENT_OFFICE_LIVE_DB_HOST: 'db.example:5432' }, psql: pg.psql, portFree: async () => true });
    assert.match('db' in remote ? remote.notes.join(' ') : '', /isn't on this machine: the office didn't touch it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
