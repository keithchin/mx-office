// The App Workspace (C3) without a browser: its address (&ws=app|eng and the five section ids, every
// existing deep link unchanged), its stage read from what the office already derives, the business status's
// missing lines in business words, the banned-terms lint over the words it can draw, and how it plugs in
// (the tab registry, the hidden sections, a lazy module, no polling, nothing in lite.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { APP_SECTIONS, appSectionFor, ENGINEERING_FOR, isAppSection, workspaceTab } from '../src/shared/app-workspace/route.js';
import { BANNED_TERMS, bannedIn, plainMissing, shownStages, STAGES, workspaceStage } from '../src/shared/app-workspace/words.js';
import { asTab, groupOf, isTab, navGroups, pageTitle } from '../src/client/ui/portal/nav-logic.js';
import { registeredTab } from '../src/client/tabs/registry.js';
import '../src/client/tabs/index.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('the address: ws=app opens an App section, ws=eng the Engineering view, no ws the tab as it always was', () => {
  assert.deepEqual(APP_SECTIONS.map((s) => s.id), ['app', 'requirements', 'decisions', 'review', 'release']);
  assert.equal(workspaceTab('app', null), 'app');
  assert.equal(workspaceTab('app', 'review'), 'review');
  assert.equal(workspaceTab('app', 'approvals'), 'decisions', 'an Engineering tab maps to its closest section');
  assert.equal(workspaceTab('app', 'documents'), 'requirements');
  assert.equal(workspaceTab('app', 'board'), 'app');
  assert.equal(workspaceTab('eng', 'decisions'), 'approvals');
  assert.equal(workspaceTab('eng', 'app'), 'live');
  assert.equal(workspaceTab('eng', 'board'), 'board');
  assert.equal(workspaceTab('eng', null), null);
  // Without ws: exactly as before, every id passed through untouched.
  for (const t of ['command', 'board', 'workers', 'agents', 'team', 'deliverables', 'live', 'git', 'model', 'settings', 'tests', 'nonsense']) assert.equal(workspaceTab(null, t), t);
  assert.equal(workspaceTab(null, null), null);
  for (const s of APP_SECTIONS) assert.equal(appSectionFor(ENGINEERING_FOR[s.id]), s.id === 'release' ? 'app' : s.id, `${s.id} round-trips (Release's Engineering page is the Overview)`);
  assert.equal(isAppSection('live'), false);
});

test('every existing deep link keeps its tab; the five sections are tabs too, App in the navigation, the rest hidden', () => {
  for (const [asked, is] of [['command', 'command'], ['board', 'board'], ['agents', 'workers'], ['team', 'org'], ['deliverables', 'documents'], ['live', 'live'], ['approvals', 'approvals'], ['testing', 'testing'], ['walkthroughs', 'walkthroughs'], ['settings', 'settings']] as const) assert.equal(asTab(asked), is);
  assert.equal(asTab('nonsense'), undefined);
  for (const s of APP_SECTIONS) {
    assert.ok(isTab(s.id), `${s.id} is a tab (?tab=${s.id})`);
    assert.equal(registeredTab(s.id)?.hidden, s.id === 'app' ? undefined : true);
  }
  assert.equal(groupOf('app')?.id, 'general');
  assert.equal(navGroups()[0].items[0].label, 'App workspace');
  for (const s of ['requirements', 'decisions', 'review', 'release']) assert.equal(groupOf(s), undefined, `${s} is in no group`);
  assert.equal(pageTitle('decisions'), 'Decisions');
  // The page reads ws through the address module, before it picks the start tab.
  assert.match(read('src/client/shared/address.ts'), /export const askedTab: string \| null = workspaceTab\(params\(\)\.get\('ws'\), params\(\)\.get\('tab'\)\);/);
});

