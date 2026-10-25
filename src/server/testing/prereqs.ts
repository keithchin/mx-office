// What a project's tests need on this machine before they can run (real-build fix, docs/mockups/product-
// assessment/real-build-test.md P1-6): agents wrote 40 unit tests and an e2e journey, and none ran at any
// revision, because the machine had neither the test database nor Playwright, and the only offer on the table
// was a PostgreSQL superuser for an agent. The Testing page now lists both as prerequisites, each with one fix
// the Project Manager can press:
//
//   test database   `mxcli test --local` boots the app against its own `<App>_test` database as the user
//                   "mendix" (mxcli's default; `mxcli test --help`). The office creates both once, with the
//                   database user its live apps already use (live-app.json / AGENT_OFFICE_LIVE_DB_*): the role
//                   "mendix" with LOGIN only (never SUPERUSER, CREATEDB or CREATEROLE) and the database owned
//                   by it. No agent ever gets a superuser. Only on a database host on this machine.
//   Playwright      e2e journeys need its browsers; "Install" runs `npx playwright install chromium`.
//
// psql is found on PATH, else under Program Files\PostgreSQL\<version>\bin (AGENT_OFFICE_PSQL wins). Every
// command runs off the event loop with a time limit; the password goes in PGPASSWORD, never on a command line.

import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { liveAppConfig } from '../liveapp/config.js';
import { runCommand, type RunResult } from '../wizard/run.js';
import type { TestPrereq, TestPrereqs } from '../../shared/testing/prereqs.js';

export type Run = (cmd: string, args: string[], env: Record<string, string>, timeoutMs: number) => Promise<RunResult>;

const realRun: Run = (cmd, args, env, timeoutMs) => runCommand(cmd, args, { cwd: os.tmpdir(), env: { ...process.env, ...env }, timeoutMs, allowFail: true });

export interface PrereqDeps {
  dataDir: string;
  run?: Run;
  env?: NodeJS.ProcessEnv;
  /** Where psql is (tests); undefined: looked up. */
  psql?: string | null;
  /** Whether Playwright's browsers are installed (tests); undefined: looked at. */
  playwright?: boolean;
}

const there = (p: string) => access(p).then(
  () => true,
  () => false,
);
const list = (p: string) => readdir(p).catch(() => [] as string[]);

/** The test database's name as `mxcli test --local` derives it: the app's (.mpr) name (at the top, else one folder down) and "_test". */
export async function testDbName(floorDir: string): Promise<string | undefined> {
  const isMpr = (f: string) => f.toLowerCase().endsWith('.mpr');
  let mpr = (await list(floorDir)).find(isMpr);
  if (!mpr) for (const d of ['app', 'src']) if ((mpr = (await list(path.join(floorDir, d))).find(isMpr))) break;
  return mpr ? `${path.basename(mpr, path.extname(mpr))}_test`.slice(0, 63) : undefined;
}

/** psql on this machine, or null. */
export async function findPsql(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.AGENT_OFFICE_PSQL) return env.AGENT_OFFICE_PSQL;
  const exe = process.platform === 'win32' ? 'psql.exe' : 'psql';
  for (const dir of (env.PATH ?? '').split(path.delimiter)) if (dir && (await there(path.join(dir, exe)))) return path.join(dir, exe);
  if (process.platform === 'win32') {
    const root = path.join(env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    for (const v of (await list(root)).sort((a, b) => Number(b) - Number(a))) if (await there(path.join(root, v, 'bin', exe))) return path.join(root, v, 'bin', exe);
  }
  return null;
}

/** Whether Playwright's Chromium is installed for this user (PLAYWRIGHT_BROWSERS_PATH, else its default cache). */
export async function playwrightInstalled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const base = env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
  return (await list(base)).some((d) => /^chromium/i.test(d));
}

