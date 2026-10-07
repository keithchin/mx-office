// Live performance warnings (server/perfwatch/, client/shared/perfwatch.ts): a page's long task and the
// server's stalled event loop each raise an incident, throttled, with what's known about where.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERF_WATCH, pageDetection, readPageReport, serverDetection, throttle, watchEventLoop } from '../src/server/perfwatch/index.js';
import { scriptLines, viewName } from '../src/client/shared/perfwatch.js';
import { DEFAULT_INCIDENT_SETTINGS, INCIDENT_RULES, RULE_META } from '../src/shared/incidents.js';
import { routes } from '../src/server/http/routes/index.js';

test('a page report is read safely, and one under the threshold is no report', () => {
  assert.equal(readPageReport({ view: 'lite › board', ms: 120 }), undefined);
  assert.equal(readPageReport({ ms: 900 }), undefined, 'no view');
  assert.equal(readPageReport('nonsense'), undefined);
  const r = readPageReport({ view: 'lite › board\u0007', ms: 812.4, floor: 'big-spike', stack: ['500 ms a', 7, 'x'.repeat(500), 'b', 'c', 'd', 'e', 'f', 'g', 'h'], url: '/lite?tab=board' });
  assert.deepEqual(r && { ...r, stack: r.stack.length }, { view: 'lite › board', ms: 812, floor: 'big-spike', stack: 8, url: '/lite?tab=board' });
  assert.equal(r!.stack[1].length, 200, 'long frames are clipped');
});

test('the throttle lets a key through once per window', () => {
  let t = 0;
  const allow = throttle(60_000, () => t);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  t = 60_001;
  assert.equal(allow('a'), true);
});

test('the incidents they raise: the view, how long and where the time went', () => {
  const d = pageDetection({ view: 'lite › command', ms: 6200, floor: 'f1', stack: ['6000 ms TimerHandler drawChat lite.js@123'] }, 'Keith', true);
  assert.equal(d.rule, 'pageStall');
  assert.equal(d.floor, 'f1');
  assert.equal(d.severity, 'sev2', 'five seconds or more is sev2');
  assert.match(d.title, /6200 ms \(lite › command\)/);
  assert.match(d.summary, /drawChat/);
  assert.equal(pageDetection({ view: 'home', ms: 700, floor: 'nope', stack: [] }, 'Keith', false).floor, undefined, 'a floor the office lacks is the office');
  const s = serverDetection(1500.4);
  assert.equal(s.rule, 'serverStall');
  assert.equal(s.severity, 'sev3');
  assert.match(s.title, /1500 ms/);
});

test('both rules are on by default and named in the rules list', () => {
  for (const r of ['pageStall', 'serverStall'] as const) {
    assert.ok(INCIDENT_RULES.includes(r));
    assert.equal(DEFAULT_INCIDENT_SETTINGS.rules[r].on, true);
    assert.ok(RULE_META[r].label);
  }
});

test('the event-loop watch sees the loop blocked for longer than the stall threshold', async () => {
  const seen: number[] = [];
  const stop = watchEventLoop((d) => seen.push(Number(d.title.match(/(\d+) ms/)![1])), { stallMs: 300, windowMs: 100, throttleMs: 0 });
  await new Promise((r) => setTimeout(r, 150));
  const until = Date.now() + 450;
  while (Date.now() < until) {
    // a synchronous stall
  }
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.ok(seen.length >= 1, 'raised');
  assert.ok(seen[0] >= 300, `measured ${seen[0]} ms`);
  assert.ok(PERF_WATCH.serverStallMs === 1000 && PERF_WATCH.pageLongTaskMs === 500);
});

test('the report route is for signed-in pages only', () => {
  const r = routes.find((x) => 'path' in x && x.path === '/api/perf/longtask');
  assert.ok(r);
  assert.equal(r!.auth, 'session');
});

test('the page side: the view it names, and the scripts of a long frame', () => {
  assert.equal(viewName({ pathname: '/lite', search: '?floor=a&tab=board' }), 'lite › board');
  assert.equal(viewName({ pathname: '/home.html', search: '' }), 'home');
  assert.deepEqual(scriptLines([{ duration: 20, invoker: 'a' }, { duration: 610.6, invoker: 'TimerHandler:setTimeout', sourceURL: 'http://x/assets/lite-1.js?v=1', sourceFunctionName: 'draw', sourceCharPosition: 42 }]), [
    '611 ms TimerHandler:setTimeout draw lite-1.js@42',
    '20 ms a',
  ]);
  // Every flat entry point installs it.
  for (const f of ['lite.ts', 'pixel.ts', 'home.ts', 'm.ts']) assert.match(readFileSync(new URL(`../src/client/${f}`, import.meta.url), 'utf8'), /import '\.\/shared\/perfwatch-on';/, f);
});