test('the stage: read from the business status and the progress bar’s phase, never stored', () => {
  assert.equal(workspaceStage({}), 'building');
  assert.equal(workspaceStage({ toolkit: true, phase: '3' }), 'before');
  assert.equal(workspaceStage({ toolkit: true, phase: '5', business: 'work-in-progress' }), 'building');
  assert.equal(workspaceStage({ toolkit: false, phase: '3' }), 'building', 'only a toolkit project has stages before the build');
  for (const b of ['ready-for-review', 'verification-incomplete', 'verification-passed'] as const) assert.equal(workspaceStage({ business: b, toolkit: true, phase: '2' }), 'validation');
  assert.equal(workspaceStage({ business: 'accepted' }), 'accepted');
  assert.equal(workspaceStage({ business: 'release-approved' }), 'accepted');
  assert.equal(workspaceStage({ business: 'submitted' }), 'awaiting');
  assert.equal(workspaceStage({ business: 'deployed-recorded' }), 'released');
  assert.deepEqual(shownStages('building').map((s) => s.id), ['before', 'building', 'validation', 'accepted', 'released']);
  assert.deepEqual(shownStages('awaiting').map((s) => s.id), ['before', 'building', 'validation', 'accepted', 'awaiting', 'released']);
});

test('the business status’s missing lines in business words, each once', () => {
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
  assert.deepEqual(plainMissing(['something about a worktree']), ['More detail is on the Engineering view']);
  assert.deepEqual(plainMissing(['Plain words stay as they are']), ['Plain words stay as they are']);
});

test('the banned-terms lint: it finds the words, and the App Workspace’s own text uses none', () => {
  assert.deepEqual(bannedIn('Merged PR #12 on branch main'), ['PR', 'merged', 'branch']);
  assert.deepEqual(bannedIn('The agent team'), ['agent']);
  assert.deepEqual(bannedIn('A pull  request and a commit on the floor'), ['pull request', 'commit', 'floor']);
  assert.deepEqual(bannedIn('Approve the scope, try the app, print a badge'), []);
  assert.deepEqual(bannedIn('price, CIty, sharp'), [], 'whole words only; PR, CI and SHA in capitals only');
  for (const s of STAGES) assert.deepEqual(bannedIn(`${s.label} ${s.canvas} ${s.panel} ${s.primary}`), [], s.id);
  for (const s of APP_SECTIONS) assert.deepEqual(bannedIn(`${s.label} ${s.hint}`), [], s.id);
  // Every string literal the workspace's drawing modules can show (imports, class names and keys aside).
  const dir = 'src/client/ui/app-workspace';
  for (const f of readdirSync(path.join(root, dir)).filter((x) => /^(shell|canvas|panel|sections|tab)\.ts$/.test(x))) {
    const src = read(`${dir}/${f}`).split('\n').filter((l) => !/^\s*(\/\/|import |\*|\/\*)/.test(l)).join('\n');
    const strings = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2]).filter((s) => !/^[a-z0-9.#:\-[\]=' "_/]*$/.test(s));
    for (const s of strings) assert.deepEqual(bannedIn(s), [], `${f}: "${s}"`);
  }
  assert.ok(BANNED_TERMS.length >= 20);
});

test('it plugs in through the registries: its own module, lazy, no polling, nothing in lite.ts or the store', () => {
  const tab = read('src/client/ui/app-workspace/tab.ts');
  assert.match(tab, /import type \* as Shell from '\.\/shell';/, 'only the shell’s type at start');
  assert.match(tab, /shell \?\?= import\('\.\/shell'\);/, 'the shell comes in with the first show');
  assert.match(read('src/client/tabs/index.ts'), /^import '\.\.\/ui\/app-workspace\/tab';$/m);
  for (const f of readdirSync(path.join(root, 'src/client/ui/app-workspace'))) assert.doesNotMatch(read(`src/client/ui/app-workspace/${f}`), /setInterval|setTimeout/, `${f}: no timers`);
  assert.doesNotMatch(read('src/client/lite.ts'), /app-workspace|aw-on/);
  assert.doesNotMatch(read('src/client/state/store.ts'), /liveApp|app-workspace/);
  assert.match(read('src/client/state/slices/index.ts'), /^  liveApp,\n\];/m, 'the live app slice joins at the end');
});
