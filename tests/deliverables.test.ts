import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  draftByHead,
  draftByName,
  extraTeam,
  globMatch,
  isDeliverablePath,
  itemStatus,
  kindOf,
  safeRelPath,
  specFor,
  stageCounts,
  unsortedReport,
  type DeliverableItem,
} from '../src/shared/deliverables.js';
import { branchOwner, scanDeliverables } from '../src/server/deliverables/scan.js';
import { scanInput } from '../src/server/deliverables/index.js';
import { CAPS, inlineHtml, parseCsv, readDeliverable, resolveRef } from '../src/server/deliverables/content.js';
import { fileAnswer, tableAnswer } from '../src/server/deliverables/serve.js';
import { deliverablesBrief } from '../src/server/roster/deliverables-brief.js';
import { cleanSettings, defaultSettings } from '../src/server/roster/store.js';

test('the catalog knows the toolkit deliverables wherever the runbook allows them', () => {
  assert.equal(specFor('triage.md')?.id, 'triage');
  assert.equal(specFor('analysis/triage.html')?.id, 'triage');
  assert.equal(specFor('analysis/knowledge-base/brd/F001-travel-request-approval.brd.json')?.id, 'brd-json');
  assert.equal(specFor('analysis/brd-report.html')?.id, 'brd-report');
  assert.equal(specFor('analysis/knowledge-base/extraction-report.html')?.id, 'extraction-report');
  assert.equal(specFor('analysis/knowledge-base/share/KB.md')?.id, 'knowledge-base');
  assert.equal(specFor('design/wireframes/home.html')?.id, 'wireframes');
  assert.equal(specFor('design/wireframes/sub/list-draft.html')?.id, 'wireframes');
  assert.equal(specFor('architecture/modules/Travel/module-brief.md')?.id, 'module-briefs');
  assert.equal(specFor('docs/requirements/BRD-travel.pdf')?.id, 'brd-pdf');
  assert.equal(specFor('docs/requirements/use-cases.xlsx')?.id, 'use-cases');
  assert.equal(specFor('tests/e2e/submit.journey.json')?.id, 'journeys');
  // The toolkit's scaffold example is not a journey, and the client's sources are never deliverables.
  assert.equal(specFor('tests/e2e/example.journey.json'), undefined);
  assert.equal(specFor('sources/deck/triage.html'), undefined);
  assert.equal(specFor('src/app.ts'), undefined);
});

test('extras go to the first team whose folders they are in; sources, tooling and journals never', () => {
  assert.equal(extraTeam('design/ui-reviews/notes.md'), 'testing');
  assert.equal(extraTeam('design/moodboard.png'), 'design');
  assert.equal(extraTeam('architecture/notes.md'), 'development');
  assert.equal(extraTeam('docs/requirements/glossary.md'), 'analysis');
  assert.equal(extraTeam('docs/budget.xlsx'), 'analysis');
  assert.equal(extraTeam('travel-BRD-notes.md'), 'analysis');
  assert.equal(extraTeam('reports/testing/run-2026-10-06.html'), 'testing');
  assert.equal(extraTeam('design/ds.css'), undefined, 'a catalog file is no extra');
  for (const p of ['sources/a.pdf', 'node_modules/x/README.md', '.claude/agents/x.md', 'docs/team/design.md', 'src/main.ts', 'analysis/knowledge-base/text/deck/slide01.md']) assert.equal(isDeliverablePath(p), false, p);
});

test('globs: folders, names, alternatives and ranges, case-insensitive', () => {
  assert.ok(globMatch('**/triage.html', 'triage.html'));
  assert.ok(globMatch('**/triage.html', 'a/b/triage.html'));
  assert.ok(!globMatch('design/*.md', 'design/x/y.md'));
  assert.ok(globMatch('design/**', 'design/x/y.md'));
  assert.ok(globMatch('*.{pdf,xlsx}', 'Report.PDF'));
  assert.ok(globMatch('**/F[0-9][0-9][0-9]*.brd.json', 'kb/F042-x.brd.json'));
  assert.ok(!globMatch('**/F[0-9][0-9][0-9]*.brd.json', 'kb/Fx42-x.brd.json'));
});

