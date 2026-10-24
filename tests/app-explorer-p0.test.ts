// The Developer view's explorer and documents on a project with a real project's shape (tests/support/
// devview-fixture.ts: made up, no real names), with no live app at all:
//   - main's newest commit is the default revision; the live app's revision is only "behind main" information
//   - a commit without a model gives a specific error ("Couldn't read the model at abc1234: …"), not kept
//   - pages show their titles, the technical name in the details line; folders as in the model
//   - Marketplace modules folded into one group, found by their unit (FromAppStore or an App Store id)
//   - counts say what they count: the app's own, what the Marketplace adds; modules without records left out
//   - the whole tree at once (the search: folded groups too) and a search over every file of the revision
//   - documents: each relationship (versions, alternatives, supporting, related, review runs, unknown), the
//     "must hold" cases (BRD source data not hidden, storyboard/wireframes not superseded by the prototype,
//     design tokens kept), dates from git (never a file's time on disk), the revision named, status only
//     from a real source
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { explorerIndex, explorerLevel } from '../src/server/app-explorer/index.js';
import { explorerHead } from '../src/server/app-explorer/head.js';
import { searchFiles } from '../src/server/app-explorer/files.js';
import { documentsAt } from '../src/server/app-explorer/documents.js';
import { appExplorerRoutes } from '../src/server/http/routes/app-explorer.js';
import { modelOf } from '../src/server/model/index.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { classifyDocuments, type DocEntry, type DocumentsView } from '../src/shared/app-documents.js';
import { artifactKey, runOf, statusOf } from '../src/shared/app-documents-rules.js';
import type { ExplorerNode } from '../src/shared/app-explorer.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite } from './support/mendix.js';
import { makeFixture, type Fixture } from './support/devview-fixture.js';

test.after(() => stopExecWorker());

let fx: Fixture | undefined;
let root = '';
const ctx = () => ({ cfg: { dataDir: path.join(root, 'data') } });
async function fixture(): Promise<Fixture> {
  if (fx) return fx;
  root = mkdtempSync(path.join(tmpdir(), 'ao-explorer-p0-'));
  fx = await makeFixture(root);
  return fx;
}
test.after(() => {
  if (root) {
    modelOf(ctx()).units.close();
    removeDir(root);
  }
});

const labels = (nodes: ExplorerNode[]) => nodes.map((n) => n.label);
type Level = { rev: string; nodes: ExplorerNode[]; problem?: string };
async function lvl(f: Fixture, at: string, sha = f.head): Promise<Level> {
  const r = await explorerLevel(ctx(), { id: 'f1', dir: f.dir } as never, sha, at);
  assert.ok(!('error' in r), `${at}: ${JSON.stringify(r)}`);
  return r as Level;
}

test('the explorer reads main’s newest commit with no live app; the live app’s revision is only information', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const f = await fixture();
  const head = await explorerHead(f.dir);
  assert.equal(head.rev, f.head, 'main’s newest commit');
  assert.equal(head.branch, 'main');
  assert.equal(head.at, f.times[f.times.length - 1] * 1000);
  const behind = await explorerHead(f.dir, f.shas[1]);
  assert.deepEqual(behind.served, { sha: f.shas[1], behind: 2, ahead: 0 }, 'the live app 2 commits behind main');
  assert.deepEqual((await explorerHead(f.dir, f.head)).served, { sha: f.head, behind: 0, ahead: 0 });
  // The tree at main: nothing about a live app is asked for or needed.
  const top = await lvl(f, '');
  assert.deepEqual(labels(top.nodes), ['Pages', 'Data', 'Logic']);
  assert.equal(top.problem, undefined);
});

