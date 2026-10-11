// "Edit in Studio Pro" on the page (ui/studio/): on every project page whatever the office has found,
// greyed out with the reason only when it truly can't work, and still there after every page change
// (it used to vanish one page after the office said there was no .mpr: the Portal navigation asks only
// when the page changes). And what the open flow says at each step (ui/studio/logic.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StudioInfo, StudioSyncResult } from '../src/shared/studio.js';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

let answer: (floor: string) => StudioInfo = () => ({ hasMpr: false, available: false, problem: 'no-mpr', error: 'No Mendix project (.mpr) in C:\\f', admin: true, busy: [] });
const asked: string[] = [];
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: async (url: string) => {
    const floor = new URL(url, 'http://office.test').searchParams.get('floor') ?? '';
    asked.push(floor);
    return { ok: true, json: async () => answer(floor) };
  },
});

const { store } = await import('../src/client/state/index.js');
const studio = await import('../src/client/ui/studio/index.js');
const { afterSync, stopBeforeSync, syncLine } = await import('../src/client/ui/studio/logic.js');

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const settle = () => new Promise((r) => setTimeout(r, 10));
const info = (over: Partial<StudioInfo> = {}): StudioInfo => ({ hasMpr: true, mpr: 'App\\App.mpr', version: '11.12.4', available: true, admin: true, busy: [], ...over });

test('on every project page, through floor and page changes, whatever the office says about the .mpr', async () => {
  let redraws = 0;
  const off = studio.onStudioChange(() => redraws++);
  store.me = { admin: true } as typeof store.me;
  store.floor = 'travel';
  studio.watchStudio();
  store.emit('floor');
  await settle();
  assert.ok(asked.includes('travel'), 'the office was asked');
  assert.ok(redraws >= 2, 'the navigation is told on every redraw, not only when the page changes');
  // The office said "no .mpr": the button stays, clickable (bringing the folder up to date may bring one).
  for (let page = 0; page < 5; page++) assert.equal(studio.studioShown(), true, `still there after page change ${page}`);
  assert.equal(studio.studioBlocked(), undefined);
  assert.match(studio.studioTitle(), /No \.mpr in the project folder yet: clicking brings the folder up to date with GitHub first/);
  // Behind GitHub and refused: the tooltip says why.
  answer = () => ({ ...info({ hasMpr: false, available: false, problem: 'no-mpr' }), sync: { floor: 'travel', state: 'refused', reason: 'branch', on: 'spike', behind: 386, message: 'The project folder is on branch spike, not main — switch it to main (git switch main), then try again', at: 1 } });
  store.floor = 'shop';
  store.emit('floor');
  await settle();
  assert.equal(studio.studioShown(), true);
  assert.match(studio.studioTitle(), /on branch spike, not main/);
  // No Studio Pro on the office's computer: still there, greyed out, saying so.
  answer = () => info({ hasMpr: false, mpr: undefined, available: false, problem: 'no-mpr', machine: { problem: 'not-installed', error: "Studio Pro isn't installed on the office's computer" } });
  store.floor = 'travel';
  store.emit('floor');
  await settle();
  assert.equal(studio.studioShown(), true);
  assert.match(studio.studioBlocked() ?? '', /isn't installed/);
  // Not an admin: there, greyed out.
  answer = () => info();
  store.me = { admin: false } as typeof store.me;
  store.emit('me');
  assert.equal(studio.studioShown(), true);
  assert.match(studio.studioBlocked() ?? '', /Only admins/);
  // Off a project (Home), it isn't offered.
  store.floor = null;
  assert.equal(studio.studioShown(), false);
  off();
});

test('the Portal navigation keeps the item, greys it with the reason, and redraws when Studio Pro\'s state changes', () => {
  const layout = read('src/client/ui/portal/layout.ts');
  assert.match(layout, /blocked: \(a\) => \(a === 'studio' \? studioBlocked\(\) : undefined\)/);
  assert.match(layout, /onStudioChange\(\(\) => nav\.refresh\(\)\)/);
  const nav = read('src/client/ui/portal/nav.ts');
  assert.match(nav, /btn\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(nav, /refresh: drawGroups/);
  assert.match(read('src/client/ui/studio/index.ts'), /export const studioShown = \(\) => !!store\.floor;/);
});

test('what the open flow says before the folder is brought up to date', () => {
  assert.match(stopBeforeSync(null) ?? '', /Couldn't ask the office/);
  assert.match(stopBeforeSync(info({ state: { floor: 'f', open: true, since: 1 } })) ?? '', /already has the project open/);
  assert.match(stopBeforeSync(info({ admin: false })) ?? '', /Only admins/);
  assert.match(stopBeforeSync(info({ available: false, problem: 'not-installed', error: "Studio Pro 11.6.4 isn't installed" })) ?? '', /11\.6\.4 isn't installed/);
  assert.equal(stopBeforeSync(info({ hasMpr: false, available: false, problem: 'no-mpr' })), undefined, 'no .mpr: go on, the sync may bring it');
  assert.match(stopBeforeSync(info({ hasMpr: false, available: false, problem: 'no-mpr', machine: { problem: 'no-desktop', error: 'not on a desktop' } })) ?? '', /not on a desktop/);
  assert.equal(stopBeforeSync(info()), undefined);
});

test('what the open flow says after: the reason with every stop, and a note when it opens the folder as it is', () => {
  assert.match('stop' in afterSync(null) ? afterSync(null).stop : '', /Couldn't reach the office/);
  const dirty = { floor: 'f', state: 'refused', reason: 'dirty', behind: 386, message: 'Your project folder is 386 commits behind GitHub and has local changes in README.md — commit or stash them, then try again', at: 1 } as const;
  const noMpr: StudioSyncResult = { sync: dirty, info: info({ hasMpr: false, mpr: undefined, available: false, problem: 'no-mpr', error: "No Mendix project (.mpr) in the project folder yet, and the office couldn't bring it up to date with GitHub. Your project folder is 386 commits behind GitHub and has local changes in README.md — commit or stash them, then try again" }) };
  const a = afterSync(noMpr);
  assert.ok('stop' in a);
  assert.match(a.stop, /386 commits behind GitHub and has local changes in README\.md — commit or stash them/);
  assert.doesNotMatch(a.stop, /^No \.mpr found$/);
  // Refused, but there's an .mpr: it opens as it is, and the confirm says so.
  const asIs = afterSync({ sync: dirty, info: info() });
  assert.ok(!('stop' in asIs));
  assert.match(asIs.note ?? '', /opens the folder as it is, 386 commits behind GitHub: Your project folder/);
  // Moved: a toast says how far.
  const moved = afterSync({ sync: { floor: 'f', state: 'moved', branch: 'main', behind: 0, commits: 386, from: 'a', to: 'b', at: 1 }, info: info() });
  assert.ok(!('stop' in moved) && moved.moved);
  assert.match(syncLine({ floor: 'f', state: 'moved', branch: 'main', behind: 0, commits: 386, at: 1 }) ?? '', /Brought the project folder up to date with GitHub \(386 commits from origin\/main\)/);
  assert.match('stop' in afterSync({ info: info({ state: { floor: 'f', open: true, since: 1 } }) }) ? (afterSync({ info: info({ state: { floor: 'f', open: true, since: 1 } }) }) as { stop: string }).stop : '', /already has the project open/);
  assert.equal(syncLine({ floor: 'f', state: 'current', behind: 0, at: 1 }), undefined);
});
