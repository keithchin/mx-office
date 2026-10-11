// The Documents page (ui/deliverables/page.ts, ?tab=documents): a page of the 1D view, not a window;
// every opener goes there (the Portal navigation, the setup panel, the progress bar, the 2D view) and
// an old ?tab=deliverables still lands there; and one request at a time however often it's clicked
// (ui/deliverables/store.ts), so nothing piles up while the office is slow to answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DeliverableItem, DeliverablesView } from '../src/shared/deliverables.js';
import { cachedDocs, DOCS_FRESH_MS, loadDocs, setDocsFetcher } from '../src/client/ui/deliverables/store.js';
import { filterItems } from '../src/client/ui/deliverables/page-logic.js';
import { documentsHref } from '../src/client/ui/deliverables/open.js';
import { groupOf, navItem, pageTitle } from '../src/client/ui/portal/nav-logic.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const view = (n = 1): DeliverablesView => ({ floor: 'f', scannedAt: n, items: [], sources: [] });

test('rapid repeat opens while the office is slow: one request, and every one of them gets its answer', async (t) => {
  let calls = 0;
  let answer!: (v: DeliverablesView) => void;
  setDocsFetcher(() => {
    calls++;
    return new Promise((r) => (answer = r));
  });
  t.after(() => setDocsFetcher(undefined));
  const asks = Array.from({ length: 8 }, () => loadDocs('f'));
  assert.equal(calls, 1, 'eight clicks during a slow fetch: one request');
  answer(view(1));
  const got = await Promise.all(asks);
  assert.ok(got.every((v) => v?.scannedAt === 1));
  // Young enough: no request at all.
  await loadDocs('f');
  assert.equal(calls, 1);
  assert.equal(cachedDocs('f')?.view.scannedAt, 1);
});

test('Refresh while a plain request is going waits for it and asks once more; repeat Refreshes share that one', async (t) => {
  let calls = 0;
  const fresh: boolean[] = [];
  const answers: ((v: DeliverablesView) => void)[] = [];
  setDocsFetcher((_f, isFresh) => {
    calls++;
    fresh.push(isFresh);
    return new Promise((r) => answers.push(r));
  });
  t.after(() => setDocsFetcher(undefined));
  const plain = loadDocs('f');
  const r1 = loadDocs('f', { fresh: true });
  const r2 = loadDocs('f', { fresh: true });
  assert.equal(r1, r2);
  assert.equal(calls, 1, 'still one at a time');
  answers[0](view(1));
  assert.equal((await plain)?.scannedAt, 1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2);
  assert.deepEqual(fresh, [false, true]);
  answers[1](view(2));
  assert.equal((await r1)?.scannedAt, 2);
});

test('an office that answers nothing is not asked again and again (the setup panel draws often)', async (t) => {
  let calls = 0;
  setDocsFetcher(async () => (calls++, undefined));
  t.after(() => setDocsFetcher(undefined));
  await loadDocs('f');
  await loadDocs('f');
  await loadDocs('f');
  assert.equal(calls, 1);
  await loadDocs('f', { fresh: true });
  assert.equal(calls, 2, 'Refresh still asks');
  assert.ok(DOCS_FRESH_MS >= 10_000);
});

test('the search and the status filter', () => {
  const item = (id: string, status: DeliverableItem['status'], files: string[], optional = false): DeliverableItem => ({ id, team: 'analysis', title: id, status, ...(optional ? { optional } : {}), files: files.map((p) => ({ path: p, kind: 'md', status: 'present', where: [{ src: 'main', label: 'main' }] })) });
  const items = [item('Triage', 'present', ['triage.md']), item('BRD report', 'missing', []), item('Assessment', 'missing', [], true), item('Wireframes', 'branch', ['design/wireframes/a.html', 'design/wireframes/b.html'])];
  assert.deepEqual(filterItems(items, 'all', '').map((i) => i.id), ['Triage', 'BRD report', 'Assessment', 'Wireframes']);
  assert.deepEqual(filterItems(items, 'missing', '').map((i) => i.id), ['BRD report'], 'an optional one missing is not "Missing"');
  assert.deepEqual(filterItems(items, 'all', 'b.html').map((i) => [i.id, i.files.map((f) => f.path)]), [['Wireframes', ['design/wireframes/b.html']]]);
  assert.deepEqual(filterItems(items, 'all', 'brd').map((i) => i.id), ['BRD report']);
});