test('a commit without a model: a specific error naming the commit, and it isn’t kept', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const f = await fixture();
  const r = await lvl(f, '', f.noModel);
  assert.deepEqual(r.nodes, []);
  assert.match(r.problem ?? '', new RegExp(`^Couldn’t read the model at ${f.noModel.slice(0, 7)}: no Mendix project \\(\\.mpr\\) in this commit`));
  const ix = await explorerIndex(ctx(), { id: 'f1', dir: f.dir } as never, f.noModel);
  assert.match(ix.problem ?? '', /Couldn’t read the model at/);
  const bad = await lvl(f, '', '0123456789012345678901234567890123456789');
  assert.match(bad.problem ?? '', /^Couldn’t read the model at 0123456: /);
  // Through the route: answered (200) with the problem, and not kept by the browser.
  const res = await call(f, `tree?floor=f1&rev=${f.noModel}&at=`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(String(res.body.problem), /Couldn’t read the model/);
  const ok = await call(f, `tree?floor=f1&rev=${f.head}&at=`);
  assert.match(ok.headers['cache-control'] ?? '', /max-age/);
});

test('pages: titles with the technical name in the details line, folders as in the model, Marketplace folded, counts that say what they count', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const f = await fixture();
  const top = await lvl(f, '');
  const [pages, data, logic] = top.nodes;
  assert.equal(pages.count, 5, 'the app’s own pages (4 + the template page)');
  assert.equal(pages.addonCount, 16, 'what Marketplace modules add (9 + 6 + 1)');
  assert.match(pages.hint ?? '', /5 pages in the app’s own modules; Marketplace modules add 16 more \(21 in all\)/);
  assert.equal(data.count, 3, 'kinds of records in the app’s own modules: modules without records add nothing');
  assert.equal(data.addonCount, 2);
  assert.equal(logic.count, 2);
  // Pages: the app's modules, then one Marketplace group.
  const mods = await lvl(f, 'pages');
  assert.deepEqual(labels(mods.nodes), ['Field ops', 'My first module', 'Marketplace modules']);
  assert.deepEqual(mods.nodes.map((n) => n.count), [4, 1, 16]);
  const market = await lvl(f, 'pages/@marketplace');
  assert.deepEqual(labels(market.nodes), ['Administration', 'Atlas core', 'Feedback module'], 'FeedbackModule only has an App Store id: still Marketplace');
  assert.ok(market.nodes.every((n) => n.addon));
  assert.match(market.nodes[0].hint ?? '', /version 4\.3\.2/);
  // Folders as in the model.
  const app = await lvl(f, 'pages/FieldOps');
  assert.deepEqual(app.nodes.map((n) => `${n.kind}:${n.label}`), ['folder:Approvals', 'folder:Inspections']);
  const insp = await lvl(f, 'pages/FieldOps/Inspections');
  assert.deepEqual(insp.nodes.map((n) => `${n.kind}:${n.label}`), ['folder:Forms', 'page:My inspections']);
  const forms = await lvl(f, 'pages/FieldOps/Inspections/Forms');
  assert.deepEqual(labels(forms.nodes), ['Inspection details', 'New inspection'], 'the page’s own title (English), not its technical name');
  const view = forms.nodes.find((n) => n.qn === 'FieldOps.Inspection_View')!;
  assert.equal(view.detail, 'FieldOps.Inspection_View · FieldOps › Inspections › Forms');
  assert.match(view.hint ?? '', /FieldOps\.Inspection_View/);
  assert.equal(insp.nodes[1].url, '/p/my-inspections');
  // Folder with spaces, nested, in a Marketplace module.
  const adminLevel = await lvl(f, 'pages/Administration');
  assert.deepEqual(labels(adminLevel.nodes), ['User Management']);
  assert.equal((await lvl(f, adminLevel.nodes[0].id)).nodes[0].label, 'Admin');
  // A page without a title: its name in words.
  assert.deepEqual(labels((await lvl(f, 'pages/MyFirstModule')).nodes), ['Home web']);
  // Data: no module without records.
  assert.deepEqual(labels((await lvl(f, 'data')).nodes), ['Field ops', 'Marketplace modules']);
  assert.deepEqual(labels((await lvl(f, 'data/@marketplace')).nodes), ['Administration', 'Feedback module']);
  // Logic: folders too.
  assert.deepEqual(labels((await lvl(f, 'logic/FieldOps')).nodes), ['Approvals', 'Inspections']);
});

