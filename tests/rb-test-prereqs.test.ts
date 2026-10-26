// Real-build fixes: what a project's tests need on this machine (server/testing/prereqs.ts,
// docs/mockups/product-assessment/real-build-test.md P1-6). The test database for `mxcli test --local` is made
// by the office with its own database user (the live apps'): the role "mendix" with LOGIN only and the
// `<App>_test` database owned by it, never a superuser for anyone. Playwright missing is a prerequisite with
// an Install fix, not tests silently not running. A fake psql and a fake npx only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixPrereq, testDbName, testDbSql, testPrereqs, type Run } from '../src/server/testing/prereqs.js';

function fakePg(state: { role: boolean; db: boolean; denyRole?: boolean }) {
  const calls: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
  const run: Run = async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    const sql = args[args.length - 1];
    if (cmd.includes('npx')) return { code: 0, tail: [], stdout: '' };
    if (/^SELECT \(SELECT count/.test(sql)) return { code: 0, tail: [], stdout: `${state.role ? 1 : 0},${state.db ? 1 : 0}\n` };
    if (/CREATE ROLE/.test(sql)) {
      if (state.denyRole) return { code: 1, tail: ['ERROR:  permission denied to create role'], stdout: '' };
      state.role = true;
      return { code: 0, tail: [], stdout: '' };
    }
    if (/^SELECT 1 FROM pg_database/.test(sql)) return { code: 0, tail: [], stdout: state.db ? '1\n' : '' };
    if (/^CREATE DATABASE/.test(sql)) return (state.db = true), { code: 0, tail: [], stdout: '' };
    return { code: 1, tail: [`unexpected ${sql}`], stdout: '' };
  };
  return { run, calls };
}

const ENV = { PATH: '', AGENT_OFFICE_LIVE_DB_HOST: '127.0.0.1:5432', AGENT_OFFICE_LIVE_DB_USER: 'office_db', AGENT_OFFICE_LIVE_DB_PASSWORD: 'pw-test-only' } as NodeJS.ProcessEnv;

test('the test database: made by the office with its own user, the role "mendix" LOGIN only, never a superuser', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-prereqs-'));
  try {
    writeFileSync(path.join(dir, 'EquipmentLoans.mpr'), '');
    assert.equal(await testDbName(dir), 'equipmentloans_test', 'lower case: mxcli looks for the folded name');
    const sql = testDbSql('equipmentloans_test');
    assert.match(sql.role, /CREATE ROLE mendix LOGIN PASSWORD 'mendix' NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    assert.equal(sql.create, 'CREATE DATABASE "equipmentloans_test" OWNER mendix');
    const pg = fakePg({ role: false, db: false });
    const deps = { dataDir: dir, run: pg.run, env: ENV, psql: 'psql', playwright: true };
    let v = await testPrereqs(dir, deps);
    const db = v.items.find((x) => x.id === 'test-db')!;
    assert.equal(db.state, 'missing');
    assert.equal(db.fix, 'Prepare the test database');
    assert.match(db.text, /never a superuser/);
    assert.equal(v.ready, false);
    assert.equal(await fixPrereq(dir, 'test-db', deps), undefined);
    // As the office's own database user, the password only in the environment.
    const writes = pg.calls.filter((c) => /CREATE/.test(c.args.at(-1)!));
    assert.equal(writes.length, 2);
    for (const c of pg.calls) {
      assert.deepEqual(c.args.slice(0, 6), ['-h', '127.0.0.1', '-p', '5432', '-U', 'office_db']);
      assert.equal(c.env.PGPASSWORD, 'pw-test-only');
      assert.ok(!c.args.includes('pw-test-only'), 'never on the command line');
      assert.doesNotMatch(c.args.at(-1)!, /\bSUPERUSER\b(?!.*NO)|ALTER ROLE .* SUPERUSER/);
    }
    v = await testPrereqs(dir, deps);
    assert.equal(v.items.find((x) => x.id === 'test-db')!.state, 'ready');
    assert.equal(v.ready, true);
    // A user that can't make roles: said, with the SQL for whoever administers the database.
    const denied = fakePg({ role: false, db: false, denyRole: true });
    assert.match((await fixPrereq(dir, 'test-db', { ...deps, run: denied.run })) ?? '', /couldn't make the role "mendix".*Ask the database's administrator to run: DO \$\$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Playwright missing is a prerequisite with an Install fix, and a database elsewhere is said, not touched', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-prereqs-pw-'));
  try {
    writeFileSync(path.join(dir, 'App.mpr'), '');
    const pg = fakePg({ role: true, db: true });
    const v = await testPrereqs(dir, { dataDir: dir, run: pg.run, env: ENV, psql: 'psql', playwright: false });
    const pw = v.items.find((x) => x.id === 'playwright')!;
    assert.equal(pw.state, 'missing');
    assert.equal(pw.fix, 'Install Playwright');
    assert.equal(pw.command, 'npx playwright install chromium');
    assert.equal(await fixPrereq(dir, 'playwright', { dataDir: dir, run: pg.run, env: ENV }), undefined);
    assert.deepEqual(pg.calls.at(-1)!.args, ['--yes', 'playwright', 'install', 'chromium']);
    const far = await testPrereqs(dir, { dataDir: dir, run: pg.run, env: { ...ENV, AGENT_OFFICE_LIVE_DB_HOST: 'db.example:5432' }, psql: 'psql', playwright: true });
    const db = far.items.find((x) => x.id === 'test-db')!;
    assert.equal(db.state, 'missing');
    assert.equal(db.fix, undefined, 'no fix for a server elsewhere');
    assert.match(db.text, /ask its administrator/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
