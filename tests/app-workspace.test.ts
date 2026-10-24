// The Developer view (the code's App Workspace, C3) without a browser: its address (&ws=app|eng, the dev|pm
// aliases, the retired section ids landing on Project Management, every other deep link unchanged), its names (Developer, Project
// Management), its stage read from what the office already derives, the business status's missing lines said
// shortly, no banned-terms lint any more, and how it plugs in (the tab registry, the hidden sections, a lazy
// module, no polling, nothing in lite.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { APP_SECTIONS, appSectionFor, DEVELOPER_VIEW, ENGINEERING_FOR, isAppSection, isRetiredSection, RETIRED_SECTIONS, VIEW_NAMES, workspaceTab, wsView } from '../src/shared/app-workspace/route.js';
import * as words from '../src/shared/app-workspace/words.js';
import { plainMissing, shownStages, workspaceStage } from '../src/shared/app-workspace/words.js';
import { asTab, groupOf, isTab, navGroups, pageTitle } from '../src/client/ui/portal/nav-logic.js';
import { registeredTab } from '../src/client/tabs/registry.js';
import '../src/client/tabs/index.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('the address: ws=app opens the Developer view, ws=eng Project Management, a retired section the page with its list, no ws the tab as it always was', () => {
  assert.deepEqual(APP_SECTIONS.map((s) => s.id), ['app']);
  assert.equal(workspaceTab('app', null), 'app');
  assert.equal(workspaceTab('app', 'approvals'), 'app', 'a Project Management tab with ws=app: the Developer view');
  assert.equal(workspaceTab('app', 'board'), 'app');
  assert.equal(workspaceTab('eng', 'app'), 'live');
  assert.equal(workspaceTab('eng', 'board'), 'board');
  assert.equal(workspaceTab('eng', null), null);
  // The retired sections land on the Project Management page that has their list, with or without ws.
  for (const ws of ['app', 'dev', 'eng', 'pm', null]) {
    assert.equal(workspaceTab(ws, 'requirements'), 'documents');
    assert.equal(workspaceTab(ws, 'decisions'), 'approvals');
    assert.equal(workspaceTab(ws, 'review'), 'testing');
    assert.equal(workspaceTab(ws, 'release'), 'command');
  }
  assert.deepEqual(RETIRED_SECTIONS, { requirements: 'documents', decisions: 'approvals', review: 'testing', release: 'command' });
  assert.equal(isRetiredSection('decisions'), true);
  assert.equal(isRetiredSection('app'), false);
  // Without ws: every other id passed through untouched.
  for (const t of ['command', 'board', 'workers', 'agents', 'team', 'deliverables', 'live', 'git', 'model', 'settings', 'tests', 'nonsense']) assert.equal(workspaceTab(null, t), t);
  assert.equal(workspaceTab(null, null), null);
  assert.equal(appSectionFor('approvals'), 'app', 'the switch to Developer: its one tab');
  assert.equal(ENGINEERING_FOR.app, 'live');
  assert.equal(isAppSection('live'), false);
  assert.equal(isAppSection('decisions'), false);
  // The aliases: ws=dev is ws=app, ws=pm is ws=eng.
  assert.equal(wsView('dev'), 'app');
  assert.equal(wsView('app'), 'app');
  assert.equal(wsView('pm'), 'eng');
  assert.equal(wsView('eng'), 'eng');
  assert.equal(wsView('x'), null);
  assert.equal(workspaceTab('dev', null), 'app');
  assert.equal(workspaceTab('pm', 'board'), 'board');
});

