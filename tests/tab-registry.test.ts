// The project tab registry (src/client/tabs/registry.ts) and the navigation it feeds (ui/portal/nav-logic.ts):
// a registered tab lands in its group in order, admin-only ones are hidden from everyone else, ?tab= knows
// it (and an unknown one still falls back to the Command Center), and the page header names it. Test-only
// tabs here, in this file's own process; the real ones (Tests) are checked in portal-nav.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { clearTabsForTests, registerTab, registeredTabs, type TabDef } from '../src/client/tabs/registry.js';
import { asTab, groupOf, isTab, navGroups, navItem, pageTitle, revealGroup, parseNavState, visibleItems } from '../src/client/ui/portal/nav-logic.js';
import { startTab } from '../src/client/shared/start-tab.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const mounted: string[] = [];
const def = (id: string, extra: Partial<TabDef> = {}): TabDef => ({ id, group: 'monitor', label: `L-${id}`, tooltip: `The ${id} test-only tab, for the registry's tests`, mount: () => (mounted.push(id), {}), ...extra });
const ids = (g: string) => navGroups().find((x) => x.id === g)!.items.map((i) => i.id);

test('a registered tab appears in its group: after the built-in items by default, at its order otherwise, stably', () => {
  clearTabsForTests();
  assert.deepEqual(ids('monitor'), ['workers'], 'nothing registered: the built-in items only');
  registerTab(def('alpha'));
  registerTab(def('beta'));
  registerTab(def('first', { order: 5 }));
  registerTab(def('between', { group: 'repo', order: 15 }));
  registerTab(def('tie', { group: 'repo', order: 15 }));
  assert.deepEqual(ids('monitor'), ['first', 'workers', 'alpha', 'beta']);
  assert.deepEqual(ids('repo'), ['git', 'between', 'tie', 'model'], 'git is 10, model 20; equal orders keep the order they registered');
  assert.deepEqual(ids('general'), ['command', 'org', 'teams', 'documents'], 'other groups untouched');
  assert.equal(navItem('alpha')?.kind, 'tab');
  assert.equal(navItem('alpha')?.hint, "The alpha test-only tab, for the registry's tests");
  assert.equal(groupOf('between')?.id, 'repo');
  assert.equal(registeredTabs().length, 5);
  assert.deepEqual(mounted, [], 'registering mounts nothing: a tab mounts the first time it shows');
});

test('the derived groups are worked out once per registration', () => {
  clearTabsForTests();
  const a = navGroups();
  assert.equal(navGroups(), a, 'the same array while nothing registers');
  registerTab(def('gamma'));
  assert.notEqual(navGroups(), a);
  assert.deepEqual(ids('monitor'), ['workers', 'gamma']);
});

test('admin-only registered tabs are hidden for non-admins', () => {
  clearTabsForTests();
  registerTab(def('lab', { admin: true }));
  registerTab(def('open'));
  const monitor = navGroups().find((g) => g.id === 'monitor')!;
  assert.deepEqual(visibleItems(monitor, false).map((i) => i.id), ['workers', 'open']);
  assert.deepEqual(visibleItems(monitor, true).map((i) => i.id), ['workers', 'lab', 'open']);
});

test('?tab= knows a registered tab, and an unknown one falls back as before', () => {
  clearTabsForTests();
  registerTab(def('records'));
  assert.equal(asTab('records'), 'records');
  assert.equal(isTab('records'), true);
  assert.equal(asTab('nonsense'), undefined);
  assert.equal(asTab(null), undefined);
  assert.equal(asTab('view-app'), undefined, 'an action is not a tab');
  // The old names still work.
  assert.equal(asTab('team'), 'org');
  assert.equal(asTab('agents'), 'workers');
  assert.equal(asTab('deliverables'), 'documents');
  assert.equal(asTab('settings'), 'settings');
  // What lite.ts does with them: an unknown ?tab= opens the Command Center (or the tab a reload kept).
  assert.equal(startTab(asTab('nonsense'), false, asTab('board'), 'command'), 'command');
  assert.equal(startTab(asTab('nonsense'), true, asTab('board'), 'command'), 'board');
  assert.equal(startTab(asTab('records'), false, undefined, 'command'), 'records');
  // A deep link into a registered tab opens its group, as for a built-in one.
  const closed = { ...parseNavState(null), open: { monitor: false } };
  assert.equal(revealGroup(closed, 'records').open.monitor, true);
});

test('the page header names a registered tab', () => {
  clearTabsForTests();
  registerTab(def('records', { label: 'Testing' }));
  assert.equal(pageTitle('records'), 'Testing');
  assert.equal(pageTitle('workers'), 'Agents');
  assert.equal(pageTitle('nonsense'), 'Overview');
});

test('a bad or repeated id is refused, a built-in one included', () => {
  clearTabsForTests();
  registerTab(def('once'));
  assert.throws(() => registerTab(def('once')), /already a tab "once"/);
  assert.throws(() => registerTab(def('workers')), /already a tab "workers"/);
  assert.throws(() => registerTab(def('settings')), /already a tab "settings"/);
  assert.throws(() => registerTab(def('studio')), /already a tab "studio"/, 'nor an action');
  assert.throws(() => registerTab(def('Bad Id')), /not a tab id/);
});

test('the page mounts registered tabs lazily and calls their hooks from showTab', () => {
  const host = read('src/client/tabs/host.ts');
  // At start only the empty containers (and optional tab-row buttons); mount() only inside show().
  assert.equal(host.match(/\.mount\(/g)?.length, 1);
  assert.match(host, /if \(on\) \(s\.hooks \?\?= s\.def\.mount\(s\.view\)\)\.show\?\.\(\);\n\s+else s\.hooks\?\.hide\?\.\(\);/);
  assert.match(host, /hooks\?\.refresh\?\.\(\)/);
  assert.match(host, /^import '\.\/index';/m, 'the registrations load before the page reads ?tab=');
  const lite = read('src/client/lite.ts');
  assert.match(lite, /import \{ projectTabs \} from '\.\/tabs\/host';/);
  assert.match(lite, /function showTab\(t: Tab\) \{[\s\S]*?featureTabs\.show\(t\);[\s\S]*?\n\}/);
});