test('Documents is a page of the 1D view: a tab in General, its header, its own view, every opener showing it', () => {
  const html = read('src/client/lite.html');
  assert.match(html, /<button id="tab-documents"[^>]*role="tab"[^>]*>📄 Documents<\/button>/);
  assert.match(html, /<div id="documents-view" class="hidden"><\/div>/);
  assert.equal(navItem('documents')?.kind, 'tab');
  assert.equal(groupOf('documents')?.id, 'general');
  assert.equal(pageTitle('documents'), 'Documents');
  assert.match(navItem('documents')!.hint, /documents/i);
  const lite = read('src/client/lite.ts');
  assert.match(lite, /t === 'deliverables' \? 'documents'/, 'an old ?tab=deliverables lands on Documents');
  assert.match(lite, /documentsOpener\(\(\) => showTab\('documents'\)\)/);
  assert.match(lite, /if \(t === 'documents'\) documents\.show\(\);\n\s*else documents\.hide\(\);/);
  assert.match(lite, /mountProgressBar\(\$\('progress-bar'\), \{ setup: .*, deliverables: openDocuments \}\);/);
  assert.match(read('src/client/pixel.ts'), /deliverables: openDocuments \}\)/, 'the 2D view links to the page');
  assert.equal(documentsHref('travel approval'), '/lite?tab=documents&floor=travel%20approval');
  // The list is a page: no window for it any more, only the single document's viewer.
  for (const f of ['page.ts', 'summary.ts', 'store.ts', 'open.ts']) assert.doesNotMatch(read(`src/client/ui/deliverables/${f}`), /openModal/, f);
  assert.doesNotMatch(read('src/client/ui/deliverables/summary.ts'), /openFloorDeliverables/);
  assert.match(read('src/client/ui/deliverables/summary.ts'), /'Open documents →'/);
  // It shows at once: what's kept, else a skeleton, then the list.
  const page = read('src/client/ui/deliverables/page.ts');
  assert.match(page, /docsLoading\(f\) \? skeleton\(\)/);
});

test('one document viewer at a time: a second click on the same link keeps the one open', () => {
  const v = read('src/client/ui/deliverables/viewer.ts');
  assert.match(v, /if \(showing\?\.key === key\) return showing\.modal;/);
  assert.match(v, /showing\?\.modal\.close\(\);/);
});

test('openers that ask the office before their window shows are one at a time (Call an audit, Resume, Open in Studio Pro)', async () => {
  const { oneAtATime } = await import('../src/client/ui/once.js');
  let calls = 0;
  let done!: (v: string) => void;
  const open = oneAtATime(async (n: number) => {
    calls++;
    return new Promise<string>((r) => (done = (v) => r(`${v}${n}`)));
  });
  const clicks = [open(1), open(2), open(3)];
  assert.equal(calls, 1, 'three clicks while the office is slow: one call, one window');
  done('w');
  assert.deepEqual(await Promise.all(clicks), ['w1', 'w1', 'w1']);
  const later = open(4);
  assert.equal(calls, 2, 'once it has shown, a new click is a new call');
  done('v');
  assert.equal(await later, 'v4');
  assert.match(read('src/client/firm/wizard.ts'), /export const openAuditWizard = oneAtATime\(auditWizard\);/);
  assert.match(read('src/client/ui/firm/banner.ts'), /const callAudit = oneAtATime\(/);
  assert.match(read('src/client/mobile/resume.ts'), /export const resumeProject = oneAtATime\(resumeSheet\);/);
  assert.match(read('src/client/ui/studio/index.ts'), /export const openStudio = oneAtATime\(openStudioNow\);/);
});