const loopback = (host: string) => /^(127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(host);
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The SQL the fix runs, in order: the role (LOGIN only), then the database owned by it. Pure, for the tests. */
export function testDbSql(name: string): { role: string; exists: string; create: string } {
  return {
    role: `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mendix') THEN CREATE ROLE mendix LOGIN PASSWORD 'mendix' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$;`,
    exists: `SELECT 1 FROM pg_database WHERE datname = ${quoteLit(name)}`,
    create: `CREATE DATABASE ${quoteIdent(name)} OWNER mendix`,
  };
}

function psqlArgs(db: { host: string; port: number; user: string }, sql: string): string[] {
  return ['-h', db.host, '-p', String(db.port), '-U', db.user, '-d', 'postgres', '-w', '-v', 'ON_ERROR_STOP=1', '-tAc', sql];
}

/** The project's test prerequisites now. */
export async function testPrereqs(floorDir: string, d: PrereqDeps): Promise<TestPrereqs> {
  const env = d.env ?? process.env;
  const run = d.run ?? realRun;
  const cfg = liveAppConfig(d.dataDir, env);
  const name = await testDbName(floorDir);
  const psql = d.psql === undefined ? await findPsql(env) : d.psql;
  let db: TestPrereq;
  if (!name) db = { id: 'test-db', title: 'Test database', state: 'unknown', text: 'No Mendix app (.mpr) in the project yet' };
  else if (!loopback(cfg.db.host)) db = { id: 'test-db', title: 'Test database', state: 'missing', text: `The database server (${cfg.db.host}) isn't on this machine: ask its administrator for a database ${name} owned by a login role "mendix" (password "mendix"). No superuser is needed by anyone.` };
  else if (!psql) db = { id: 'test-db', title: 'Test database', state: 'unknown', text: `psql isn't on this machine, so the office can't look: the tests need a database ${name} owned by the role "mendix" on ${cfg.db.host}:${cfg.db.port}` };
  else {
    const pw = { PGPASSWORD: cfg.db.password };
    const sql = testDbSql(name);
    const r = await run(psql, psqlArgs(cfg.db, `SELECT (SELECT count(*) FROM pg_roles WHERE rolname = 'mendix') || ',' || (SELECT count(*) FROM pg_database WHERE datname = ${quoteLit(name)})`), pw, 20_000).catch(() => undefined);
    const [role, base] = (r?.code === 0 ? r.stdout.trim() : '').split(',').map(Number);
    if (r?.code !== 0) db = { id: 'test-db', title: 'Test database', state: 'unknown', text: `The office couldn't reach PostgreSQL at ${cfg.db.host}:${cfg.db.port} as ${cfg.db.user} (the live apps' user): ${r?.tail.slice(-1)[0] ?? 'no answer'}` };
    else if (role && base) db = { id: 'test-db', title: 'Test database', state: 'ready', text: `${name} owned by "mendix" on ${cfg.db.host}:${cfg.db.port}: microflow tests can run` };
    else db = { id: 'test-db', title: 'Test database', state: 'missing', text: `Microflow tests (mxcli test --local) need the database ${name} and the login role "mendix"${role ? ' (the role is there)' : ''}. The office makes them with its own database user: never a superuser for an agent.`, fix: 'Prepare the test database', sql: [sql.role, sql.create] };
  }
  const pwOk = d.playwright ?? (await playwrightInstalled(env));
  const pwr: TestPrereq = pwOk
    ? { id: 'playwright', title: 'Playwright (e2e journeys)', state: 'ready', text: 'Its Chromium is installed: e2e journeys can run' }
    : { id: 'playwright', title: 'Playwright (e2e journeys)', state: 'missing', text: "Playwright's browser isn't installed, so the team's e2e journeys can't run (they don't fail: they never start).", fix: 'Install Playwright', command: 'npx playwright install chromium' };
  return { items: [db, pwr], ready: db.state === 'ready' && pwr.state === 'ready' };
}

/** Runs a prerequisite's fix; the error in words, or undefined once done. */
export async function fixPrereq(floorDir: string, what: 'test-db' | 'playwright', d: PrereqDeps): Promise<string | undefined> {
  const env = d.env ?? process.env;
  const run = d.run ?? realRun;
  if (what === 'playwright') {
    const r = await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'playwright', 'install', 'chromium'], {}, 15 * 60_000).catch((err: Error) => ({ code: 1, tail: [err.message], stdout: '' }));
    return r.code === 0 ? undefined : `Playwright's install failed: ${r.tail.slice(-2).join(' ').slice(0, 300)}`;
  }
  const cfg = liveAppConfig(d.dataDir, env);
  const name = await testDbName(floorDir);
  if (!name) return 'There is no Mendix app (.mpr) in the project yet';
  if (!loopback(cfg.db.host)) return `The database server (${cfg.db.host}) isn't on this machine: ask its administrator for it`;
  const psql = d.psql === undefined ? await findPsql(env) : d.psql;
  if (!psql) return "psql isn't on this machine (install PostgreSQL's command-line tools, or set AGENT_OFFICE_PSQL)";
  const pw = { PGPASSWORD: cfg.db.password };
  const sql = testDbSql(name);
  const role = await run(psql, psqlArgs(cfg.db, sql.role), pw, 30_000);
  if (role.code !== 0) return `The office's database user ${cfg.db.user} couldn't make the role "mendix": ${role.tail.slice(-1)[0] ?? ''}. Ask the database's administrator to run: ${sql.role}`;
  const has = await run(psql, psqlArgs(cfg.db, sql.exists), pw, 20_000);
  if (has.code === 0 && has.stdout.trim() === '1') return undefined;
  const made = await run(psql, psqlArgs(cfg.db, sql.create), pw, 60_000);
  return made.code === 0 ? undefined : `The office's database user ${cfg.db.user} couldn't create ${name}: ${made.tail.slice(-1)[0] ?? ''}. Ask the database's administrator to run: ${sql.create}`;
}
