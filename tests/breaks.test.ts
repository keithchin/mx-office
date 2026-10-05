import test from 'node:test';
import assert from 'node:assert/strict';
import { breakAt, route } from '../src/client/pixel/breaks.js';
import { benchedLeads } from '../src/client/pixel/teams.js';
import { BALCONY, FLOOR } from '../src/shared/layout.js';

const T0 = Date.UTC(2026, 9, 5, 12);

test('a benched Lead is at the same break at the same moment in every browser', () => {
  assert.deepEqual(breakAt('Kamal', 0, T0 + 12_345), breakAt('Kamal', 0, T0 + 12_345));
  // Different Leads aren't in lockstep.
  const acts = new Set(['Kamal', 'Hedy', 'Mary', 'Annie', 'Joan'].map((n) => breakAt(n, 0, T0).act));
  assert.ok(acts.size > 1);
});

test('each break lasts half a minute to a minute and a half, and every break gets its turn', () => {
  const seen = new Set<string>();
  let last = breakAt('Kamal', 0, T0);
  let since = T0;
  const spans: number[] = [];
  for (let t = T0; t < T0 + 3_600_000; t += 1000) {
    const s = breakAt('Kamal', 0, t);
    seen.add(s.act);
    if (s.act !== last.act) {
      spans.push(t - since);
      since = t;
    }
    last = s;
  }
  assert.deepEqual([...seen].sort(), ['coffee', 'smoke', 'tv']);
  // The first span is cut off by where the hour began; the rest are whole breaks.
  for (const ms of spans.slice(1)) assert.ok(ms >= 29_000 && ms <= 91_000, `a break of ${ms} ms`);
});

test('a walk goes from one break to the other, out on the balcony only for a smoke', () => {
  const way = route('coffee', 'smoke', 0);
  const [sx, sz] = way[0], [ex, ez] = way[way.length - 1];
  assert.ok(sz < FLOOR.maxZ && sx < -12, 'starts at the kitchen');
  assert.ok(ez > BALCONY.minZ && ex > BALCONY.minX && ex < BALCONY.maxX, 'ends on the balcony');
  // Through the balcony doors (x -5.5 to -2.5), not through the wall.
  const crossing = way.findIndex((p, i) => i && (way[i - 1][1] < FLOOR.maxZ) !== (p[1] < FLOOR.maxZ));
  assert.ok(Math.abs(way[crossing][0] + 4) <= 1.5);
});

test('with less motion asked for, a Lead stays at their break', () => {
  for (let t = T0; t < T0 + 600_000; t += 7_000) assert.equal(breakAt('Kamal', 1, t, true).walking, false);
  // Without, they're walking now and then.
  let walked = false;
  for (let t = T0; t < T0 + 600_000 && !walked; t += 500) walked = breakAt('Kamal', 1, t).walking;
  assert.ok(walked);
});

test('only benched Leads go on a break, dressed for their role', () => {
  const leads = benchedLeads(
    [
      { role: 'lead-designer', team: 'design', title: 'Lead Designer', name: 'Kamal', status: 'benched' },
      { role: 'lead-developer', team: 'development', title: 'Lead Developer', name: 'Mary', status: 'working' },
    ],
    'alpha',
  );
  assert.deepEqual(leads.map((l) => [l.id, l.name, l.outfit]), [['lead:alpha:lead-designer', 'Kamal', 'designer']]);
});
