// Page work the performance guard found on a big floor (2026-10-07), each held here so it can't come back:
// the Workers view redrew everything for every worker update (it hung the page), drew a card for each of
// hundreds of workers gone home with a forty-rect robot each, and the team phone worked out Needs you and
// every channel's unread on every frame, open or not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { batched, type BatchClock } from '../src/client/ui/batch.js';
import { GONE_CAP, capGone } from '../src/client/ui/ranking/index.js';

function fakeClock() {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const clock: BatchClock = {
    now: () => t,
    later: (fn, ms) => (timers.push({ at: t + ms, fn, id: ++id }), id),
    clear: (x) => {
      const i = timers.findIndex((tm) => tm.id === x);
      if (i >= 0) timers.splice(i, 1);
    },
    frame: (fn) => (timers.push({ at: t + 16, fn, id: ++id }), id),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { clock, advance };
}

test('batched: a burst of a thousand asks draws once, on the next frame', () => {
  const { clock, advance } = fakeClock();
  let runs = 0;
  const draw = batched(() => runs++, 250, clock);
  for (let i = 0; i < 1000; i++) draw();
  assert.equal(runs, 0, 'nothing drawn in the middle of the burst');
  advance(20);
  assert.equal(runs, 1);
});

test('batched: asks that keep coming draw at most once per interval, and the last ask always gets its draw', () => {
  const { clock, advance } = fakeClock();
  let runs = 0;
  const draw = batched(() => runs++, 250, clock);
  // One ask every 10 ms for two seconds: eight or nine draws, not two hundred.
  for (let i = 0; i < 200; i++) {
    draw();
    advance(10);
  }
  advance(1000);
  assert.ok(runs >= 7 && runs <= 10, `${runs} draws`);
  const before = runs;
  draw();
  advance(300);
  assert.equal(runs, before + 1, 'a lone ask later is drawn');
});

test('batched: flush draws a waiting run now; cancel drops it', () => {
  const { clock, advance } = fakeClock();
  let runs = 0;
  const draw = batched(() => runs++, 250, clock);
  draw.flush();
  assert.equal(runs, 0, 'nothing waiting, nothing drawn');
  draw();
  draw.flush();
  assert.equal(runs, 1);
  advance(500);
  assert.equal(runs, 1, 'the frame it had asked for draws nothing more');
  draw();
  draw.cancel();
  advance(500);
  assert.equal(runs, 1);
});

test('the Workers view draws every live worker but only the first few gone home', () => {
  const list = [...Array.from({ length: 300 }, (_, i) => ({ id: `gone${i}` })), { id: 'live1', w: {} }, { id: 'live2', w: {} }];
  const { shown, hidden } = capGone(list, GONE_CAP);
  assert.equal(shown.length, GONE_CAP + 2);
  assert.equal(hidden, 300 - GONE_CAP);
  assert.ok(shown.some((i) => i.id === 'live1') && shown.some((i) => i.id === 'live2'), 'the live ones even at the end of the order');
  assert.deepEqual(capGone(list.slice(0, 5), GONE_CAP), { shown: list.slice(0, 5), hidden: 0 });
});

const src = (f: string) => readFileSync(new URL(`../src/client/${f}`, import.meta.url), 'utf8');

test('the views that follow every worker update draw through batched()', () => {
  // The ranking's render (store 'workers' → renderWorkers) asks for a draw, never draws.
  const ranking = src('ui/ranking/index.ts');
  const render = ranking.slice(ranking.indexOf('  function render(workers: WorkerInfo[])'), ranking.indexOf('  function items('));
  assert.match(render, /drawSoon\(\);/);
  assert.doesNotMatch(render, /\bdraw\(\);/);
  // The phone's office-driven redraws (every feed, every message) are the slow batch.
  const phone = src('ui/phone/index.ts');
  assert.match(phone, /onFeed\(floor, \(\) => drawLater\(\)\)/);
  assert.match(phone, /refresh: \(\) => drawLater\(\)/);
  assert.doesNotMatch(phone, /requestAnimationFrame\(\(\) => \(\(frameReq/);
});

test("a robot is two paths, not a rect per pixel; a sprite's canvas is read back on the CPU", () => {
  assert.doesNotMatch(src('ui/ranking/view.ts'), /createElementNS\(ns, 'rect'\)/);
  assert.match(src('pixel/chars.ts'), /getContext\('2d', \{ willReadFrequently: true \}\)/);
});

test('a phone log draws only the newest STREAM_CAP messages', async () => {
  const { newest, STREAM_CAP } = await import('../src/client/ui/phone/cap.js');
  const items = Array.from({ length: 1000 }, (_, i) => ({ at: 1000 - i }));
  const shown = newest(items, STREAM_CAP);
  assert.equal(shown.length, STREAM_CAP);
  assert.equal(shown[0].at, 1000 - STREAM_CAP + 1, 'the newest ones');
  assert.equal(shown.at(-1)!.at, 1000, 'oldest first, newest last');
  assert.equal(newest([{ at: 2 }, { at: 1 }], STREAM_CAP).length, 2);
});

test('nothing rewrites the page for a worker update that changes nothing it shows', () => {
  // The tab badges, the title, the phone's badge: written only when they change (each write restyled 1,400 elements).
  const badge = src('ui/badge.ts');
  assert.match(badge, /if \(el\.title !== tip\) el\.title = tip;/);
  assert.match(badge, /if \(el\.getAttribute\('aria-label'\) !== label\)/);
  assert.match(src('shared/title.ts'), /if \(document\.title !== title\) document\.title = title;/);
  assert.match(src('ui/phone/frame.ts'), /if \(badge\.textContent !== text\) badge\.textContent = text;/);
  // Needs you: batched, and skipped when the items it shows are the same.
  const ny = src('ui/needsyou/index.ts');
  assert.match(ny, /store\.on\(k, refreshSoon\)/);
  assert.match(ny, /if \(key === drawnKey\) return;/);
  // The phone's open log: skipped when what it reads didn't change.
  assert.match(src('ui/phone/index.ts'), /if \(key === drawnKey && !toBottom\) return;/);
  // The board and the phone page: batched.
  assert.match(src('lite.ts'), /store\.on\(k, renderKanbanSoon\)/);
  assert.match(src('mobile/app.ts'), /store\.on\(k, drawLater\)/);
});

test("the board keeps its columns' scroll from scroll events, never by reading the layout before a redraw", () => {
  const kb = src('ui/kanban.ts');
  const kept = kb.slice(kb.indexOf('function keptScroll('), kb.indexOf('function column('));
  const before = kept.slice(0, kept.indexOf('return () =>'));
  assert.doesNotMatch(before, /scrollTop|scrollLeft|querySelector/, 'nothing is read before the redraw');
  assert.match(kept, /addEventListener\('scroll'/);
});

test('long lists skip what is off screen, and the chat starts with fewer rows', async () => {
  for (const [f, sel] of [['ui/phone/phone.css', '.tp-log > li'], ['ui/kanban.css', '.kb-cards > li'], ['ui/ranking/ranking.css', '.rk-list > .rk-item'], ['ui/pm/chat/chat.css', '.pmc-rows > *']] as const)
    assert.ok(src(f).includes(`${sel} { content-visibility: auto;`), f);
  assert.ok(Number(src('ui/pm/chat/view.ts').match(/export const PAGE = (\d+);/)?.[1]) <= 60, 'the chat starts with at most 60 rows');
  // The team phone's ping is a tiny WAV on an <audio>, not a Web Audio graph opened in the middle of a paint.
  assert.ok(src('ui/phone/alerts.ts').includes('new Audio(pingUrl).play()'));
  assert.doesNotMatch(src('ui/phone/alerts.ts'), /new AudioContext/);
});

test("the Team boards page draws its journal once per fetch, its newest entries first, not on every redraw", () => {
  const page = src('ui/teams/page.ts');
  assert.match(page, /const journals = new WeakMap<TeamPageData, HTMLElement>\(\);/);
  assert.match(page, /const journal = journalPanel\(pageData\);/);
  assert.match(page, /export const JOURNAL_SHOWN = 20;/);
});
