// 🗺️ The toolkit's process map in the office (shared/process-map.ts, server/process-map/, ui/process-map/):
// recognised as a deliverable flat and nested, its pass, the gate's freshness rule (stale, not missing) in a
// folder and at a commit, the BRD report that embeds it, the pin-gated brief lines, and the decision card's
// "See where this fits" link from the anchors. The fixture is the toolkit's own synthetic order-approval
// map (tests/fixtures/process-map, built with its process-map.js), neutral content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { specFor, extraTeam, type DeliverablesView } from '../src/shared/deliverables.js';
import { factNotes, isProcessMapPath, mapFacts, pinForCard, pinsFrom, placeHash, placeWords, bestPlace, staleSources, type ModelLite } from '../src/shared/process-map.js';
import { scanDeliverables } from '../src/server/deliverables/scan.js';
import { pinsView, withProcessMap } from '../src/server/process-map/index.js';
import { deliverablesBrief } from '../src/server/roster/deliverables-brief.js';
import { toolkitHas, toolkitHasAsync } from '../src/server/toolkit-pin/features.js';
import { installFakeDom } from './support/fakedom.js';

const FIX = path.join(import.meta.dirname, 'fixtures', 'process-map');
const model = JSON.parse(readFileSync(path.join(FIX, 'design/process-model.json'), 'utf8')) as ModelLite;
const anchors = JSON.parse(readFileSync(path.join(FIX, 'design/question-anchors.json'), 'utf8'));
const PINS = pinsFrom(model, anchors);

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();

/** A project folder (a git repo) with the fixture's design folder at `designAt`, optionally without wireframes. */
function project(t: { after: (fn: () => void) => void }, designAt = 'design', wireframes = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pmap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'core.autocrlf', 'false']);
  cpSync(path.join(FIX, 'design'), path.join(dir, designAt), { recursive: true });
  if (!wireframes) rmSync(path.join(dir, designAt, 'wireframes'), { recursive: true, force: true });
  writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n');
  // Every input older than the map, as the toolkit leaves them right after a build.
  const old = new Date(Date.now() - 3600_000);
  const now = new Date();
  utimesSync(path.join(dir, designAt, 'process-map.html'), now, now);
  for (const f of ['process-model.json', 'question-anchors.json']) utimesSync(path.join(dir, designAt, f), old, old);
  if (wireframes) for (const f of ['Order_Approve.html', 'Order_NewEdit.html', 'Order_Overview.html', 'Settings_Edit.html']) utimesSync(path.join(dir, designAt, 'wireframes', f), old, old);
  return dir;
}

async function view(dir: string, toolkitHasMap = true, main?: { def: string; sha: string; at: number }): Promise<DeliverablesView> {
  const input = { floor: 'f', dir, people: [], ...(main ? { main } : {}) };
  return withProcessMap(input, await scanDeliverables(input), { toolkitHasMap });
}
const mapItem = (v: DeliverablesView) => v.items.find((i) => i.id === 'process-map');

test('a process map is a deliverable of its own, flat and nested; its inputs are not', () => {
  assert.equal(specFor('design/process-map.html')?.id, 'process-map');
  assert.equal(specFor('analysis/orders/design/process-map.html')?.id, 'process-map');
  assert.ok(isProcessMapPath('analysis/orders/design/process-map.html'));
  assert.ok(!isProcessMapPath('design/process-map-embed.html'));
  assert.notEqual(specFor('design/process-model.json')?.id, 'process-map');
  assert.equal(extraTeam('design/process-model.json'), 'design');
  assert.equal(specFor('design/prototype.html'), undefined);
});

