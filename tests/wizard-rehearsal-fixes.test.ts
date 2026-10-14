// Creation rehearsal 2's should-fix findings in the New project flow: a draft keeps the change's repository
// (and a resumed draft brings it back), the planner is told the repository's name in change mode without
// ever reading it, the input documents in sources/ are given by their full path (a hire's worktree has no
// sources/: it's git-ignored) with the toolkit's inventory step, and the setup's log keeps its head and tail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Planner, type PlannerConfig } from '../src/server/wizard/planner/index.js';
import { draftView } from '../src/server/wizard/planner/drafts.js';
import { fakeBrief, fakeChat, fakeDomains } from '../src/server/wizard/planner/fake.js';
import type { PlannerEngine } from '../src/server/wizard/planner/engine.js';
import { briefInput, chatInput } from '../src/server/wizard/planner/prompts.js';
import { draftRepoOf, repoFrom, repoText, type DraftRepo, type PlanBrief } from '../src/shared/brief.js';
import { briefForDiscovery, sourcesDirOf } from '../src/shared/brief-map.js';
import { discoveryBrief } from '../src/server/wizard/brief.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { keepLine } from '../src/server/wizard/job.js';
import { playbook, sourcesOf } from '../src/server/roster/playbooks.js';
import { defaultCoverage } from '../src/shared/roster/coverage.js';
import type { ProjectPlan } from '../src/shared/wizard.js';

