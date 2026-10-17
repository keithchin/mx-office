// The live app viewer's logic (src/client/ui/liveapp/viewer-logic.ts): Back and Forward over the addresses
// the viewer opened, the address field kept to the app's own origin, a hard reload's address, and the
// device widths' fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { back, bust, canBack, canForward, current, forward, freshHistory, go, inApp, scaleFor, urlOf } from '../src/client/ui/liveapp/viewer-logic.js';

test('history: go, back, forward; going somewhere new drops what Forward had; the same page twice is one entry', () => {
  let h = freshHistory();
  assert.equal(canBack(h), false);
  h = go(h, '/p/check-sheets');
  h = go(h, '/p/check-sheets');
  h = go(h, '/p/approvals');
  assert.deepEqual(h.stack, ['/', '/p/check-sheets', '/p/approvals']);
  h = back(back(h));
  assert.equal(current(h), '/');
  assert.equal(canBack(h), false);
  assert.equal(back(h), h, 'nothing further back');
  h = forward(h);
  assert.equal(current(h), '/p/check-sheets');
  assert.equal(canForward(h), true);
  h = go(h, '/p/login');
  assert.deepEqual(h.stack, ['/', '/p/check-sheets', '/p/login']);
  assert.equal(canForward(h), false);
});

test('the address field: paths and the app’s own address go; another site, port or scheme does not', () => {
  const base = 'http://office-pc:8110/';
  assert.equal(inApp('/p/check-sheets', base), '/p/check-sheets');
  assert.equal(inApp('p/check-sheets?x=1#top', base), '/p/check-sheets?x=1#top');
  assert.equal(inApp('http://office-pc:8110/index.html?profile=Responsive', base), '/index.html?profile=Responsive');
  assert.equal(inApp('', base), '/');
  assert.equal(inApp('http://office-pc:8111/', base), null, 'another port is another app');
  assert.equal(inApp('https://evil.example/', base), null);
  assert.equal(inApp('javascript:alert(1)', base), null);
  assert.equal(inApp('//evil.example/x', base), null);
  assert.equal(urlOf(base, '/p/x'), 'http://office-pc:8110/p/x');
  assert.equal(bust('/p/x#top', 5), '/p/x?_mxoffice=5#top');
  assert.equal(bust('/p/x?a=1', 5), '/p/x?a=1&_mxoffice=5');
});

test('device widths: desktop fills; tablet and phone shrink to fit, never grow; 100% is 100%', () => {
  assert.equal(scaleFor('desktop', 'fit', 600), 1);
  assert.equal(scaleFor('phone', 'fit', 1200), 1);
  assert.equal(scaleFor('tablet', 'fit', 410), 0.5);
  assert.equal(scaleFor('tablet', '100', 410), 1);
});