test('the gate rule: stale when the model, the anchors or a wireframe is newer than the map', () => {
  assert.deepEqual(staleSources({ map: 100, model: 90, anchors: 100, wireframe: 50, wireframes: 2 }), []);
  assert.deepEqual(staleSources({ map: 100, model: 101, anchors: 99, wireframe: 200, wireframes: 2 }), ['model', 'wireframe']);
  assert.deepEqual(staleSources({ map: 100, model: 1500, wireframes: 0 }, 2000), [], 'a checkout writing files a moment apart is forgiven');
  const f = mapFacts({ map: 100, model: 90, anchors: 300, wireframes: 0 });
  assert.deepEqual(f, { role: 'map', pass: 1, stale: ['anchors'] });
  assert.deepEqual(factNotes(f).map((n) => n.text), ['Pass 1 · no screens yet', 'Stale: older than its anchors']);
  assert.deepEqual(factNotes(mapFacts({ map: 100, model: 200, anchors: 300, wireframe: 400, wireframes: 3 })).map((n) => n.text), ['Pass 2 · with screens', 'Stale: older than its model, its anchors and a wireframe']);
  assert.deepEqual(factNotes({ role: 'report', embedsMap: true }).map((n) => n.text), ['Opens with the pass-1 process map']);
  assert.deepEqual(factNotes(undefined), []);
});

test('in a folder: pass 2 and current after a build; stale (not missing) once the model is edited', async (t) => {
  const dir = project(t);
  let v = await view(dir);
  const item = mapItem(v)!;
  assert.equal(item.status, 'present');
  assert.equal(item.stage, '3');
  assert.equal(item.files[0].path, 'design/process-map.html');
  assert.deepEqual(item.files[0].processMap, { role: 'map', pass: 2 });
  // The model edited after the build: the map is older than it.
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(dir, 'design/process-model.json'), later, later);
  v = await view(dir);
  assert.equal(mapItem(v)!.status, 'present', 'stale is not missing');
  assert.deepEqual(mapItem(v)!.files[0].processMap?.stale, ['model']);
  // A wireframe changed too.
  utimesSync(path.join(dir, 'design/wireframes/Order_Approve.html'), later, later);
  assert.deepEqual((await view(dir)).items.find((i) => i.id === 'process-map')!.files[0].processMap?.stale, ['model', 'wireframe']);
});

test('nested layout, no wireframes yet: pass 1, shown at Stage 2 as the Chief Analyst\'s', async (t) => {
  const dir = project(t, 'analysis/orders/design', false);
  const item = mapItem(await view(dir))!;
  assert.equal(item.files[0].path, 'analysis/orders/design/process-map.html');
  assert.deepEqual(item.files[0].processMap, { role: 'map', pass: 1 });
  assert.equal(item.stage, '2');
  assert.equal(item.team, 'analysis');
  assert.equal(item.owner, 'chief-analyst');
});

test('at a commit (origin/<default>): freshness by the last commit of each file', async (t) => {
  const dir = project(t);
  const at = (s: number) => ({ ...GIT_ENV, GIT_AUTHOR_DATE: `${s} +0000`, GIT_COMMITTER_DATE: `${s} +0000` });
  g(dir, ['add', '.']);
  g(dir, ['commit', '-qm', 'map'], at(1_700_000_000));
  let sha = g(dir, ['rev-parse', 'HEAD']).trim();
  assert.deepEqual(mapItem(await view(dir, true, { def: 'main', sha, at: 1_700_000_000_000 }))!.files[0].processMap, { role: 'map', pass: 2 });
  writeFileSync(path.join(dir, 'design/question-anchors.json'), readFileSync(path.join(dir, 'design/question-anchors.json'), 'utf8').replace('Money', 'Amounts'));
  g(dir, ['commit', '-qam', 'anchors'], at(1_700_000_600));
  sha = g(dir, ['rev-parse', 'HEAD']).trim();
  assert.deepEqual(mapItem(await view(dir, true, { def: 'main', sha, at: 1_700_000_600_000 }))!.files[0].processMap?.stale, ['anchors']);
});