test('the search: the whole tree at once (folded Marketplace groups too) and every file of the revision', async (t) => {
  if (!(await hasSqlite())) return t.skip('no node:sqlite here');
  const f = await fixture();
  const ix = await explorerIndex(ctx(), { id: 'f1', dir: f.dir } as never, f.head);
  const all = Object.values(ix.levels).flat();
  assert.ok(all.some((n) => n.qn === 'FeedbackModule.Feedback_Thanks'), 'a page inside the folded Marketplace group');
  assert.ok(all.some((n) => n.qn === 'FieldOps.Inspection_View'), 'a page three folders deep');
  assert.ok(ix.levels['pages/Administration/User%20Management/Admin'].length === 9);
  const hit = await searchFiles(f.dir, f.head, 'night approvals');
  assert.deepEqual(hit.nodes.map((n) => n.path), ['design/ui-reviews/shots/2026-10-18-night/approvals-1280.png'], 'a file in a folder never opened');
  const many = await searchFiles(f.dir, f.head, 'mxunit');
  assert.ok(many.total > 30 && many.nodes.length === many.total, 'every unit file found');
  assert.equal((await searchFiles(f.dir, f.head, '')).total, 0);
  assert.equal((await searchFiles(f.dir, f.head, '.env')).total, 0, 'the denylist holds in the search');
});

const entry = (v: DocumentsView, pred: (e: DocEntry) => boolean, what: string) => {
  const e = v.entries.find(pred);
  assert.ok(e, `${what}: ${v.entries.map((x) => x.title).join(', ')}`);
  return e!;
};
const has = (e: DocEntry, p: string) => [...e.files, ...(e.formats ?? []), ...(e.runs ?? []).flatMap((r) => r.files)].some((f) => f.path === p);
const of = (v: DocumentsView, p: string) => entry(v, (e) => has(e, p), p);

