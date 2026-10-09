// The Model tab's readable domain models (client/ui/model/domain-layout.ts): associations nobody
// arranged in Studio Pro get facing sides, spread ends and routes around the boxes; points someone
// moved stay exactly; the tidy layout is the same every time; and it's all cheap. The fixture is the
// TravelApproval module of a test app as the office cached it: 18 entities on mxcli's grid and 21
// associations at Studio Pro's default connection points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DmAssociation, DmEntity, DomainDoc } from '../src/shared/model.js';
import { ENTITY_W, entityHeight, facing, looksUnarranged, routeAssociations, segHitsBox, spreadAlong, unarranged, type Box } from '../src/client/ui/model/domain-layout.js';
import { tidyDomain } from '../src/client/ui/model/domain-tidy.js';
import { drawDomain } from '../src/client/ui/model/domain-draw.js';

const travel = (): DomainDoc => JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'model', 'domain-travel-approval.json'), 'utf8'));
const boxesOf = (doc: DomainDoc) => new Map<string, Box>(doc.entities.map((e) => [e.id, { x: e.x, y: e.y, w: ENTITY_W, h: entityHeight(e) }]));
const key = (p: { x: number; y: number }) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

/** Every entity an orthogonal line passes through (its own two only where it leaves or enters them). */
function crossings(doc: DomainDoc) {
  const boxes = boxesOf(doc);
  const routes = routeAssociations(doc.associations, boxes);
  const bad: string[] = [];
  for (const a of doc.associations) {
    const r = routes.get(a.id);
    if (!r || r.kind !== 'ortho') continue;
    for (let i = 1; i < r.pts.length; i++) {
      for (const e of doc.entities) {
        const b = boxes.get(e.id)!;
        // Shrunk a little: a line may start on (or run along) a box's edge.
        if (segHitsBox(r.pts[i - 1], r.pts[i], { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 })) bad.push(`${a.name} crosses ${e.name}`);
      }
    }
  }
  return { routes, bad };
}

test('the facing sides: left/right when further apart across, top/bottom when further apart down', () => {
  const a = { x: 0, y: 0, w: 170, h: 100 };
  assert.deepEqual(facing(a, { x: 300, y: 20, w: 170, h: 100 }), ['R', 'L']);
  assert.deepEqual(facing(a, { x: -300, y: 20, w: 170, h: 100 }), ['L', 'R']);
  assert.deepEqual(facing(a, { x: 20, y: 200, w: 170, h: 100 }), ['B', 'T']);
  assert.deepEqual(facing(a, { x: 20, y: -200, w: 170, h: 100 }), ['T', 'B']);
  // Diagonal: whichever gap is the bigger.
  assert.deepEqual(facing(a, { x: 400, y: 150, w: 170, h: 100 }), ['R', 'L']);
  assert.deepEqual(facing(a, { x: 200, y: 400, w: 170, h: 100 }), ['B', 'T']);
});

test('ends on one side spread around its middle, never on the same point', () => {
  assert.deepEqual(spreadAlong(100, 1), [0.5]);
  const t = spreadAlong(170, 4);
  assert.equal(new Set(t).size, 4);
  assert.ok(t.every((v) => v > 0 && v < 1));
  assert.ok(Math.abs(t[0] + t[3] - 1) < 1e-9, 'centred');
  const many = spreadAlong(89, 9);
  assert.ok(many.every((v, i) => i === 0 || v > many[i - 1]) && many[0] > 0 && many[8] < 1);
});

test('TravelApproval: no two association ends meet a box at the same point', () => {
  const doc = travel();
  const { routes } = crossings(doc);
  const seen = new Map<string, string>();
  for (const a of doc.associations) {
    const r = routes.get(a.id)!;
    assert.ok(r, a.name);
    const ends = r.kind === 'cross' ? [r.pts[0]] : [r.pts[0], r.pts[r.pts.length - 1]];
    for (const p of ends) {
      assert.ok(!seen.has(key(p)), `${a.name} and ${seen.get(key(p))} share an end`);
      seen.set(key(p), a.name);
    }
  }
});