test('paths from requests stay inside the project', () => {
  for (const bad of ['../x.md', 'a/../../x.md', '/etc/passwd', 'C:/x.md', 'a\\b.md', '-n', 'a//b.md', './a.md', '', 'a\0b']) assert.equal(safeRelPath(bad), false, JSON.stringify(bad));
  assert.ok(safeRelPath('design/wireframes/home.html'));
  assert.equal(resolveRef('design/wireframes/home.html', '../ds.css'), 'design/ds.css');
  assert.equal(resolveRef('design/wireframes/home.html', '/design/ds.css'), 'design/ds.css');
  assert.equal(resolveRef('design/x.html', '../../../etc/passwd'), undefined);
  assert.equal(resolveRef('design/x.html', 'https://cdn.example/x.css'), undefined);
  assert.equal(resolveRef('design/x.html', '//cdn.example/x.css'), undefined);
  assert.equal(resolveRef('design/x.html', 'img%20one.png?v=1#a'), 'design/img one.png');
});

test('kinds, drafts and statuses', () => {
  assert.deepEqual(['a.html', 'a.md', 'a.pdf', 'a.svg', 'a.xlsx', 'a.csv', 'a.json', 'a.css'].map(kindOf), ['html', 'md', 'pdf', 'image', 'xlsx', 'csv', 'json', 'text']);
  assert.ok(draftByName('design/wireframes/home-draft.html'));
  assert.ok(draftByName('architecture/drafts/x.md'));
  assert.ok(draftByName('tests/test-plan.draft.md'));
  assert.ok(!draftByName('design/drafty.md'));
  assert.ok(draftByHead('<div class="banner">DRAFT — before Stage 3 gate</div>'));
  assert.ok(draftByHead('# DRAFT: domain model'));
  assert.ok(!draftByHead('# Domain model\n\nNot a draft.'));
  assert.equal(itemStatus([]), 'missing');
  assert.equal(itemStatus([{ status: 'branch' }, { status: 'present' }]), 'present');
  assert.equal(itemStatus([{ status: 'draft' }, { status: 'branch' }]), 'branch');
  assert.equal(itemStatus([{ status: 'draft' }]), 'draft');
  const items = [
    { id: 'a', team: 'analysis', stage: '1', title: '', status: 'present', files: [] },
    { id: 'b', team: 'analysis', stage: '1', title: '', status: 'branch', files: [] },
    { id: 'c', team: 'analysis', stage: '1', title: '', status: 'missing', optional: true, files: [] },
    { id: 'd', team: 'design', stage: '3', title: '', status: 'missing', files: [] },
  ] as DeliverableItem[];
  assert.deepEqual(stageCounts(items), [
    { stage: '1', expected: 2, present: 1, branch: 1, draft: 0, missing: 0 },
    { stage: '3', expected: 1, present: 0, branch: 0, draft: 0, missing: 1 },
  ]);
});

