// The teams' patches of the floor (shared/zones.ts): every team has one, no desk is in two, and a
// role's hire sits in its own team's patch while there's a desk free there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { ROLES } from '../src/shared/roster/roles.js';
import { ZONES, ZONE_OF_DESK, zoneSeat } from '../src/shared/zones.js';

test('every team has a patch of real desks, and no desk is in two', () => {
  for (const r of ROLES) assert.ok(ZONES.some((z) => z.team === r.team), `${r.team} has a zone`);
  const all = ZONES.flatMap((z) => z.desks);
  assert.equal(new Set(all).size, all.length);
  for (const d of all) assert.ok(DESK_BY_ID.has(d), `${d} is a desk`);
  for (const z of ZONES) for (const id of z.desks) {
    const d = DESK_BY_ID.get(id)!;
    assert.ok(d.x >= z.area.minX && d.x <= z.area.maxX && d.z >= z.area.minZ && d.z <= z.area.maxZ, `${id} is inside the ${z.name}`);
  }
  assert.equal(ZONE_OF_DESK.get('desk-1')?.team, 'development');
});

test("a hire takes its team's Lead desk first, then the team's next, then none", () => {
  assert.equal(zoneSeat('development', () => false), 'desk-1');
  assert.equal(zoneSeat('development', (id) => id === 'desk-1'), 'desk-2');
  assert.equal(zoneSeat('management', () => true), undefined);
});