test('TravelApproval: the lines go round the entities, in straight horizontal and vertical segments', () => {
  const doc = travel();
  const { routes, bad } = crossings(doc);
  assert.deepEqual(bad, []);
  for (const a of doc.associations.filter((x) => !x.cross)) {
    const r = routes.get(a.id)!;
    assert.equal(r.kind, 'ortho', a.name);
    assert.ok(r.auto);
    for (let i = 1; i < r.pts.length; i++) assert.ok(r.pts[i].x === r.pts[i - 1].x || r.pts[i].y === r.pts[i - 1].y, `${a.name} segment ${i} is orthogonal`);
  }
  // The stubs to other modules cross nothing either.
  const boxes = boxesOf(doc);
  for (const a of doc.associations.filter((x) => x.cross)) {
    const r = routes.get(a.id)!;
    for (const e of doc.entities) if (e.id !== a.parent) assert.ok(!segHitsBox(r.pts[0], r.pts[1], boxes.get(e.id)!), `${a.name} stub crosses ${e.name}`);
  }
});

/** Association names over an entity, leaving out lines with no segment as long as their name (between two boxes 90 apart, say). */
function namesOver(doc: DomainDoc) {
  const boxes = boxesOf(doc);
  const routes = routeAssociations(doc.associations, boxes);
  const covered: string[] = [];
  for (const a of doc.associations) {
    const r = routes.get(a.id)!;
    const w = a.name.length * 11.5 * 0.52 + 8;
    const rect = { x: r.name.x - w / 2, y: r.name.y - 10, w, h: 20 };
    let longest = 0;
    for (let i = 1; i < r.pts.length; i++) longest = Math.max(longest, Math.abs(r.pts[i].x - r.pts[i - 1].x) + Math.abs(r.pts[i].y - r.pts[i - 1].y));
    if (longest < w + 30) continue;
    for (const e of doc.entities) {
      const b = boxes.get(e.id)!;
      if (rect.x < b.x + b.w && rect.x + rect.w > b.x && rect.y < b.y + b.h && rect.y + rect.h > b.y) covered.push(`${a.name} over ${e.name}`);
    }
  }
  return covered;
}

test('TravelApproval: association names cover no entity where their line has room', () => {
  assert.deepEqual(namesOver(travel()), []);
  assert.deepEqual(namesOver(tidyDomain(travel())), []);
});

test('points someone moved in Studio Pro stay exactly: a straight line between them', () => {
  const doc = travel();
  const a = doc.associations.find((x) => x.name === 'TravelRequest_Requestor')!;
  a.parentConn = { x: 100, y: 20 };
  a.childConn = { x: 0, y: 80 };
  assert.equal(unarranged(a), false);
  assert.equal(unarranged(doc.associations.find((x) => x.name === 'TravelRequest_FinalApprover')!), true);
  const boxes = boxesOf(doc);
  const r = routeAssociations(doc.associations, boxes).get(a.id)!;
  const pb = boxes.get(a.parent)!;
  const cb = boxes.get(a.child)!;
  assert.equal(r.kind, 'straight');
  assert.equal(r.auto, false);
  assert.deepEqual(r.pts, [
    { x: pb.x + pb.w, y: pb.y + pb.h * 0.2 },
    { x: cb.x, y: cb.y + cb.h * 0.8 },
  ]);
  // Missing points count as unarranged too.
  assert.equal(unarranged({ ...a, parentConn: undefined, childConn: undefined }), true);
});

test('an association from an entity to itself loops out of its right side', () => {
  const e: DmEntity = { id: 'e', name: 'Node', kind: 'persistent', x: 0, y: 0, attrs: [] };
  const a: DmAssociation = { id: 'a', name: 'Node_Parent', parent: 'e', child: 'e', type: 'Reference', owner: 'Default', parentConn: { x: 0, y: 50 }, childConn: { x: 100, y: 50 } };
  const r = routeAssociations([a], boxesOf({ kind: 'domainmodel', module: 'M', entities: [e], associations: [a], annotations: [], source: 'units' })).get('a')!;
  assert.equal(r.kind, 'ortho');
  assert.ok(r.pts[0].x === ENTITY_W && r.pts[r.pts.length - 1].x === ENTITY_W);
  assert.notEqual(r.pts[0].y, r.pts[r.pts.length - 1].y);
});

test('the TravelApproval layout looks unarranged; a moved one does not', () => {
  const doc = travel();
  assert.equal(looksUnarranged(doc), true);
  const moved = { ...doc, entities: doc.entities.map((e, i) => ({ ...e, x: e.x + (i % 3) * 37 })) };
  assert.equal(looksUnarranged(moved), false);
  const arranged = { ...doc, associations: doc.associations.map((a) => ({ ...a, parentConn: { x: 50, y: 0 }, childConn: { x: 50, y: 100 } })) };
  assert.equal(looksUnarranged(arranged), false);
  assert.equal(looksUnarranged(tidyDomain(doc)), false);
});