test('the names: Developer and Project Management, in the navigation and the docs', () => {
  assert.deepEqual(VIEW_NAMES, { app: 'Developer', eng: 'Project Management' });
  assert.equal(DEVELOPER_VIEW, 'Developer view');
  assert.equal(registeredTab('app')?.label, 'Developer');
  // Not in the navigation: the Developer | Project Management switch in the top bar is the way in.
  assert.ok(!navGroups().some((g) => g.items.some((i) => i.id === 'app')), 'no Developer item in the navigation');
  // No user-visible "App workspace" or "Engineering view" left in what the view draws, the docs or the README.
  const dir = 'src/client/ui/app-workspace';
  for (const f of readdirSync(path.join(root, dir), { recursive: true }).map(String).filter((x) => /\.ts$/.test(x))) {
    const src = read(`${dir}/${f}`).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(src, /App workspace|Engineering view|App view/i, f);
  }
  for (const f of ['src/shared/app-workspace/acceptance-words.ts', 'src/shared/change-requests.ts', 'src/server/change-requests/service.ts', 'src/server/roster/playbooks.ts', 'README.md']) assert.doesNotMatch(read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'), /App workspace|Engineering view/, f);
  assert.match(read('docs/site/using-the-office/developer-view.md'), /^title: Developer view$/m);
  assert.match(read('docs/site/using-the-office/developer-view.md'), /aliases: \[using-the-office\/app-workspace\]/, 'the old address still lands on the page');
});

test('every existing deep link keeps its tab; the Developer view and its retired sections are tabs, all hidden from the navigation', () => {
  for (const [asked, is] of [['command', 'command'], ['board', 'board'], ['agents', 'workers'], ['team', 'org'], ['deliverables', 'documents'], ['live', 'live'], ['approvals', 'approvals'], ['testing', 'testing'], ['walkthroughs', 'walkthroughs'], ['settings', 'settings']] as const) assert.equal(asTab(asked), is);
  assert.equal(asTab('nonsense'), undefined);
  for (const id of ['app', 'requirements', 'decisions', 'review', 'release']) {
    assert.ok(isTab(id), `${id} is a tab (?tab=${id})`);
    assert.equal(registeredTab(id)?.hidden, true);
    assert.equal(groupOf(id), undefined, `${id} is in no group`);
  }
  assert.equal(pageTitle('decisions'), 'Decisions');
  // A retired section, shown (an old link, a page that still opens it): the Project Management page with its list.
  assert.match(read('src/client/ui/app-workspace/tab.ts'), /show: \(\) => void queueMicrotask\(\(\) => openProjectTab\(RETIRED_SECTIONS\[id\]\)\)/);
  // The page reads ws through the address module, before it picks the start tab.
  assert.match(read('src/client/shared/address.ts'), /export const askedTab: string \| null = workspaceTab\(params\(\)\.get\('ws'\), params\(\)\.get\('tab'\)\);/);
});

test('the stage: read from the business status and the progress bar’s phase, never stored', () => {
  assert.equal(workspaceStage({}), 'building');
  assert.equal(workspaceStage({ toolkit: true, phase: '3' }), 'before');
  assert.equal(workspaceStage({ toolkit: true, phase: '5', business: 'work-in-progress' }), 'building');
  assert.equal(workspaceStage({ toolkit: false, phase: '3' }), 'building', 'only a toolkit project has stages before the build');
  for (const b of ['ready-for-review', 'verification-incomplete', 'verification-passed'] as const) {
    assert.equal(workspaceStage({ business: b, toolkit: true, phase: '6' }), 'validation');
    assert.equal(workspaceStage({ business: b }), 'validation');
    assert.equal(workspaceStage({ business: b, toolkit: true, phase: '5' }), 'building', 'the plan is still in its build step');
    assert.equal(workspaceStage({ business: b, toolkit: true, phase: '2' }), 'before');
  }
  assert.equal(workspaceStage({ business: 'accepted' }), 'accepted');
  assert.equal(workspaceStage({ business: 'release-approved' }), 'accepted');
  assert.equal(workspaceStage({ business: 'submitted' }), 'awaiting');
  assert.equal(workspaceStage({ business: 'deployed-recorded' }), 'released');
  assert.deepEqual(shownStages('building').map((s) => s.id), ['before', 'building', 'validation', 'accepted', 'released']);
  assert.deepEqual(shownStages('awaiting').map((s) => s.id), ['before', 'building', 'validation', 'accepted', 'awaiting', 'released']);
});

test('the business status’s missing lines said shortly, each once', () => {
  assert.deepEqual(
    plainMissing([
      "the live app isn't running: start it on the Live app tab to try the work",
      'no journey evidence for abc1234',
      'BUILD rows 4, 5 merged to main, not in the running build yet',
      'BUILD row 6 in PR #12, not merged',
      'unreviewed head: PR #12 merged without a review that counts',
      'security baseline not checked at abc1234',
      'required checks at abc1234 not read',
      '2 open tasks',
      'no deployment recorded for abc1234',
      'v1 not accepted for abc1234 yet',
    ]),
    [
      'The app isn’t running yet',
      'No guided check has run on this version yet',
      'Some agreed work isn’t in the running app yet',
      'Some finished work still needs a second look by the team',
      'The security checks haven’t passed on this version yet',
      'Some required checks have no result on this version yet',
      'The team has work in progress',
      'No deployment recorded yet',
      'This version isn’t accepted yet',
    ],
  );
  // The guided checks' own lines (C5): failed and not run on this version, required checks failed or without a result.
  assert.deepEqual(plainMissing(['J-02 failed against abc1234', 'J-03, J-04 not run against abc1234', 'checks failed on abc1234: unit tests', 'no result on abc1234 for lint']), ['A guided check failed on this version', 'Some guided checks haven’t run on this version yet', 'Some required checks failed on this version', 'Some required checks have no result on this version yet']);
  assert.deepEqual(plainMissing(['something about a worktree']), ['something about a worktree'], 'builders read the line as it is');
  assert.deepEqual(plainMissing(['Plain words stay as they are']), ['Plain words stay as they are']);
});

test('the banned-terms lint is gone: the audience is builders', () => {
  assert.equal('bannedIn' in words, false);
  assert.equal('BANNED_TERMS' in words, false);
  assert.ok(!readdirSync(path.join(root, 'tests')).includes('app-workspace-words.test.ts'));
});

test('it plugs in through the registries: its own module, lazy, no polling, nothing in lite.ts or the store', () => {
  const tab = read('src/client/ui/app-workspace/tab.ts');
  assert.match(tab, /import type \* as Shell from '\.\/shell';/, 'only the shell’s type at start');
  assert.match(tab, /shell \?\?= import\('\.\/shell'\);/, 'the shell comes in with the first show');
  assert.match(read('src/client/tabs/index.ts'), /^import '\.\.\/ui\/app-workspace\/tab';$/m);
  for (const f of readdirSync(path.join(root, 'src/client/ui/app-workspace'), { recursive: true }).map(String).filter((x) => /\.(ts|css)$/.test(x))) assert.doesNotMatch(read(`src/client/ui/app-workspace/${f}`), /setInterval|setTimeout/, `${f}: no timers`);
  assert.doesNotMatch(read('src/client/lite.ts'), /app-workspace|aw-on/);
  assert.doesNotMatch(read('src/client/state/store.ts'), /liveApp|app-workspace/);
  assert.match(read('src/client/state/slices/index.ts'), /^  liveApp,\n\];/m, 'the live app slice joins at the end');
});
