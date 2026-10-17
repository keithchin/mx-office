// Agent profiles (Portfolios Phase 2): the store, the migration of existing seats (M01), ids that survive
// a restart and aren't derived from names (A01), names unique office-wide for new hires with migrated
// duplicates disambiguated, renames kept in step, the owner's notes never in a hire's first message (S02),
// a removed project leaving its history, and "not measured yet" track records (M02). Fake floors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanFile } from '../src/server/profiles/store.js';
import { migrationId, planMigration } from '../src/server/profiles/migrate.js';
import { duplicateNames, freshName, isProfileId, labelOf, profileLine, TRACK_ROWS } from '../src/shared/profiles.js';
import { NAME_POOL } from '../src/shared/roster/roles.js';
import { mark, world } from './profiles-world.js';

test('the store cleans a hand-edited file: bad ids dropped, one seat per profile, unknown seats ignored', () => {
  const id = migrationId('fa', 'pm', 1);
  const f = cleanFile({
    profiles: [{ id, displayName: 'Ada\nX', assignments: [{ floor: 'fa', role: 'pm', start: 1, reason: 'bogus', workers: ['abc', '../x'] }, { floor: 'fa', role: 'nope', start: 1 }] }, { id: 'prf_bad', displayName: 'Bad' }, { id, displayName: 'Dupe' }],
    seats: { 'fa|pm': id, 'fb|pm': id, 'fc|pm': 'prf_missing', 'fd|pm': null, junk: id },
    moves: [{ id: 'mov_x', profileId: id }],
  });
  assert.equal(f.profiles.length, 1);
  assert.equal(f.profiles[0].displayName, 'Ada X');
  assert.deepEqual(f.profiles[0].assignments, [{ floor: 'fa', project: 'fa', role: 'pm', start: 1, reason: 'hired', workers: ['abc'] }]);
  assert.deepEqual(f.seats, { 'fa|pm': id, 'fd|pm': null });
  assert.deepEqual(f.moves, []);
});

test('M01: the migration gives each ever-hired seat one profile, deterministically, never merging by name', () => {
  const floors = [
    { id: 'fa', name: 'A', seats: [{ role: 'pm' as const, name: 'Ada', everHired: true, hiredAt: 1000 }, { role: 'lead-tester' as const, name: 'Grace', everHired: false }] },
    { id: 'fb', name: 'B', seats: [{ role: 'pm' as const, name: 'Ada', everHired: true, hiredAt: 2000, workerId: 'w1' }, { role: 'lead-developer' as const, name: 'Linus', everHired: true }] },
  ];
  const one = planMigration(floors, { seats: {}, profiles: [] }, 5);
  const two = planMigration(floors, { seats: {}, profiles: [] }, 9);
  // One per ever-hired seat (the two Adas are two profiles), the same ids every run.
  assert.equal(one.profiles.length, 3);
  assert.deepEqual(one.profiles.map((p) => p.id), two.profiles.map((p) => p.id));
  assert.ok(one.profiles.every((p) => isProfileId(p.id)));
  assert.equal(new Set(one.profiles.map((p) => p.id)).size, 3);
  assert.deepEqual(one.profiles.filter((p) => p.displayName === 'Ada').length, 2);
  assert.deepEqual(one.profiles[1].assignments[0].workers, ['w1']);
  // Already done: nothing more; a released seat (null) is never minted again.
  assert.equal(planMigration(floors, { seats: one.seats, profiles: one.profiles }, 9).profiles.length, 0);
  assert.equal(planMigration(floors, { seats: { 'fa|pm': null }, profiles: [] }, 9).profiles.length, 2);
  // A01: not derived from the name.
  assert.equal(migrationId('fa', 'pm', 1000), planMigration([{ ...floors[0], seats: [{ ...floors[0].seats[0], name: 'Zed' }] }], { seats: {}, profiles: [] }, 1).profiles[0].id);
});

test('M01 + A01: existing rosters migrate once, retry-safe, and the ids survive a restart', async () => {
  // An office from before profiles (the roster without the hooks): two projects, each with a "Zelda".
  const w = world({ noProfiles: true });
  for (const f of w.floors) assert.equal(w.roster.members.rename(f, 'pm', 'Zelda'), undefined);
  await w.roster.members.hire(w.a, 'pm', 'Keith');
  await w.roster.members.hire(w.b, 'pm', 'Keith');
  assert.equal(existsSync(path.join(w.dataDir, 'profiles.json')), false);
  const fresh = w.svc;
  assert.equal(await fresh.migrate(), 2);
  const ids = fresh.store.data.profiles.map((p) => p.id).sort();
  assert.deepEqual(ids, [migrationId('fa', 'pm', w.roster.data('fa').members.pm.hiredAt), migrationId('fb', 'pm', w.roster.data('fb').members.pm.hiredAt)].sort());
  // Run again after a restart: nothing new, the same ids.
  const again = w.restart();
  assert.equal(await again.migrate(), 0);
  assert.deepEqual(again.store.data.profiles.map((p) => p.id).sort(), ids);
  const v = await again.view(true);
  assert.deepEqual(v.profiles.map((p) => p.label).sort(), [`Zelda · #${ids[0].slice(-4)}`, `Zelda · #${ids[1].slice(-4)}`].sort());
  assert.ok(v.profiles.every((p) => p.where.kind === 'working'));
  assert.ok(w.audits.some((e) => e.action === 'profile.migrate'));
});

