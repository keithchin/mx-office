// Why a microflow test run gave no results, in words a person can act on (the real APAC-style rebuild test,
// P0-2: the office said only "mxcli wrote no JUnit file (exit 1): Starting local runtime (no Docker)...
// Cleaning up... project restored", because it took the last three lines of stderr+stdout and mxcli prints
// its reason on stderr, before stdout's last lines). mxcli's own `Error:` line is found wherever it is, and
// the failures seen on real runs are said with what they mean and the fix:
//   * "no local PostgreSQL superuser available to create the role/database": mxcli test --local found no
//     database `<app>_test` (lower case) and won't make one without a superuser;
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

/** Why the run gave no results, said precisely (`db`: the database it looks for, when known). */
export function testRunWhy(out: TestRunOutput, db?: string): string {
  if (out.startError) return `mxcli could not start: ${out.startError}`;
  const err = mxcliErrorLine(out) ?? '';
  const all = `${clean(out.stdout)}\n${clean(out.stderr)}`;
  const named = db ? `"${db}"` : '"<app>_test" (the app\'s name in lower case)';
  if (/no local PostgreSQL superuser available/i.test(all)) {
    return `The test database is missing: mxcli test --local looks for the database ${named}, owned by the login role "mendix" (password "mendix"), and won't create one without a PostgreSQL superuser. Testing › Prepare the test database makes it with the office's own database user (no superuser for anyone). mxcli said: ${err || 'no local PostgreSQL superuser available'}`;
  }
  if (/password authentication failed for user "?mendix"?/i.test(all)) {
    return `The role "mendix" refused its password: mxcli test --local always signs in as mendix with the password "mendix". Ask the database's administrator to run: ALTER ROLE mendix LOGIN PASSWORD 'mendix'. mxcli said: ${err}`;
  }
  if (/database "?[\w-]+"? does not exist/i.test(all)) return `The test database ${named} isn't there: Testing › Prepare the test database makes it. mxcli said: ${err}`;
  const port = /(?:address already in use|bind(?:ing)?[^\n]*(?:in use|failed)|port[^\n]*(?:in use|already|taken))[^\n]*/i.exec(all);
  if (port || new RegExp(`:(${MXCLI_TEST_PORTS.join('|')})\\b[^\\n]*(in use|refused)`, 'i').test(all)) {
    return `A port the test runtime needs is taken: mxcli test --local always uses ports ${MXCLI_TEST_PORTS.join(' and ')} (it has no flag to move them). Stop what holds them, or wait for the other test run. mxcli said: ${err || port?.[0] || ''}`.trim();
  }
  if (/Cannot open MPR file|mxbuild[^\n]*(fail|error)|build failed|compil\w+ (failed|error)/i.test(all)) return `The app didn't build for the test run: ${err || lastSaid(out)}`;
  if (out.killed) return `Timed out after ${out.minutes ?? '?'} min with no results: the test runtime didn't start or the tests didn't finish (last: ${lastSaid(out) || 'nothing'})`;
  if (err) return `mxcli test stopped before any result (exit ${out.code ?? 'none'}): ${err}`;
  return `mxcli test gave no results (exit ${out.code ?? 'none'}); its last words: ${lastSaid(out) || 'nothing'}`;
}
