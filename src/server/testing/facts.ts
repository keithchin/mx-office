// What the files at main say, for the Testing tab: the BRDs' use cases and rules, the acceptance
// criteria table, the test and journey files with the ids they name, the test plan, and the report
// files as runs. Read once per main commit (a new commit reads again), with git off the event loop.

import { isReportFile, MAX_REPORTS, parseReport, draftFromReport, REPORT_PATHS } from './import-reports.js';
import { lastCommits, listFiles, readFiles, resolveRevisions, type MainRef } from './repo.js';
import { journeyIdOf, parseAcTable, parseBrd, recordedLinks, type AcRow, type Brd } from '../../shared/testing/links.js';
import type { TestRunDraft } from '../../shared/testing/record.js';
import type { TestDef } from '../../shared/testing/view.js';

export const BRD_DIR = 'analysis/knowledge-base/brd';
export const AC_FILE = 'architecture/acceptance-criteria.md';
const MAX_TESTS = 400;

export interface RepoFacts {
  brds: Brd[];
  acs: AcRow[];
  tests: TestDef[];
  plan?: { path: string; status?: string; bytes: number; changedIn?: string; changedAt?: string };
  /** The committed gate dashboard at main, when there is one. */
  indexHtml?: string;
  reports: TestRunDraft[];
  notes: string[];
}

const kindOf = (f: string): TestDef['kind'] => (/\.journey\.json$/i.test(f) ? 'journey' : /\.test\.mdl$/i.test(f) ? 'unit' : f.startsWith('tests/e2e/') ? 'e2e' : /\.sh$/i.test(f) ? 'script' : 'other');
const isTestFile = (f: string) => f.startsWith('tests/') && !/(^|\/)test-plan[^/]*\.md$/i.test(f) && /\.(json|mdl|js|mjs|cjs|ts|sh|feature|py)$/i.test(f) && !/(^|\/)example\.journey\.json$/i.test(f);
export const isPlanFile = (f: string) => /^(tests|docs)\/test-plan[^/]*\.md$/i.test(f);

/** The plan's own status line ("Status: Draft"), when it has one. */
export function planStatus(md: string): string | undefined {
  const m = /^\s*(?:[-*]\s*)?\**status\**\s*[:：]\s*\**\s*([^\n]{1,120})/im.exec(md.replace(/\r/g, ''));
  return m?.[1].replace(/\*+/g, '').trim() || undefined;
}

export async function readRepoFacts(dir: string, main: MainRef): Promise<RepoFacts> {
  const notes: string[] = [];
  const [deep, docs] = await Promise.all([listFiles(dir, main.sha, [BRD_DIR, AC_FILE, 'tests', ...REPORT_PATHS, 'index.html']), listFiles(dir, main.sha, ['docs/'], false)]);
  const files = [...deep, ...docs.filter(isPlanFile)];
  const brdFiles = files.filter((f) => f.startsWith(`${BRD_DIR}/`) && f.endsWith('.brd.json'));
  const testFiles = files.filter(isTestFile);
  if (testFiles.length > MAX_TESTS) notes.push(`Only the first ${MAX_TESTS} of ${testFiles.length} test files were read`);
  const reportFiles = files.filter(isReportFile);
  if (reportFiles.length > MAX_REPORTS) notes.push(`Only the newest ${MAX_REPORTS} of ${reportFiles.length} report files were read`);
  const planFile = files.filter(isPlanFile).sort((a, b) => (a.startsWith('tests/') === b.startsWith('tests/') ? a.localeCompare(b) : a.startsWith('tests/') ? -1 : 1))[0];

  const [texts, commits] = await Promise.all([
    readFiles(dir, main.sha, [...brdFiles, ...(files.includes(AC_FILE) ? [AC_FILE] : []), ...testFiles.slice(0, MAX_TESTS), ...(planFile ? [planFile] : []), ...(files.includes('index.html') ? ['index.html'] : [])]),
    lastCommits(dir, main.sha, [...REPORT_PATHS, ...(planFile ? [planFile] : [])]),
  ]);

  const brds = brdFiles.map((f) => parseBrd(texts.get(f) ?? '', f.split('/').pop()!)).filter((b): b is Brd => !!b);
  if (brdFiles.length && !brds.length) notes.push('The BRD files could not be read');
  if (!brdFiles.length) notes.push(`No BRD at ${BRD_DIR}/*.brd.json yet, so there are no use cases to list`);
  const acs = texts.has(AC_FILE) ? parseAcTable(texts.get(AC_FILE)!) : [];
  if (!files.includes(AC_FILE)) notes.push(`No ${AC_FILE} yet`);

  const tests: TestDef[] = testFiles.slice(0, MAX_TESTS).map((f) => {
    const journey = kindOf(f) === 'journey' ? journeyIdOf(f) : undefined;
    return { path: f, ...(journey ? { journey } : {}), kind: kindOf(f), links: recordedLinks(texts.get(f) ?? '', f, brds) };
  });

  // Reports: newest-changed first, each parsed at main (its content at the commit that last changed it is the same).
  const ordered = reportFiles.filter((f) => commits.has(f)).sort((a, b) => (commits.get(b)!.at ?? '').localeCompare(commits.get(a)!.at ?? ''));
  const reportTexts = await readFiles(dir, main.sha, ordered.slice(0, MAX_REPORTS));
  const parsed = ordered.slice(0, MAX_REPORTS).flatMap((f) => {
    const p = reportTexts.has(f) ? parseReport(f, reportTexts.get(f)!, brds) : undefined;
    return p ? [{ f, p }] : [];
  });
  const full = await resolveRevisions(
    dir,
    parsed.flatMap(({ p }) => [p.declaredApp, p.declaredTests].filter((x): x is string => !!x)),
  );
  const reports = parsed.map(({ f, p }) => draftFromReport(f, p, commits.get(f)!, (r) => full.get(r)));

  const planText = planFile ? texts.get(planFile) : undefined;
  const planCommit = planFile ? commits.get(planFile) : undefined;
  const plan = planFile && planText !== undefined ? { path: planFile, ...(planStatus(planText) ? { status: planStatus(planText) } : {}), bytes: Buffer.byteLength(planText), ...(planCommit ? { changedIn: planCommit.sha, changedAt: planCommit.at } : {}) } : undefined;
  return { brds, acs, tests, ...(plan ? { plan } : {}), ...(texts.has('index.html') ? { indexHtml: texts.get('index.html') } : {}), reports, notes };
}

/** The test plan's text at main. */
export async function readPlan(dir: string, main: MainRef, file: string): Promise<string | undefined> {
  return (await readFiles(dir, main.sha, [file])).get(file);
}
