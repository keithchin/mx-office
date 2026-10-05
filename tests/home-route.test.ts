import test from 'node:test';
import assert from 'node:assert/strict';
import { flatViewGoesHome, isReturnPage, shortStage } from '../src/shared/home.js';

test('a flat view hands over to /home only when it has no floor to open, or an old ?home link asks', () => {
  // Nothing in the address and nothing remembered: pick a project on the home page first.
  assert.equal(flatViewGoesHome('', null), true);
  assert.equal(flatViewGoesHome('?tab=board', null), true);
  assert.equal(flatViewGoesHome('?floor=', null), true);
  // A floor in the address, or one this browser was on before, opens straight away.
  assert.equal(flatViewGoesHome('?floor=mx-spike', null), false);
  assert.equal(flatViewGoesHome('', 'mx-spike'), false);
  assert.equal(flatViewGoesHome('?tab=team', 'mx-spike'), false);
  // The floors page used to be an overlay at ?home: those links now go to /home, floor or not.
  assert.equal(flatViewGoesHome('?home', 'mx-spike'), true);
  assert.equal(flatViewGoesHome('?floor=mx-spike&home=1', 'mx-spike'), true);
});

test('signing in returns to /home, /lite or /pixel, and nowhere else', () => {
  for (const p of ['/home', '/lite', '/pixel']) assert.equal(isReturnPage(p), true, p);
  for (const p of ['/', '/home/', '//evil.example', 'https://evil.example/home', null, undefined]) assert.equal(isReturnPage(p), false, String(p));
});

test("a toolkit project's stage is cut down to its first words", () => {
  assert.equal(shortStage('**Stage 3** (build), waiting on review'), 'Stage 3');
  assert.equal(shortStage(undefined), undefined);
  assert.equal(shortStage('  '), undefined);
});
