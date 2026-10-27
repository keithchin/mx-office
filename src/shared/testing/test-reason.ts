// Why a microflow test run gave no results, in words a person can act on (the real APAC-style rebuild test,
// P0-2: the office said only "mxcli wrote no JUnit file (exit 1): Starting local runtime (no Docker)...
// Cleaning up... project restored", because it took the last three lines of stderr+stdout and mxcli prints
// its reason on stderr, before stdout's last lines). mxcli's own `Error:` line is found wherever it is, and
// the failures seen on real runs are said with what they mean and the fix:
//   * "no local PostgreSQL superuser available to create the role/database": an mxcli older than v0.27 makes
//     its `<app>_test` through `psql -U postgres` on every run, even when the database is there (release 78's
//     office-made database didn't help, and the old words blamed a missing database and a Prepare button the
//     page no longer has). The fix is a newer mxcli, which runs on the built-in database (test-flags.ts);
//   * a refused password for the role "mendix" (mxcli always signs in as mendix/mendix);
//   * the fixed ports 8081/8091 taken (mxcli test --local has no flag to move them);
//   * the build failing, the timeout, mxcli not starting.
// Anything else is mxcli's own error line, never "no JUnit file" alone. Pure (no Node imports).

export interface TestRunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  killed?: boolean;
  startError?: string;
  /** The minutes mxcli was given. */
  minutes?: number;
}

/** mxcli test --local's fixed ports: the app's and the admin API's. */
export const MXCLI_TEST_PORTS = [8081, 8091] as const;

const ANSI = /\u001b\[[0-9;]*m/g;
const clean = (s: string) => s.replace(ANSI, '').replace(/\r/g, '');

/** mxcli's own error line (`Error: …`), the last one in either stream, without the prefix. */
export function mxcliErrorLine(out: Pick<TestRunOutput, 'stdout' | 'stderr'>): string | undefined {
  const lines = `${clean(out.stdout)}\n${clean(out.stderr)}`.split('\n').map((l) => l.trim());
  const errs = lines.filter((l) => /^(error|fatal)\b[:\s]/i.test(l));
  return errs.at(-1)?.replace(/^(error|fatal)\s*:?\s*/i, '').slice(0, 400);
}

/** What mxcli last said that isn't noise, for when it gave no Error line. */
function lastSaid(out: Pick<TestRunOutput, 'stdout' | 'stderr'>): string {
  return `${clean(out.stderr)}\n${clean(out.stdout)}`
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^WARNING: This is a vibe-coded/i.test(l) && !/MDL-|^→|^at\s*$/.test(l))
    .slice(-3)
    .join(' ')
    .slice(0, 300);
}

/** The mxcli that runs microflow tests on its built-in database (`mxcli test --local --db-type hsqldb`), so nobody needs a PostgreSQL superuser. */
export const MXCLI_HSQL_VERSION = 'v0.27.0';

/** Where the office's mxcli is set (the one setting that moves it to a newer mxcli). */
export const MXCLI_SETTING = 'Connections > Folders > mxcli (or the AGENT_OFFICE_MXCLI environment variable when the office starts)';

/** What an older mxcli's superuser demand needs, in words a person can act on (the Needs-you item says the same). */
export function superuserWords(version?: string): string {
  return `mxcli ${version ?? '(this version)'} makes its test database only through a PostgreSQL superuser ('psql -U postgres', which this machine doesn't let it use), even when the office has the database ready. Nobody needs to grant that: mxcli ${MXCLI_HSQL_VERSION} or newer runs the tests on the Mendix runtime's built-in database instead (no PostgreSQL at all). Point the office at it: ${MXCLI_SETTING}, then run the tests again.`;
}

export interface WhyOpts {
  mxcliVersion?: string;
  /** The run used the built-in database (--db-type hsqldb): no PostgreSQL reason applies. */
  hsql?: boolean;
}

/** Why the run gave no results, said precisely (`db`: the database it looks for, when known). ASCII punctuation only: the reason travels through consoles and logs that may not read UTF-8. */
export function testRunWhy(out: TestRunOutput, db?: string, o: WhyOpts = {}): string {
  if (out.startError) return `mxcli could not start: ${out.startError}`;
  const err = mxcliErrorLine(out) ?? '';
  const all = `${clean(out.stdout)}\n${clean(out.stderr)}`;
  const named = db ? `"${db}"` : `"<app>_test" (the app's name in lower case)`;
  if (!o.hsql && /no local PostgreSQL superuser available/i.test(all)) {
    return `Needs a newer mxcli, not a database: ${superuserWords(o.mxcliVersion)} mxcli said: ${err || 'no local PostgreSQL superuser available'}`;
  }
  if (!o.hsql && /password authentication failed for user "?mendix"?/i.test(all)) {
    return `The role "mendix" refused its password: mxcli test --local always signs in as mendix with the password "mendix". Ask the database's administrator to run: ALTER ROLE mendix LOGIN PASSWORD 'mendix' (or use mxcli ${MXCLI_HSQL_VERSION} or newer, which needs no PostgreSQL: ${MXCLI_SETTING}). mxcli said: ${err}`;
  }
  if (!o.hsql && /database "?[\w-]+"? does not exist/i.test(all)) return `The test database ${named} isn't there although the office makes it before each run (someone dropped it meanwhile?): run the tests again. mxcli said: ${err}`;
  const port = /(?:address already in use|bind(?:ing)?[^\n]*(?:in use|failed)|port[^\n]*(?:in use|already|taken))[^\n]*/i.exec(all);
  if (port || new RegExp(`:(${MXCLI_TEST_PORTS.join('|')})\\b[^\\n]*(in use|refused)`, 'i').test(all)) {
    return (o.hsql ? `A port the test runtime needs was taken when it started: run the tests again (the office picks other free ports each time). mxcli said: ${err || port?.[0] || ''}` : `A port the test runtime needs is taken: this mxcli's test --local always uses ports ${MXCLI_TEST_PORTS.join(' and ')} (mxcli ${MXCLI_HSQL_VERSION} or newer can be moved). Stop what holds them, or wait for the other test run. mxcli said: ${err || port?.[0] || ''}`).trim();
  }
  if (/Cannot open MPR file|mxbuild[^\n]*(fail|error)|build failed|compil\w+ (failed|error)/i.test(all)) return `The app didn't build for the test run: ${err || lastSaid(out)}`;
  if (out.killed) return `Timed out after ${out.minutes ?? '?'} min with no results: the test runtime didn't start or the tests didn't finish (last: ${lastSaid(out) || 'nothing'})`;
  if (err) return `mxcli test stopped before any result (exit ${out.code ?? 'none'}): ${err}`;
  return `mxcli test gave no results (exit ${out.code ?? 'none'}); its last words: ${lastSaid(out) || 'nothing'}`;
}

/** The prefix of a reason only a person can clear (a newer mxcli): what testBlocker looks for. */
export const NEEDS_MXCLI = 'Needs a newer mxcli, not a database:';

/** A run's harness error that only a person can clear, as the Needs-you ask for it; undefined for any other. */
export function testBlocker(harnessError: string | undefined): { title: string; details: string; recommendation: string } | undefined {
  if (!harnessError || !harnessError.includes(NEEDS_MXCLI)) return undefined;
  return {
    title: `Microflow tests can't run here until the office uses mxcli ${MXCLI_HSQL_VERSION} or newer`,
    details: harnessError.replace(/^Not started: /, ''),
    recommendation: `Set ${MXCLI_SETTING} to mxcli ${MXCLI_HSQL_VERSION} or newer, then run the tests again (no database change and no superuser needed).`,
  };
}