const me = { id: 'u1', name: 'Alex Lee' };
const cfg = (over: Partial<PlannerConfig> = {}): PlannerConfig => ({ mode: 'auto', model: 'sonnet', capUsd: 2, timeoutMs: 1000, perHour: 20, ...over });
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function tmp(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-rehearsal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The test planner's answers, noting the repository each call was given. */
function seeingEngine(): PlannerEngine & { repos: (DraftRepo | undefined)[] } {
  const repos: (DraftRepo | undefined)[] = [];
  return {
    repos,
    kind: 'cli',
    model: 'sonnet',
    why: () => undefined,
    async brief(req) {
      repos.push(req.repo);
      return { value: fakeBrief(req.files), cost: 0 };
    },
    async chat(req) {
      repos.push(req.repo);
      return { value: fakeChat(req.brief, req.history, req.text), cost: 0 };
    },
    async domains() {
      return { value: fakeDomains(), cost: 0 };
    },
  };
}

test('a draft keeps the change’s repository: made with it, changed, forgotten in another mode, and back after a restart', (t) => {
  const dir = tmp(t);
  const p = new Planner(dir, { engine: seeingEngine(), config: cfg() });
  const d = p.create(me, { mode: 'change', prompt: 'Add a withdraw option', repo: { owner: 'acme', name: 'travel-approval', description: 'Trip\nrequests' } });
  assert.deepEqual(d.repo, { owner: 'acme', name: 'travel-approval', description: 'Trip requests' });
  assert.deepEqual(draftView(d).repo, d.repo, 'the page sees it');
  // A resumed draft is read back from disk with it.
  const again = new Planner(dir, { engine: seeingEngine(), config: cfg() });
  assert.deepEqual(again.get(d.id, me)?.repo, d.repo);
  p.update(d, { repo: { owner: 'acme', name: 'travel-v2' } });
  assert.deepEqual(d.repo, { owner: 'acme', name: 'travel-v2' });
  p.update(d, { prompt: 'Only the prompt changed' });
  assert.equal(d.repo?.name, 'travel-v2', 'an update without a repository keeps it');
  p.update(d, { repo: { owner: 'bad owner', name: 'x' } });
  assert.equal(d.repo, undefined, 'one that isn’t owner/name is dropped');
  p.update(d, { repo: { owner: 'acme', name: 'travel-v2' } });
  p.update(d, { mode: 'plan' });
  assert.equal(d.repo, undefined, 'a new app names no repository');
  assert.equal(p.create(me, { mode: 'plan', prompt: 'x', repo: { owner: 'acme', name: 'y' } }).repo, undefined);
  assert.deepEqual(p.create(me, { mode: 'assurance', prompt: 'x', repo: { owner: 'acme', name: 'y' } }).repo, { owner: 'acme', name: 'y' });
});

test('the repository field’s text: owner/name, its description from the list the office already has, nothing else', () => {
  assert.equal(draftRepoOf(null), undefined);
  assert.equal(draftRepoOf({ owner: 'acme' }), undefined);
  assert.equal(draftRepoOf({ owner: 'acme', name: 'a/b' }), undefined);
  assert.equal(draftRepoOf({ owner: 'acme', name: 'app', description: 'x'.repeat(400) })!.description!.length, 300);
  const known = [{ name: 'Acme/Travel-Approval', description: 'Trip requests' }];
  assert.deepEqual(repoFrom(' acme/travel-approval ', known), { owner: 'acme', name: 'travel-approval', description: 'Trip requests' });
  assert.deepEqual(repoFrom('acme/other', known), { owner: 'acme', name: 'other' });
  assert.equal(repoFrom('acme', known), null);
  assert.equal(repoFrom('a/b/c', known), null);
  assert.equal(repoText({ owner: 'acme', name: 'app' }), 'acme/app');
  assert.equal(repoText(undefined), '');
});

test('Continue on a resumed draft brings its repository back, and a fixed field loses its error', () => {
  const start = src('src/client/ui/wizard/new/start.ts');
  const resume = start.slice(start.indexOf('function resumeCard'), start.indexOf('const setMode'));
  assert.match(resume, /repo\.value = repoText\(d\.repo\)/);
  assert.match(resume, /setMode\(d\.mode\)/);
  assert.match(resume, /applyRepo\(\)/, 'the plan gets the repository (the Advanced field)');
  assert.match(start, /briefApi\.update\(d\.id, \{ prompt: ta\.value, mode, repo: r \}\)/, 'the draft keeps what the field says');
  assert.match(start, /repo\.removeAttribute\('aria-invalid'\)/);
  const plan = src('src/client/ui/wizard/new/plan.ts');
  assert.match(plan, /p\.kind === 'change' && d\.repo && !p\.name/, 'the plan falls back to the draft’s repository');
  const adv = src('src/client/ui/wizard/new/advanced.ts');
  assert.match(adv, /function clearFixed\(\)/);
  assert.match(adv, /root\.addEventListener\('input', clearFixed\)/);
  assert.match(adv, /briefApi\.update\(id, \{ repo: r \}\)/, 'a repository picked under Advanced is kept on the draft too');
});

test('change mode: the planner is told the repository’s name and description, and that it hasn’t read it', async (t) => {
  const engine = seeingEngine();
  const p = new Planner(tmp(t), { engine, config: cfg() });
  const d = p.create(me, { mode: 'change', prompt: 'Add a withdraw option', repo: { owner: 'acme', name: 'travel-approval', description: 'Trip requests' } });
  assert.equal(p.draft(d, me), undefined);
  await (p.running.get(d.id) ?? Promise.resolve());
  assert.equal(p.chat(d, 'CSV export too', me), undefined);
  await (p.running.get(d.id) ?? Promise.resolve());
  assert.deepEqual(engine.repos.map((r) => r?.name), ['travel-approval', 'travel-approval'], 'the brief and the chat');
  const input = briefInput('Add a withdraw option', [], [], d.repo);
  assert.match(input, /The existing app's repository: acme\/travel-approval \(its GitHub description: "Trip requests"\)\./);
  assert.match(input, /You have not read this repository and cannot: the team reads the app after setup\./);
  assert.match(chatInput(d.brief!, [], 'hi', d.repo), /acme\/travel-approval/);
  assert.doesNotMatch(briefInput('A new app', [], []), /repository/, 'nothing for a new app');
  // The start card no longer claims anyone read it first.
  const start = src('src/client/ui/wizard/new/start.ts');
  assert.doesNotMatch(start, /reads it first/);
  assert.match(start, /The brief is drafted from your description; the team reads the app after setup\./);
  // The repository is only ever text in the prompt: the planning call's files are the attached PDFs alone.
  assert.match(src('src/server/wizard/planner/engine.ts'), /briefInput\(req\.prompt, texts, pdfs\.map\(\(f\) => f\.name\), req\.repo\)[^\n]*, BRIEF_SCHEMA, req\.budgetUsd, pdfs\)/);
});

const pb = (): PlanBrief => ({ brief: fakeBrief([]).brief, attachments: [{ name: 'workshop.pdf', size: 99, read: 'read' }], approved: { by: 'Alex Lee', at: '2026-10-12T10:45:00.000Z', assumed: 0 } });

test('the Discovery issue gives the documents’ full path and the toolkit’s inventory step (a worktree has no sources/)', () => {
  assert.equal(sourcesDirOf('C:\\Projects\\travel\\'), 'C:/Projects/travel/sources');
  const lines = briefForDiscovery(pb(), { sourcesDir: 'C:/Projects/travel/sources', toolkitDir: 'C:\\tk-pins\\7b4b4cf13b9f' }).join('\n');
  assert.match(lines, /The attached documents are in `C:\/Projects\/travel\/sources`: workshop\.pdf/);
  assert.match(lines, /git-ignored, so only in the main checkout and never in your worktree/);
  assert.match(lines, /`C:\/tk-pins\/7b4b4cf13b9f\/bin\/source-sufficiency\.sh init \. --sources C:\/Projects\/travel\/sources`/);
  assert.match(briefForDiscovery(pb()).join('\n'), /The attached documents are in `sources\/`/, 'without a folder it says sources/ as before');
  assert.doesNotMatch(briefForDiscovery({ ...pb(), attachments: [] }, { sourcesDir: 'C:/x/sources' }).join('\n'), /source-sufficiency/, 'no documents, no inventory step');
  const plan = cleanPlan({ kind: 'new', owner: 'org', name: 'travel', mendix: '11.12.4', entry: 'requirements-driven', roles: ['chief-analyst'], discovery: { issue: true }, brief: { draftId: 'd-abc123-0a1b2c', ...pb() } }, ['11.12.4'], 'org') as ProjectPlan;
  assert.match(discoveryBrief(plan, 'C:/tk', 'abcdef0123', 'C:\\Projects\\travel'), /C:\/Projects\/travel\/sources/);
  assert.match(src('src/server/wizard/steps.ts'), /discoveryBrief\(job\.plan, [^)]*, job\.dir\)/);
});