/** A project with deliverables on main, on an office branch, and uncommitted in a team member's worktree. */
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-deliv-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'proj');
  mkdirSync(dir);
  const put = (base: string, file: string, text: string | Buffer) => {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), text);
  };
  const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' }).toString();
  g(dir, 'init', '-q', '-b', 'main');
  put(dir, '.gitignore', 'ignored/\n.agent-office/\n');
  put(dir, 'triage.md', '# Triage\n');
  put(dir, 'docs/standups/2026-10-05.md', '# Standup\n');
  put(dir, 'sources/client.pdf', '%PDF-1.4 not ours');
  put(dir, 'design/wireframes/list-draft.html', '<p>low-fi</p>');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'scaffold');
  // The Chief Analyst's branch, committed, not merged.
  g(dir, 'checkout', '-q', '-b', 'office/grace-a1b2');
  put(dir, 'analysis/brd-report.html', '<html><body>BRD</body></html>');
  put(dir, 'analysis/knowledge-base/brd/F001-x.brd.json', '{"id":"F001"}');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'stage 2');
  g(dir, 'checkout', '-q', 'main');
  // The Lead Designer's worktree with work it hasn't committed.
  const wt = path.join(dir, '.agent-office', 'worktrees', 'ada');
  g(dir, 'worktree', 'add', '-q', '-b', 'office/ada-c3d4', wt);
  put(wt, 'design/ds.css', ':root { --a: 1; }');
  put(wt, 'design/wireframes/home.html', '<link rel="stylesheet" href="../ds.css"><img src="logo.svg"><h1>Home</h1>');
  put(wt, 'design/wireframes/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  put(wt, 'architecture/domain-model.md', '# DRAFT — before Stage 3 gate\n\nerDiagram');
  put(dir, 'docs/requirements/use-cases.csv', 'id,actor\nUC1,"Traveller, ""frequent"""\nUC2,Manager\n');
  return { dir, wt, g, put };
}

const PEOPLE = (wt: string) => [
  { workerId: 'w-ada', name: 'Ada', role: 'lead-designer' as const, dir: wt, branch: 'office/ada-c3d4' },
  { name: 'Grace', role: 'chief-analyst' as const },
];

test('the scan finds main, a team worktree (uncommitted) and an office branch, with who and status', async (t) => {
  const { dir, wt } = fixture(t);
  const v = await scanDeliverables({ floor: 'f', dir, people: PEOPLE(wt) });
  const item = (id: string) => v.items.find((i) => i.id === id)!;
  assert.equal(item('triage').status, 'present');
  // The same blob on a branch or in a worktree isn't another copy (whatever line endings the checkout has).
  assert.deepEqual(item('triage').files[0].where.map((w) => w.src), ['main']);
  assert.equal(item('brd-report').status, 'branch');
  assert.deepEqual(item('brd-report').files[0].where, [{ src: 'ref:office/grace-a1b2', label: 'office/grace-a1b2', branch: 'office/grace-a1b2', who: 'Grace', role: 'chief-analyst' }]);
  assert.equal(item('ds-css').status, 'branch');
  assert.equal(item('ds-css').files[0].where[0].src, 'wt:w-ada');
  assert.equal(item('ds-css').files[0].where[0].who, 'Ada');
  assert.equal(item('domain-model').status, 'draft', 'a DRAFT banner at the top');
  // A draft on main is a draft, and the real wireframe in the worktree outranks it.
  assert.equal(item('wireframes').files.find((f) => f.path.endsWith('list-draft.html'))?.status, 'draft');
  assert.equal(item('wireframes').status, 'branch');
  assert.equal(item('use-cases').status, 'present', 'new and not ignored counts as on main');
  assert.equal(item('blueprint').status, 'missing');
  assert.ok(!v.items.some((i) => i.files.some((f) => f.path.startsWith('sources/'))));
  assert.deepEqual(v.sources.map((s) => s.src).sort(), ['ref:office/grace-a1b2', 'wt:w-ada']);
});

test('a branch is put down to the worker on it, else a team member whose name starts it', () => {
  const people = [{ name: 'Barbara', role: 'chief-analyst' as const }, { name: 'Pixel', workerId: 'w1', branch: 'office/pixel-31e0' }];
  assert.deepEqual(branchOwner('office/pixel-31e0', people), { who: 'Pixel', role: undefined });
  assert.deepEqual(branchOwner('origin/office/barbara-stage1', people), { who: 'Barbara', role: 'chief-analyst' });
  assert.deepEqual(branchOwner('office/nibble-1fa7', people), { who: 'Nibble' });
});

