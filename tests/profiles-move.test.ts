// Hire from your agents and Move (Portfolios Phase 2, sequential reuse): a free profile reused at once; a
// profile active elsewhere refused without a confirmed Move (no silent concurrency, no "on loan"); a Move
// benches the source with its handoff (kept there), then hires the destination in a fresh session that
// carries none of it (A02); hires of either seat refused mid-move; a destination failure put back and
// retried; and every state a restart can leave reconciled without a second live session (A03). Fake floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { benchWithHandoff, mark, until, world, type World } from './profiles-world.js';

/** Zelda on A as Lead Developer, hired and idle, with her profile. */
async function zeldaOnA(): Promise<{ w: World; id: string }> {
  const w = world();
  assert.equal(w.roster.members.rename(w.a, 'lead-developer', 'Zelda'), undefined);
  assert.equal(await w.roster.members.hire(w.a, 'lead-developer', 'Keith'), undefined);
  await w.settle();
  w.a.set(w.a.workerOf('lead-developer')!.id, 'idle');
  return { w, id: w.svc.store.ofSeat('fa', 'lead-developer')!.id };
}

const live = (w: World) => w.floors.flatMap((f) => f.workers().filter((x) => x.name === 'Zelda'));

test('a profile on no project is hired at once: a fresh session, recorded as a reuse in both logs', async () => {
  const { w, id } = await zeldaOnA();
  await w.a.stop(w.a.workerOf('lead-developer')!.id);
  await w.svc.forgetFloor('fa');
  const r = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-tester', by: 'Keith' });
  assert.equal(r.error, undefined);
  assert.equal(r.op?.state, 'done');
  assert.equal(w.roster.data('fb').members['lead-tester'].name, 'Zelda');
  assert.match(w.b.hires.at(-1)!.prompt, /You are Zelda, the Lead Tester/);
  const p = w.svc.store.get(id)!;
  assert.deepEqual(p.assignments.map((a) => [a.floor, a.role, a.reason, a.ended ?? null]), [['fa', 'lead-developer', 'hired', 'project-removed'], ['fb', 'lead-tester', 'reused', null]]);
  assert.ok(w.audits.some((e) => e.action === 'profile.reuse' && e.floor === 'fb'));
});