test('the tidy layout is the same every time, overlaps nothing and never touches the model', () => {
  const doc = travel();
  const before = JSON.stringify(doc);
  const a = tidyDomain(doc);
  const b = tidyDomain(travel());
  assert.equal(JSON.stringify(doc), before, 'the model is untouched');
  assert.deepEqual(a, b);
  // Shuffled input order: the same places.
  const shuffled = { ...doc, entities: [...doc.entities].reverse(), associations: [...doc.associations].reverse() };
  const c = tidyDomain(shuffled);
  for (const e of a.entities) {
    const o = c.entities.find((x) => x.id === e.id)!;
    assert.deepEqual([o.x, o.y], [e.x, e.y], e.name);
  }
  const boxes = [...boxesOf(a).values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i];
      const q = boxes[j];
      assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${a.entities[i].name} overlaps ${a.entities[j].name}`);
    }
  // Referenced entities sit above the ones referencing them.
  const at = (name: string) => a.entities.find((e) => e.name === name)!;
  assert.ok(at('Country').y < at('TravelProfile').y);
  assert.ok(at('TravelProfile').y < at('TravelRequest').y);
  assert.ok(at('TravelRequest').y < at('ApprovalStep').y);
  // Its stored points belonged to the old places: every line gets chosen ends.
  assert.ok(a.associations.every((x) => !x.parentConn && !x.childConn));
  assert.deepEqual(crossings(a).bad, []);
});

/** A synthetic model: `n` entities on a grid, `m` associations between them (deterministic). */
function synthetic(n: number, m: number): DomainDoc {
  const entities: DmEntity[] = Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    name: `Entity${i}`,
    kind: i % 3 ? 'persistent' : 'nonpersistent',
    x: 100 + (i % 8) * 260,
    y: 100 + Math.floor(i / 8) * 300,
    attrs: Array.from({ length: (i * 7) % 12 }, (_, k) => ({ name: `Attr${k}`, type: 'String' })),
  }));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const associations: DmAssociation[] = Array.from({ length: m }, (_, i) => {
    const p = Math.floor(rnd() * n);
    let c = Math.floor(rnd() * n);
    if (c === p) c = (c + 1) % n;
    return { id: `a${i}`, name: `Entity${p}_Entity${c}_${i}`, parent: `e${p}`, child: `e${c}`, type: i % 4 ? 'Reference' : 'ReferenceSet', owner: 'Default', parentConn: { x: 0, y: 50 }, childConn: { x: 100, y: 50 } };
  });
  return { kind: 'domainmodel', module: 'Big', entities, associations, annotations: [], source: 'units' };
}

test('perf: routing 50 entities and 80 associations takes well under 30 ms (and the tidy layout too)', () => {
  const doc = synthetic(50, 80);
  const boxes = boxesOf(doc);
  // Warm up once, then take the best of a few runs (the machine may be busy).
  routeAssociations(doc.associations, boxes);
  let best = Infinity;
  let bestTidy = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    routeAssociations(doc.associations, boxes);
    best = Math.min(best, performance.now() - t0);
    const t1 = performance.now();
    const tidy = tidyDomain(doc);
    routeAssociations(tidy.associations, boxesOf(tidy));
    bestTidy = Math.min(bestTidy, performance.now() - t1);
  }
  assert.ok(best < 30, `routing took ${best.toFixed(1)} ms`);
  assert.ok(bestTidy < 30, `tidy layout and routing took ${bestTidy.toFixed(1)} ms`);
  const d = drawDomain(doc);
  assert.equal((d.svg.match(/class="mx-edge/g) ?? []).length, 80);
});

test("the drawing keeps Studio Pro's look (discs, owner dot, arrow, name box) and says which entities a line joins", () => {
  const doc = travel();
  const d = drawDomain(doc);
  const a = doc.associations.find((x) => x.name === 'ApprovalStep_TravelRequest')!;
  const g = d.svg.slice(d.svg.indexOf(`data-id="${a.id}"`));
  const one = g.slice(0, g.indexOf('</g><g class="mx-e'));
  assert.ok(one.includes(`data-ends="${a.parent} ${a.child}"`));
  for (const cls of ['mx-hit', 'mx-assoc', 'mx-arrow', 'mx-aname', 'mx-mult', 'mx-owner']) assert.ok(one.includes(cls), cls);
});