test('reading: only deliverable paths, inside the source, under the cap, from a folder or a branch', async (t) => {
  const { dir, wt } = fixture(t);
  assert.equal(((await readDeliverable({ dir }, 'triage.md', CAPS.text)) as { body: Buffer }).body.toString(), '# Triage\n');
  assert.equal(((await readDeliverable({ repo: dir, branch: 'office/grace-a1b2' }, 'analysis/brd-report.html', CAPS.text)) as { body: Buffer }).body.toString(), '<html><body>BRD</body></html>');
  assert.deepEqual(await readDeliverable({ dir }, '../proj/triage.md', CAPS.text), { status: 404, error: 'That is not a deliverable' });
  assert.deepEqual(await readDeliverable({ dir }, '.gitignore', CAPS.text), { status: 404, error: 'That is not a deliverable' });
  assert.deepEqual(await readDeliverable({ dir }, 'sources/client.pdf', CAPS.file), { status: 404, error: 'That is not a deliverable' });
  assert.equal(((await readDeliverable({ dir }, 'triage.md', 3)) as { status: number }).status, 413);
  assert.equal(((await readDeliverable({ repo: dir, branch: 'office/grace-a1b2' }, 'analysis/brd-report.html', 3)) as { status: number }).status, 413);
  assert.equal(((await readDeliverable({ repo: dir, branch: 'HEAD~1 --output=x' }, 'triage.md', CAPS.text)) as { status: number }).status, 400);
  assert.equal(((await readDeliverable({ dir: wt }, 'analysis/brd-report.html', CAPS.text)) as { status: number }).status, 404);
});

test('an HTML report is served self-contained: its stylesheet and pictures inlined, nothing else fetched', async (t) => {
  const { wt, put } = fixture(t);
  put(wt, 'design/wireframes/evil.html', '<link rel="stylesheet" href="../../.gitignore"><link rel="stylesheet" href="https://cdn.example/x.css"><script src="../../.gitignore"></script>');
  const html = await inlineHtml({ dir: wt }, 'design/wireframes/home.html', '<link rel="stylesheet" href="../ds.css"><img alt="l" src="logo.svg"><h1>Home</h1>');
  assert.match(html, /<style data-from="design\/ds.css">\n:root \{ --a: 1; \}\n<\/style>/);
  assert.match(html, /<img alt="l" src="data:image\/svg\+xml;base64,/);
  const evil = await inlineHtml({ dir: wt }, 'design/wireframes/evil.html', '<link rel="stylesheet" href="../../.gitignore"><link rel="stylesheet" href="https://cdn.example/x.css"><script src="../../.gitignore"></script>');
  assert.ok(!evil.includes('ignored/'), 'only .css and .js are inlined');
  assert.ok(evil.includes('https://cdn.example/x.css'), 'an outside link is left for the CSP to block');
  const a = await fileAnswer({ dir: wt }, 'design/wireframes/home.html', false);
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(a.headers['content-security-policy'], /default-src 'none'.*sandbox allow-scripts/);
  assert.doesNotMatch(a.headers['content-security-policy'], /allow-same-origin|connect-src/);
});

test('each kind is answered its own way: pictures and text sandboxed, PDF for the viewer, xlsx and downloads as attachments, CSV as rows', async (t) => {
  const { dir, wt, put } = fixture(t);
  put(dir, 'docs/requirements/BRD-x.pdf', '%PDF-1.4\n');
  put(dir, 'docs/requirements/use-cases.xlsx', 'PK\u0003\u0004');
  const svg = await fileAnswer({ dir: wt }, 'design/wireframes/logo.svg', false);
  assert.equal(svg.headers['content-type'], 'image/svg+xml');
  assert.match(svg.headers['content-security-policy'], /sandbox$/);
  const md = await fileAnswer({ dir }, 'triage.md', false);
  assert.equal(md.headers['content-type'], 'text/plain; charset=utf-8');
  const pdf = await fileAnswer({ dir }, 'docs/requirements/BRD-x.pdf', false);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.headers['content-security-policy'], "frame-ancestors 'self'");
  const xlsx = await fileAnswer({ dir }, 'docs/requirements/use-cases.xlsx', false);
  assert.match(xlsx.headers['content-disposition'], /^attachment; filename="use-cases.xlsx"$/);
  const dl = await fileAnswer({ dir }, 'triage.md', true);
  assert.equal(dl.headers['content-type'], 'application/octet-stream');
  const csv = await tableAnswer({ dir }, 'docs/requirements/use-cases.csv');
  assert.deepEqual(JSON.parse(csv.body.toString()), { rows: [['id', 'actor'], ['UC1', 'Traveller, "frequent"'], ['UC2', 'Manager']], more: false });
  assert.equal((await tableAnswer({ dir }, 'triage.md')).status, 415);
  assert.equal((await fileAnswer({ dir }, 'sources/client.pdf', false)).status, 404);
});