test('rollback: without profiles.json and without the hooks the roster works exactly as before', async () => {
  const w = world({ noProfiles: true });
  assert.equal(await w.roster.members.hire(w.a, 'pm', 'Keith'), undefined);
  assert.equal(w.roster.view(w.a, true).members.find((m) => m.role === 'pm')!.profileId, undefined);
  assert.equal(existsSync(path.join(w.dataDir, 'profiles.json')), false);
  w.roster.flush();
  // The roster file carries no profile field.
  const raw = readFileSync(path.join(w.dataDir, 'roster', 'fa.json'), 'utf8');
  assert.doesNotMatch(raw, /profile/i);
});

test('a first hire mints a profile; new names are unique office-wide; renames stay in step', async () => {
  const w = world();
  w.roster.members.rename(w.a, 'pm', 'Zelda');
  // B's seat happens to be called Zelda too (named before A's profile existed).
  w.roster.members.rename(w.b, 'pm', 'Zelda');
  await w.roster.members.hire(w.a, 'pm', 'Keith');
  await w.settle();
  const ada = w.svc.store.ofSeat('fa', 'pm')!;
  assert.equal(ada.displayName, 'Zelda');
  assert.equal(ada.createdBy, 'hire');
  assert.equal(ada.assignments[0].reason, 'hired');
  assert.equal(ada.assignments[0].project, 'Travel approval');
  assert.equal(w.roster.view(w.a, true).members.find((m) => m.role === 'pm')!.profileId, ada.id);
  // So B's first hire renames it to a free name.
  await w.roster.members.hire(w.b, 'pm', 'Keith');
  await w.settle();
  const other = w.svc.store.ofSeat('fb', 'pm')!;
  assert.notEqual(other.displayName.toLowerCase(), 'zelda');
  assert.equal(w.roster.data('fb').members.pm.name, other.displayName);
  assert.ok(w.b.toasts.some((t) => /Another agent in this office is called Zelda/.test(t)));
  // A rename to a name another agent has is refused; a fresh one goes to the profile and the worker.
  assert.match(String(w.roster.members.rename(w.b, 'pm', 'zelda')), /already called Zelda/);
  assert.equal(w.roster.members.rename(w.b, 'pm', 'Rosalind', 'Keith'), undefined);
  assert.equal(w.svc.store.get(other.id)!.displayName, 'Rosalind');
  assert.equal(w.b.workerOf('pm')!.name, 'Rosalind');
  // From the Agents page: the seat and its worker follow.
  assert.equal(await w.svc.rename(ada.id, 'Ottilie', 'Keith'), undefined);
  assert.equal(w.roster.data('fa').members.pm.name, 'Ottilie');
  assert.equal(w.a.workerOf('pm')!.name, 'Ottilie');
  assert.match(String(await w.svc.rename(ada.id, 'Rosalind', 'Keith')), /already called Rosalind/);
  assert.ok(w.audits.filter((e) => e.action === 'profile.rename').length >= 2);
});

test('S02: the owner’s notes and other projects’ names never reach a hire’s first message', async () => {
  const w = world();
  w.roster.members.rename(w.a, 'lead-developer', 'Zelda');
  await w.roster.members.hire(w.a, 'lead-developer', 'Keith');
  await w.settle();
  const ada = w.svc.store.ofSeat('fa', 'lead-developer')!;
  const note = mark('PROFILE-NOTE');
  await w.svc.setNotes(ada.id, `Client secret detail ${note}`, 'Keith');
  // Notes are in their own file, shown to admins only, and the audit line has the length, not the text.
  assert.match(readFileSync(path.join(w.dataDir, 'profile-notes.json'), 'utf8'), new RegExp(note));
  assert.doesNotMatch(readFileSync(path.join(w.dataDir, 'profiles.json'), 'utf8'), new RegExp(note));
  assert.equal((await w.svc.view(false)).profiles[0].notes, undefined);
  assert.match((await w.svc.view(true)).profiles[0].notes!.text, new RegExp(note));
  assert.ok(!JSON.stringify(w.audits).includes(note));
  // Bench on A (no handoff needed for this), then hire her on B.
  const worker = w.a.workerOf('lead-developer')!;
  w.a.set(worker.id, 'idle');
  await w.a.stop(worker.id);
  const r = await w.svc.moves.hire({ profileId: ada.id, floor: 'fb', role: 'lead-developer', by: 'Keith', move: true });
  assert.equal(r.error, undefined);
  const prompt = w.b.hires.at(-1)!.prompt;
  assert.match(prompt, /You are Zelda/);
  assert.match(prompt, /worked on 1 other project before\. Nothing from it comes with you/);
  assert.ok(!prompt.includes(note));
  assert.ok(!prompt.includes('Travel approval'));
  // No prompt builder reads the notes file (only the service's view and the route do).
  const builders = ['src/server/roster', 'src/server/portfolios'].flatMap((d) => readdirSync(d).map((f) => path.join(d, f)));
  for (const f of builders) assert.doesNotMatch(readFileSync(f, 'utf8'), /profiles\/notes|profile-notes/, f);
});