test('no map: listed as optional only when the toolkit has the skill; a BRD report is left alone without the frame', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pmap-none-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  mkdirSync(path.join(dir, 'analysis'), { recursive: true });
  writeFileSync(path.join(dir, 'analysis/brd-report.html'), '<html><body>BRD</body></html>');
  const old = await view(dir, false);
  assert.equal(mapItem(old), undefined, 'an older pin: no Process map row at all');
  assert.equal(old.items.find((i) => i.id === 'brd-report')!.files[0].processMap, undefined);
  const now = await view(dir, true);
  assert.equal(mapItem(now)?.status, 'missing');
  assert.equal(mapItem(now)?.optional, true);
  // The rest of the view is what the scan gave.
  const plain = await scanDeliverables({ floor: 'f', dir, people: [] });
  assert.deepEqual(old.items.map((i) => i.id), plain.items.map((i) => i.id).filter((id) => id !== 'process-map'));
  // The report the toolkit drew with the map framed at its top.
  writeFileSync(path.join(dir, 'analysis/brd-report.html'), '<html><body><section><iframe id="pm-frame" title="Process map" sandbox="allow-scripts" srcdoc="…"></iframe></section></body></html>');
  assert.deepEqual((await view(dir)).items.find((i) => i.id === 'brd-report')!.files[0].processMap, { role: 'report', embedsMap: true });
});

test('pins: each anchor on its process and step, a page on its step, whole-app buckets kept', () => {
  const q2 = PINS.find((p) => p.id === 'F001:Q02')!;
  assert.deepEqual(bestPlace(q2), { process: 'P1', processTitle: 'Order approval: submit, approve or reject, notify', step: 'P1-03', n: 3, stepTitle: 'Open the order' });
  assert.equal(placeWords(bestPlace(q2)), 'Order approval: submit, approve or reject, notify · step 3');
  assert.equal(placeHash(bestPlace(q2)), '#/P1');
  const money = PINS.find((p) => p.id === 'F001:Q04')!;
  assert.equal(placeWords(bestPlace(money)), 'whole app · Money');
  assert.equal(placeHash(bestPlace(money)), '#/');
  const page = pinsFrom(model, { anchors: [{ id: 'X1', targets: [{ type: 'page', page: 'Orders.Order_Overview' }] }, { id: 'X2', targets: [{ type: 'step', step: 'P9-01' }] }] });
  assert.deepEqual(page.map((p) => [p.id, p.places[0].step]), [['X1', 'P1-08']], 'a step not in the model is dropped');
});

test('a decision card finds its pin by question key, by an id it names, or by the question\'s text', () => {
  assert.equal(pinForCard({ question: 'anything', questionKey: 'F001-orders.brd.json#Q02' }, PINS)?.id, 'F001:Q02');
  assert.equal(pinForCard({ question: 'anything', questionKey: 'F0012-other.brd.json#Q02' }, PINS), undefined, 'another BRD whose id only starts the same');
  assert.equal(pinForCard({ question: 'Confirm D3-01 before the build' }, PINS)?.id, 'D3-01');
  assert.equal(pinForCard({ question: 'Ada escalated: May an approver approve their own order?' }, PINS)?.id, 'F001:Q02');
  assert.equal(pinForCard({ question: 'Approval', texts: ['“May an approver approve their own  order?”'] }, PINS)?.id, 'F001:Q02');
  assert.equal(pinForCard({ question: 'Which colour should the header be?' }, PINS), undefined);
  assert.equal(pinForCard({ question: 'May an approver approve their own order?' }, []), undefined);
});

test('the pins route\'s view: the best map, where it is, and its pins; none without a map', async (t) => {
  const dir = project(t);
  const v = await view(dir);
  const p = await pinsView('f', v, async () => ({ dir }));
  assert.deepEqual(p.map, { path: 'design/process-map.html', src: 'main', label: 'main', app: 'Order desk' });
  assert.equal(p.pins.length, PINS.length);
  assert.deepEqual(await pinsView('f', { floor: 'f', scannedAt: 0, items: [], sources: [] }, async () => ({ dir })), { floor: 'f', pins: [] });
});