test('A02 + no silent concurrency: Move benches the source with its handoff kept there, then hires fresh at the destination', async () => {
  const { w, id } = await zeldaOnA();
  // Asked without the Move: refused, with what a Move would do there.
  const asked = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith' });
  assert.equal(asked.status, 409);
  assert.deepEqual(asked.needsMove?.from, { floor: 'fa', role: 'lead-developer', project: 'Travel approval', status: 'active' });
  assert.equal(w.b.hires.length, 0);
  assert.equal(w.a.prompts.length, 0);
  // Confirmed: the source is asked for its handoff; nothing is hired yet.
  const started = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
  assert.equal(started.op?.state, 'source-benching');
  assert.match(w.a.prompts.at(-1)!.text, /benching you/);
  assert.equal(w.b.hires.length, 0);
  // Mid-move, neither seat can be hired by any other path, and another move of her is refused.
  assert.match(String(await w.roster.members.hire(w.b, 'lead-developer', 'Keith')), /kept for Zelda/);
  assert.match(String((await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-tester', by: 'Keith', move: true })).error), /already has a move/);
  // The handoff, with a planted marker, written on A; once benched, B hires her.
  const secret = mark('A-HANDOFF');
  await benchWithHandoff(w, w.a, 'lead-developer', 'development', `**What I know** Travel approval's ${secret}.`);
  await until(() => w.b.hires.length === 1, 'the destination hire');
  await until(() => w.svc.store.data.moves.at(-1)!.state === 'done', 'the move to finish');
  await w.settle();
  const prompt = w.b.hires[0].prompt;
  assert.match(prompt, /You are Zelda, the Lead Developer/);
  assert.match(prompt, /first session on the project/);
  assert.match(prompt, /worked on 1 other project before/);
  assert.ok(!prompt.includes(secret), 'the source handoff never reaches the destination');
  assert.ok(!prompt.includes('Travel approval'));
  // The handoff stays with A's seat, which is released and renamed for its next hire.
  const aSeat = w.roster.data('fa').members['lead-developer'];
  assert.match(aSeat.handoff!.text, new RegExp(secret));
  assert.notEqual(aSeat.name, 'Zelda');
  assert.equal(w.svc.store.data.seats['fa|lead-developer'], null);
  assert.equal(w.svc.store.ofSeat('fb', 'lead-developer')!.id, id);
  // One live session for the profile, ever.
  assert.equal(live(w).length, 1);
  const p = w.svc.store.get(id)!;
  assert.deepEqual(p.assignments.map((a) => [a.floor, a.reason, a.ended ?? null]), [['fa', 'hired', 'moved'], ['fb', 'moved-in', null]]);
  assert.equal(p.assignments[1].workers.length, 1);
  for (const f of ['fa', 'fb']) {
    assert.ok(w.audits.some((e) => e.floor === f && e.action === 'profile.move-started'));
    assert.ok(w.audits.some((e) => e.floor === f && e.action === 'profile.move-done'));
  }
  // A hires its open seat as someone new: a new profile.
  await w.roster.members.hire(w.a, 'lead-developer', 'Keith');
  await w.settle();
  assert.notEqual(w.svc.store.ofSeat('fa', 'lead-developer')!.id, id);
});

test('a benched profile elsewhere needs the Move confirmed (its seat there is released), then is hired at once', async () => {
  const { w, id } = await zeldaOnA();
  await w.a.stop(w.a.workerOf('lead-developer')!.id);
  const asked = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith' });
  assert.equal(asked.needsMove?.from.status, 'benched');
  const r = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
  assert.equal(r.op?.state, 'done');
  assert.equal(w.b.hires.length, 1);
});

test('a refused bench cancels the move with its reason; a busy or held destination is refused before anything happens', async () => {
  const { w, id } = await zeldaOnA();
  w.a.set(w.a.workerOf('lead-developer')!.id, 'working');
  const r = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
  assert.match(String(r.error), /Can't move Zelda: Can't bench/);
  assert.equal(w.svc.store.data.moves.at(-1)!.state, 'cancelled');
  await w.roster.members.hire(w.b, 'lead-developer', 'Keith');
  w.a.set(w.a.workerOf('lead-developer')!.id, 'idle');
  assert.match(String((await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true })).error), /seat is taken/);
  assert.equal(w.a.workerOf('lead-developer')!.status, 'idle');
});

test('A03: a destination hire that fails puts the seat back, keeps the profile on its benched source, and Retry finishes', async () => {
  const { w, id } = await zeldaOnA();
  await w.a.stop(w.a.workerOf('lead-developer')!.id);
  const before = w.roster.data('fb').members['lead-developer'].name;
  w.b.failHire = 'Every desk and bean bag is taken';
  const r = await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
  assert.match(String(r.error), /wasn't hired/);
  const op = w.svc.store.data.moves.at(-1)!;
  assert.equal(op.state, 'failed');
  assert.equal(op.stage, 'dest');
  assert.equal(w.roster.data('fb').members['lead-developer'].name, before);
  assert.equal(w.svc.store.seatOf(id)?.floor, 'fa');
  assert.ok(w.audits.some((e) => e.action === 'profile.move-failed'));
  // While it waits, A's seat can't be hired (it's still hers, and the move is open)…
  assert.match(String(await w.roster.members.hire(w.a, 'lead-developer', 'Keith')), /moving to Welcome desk/);
  // …and Retry, once the destination can hire, finishes it.
  w.b.failHire = undefined;
  const again = await w.svc.moves.retry(op.id, 'Keith');
  assert.equal(again.error, undefined);
  assert.equal(op.state, 'done');
  assert.equal(live(w).length, 1);
});

test('A03: a restart mid-move reconciles from the seats: hired → done, not hired → put back, bench lost → failed', async () => {
  // dest-hiring, and the hire happened before the office stopped.
  {
    const { w, id } = await zeldaOnA();
    await w.a.stop(w.a.workerOf('lead-developer')!.id);
    await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
    const file = path.join(w.dataDir, 'profiles.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const op = saved.moves.at(-1);
    // As the file stood before "done" was written: the destination reserved, the source still linked.
    Object.assign(op, { state: 'dest-hiring' });
    saved.seats['fa|lead-developer'] = id;
    writeFileSync(file, JSON.stringify(saved));
    const svc = w.restart();
    await svc.start();
    assert.equal(svc.store.data.moves.at(-1)!.state, 'done');
    assert.equal(svc.store.data.seats['fa|lead-developer'], null);
    assert.equal(w.b.hires.length, 1, 'never hired twice');
  }
  // dest-hiring, and the hire never happened.
  {
    const { w, id } = await zeldaOnA();
    await w.a.stop(w.a.workerOf('lead-developer')!.id);
    const before = w.roster.data('fb').members['lead-developer'].name;
    w.b.failHire = 'stopped';
    await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
    const file = path.join(w.dataDir, 'profiles.json');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(saved.moves.at(-1), { state: 'dest-hiring' });
    delete saved.moves.at(-1).stage;
    saved.seats['fb|lead-developer'] = id;
    writeFileSync(file, JSON.stringify(saved));
    w.roster.members.setName(w.b, 'lead-developer', 'Zelda');
    const svc = w.restart();
    await svc.start();
    const op = svc.store.data.moves.at(-1)!;
    assert.equal(op.state, 'failed');
    assert.equal(w.roster.data('fb').members['lead-developer'].name, before);
    assert.equal(svc.store.seatOf(id)?.floor, 'fa');
  }
  // source-benching, but the source is still at work (its bench was lost).
  {
    const { w, id } = await zeldaOnA();
    await w.svc.moves.hire({ profileId: id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
    // The office stopped: the roster as saved before the bench was asked.
    w.roster.data('fa').members['lead-developer'].phase = 'active';
    const svc = w.restart();
    await svc.start();
    const op = svc.store.data.moves.at(-1)!;
    assert.equal(op.state, 'failed');
    assert.equal(op.stage, 'source');
    assert.equal(w.b.hires.length, 0);
    // Cancel leaves her where she is.
    assert.equal((await svc.moves.cancel(op.id, 'Keith')).error, undefined);
    assert.equal(svc.store.seatOf(id)?.floor, 'fa');
  }
});