test('CSV: quotes, newlines in quotes, semicolons, and the row cap', () => {
  assert.deepEqual(parseCsv('a;b\r\n1;"x\ny"\r\n').rows, [['a', 'b'], ['1', 'x\ny']]);
  const big = parseCsv(Array.from({ length: 300 }, (_, i) => `r${i},v`).join('\n'), 200);
  assert.equal(big.rows.length, 200);
  assert.equal(big.more, true);
});

test('Playbooks: every Lead names its deliverables; early drafts are on by default and only for Design, Development and Testing', () => {
  assert.equal(defaultSettings().earlyDrafts, true);
  assert.equal(cleanSettings({}).earlyDrafts, true, 'a roster saved before the setting has it on');
  assert.equal(cleanSettings({ earlyDrafts: false }).earlyDrafts, false);
  assert.equal(cleanSettings({ earlyDrafts: 'no' }, cleanSettings({ earlyDrafts: false })).earlyDrafts, false);
  const text = (r: Parameters<typeof deliverablesBrief>[0], on = true) => deliverablesBrief(r, on).join('\n');
  assert.match(text('chief-analyst'), /docs\/requirements\/BRD-<feature>\.pdf/);
  assert.match(text('chief-analyst'), /use-cases\.xlsx/);
  assert.match(text('lead-designer'), /design\/storyboard\.html/);
  assert.match(text('lead-developer'), /architecture\/domain-model\.md/);
  assert.match(text('lead-tester'), /tests\/test-plan\.md/);
  assert.match(text('pm'), /docs\/status\//);
  for (const r of ['lead-designer', 'lead-developer', 'lead-tester'] as const) {
    assert.match(text(r), /### Early drafts/);
    assert.match(text(r), /DRAFT — before Stage 3 gate/);
    assert.doesNotMatch(text(r, false), /### Early drafts/);
    assert.match(text(r, false), /only once the stage before them is closed/);
  }
  assert.doesNotMatch(text('chief-analyst'), /Early drafts/);
  // Every draft path the Playbooks name is one the view counts as a draft of a catalog item.
  for (const p of ['design/wireframes/home-draft.html', 'architecture/domain-model-draft.md', 'architecture/blueprint-draft.md', 'tests/test-plan-draft.md']) {
    assert.ok(specFor(p), p);
    assert.ok(draftByName(p), p);
  }
});

test('reports: the analysts\' toolkit reports stay Analysis\'s where they are, every other team has reports/<team>/, the rest is unsorted', () => {
  assert.equal(specFor('reports/validation-report.md')?.id, 'brd-validation');
  assert.equal(specFor('reports/validation-report.md')?.team, 'analysis');
  assert.equal(extraTeam('reports/summary.md'), 'analysis');
  assert.equal(extraTeam('reports/gaps-report.md'), 'analysis');
  assert.equal(extraTeam('reports/analysis/cost-model.md'), 'analysis');
  for (const team of ['design', 'development', 'testing', 'management'] as const) assert.equal(extraTeam(`reports/${team}/review.md`), team);
  assert.equal(specFor('reports/testing/e2e-evidence-2026-10-06.html')?.id, 'test-report');
  assert.equal(specFor('reports/test-report.html')?.id, 'test-report', "the toolkit's own test report stays put");
  assert.equal(extraTeam('reports/random-notes.md'), undefined);
  assert.equal(unsortedReport('reports/random-notes.md'), true);
  assert.equal(unsortedReport('reports/design/review.md'), false);
  assert.equal(unsortedReport('reports/validation-report.md'), false);
  assert.equal(isDeliverablePath('reports/random-notes.md'), true);
});

test('the scan puts an unsorted report in Management\'s panel', async (t) => {
  const { dir, put, g } = fixture(t);
  put(dir, 'reports/random-notes.md', '# notes');
  put(dir, 'reports/design/a11y.md', '# a11y');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'reports');
  const v = await scanDeliverables({ floor: 'f', dir, people: [] });
  const unsorted = v.items.find((i) => i.id === 'unsorted-reports');
  assert.equal(unsorted?.team, 'management');
  assert.deepEqual(unsorted?.files.map((f) => f.path), ['reports/random-notes.md']);
  assert.deepEqual(v.items.find((i) => i.id === 'extras-design')?.files.map((f) => f.path), ['reports/design/a11y.md']);
});

test('with a remote, "main" is origin/<default>, not the folder\'s branch, and the view says where the folder is', async (t) => {
  const { dir, put, g } = fixture(t);
  // The fixture's repo becomes origin; the floor is a clone left on an old branch while main moves on.
  const floor = `${dir}-floor`;
  t.after(() => rmSync(floor, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', dir, floor], { stdio: 'pipe' });
  g(floor, 'checkout', '-q', '-b', 'old-run');
  put(dir, 'architecture/blueprint.md', '# Blueprint');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'blueprint merged');
  g(floor, 'fetch', '-q', 'origin');
  // Something only in the folder isn't on main any more.
  put(floor, 'design/brand.md', '# local only');
  const input = await scanInput({ id: 'f', dir: floor }, [], false);
  assert.equal(input.main?.def, 'main');
  assert.deepEqual(input.checkout, { branch: 'old-run', behind: 1, defaultBranch: 'main' });
  const v = await scanDeliverables(input);
  const item = (id: string) => v.items.find((i) => i.id === id)!;
  assert.equal(v.main, 'origin/main');
  assert.deepEqual(v.checkout, { branch: 'old-run', behind: 1, defaultBranch: 'main' });
  assert.equal(item('blueprint').status, 'present', 'merged on origin/main though the folder has not got it');
  assert.equal(item('blueprint').files[0].where[0].label, 'origin/main');
  assert.equal(item('brand').status, 'missing', 'the folder alone is not main');
  assert.equal(item('brd-report').status, 'branch', 'office branches still show, against origin/main');
  // Its content comes from that ref.
  const r = await readDeliverable({ repo: floor, branch: 'origin/main' }, 'architecture/blueprint.md', CAPS.text);
  assert.equal((r as { body: Buffer }).body.toString(), '# Blueprint');
  // No remote: the folder, as before.
  const local = await scanInput({ id: 'f', dir }, [], false);
  assert.equal(local.main, undefined);
});

test('Playbooks say where each Lead\'s reports go; the Chief Analyst is not told to move the toolkit\'s', () => {
  const text = (r: Parameters<typeof deliverablesBrief>[0]) => deliverablesBrief(r, true).join('\n');
  assert.match(text('lead-designer'), /`reports\/design\/`/);
  assert.match(text('lead-developer'), /`reports\/development\/`/);
  assert.match(text('lead-tester'), /`reports\/testing\/e2e-evidence-<YYYY-MM-DD>\.html`/);
  assert.match(text('pm'), /`reports\/management\/`/);
  const analyst = text('chief-analyst');
  assert.match(analyst, /`reports\/validation-report\.md`.*stay where the toolkit writes them/);
  assert.doesNotMatch(analyst, /move/i);
  // Every report path the Playbooks name is one the view gives that team.
  assert.equal(extraTeam('reports/design/x.md'), 'design');
  assert.equal(specFor('reports/testing/e2e-evidence-2026-10-06.html')?.team, 'testing');
});
