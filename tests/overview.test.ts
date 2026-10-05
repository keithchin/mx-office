import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERVIEW_BANNER, OVERVIEW_GAP, overviewColumns, overviewGrid, overviewHit, overviewStats } from '../src/shared/overview.js';
import { overviewWorker } from '../src/server/overview.js';
import { Camera } from '../src/client/pixel/camera.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('as many floors abreast as shows them biggest, and one above the other on a phone', () => {
  const floor = { width: 760, height: 650 };
  // A wide, short stage: three floors in a row beat two rows of two.
  assert.equal(overviewColumns(1200, 650, [floor, floor, floor]), 3);
  // Four in a tall stage: two by two.
  assert.equal(overviewColumns(1200, 1400, [floor, floor, floor, floor]), 2);
  assert.equal(overviewColumns(390, 700, [floor, floor, floor]), 1);
  assert.equal(overviewColumns(1280, 700, [floor]), 1);
  // Never more than three abreast.
  assert.ok(overviewColumns(4000, 400, Array(6).fill(floor)) <= 3);
});

test('the grid lays floors out row by row, each row as tall as its tallest floor', () => {
  const g = overviewGrid([{ width: 700, height: 500 }, { width: 700, height: 600 }, { width: 700, height: 500 }], 2, 40, 60);
  assert.deepEqual(g.cells.map((c) => [c.x, c.y, c.floorY]), [[40, 40, 100], [780, 40, 100], [40, 740, 800]]);
  assert.equal(g.width, 40 + 2 * (700 + 40));
  assert.equal(g.height, 740 + 60 + 500 + 40);
  // One column: a floor under another.
  const one = overviewGrid([{ width: 700, height: 500 }, { width: 700, height: 500 }], 1);
  assert.equal(one.cells[1].y, OVERVIEW_GAP + OVERVIEW_BANNER + 500 + OVERVIEW_GAP);
  assert.equal(one.width, 700 + 2 * OVERVIEW_GAP);
  // No floors: an empty grid, not a crash.
  assert.deepEqual(overviewGrid([], 2).cells, []);
});

test('a point in the grid is on a floor, its banner, or between them', () => {
  const { cells } = overviewGrid([{ width: 700, height: 500 }, { width: 700, height: 500 }], 2, 40, 60);
  assert.deepEqual(overviewHit(cells, 50, 50), { index: 0, part: 'banner' });
  assert.deepEqual(overviewHit(cells, 800, 300), { index: 1, part: 'floor' });
  assert.equal(overviewHit(cells, 760, 300), null);
  assert.equal(overviewHit(cells, 10, 10), null);
});

test("a floor's banner line says who's working, who's waiting and its open PRs", () => {
  assert.equal(overviewStats({ workers: [], working: 0, waiting: 0, prsOpen: 1 }), '👷 0 working · 🔀 1 open PR · 💻 0 workers');
  assert.match(overviewStats({ workers: [{} as never, {} as never], working: 1, waiting: 2, prsOpen: 3 }), /🙋 2 waiting.*3 open PRs.*2 workers/);
});

test('the endpoint sends a worker cut down to what the overview draws, its lines clipped', () => {
  const w = { id: 'w1', kind: 'agent', name: 'Ada', color: '#f00', status: 'needs_input', deskId: 'desk-1', acked: false, prompt: 'x'.repeat(300), activity: 'Allow permission?', viewers: ['me'], cols: 80, rows: 24, createdBy: 'me', createdAt: 1, viewerIds: [], pr: { number: 7, url: 'u' } } as WorkerInfo;
  const o = overviewWorker(w);
  assert.equal(o.task?.length, 90);
  assert.equal(o.now, 'Allow permission?');
  assert.equal(o.pr, 7);
  assert.equal('viewers' in o, false);
  assert.equal(overviewWorker({ ...w, status: 'working', task: { name: 'Fix it', summary: 'Editing' } }).now, 'Editing');
});

test('the camera fits the whole grid, and the overview one never fills a phone by height', () => {
  const cam = new Camera({ key: 'test-zoom', steps: [0.5, 1, 2], fillHeight: false });
  cam.layout(390, 600, 780, 1800);
  assert.equal(cam.zoom, 'fit');
  assert.equal(cam.scale, 600 / 1800);
  assert.equal(cam.pannable, false);
  // The 2D view's camera fills an upright phone's height instead, and pans sideways.
  const pixel = new Camera();
  pixel.layout(390, 600, 780, 500);
  assert.equal(pixel.scale, 1.2);
  assert.equal(pixel.pannable, true);
  // Zooming in goes through the steps, about the point given; out stops at all of it showing.
  cam.step(1, 0, 0);
  assert.equal(cam.zoom, 0.5);
  assert.equal(cam.label(), '50%');
  cam.step(1);
  assert.equal(cam.label(), '1×');
  cam.step(-1);
  cam.step(-1);
  assert.equal(cam.zoom, 'fit');
});