test('briefs mention the process map only when the project\'s toolkit has the skill', (t) => {
  const ca = (on: boolean) => deliverablesBrief('chief-analyst', true, [], undefined, on).join('\n');
  const ld = (on: boolean) => deliverablesBrief('lead-designer', true, [], undefined, on).join('\n');
  assert.match(ca(true), /design\/process-model\.json.*design\/question-anchors\.json.*design\/process-map\.html.*skills\/process-map\.md/);
  assert.match(ld(true), /pass 2 of `design\/process-map\.html`.*older than any of them/);
  assert.doesNotMatch(ca(false), /process-map|process map/i);
  assert.doesNotMatch(ld(false), /process-map|process map/i);
  // A Solo generalist covering design gets the designer's line under its heading.
  assert.match(deliverablesBrief('chief-analyst', true, ['lead-designer'], undefined, true).join('\n'), /\n {2}- Stage 3, when `design\/process-model\.json` exists/);
  // The pin check: the skill file in the toolkit folder.
  const tk = mkdtempSync(path.join(tmpdir(), 'tk-'));
  t.after(() => rmSync(tk, { recursive: true, force: true }));
  assert.equal(toolkitHas(tk, 'skills/process-map.md'), false);
  const pin = path.join(tk, 'mendix-toolkit-pins', '7b4b4cf00000');
  mkdirSync(path.join(pin, 'skills'), { recursive: true });
  writeFileSync(path.join(pin, 'skills/process-map.md'), '# Process Map');
  assert.equal(toolkitHas(pin, 'skills/process-map.md'), true);
  assert.equal(toolkitHas(undefined, 'skills/process-map.md'), false);
  return toolkitHasAsync(pin, 'skills/process-map.md').then((has) => assert.equal(has, true));
});

test('a decision card pinned on the map shows "See where this fits", others nothing', async () => {
  installFakeDom();
  const { genericCard } = await import('../src/client/ui/portal/decision-card.js');
  const { setPinsFetcher } = await import('../src/client/ui/process-map/card-link.js');
  setPinsFetcher(async (floor) => ({ floor, map: { path: 'design/process-map.html', src: 'main', label: 'main' }, pins: PINS }));
  const card = (question: string) => {
    const need = { key: 'k', kind: 'escalation', icon: '🚩', text: question, level: 'warn', action: 'Answer', target: { to: 'escalation', id: 'e1' } } as const;
    return { id: 'esc:e1', kind: 'decision', question, evidence: [], blocks: [], owner: 'Ada', sources: [{ id: 'esc:e1', type: 'escalation', label: 'escalation', target: need.target }], after: 'After you answer: …', level: 'warn', notes: [], related: [], need } as never;
  };
  const ctx = { floor: 'f', admin: true, go: () => {}, ask: () => true, done: () => {} };
  const pinned = genericCard(card('May an approver approve their own order?'), ctx);
  const other = genericCard(card('Which colour should the header be?'), ctx);
  await new Promise((r) => setTimeout(r, 10));
  const line = (el: HTMLElement) => el.querySelector('.pm-fits') as HTMLElement;
  assert.equal(line(pinned).hidden, false);
  assert.equal(line(pinned).getAttribute('data-pin'), 'F001:Q02');
  assert.match(line(pinned).textContent ?? '', /See where this fits → Process map: Order approval: submit, approve or reject, notify · step 3/);
  assert.equal(line(other).hidden, true);
  assert.equal(line(other).textContent, '');
  // A project with no map: nothing, and no error.
  setPinsFetcher(async (floor) => ({ floor, pins: [] }));
  const none = genericCard(card('May an approver approve their own order?'), { ...ctx, floor: 'g' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(line(none).hidden, true);
  setPinsFetcher(undefined);
});