test('documents: each relationship, the must-holds, git dates, the revision and status only from a source', async (t) => {
  const f = await fixture();
  const v = await documentsAt(ctx(), { id: 'f1', dir: f.dir }, f.head);
  assert.equal(v.rev, f.head, 'the revision every document comes from');
  assert.equal(v.problem, undefined);
  // Versions: the same artifact with a version, date or round suffix; a dated series; never by date alone.
  const brand = of(v, 'design/brand-v2.md');
  assert.equal(brand.shape, 'versions');
  assert.deepEqual(brand.files.map((x) => x.path), ['design/brand-v2.md', 'design/brand-v1.md'], 'by what the names say');
  assert.ok(brand.relations.includes('version'));
  const gate = of(v, 'reports/management/gate-check-main-2026-10-18.md');
  assert.deepEqual(gate.files.map((x) => x.marker), ['2026-10-18', '2026-10-16']);
  const standups = of(v, 'docs/standups/2026-10-22.md');
  assert.equal(standups.shape, 'versions');
  assert.equal(standups.files.length, 3);
  assert.equal(standups.files[0].path, 'docs/standups/2026-10-23.md');
  // A git rename: shown with where it came from.
  const plan = of(v, 'architecture/build-plan.md');
  assert.equal(plan.files[0].renamedFrom, 'architecture/build-plan-old.md');
  // Alternatives: two formats as one entry, side by side; screen representations linked, none hidden.
  const blueprint = of(v, 'architecture/blueprint.md');
  assert.ok(has(blueprint, 'architecture/blueprint.html'));
  assert.ok(blueprint.relations.includes('alternative'));
  assert.equal(blueprint.shape, 'single', 'formats aren’t versions');
  const wire = of(v, 'design/wireframes/Inspection_Overview.html');
  const frame = of(v, 'design/storyboard/01-Inspection_Overview.png');
  const proto = of(v, 'design/prototype.html');
  for (const e of [wire, frame, proto]) assert.ok(e.relations.includes('alternative'), e.title);
  assert.ok(wire.links.some((l) => l.relation === 'alternative' && l.to === frame.id && /Storyboard frame/.test(l.label)));
  assert.ok(wire.links.some((l) => l.relation === 'alternative' && l.to === proto.id && l.route === '#/my-inspections'));
  // Must hold: storyboard and wireframes are not superseded by the prototype (each its own entry, never a version).
  assert.notEqual(wire.id, proto.id);
  assert.notEqual(frame.id, proto.id);
  assert.ok(!wire.relations.includes('version') && !proto.relations.includes('version'));
  const story = of(v, 'design/storyboard.html');
  assert.ok(story.links.some((l) => l.relation === 'alternative' && l.to === proto.id), 'the storyboard and the prototype of the whole app');
  // Supporting: design tokens kept as their own entry, used by the wireframes and the design system.
  const tokens = of(v, 'design/ds.css');
  assert.equal(tokens.role, 'Design tokens');
  assert.ok(tokens.relations.includes('supporting'));
  assert.ok(tokens.links.some((l) => l.relation === 'supporting' && l.to === wire.id));
  assert.ok(wire.links.some((l) => l.relation === 'supporting' && l.to === tokens.id && l.label === 'Uses ds.css'));
  assert.ok(story.links.some((l) => l.relation === 'supporting' && l.to === frame.id), 'the frames the storyboard shows');
  // Related: BRD source data next to the report, never hidden as an older one.
  const brdData = of(v, 'analysis/F001-visit-log.brd.json');
  const brdReport = of(v, 'analysis/brd-report.html');
  assert.notEqual(brdData.id, brdReport.id);
  assert.equal(brdData.role, 'BRD source data');
  assert.ok(brdData.relations.includes('related') && !brdData.relations.includes('version'));
  assert.ok(brdReport.links.some((l) => l.relation === 'related' && l.to === brdData.id));
  // Earlier review runs: every dated round listed, newest name first, related to its report.
  const rounds = of(v, 'design/ui-reviews/shots/2026-10-17/overview-1280.png');
  assert.equal(rounds.shape, 'runs');
  assert.deepEqual(rounds.runs!.map((r) => r.label), ['18 Oct 2026 · r2 · 2 shots', '18 Oct 2026 · night · 2 shots', '17 Oct 2026 · 3 shots']);
  assert.ok(rounds.relations.includes('run'));
  const review = of(v, 'design/ui-reviews/ui-review-2026-10-17.html');
  assert.ok(review.links.some((l) => l.relation === 'related' && l.to === rounds.id));
  // Unknown: stays its own entry.
  const fit = of(v, 'architecture/fit-gap.md');
  assert.deepEqual(fit.relations, ['unknown']);
  assert.deepEqual(of(v, 'tests/test-plan.md').relations, ['unknown']);
  // Dates: the last commit that touched the file at the revision, its author; never the file's time on disk.
  const day = (i: number) => f.times[i] * 1000;
  assert.deepEqual([brand.files[0].last?.at, brand.files[0].last?.author], [day(1), 'Bo']);
  assert.deepEqual([brand.files[1].last?.at, brand.files[1].last?.author, brand.files[1].last?.sha], [day(0), 'Ada', f.shas[0]]);
  assert.equal(plan.files[0].last?.at, day(2), 'renamed on day 2');
  assert.ok(v.entries.every((e) => [...e.files, ...(e.formats ?? [])].every((x) => x.last && x.last.at > Date.UTC(2020, 0, 1))), 'never 2001 (the files’ time on disk)');
  // At an older revision: what was there then, dated then.
  const old = await documentsAt(ctx(), { id: 'f1', dir: f.dir }, f.shas[1]);
  assert.equal(old.rev, f.shas[1]);
  assert.equal(of(old, 'docs/standups/2026-10-21.md').files.length, 1);
  assert.ok(!old.entries.some((e) => has(e, 'design/prototype.html')));
  // Status only from a real source; a newer date never means approved.
  assert.deepEqual([brand.files[0].status?.value, brand.files[0].status?.source], ['draft', 'Status line']);
  assert.deepEqual([brand.files[1].status?.value, brand.files[1].status?.source], ['draft', 'front matter']);
  assert.deepEqual([wire.files[0].status?.value, wire.files[0].status?.source], ['current', 'PAGE-MAP.tsv']);
  assert.equal(of(v, 'docs/requirements/handover-draft.md').files[0].status?.source, 'DRAFT banner');
  assert.equal(gate.files[0].status, undefined, 'the newer gate check isn’t "approved" or "current"');
  assert.ok(v.entries.every((e) => e.files.every((x) => x.status?.value !== 'approved')), 'nothing approved without a record');
  for (const k of ['version', 'alternative', 'supporting', 'related', 'run', 'unknown'] as const) assert.ok(v.counts[k] > 0, k);
  // Through the route.
  const res = await call(f, `documents?floor=f1&rev=${f.head}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rev, f.head);
});

test('relationship rules on their own: keys, runs, status, acceptance', () => {
  assert.equal(artifactKey('design/brand-v2.md').key, artifactKey('design/brand.md').key);
  assert.equal(artifactKey('docs/a-2026-10-01.md').key, 'docs/a.md');
  assert.notEqual(artifactKey('docs/a.md').key, artifactKey('docs/a.html').key, 'another kind is no version');
  assert.notEqual(artifactKey('x/a-v2.md').key, artifactKey('y/a-v1.md').key, 'another folder is no version');
  assert.equal(artifactKey('docs/standups/2026-10-23.md').dateOnly, true);
  assert.deepEqual(runOf('d/shots/2026-10-18-r2/a.png'), { base: 'd/shots', run: 'd/shots/2026-10-18-r2', date: '2026-10-18', tag: 'r2' });
  assert.equal(runOf('docs/standups/2026-10-23.md'), undefined);
  assert.equal(statusOf('a.md', '# A\n\nsome text'), undefined, 'no source, no status');
  assert.equal(statusOf('drafts/a.md', '# A')?.source, 'file name');
  // Two files with the same name pattern but different dates in the name are versions; same files with
  // only commit dates apart stay separate (dates never make versions).
  const c = (at: number) => ({ sha: 'a'.repeat(40), at, author: 'x', subject: 's' });
  const v = classifyDocuments('b'.repeat(40), [
    { path: 'architecture/notes.md', size: 1, last: c(1) },
    { path: 'architecture/ideas.md', size: 1, last: c(2) },
    { path: 'design/look.md', size: 1, last: c(3) },
  ]);
  assert.equal(v.entries.length, 3);
  assert.ok(v.entries.every((e) => e.shape === 'single' && e.relations[0] === 'unknown'));
  // An acceptance record that cites a file: approved, with its source; changed since when it was.
  const acc = classifyDocuments('b'.repeat(40), [{ path: 'architecture/blueprint.md', size: 1, last: c(5_000) }], new Map([['architecture/blueprint.md', { version: 'v1', commit: 'c'.repeat(40), at: 1_000 }]]));
  assert.deepEqual([acc.entries[0].files[0].status?.value, acc.entries[0].files[0].status?.source], ['approved', 'acceptance record']);
  assert.match(acc.entries[0].files[0].status?.text ?? '', /changed since/);
});

async function call(f: Fixture, q: string) {
  const c = { ...ctx(), floors: new Map([['f1', { id: 'f1', dir: f.dir }]]) };
  let status = 0;
  let body = '';
  let headers: Record<string, string> = {};
  const res = { writeHead: (s: number, h?: Record<string, string>) => ((status = s), (headers = { ...(h ?? {}) })), end: (b: string) => (body = b), setHeader: () => undefined };
  const url = new URL(`http://office.test/api/app-explorer/${q}`);
  await appExplorerRoutes.explorer.handle(c as never, { req: {} as never, res: res as never, url, path: url.pathname, session: {} as never } as never);
  return { status, headers, body: JSON.parse(body || '{}') as Record<string, unknown> };
}