test('the analyst’s Playbook says where the documents are and to inventory them, only when the project has sources/', (t) => {
  const names = { pm: 'Pat', 'lead-designer': 'Dee', 'lead-developer': 'Dev', 'lead-tester': 'Tess', 'chief-analyst': 'Tim', 'solo-lead': 'Sol' };
  const ctx = (over: object) => ({ project: 'travel', name: 'Tim', names, level: 2, lessons: 'L.md', toolkit: { dir: 'C:/tk-pins/7b4b4cf13b9f', sha: '7b4b4cf13b9f' }, ...over }) as Parameters<typeof playbook>[1];
  const ca = playbook('chief-analyst', ctx({ sources: 'C:/Projects/travel/sources' }));
  assert.match(ca, /## Input documents/);
  assert.match(ca, /`C:\/tk-pins\/7b4b4cf13b9f\/bin\/source-sufficiency\.sh init \. --sources C:\/Projects\/travel\/sources`/);
  assert.doesNotMatch(playbook('lead-developer', ctx({ sources: 'C:/Projects/travel/sources' })), /## Input documents/, 'only whoever does the analysis');
  assert.doesNotMatch(playbook('chief-analyst', ctx({})), /## Input documents/, 'nothing when there is no sources/');
  assert.match(playbook('solo-lead', ctx({ sources: 'C:/p/sources', coverage: defaultCoverage('solo') })), /## Input documents/, 'the Solo Lead covers Analysis');
  const dir = tmp(t);
  assert.deepEqual(sourcesOf(dir), {});
  mkdirSync(path.join(dir, 'sources'));
  assert.equal(sourcesOf(dir).sources, `${dir.replace(/\\/g, '/')}/sources`);
});

test('the setup’s log keeps its head and its tail, with how many lines were left out between them', () => {
  const log: string[] = [];
  for (let i = 1; i <= 10; i++) keepLine(log, `l${i}`, 3, 4);
  assert.deepEqual(log, ['l1', 'l2', 'l3', '… 3 lines left out …', 'l7', 'l8', 'l9', 'l10']);
  keepLine(log, 'l11', 3, 4);
  assert.deepEqual(log, ['l1', 'l2', 'l3', '… 4 lines left out …', 'l8', 'l9', 'l10', 'l11']);
  const short: string[] = [];
  for (let i = 1; i <= 8; i++) keepLine(short, `s${i}`, 3, 4);
  assert.equal(short.length, 8, 'nothing is left out until it has to be');
  keepLine(short, 's9', 3, 4);
  assert.deepEqual(short, ['s1', 's2', 's3', '… 2 lines left out …', 's6', 's7', 's8', 's9']);
  // The real sizes: 3,000 lines and the marker, whatever is said.
  const big: string[] = [];
  for (let i = 0; i < 10_000; i++) keepLine(big, `line ${i}`);
  assert.equal(big.length, 3001);
  assert.equal(big[0], 'line 0');
  assert.equal(big[300], '… 7000 lines left out …');
  assert.equal(big.at(-1), 'line 9999');
});
