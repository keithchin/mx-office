// What the office does before every microflow test run it starts (the Testing page's "Run microflow tests
// on main", an agent's `office-app test`), so `mxcli test --local` finds what it needs and nobody needs a
// PostgreSQL superuser (P0-2 of the real rebuild test: 49 tests written, none ever ran):
//   * the database `<app>_test` in lower case (prereqs.ts mxcliTestDb: mxcli looks for the folded name) owned
//     by the login role "mendix" (LOGIN only, password "mendix", mxcli's default), made with the office's own
//     database user (the live apps', liveapp/config.ts). One the office made (it carries the office's comment)
//     is dropped and made again, so every run starts on an empty database; one somebody else made is used as
//     it is and never dropped;
//   * the fixed ports 8081 and 8091 (mxcli test --local has no flag to move them) free, else the run isn't
//     started and the reason names the port;
//   * one test runtime at a time on this machine (`serialTestRuntime`): two would fight over those ports.
// A database server that isn't on this machine is left alone: the reason says what to ask for.

import net from 'node:net';
import { liveAppConfig } from '../liveapp/config.js';
import { realPsql, type Psql } from '../app-instance/db.js';
import { MXCLI_TEST_PORTS } from '../../shared/testing/test-reason.js';
import { mxcliTestDb, testDbSql } from './prereqs.js';

/** The comment the office puts on a test database it made: only those are ever dropped. */
export const OFFICE_TEST_DB = 'mx-office test database (made for mxcli test --local; made again before each run)';

const SAFE = /^[a-z_][a-z0-9_]{0,62}$/;
const loopback = (host: string) => /^(127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(host);
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Whether nothing listens on 127.0.0.1:`port` (it can be bound). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(true)));
  });
}

export interface TestDbDeps {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  psql?: Psql;
  portFree?: (port: number) => Promise<boolean>;
}

export type Prepared = { db: string; notes: string[] } | { why: string };

/** Gets the database and ports ready for `mxcli test --local` on the app named `mprBase`; or why it can't run. */
export async function prepareTestRun(mprBase: string, d: TestDbDeps): Promise<Prepared> {
  const name = mxcliTestDb(mprBase);
  if (!SAFE.test(name)) return { why: `The app's name gives a test database name PostgreSQL can't take as it is ("${name}")` };
  const free = d.portFree ?? portFree;
  for (const p of MXCLI_TEST_PORTS) {
    if (!(await free(p))) return { why: `Port ${p} is in use on this machine, and mxcli test --local always uses ports ${MXCLI_TEST_PORTS.join(' and ')} (it has no flag to move them): stop what holds it (another test run, an app started by hand), then run the tests again.` };
  }
  const cfg = liveAppConfig(d.dataDir, d.env ?? process.env);
  if (!loopback(cfg.db.host)) return { db: name, notes: [`The database server (${cfg.db.host}) isn't on this machine: the office didn't touch it (the tests need ${name} owned by the role "mendix" there)`] };
  const psql = d.psql ?? realPsql;
  const notes: string[] = [];
  try {
    const sql = testDbSql(name);
    const role = (await psql(`SELECT count(*) FROM pg_roles WHERE rolname = 'mendix'`, cfg.db)).trim();
    if (role !== '1') {
      await psql(sql.role, cfg.db);
      notes.push('made the login role "mendix" (LOGIN only)');
    }
    const row = await psql(`SELECT 'db:' || coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = ${lit(name)}`, cfg.db);
    const has = row.split(/\r?\n/).find((l) => l.startsWith('db:'));
    if (has && has.slice(3) !== OFFICE_TEST_DB) {
      notes.push(`${name} was there already and isn't the office's: used as it is (never dropped)`);
    } else {
      if (has) await psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`, cfg.db);
      await psql(`CREATE DATABASE "${name}" OWNER mendix`, cfg.db);
      await psql(`COMMENT ON DATABASE "${name}" IS ${lit(OFFICE_TEST_DB)}`, cfg.db);
      notes.push(`${has ? 'made again' : 'made'} ${name} (owner "mendix") for this run`);
    }
    // The office's earlier fix made it with the app's own case, which mxcli never finds: said, never dropped.
    const mixed = `${mprBase}_test`.slice(0, 63);
    if (mixed !== name) {
      const old = (await psql(`SELECT count(*) FROM pg_database WHERE datname = ${lit(mixed)}`, cfg.db).catch(() => '0')).trim();
      if (old === '1') notes.push(`"${mixed}" (made before this fix) isn't the one mxcli uses (${name}): it can be dropped`);
    }
  } catch (err) {
    return { why: `The office couldn't get the test database ${name} ready with its database user ${cfg.db.user}: ${(err as Error).message}. Ask the database's administrator for a database ${name} owned by a login role "mendix" (password "mendix"); no superuser is needed by anyone.` };
  }
  return { db: name, notes };
}

let chain: Promise<unknown> = Promise.resolve();
/** One mxcli test runtime at a time on this machine (its ports are fixed). */
export function serialTestRuntime<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}