test('names, labels and the profile line', () => {
  assert.equal(freshName([]), NAME_POOL[0]);
  assert.equal(freshName(NAME_POOL.map((n) => n.toUpperCase())), `${NAME_POOL[0]} 2`);
  const list = [{ id: 'prf_01ARZ3NDEKTSV4RRFFQ69G5FAV', displayName: 'Ada' }, { id: 'prf_01ARZ3NDEKTSV4RRFFQ69G5FAW', displayName: 'ada' }, { id: 'prf_01ARZ3NDEKTSV4RRFFQ69G5FAX', displayName: 'Hedy' }];
  const d = duplicateNames(list);
  assert.equal(labelOf(list[0], d), 'Ada · #5FAV');
  assert.equal(labelOf(list[2], d), 'Hedy');
  assert.equal(profileLine(0), undefined);
  assert.ok(profileLine(3)!.length <= 300);
  assert.doesNotMatch(profileLine(3)!, /train|skill|learn|better/i);
  // M02: four rows, nothing measured.
  assert.equal(TRACK_ROWS.length, 4);
});

test('removing a project keeps the profile, ends its assignment and lets go of the seat', async () => {
  const w = world();
  await w.roster.members.hire(w.a, 'pm', 'Keith');
  await w.settle();
  const p = w.svc.store.ofSeat('fa', 'pm')!;
  await w.svc.forgetFloor('fa');
  const after = w.svc.store.get(p.id)!;
  assert.ok(after);
  assert.equal(after.assignments[0].ended, 'project-removed');
  assert.equal(after.assignments[0].project, 'Travel approval');
  assert.equal(w.svc.store.ofSeat('fa', 'pm'), undefined);
  // Survives a restart.
  const again = w.restart();
  await again.store.load();
  assert.equal(again.store.get(p.id)!.assignments[0].ended, 'project-removed');
});

test('the hire dialog lists this role’s agents first, never the seat’s own, and the Move says its effect on the source first', async () => {
  const { hireOrder, moveLines } = await import('../src/client/ui/profiles/words.js');
  const p = (id: string, label: string, roles: string[], where: object) => ({ id, label, displayName: label, roles, where, assignments: [], projects: 1, createdAt: 0, createdBy: 'hire' }) as never;
  const list = [p('1', 'Bo', ['lead-tester'], { kind: 'free' }), p('2', 'Al', ['lead-developer'], { kind: 'free' }), p('3', 'Cy', ['lead-developer'], { kind: 'benched', floor: 'fb', role: 'lead-developer', project: 'B' })];
  assert.deepEqual(hireOrder(list, 'fb', 'lead-developer').map((x: { label: string }) => x.label), ['Al', 'Bo']);
  const lines = moveLines({ profile: 'x', name: 'Zelda', from: { floor: 'fa', role: 'lead-developer', project: 'Travel approval', status: 'active' }, to: { floor: 'fb', role: 'lead-tester', project: 'Welcome desk' } });
  assert.match(lines[0], /On Travel approval, Zelda is asked to write a handoff note .* The note stays with Travel approval/);
  assert.match(lines[1], /fresh session .* Nothing from Travel approval comes along/);
  assert.match(lines.join(' '), /can’t work on both projects at once/);
  assert.doesNotMatch(lines.join(' '), /on loan|train|skill|better|learn/i);
});

test('a corrupt profiles.json is moved aside (never deleted) before the office starts profiles over', async () => {
  const w = world();
  writeFileSync(path.join(w.dataDir, 'profiles.json'), '{ not json');
  await w.svc.store.load();
  assert.equal(w.svc.store.data.profiles.length, 0);
  assert.ok(readdirSync(w.dataDir).some((f) => f.startsWith('profiles.json.corrupt-')));
});
