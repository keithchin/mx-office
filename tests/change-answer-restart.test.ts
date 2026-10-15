// A change (Slice 1B-3) or a correction (1B-2) whose dispatch outcome is unknown survives a restart: the pending
// change is on disk before anything is typed (change-answer/pending.ts), nothing moves on an unknown outcome,
// and once a person settles it after the restart, "It went through" moves the decision to the new revision and
// Abandon leaves it where it was (the pending entry cleared, with an audit line). Nothing is typed again.
// The real roster and dispatcher on a fake floor, "crashed" and made again from disk; no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditInput } from '../src/shared/audit.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import { withMarker } from '../src/shared/dispatch.js';
import type { Target } from '../src/server/dispatch/service.js';
import { ChangeAnswer } from '../src/server/change-answer/service.js';
import { FollowThrough } from '../src/server/followthrough/service.js';
import { personAct } from '../src/server/roster/dispatch-person.js';
import { clock, crashAndRestart, settle, type Office } from './dispatch-helpers.js';
import { journal, team, type Team } from './followthrough-helpers.js';

/** Typing that dies half-way: the office can't tell whether it went. */
const unknownTarget = (_f: string, x: Escalation) => (text: string): Target => ({ channel: 'type', workerId: x.workerId, workerName: x.by, payload: (m) => withMarker(text, m), act: () => Promise.reject(new Error('the office stopped mid-typing')) });

/** Change answer and Recorded as given made on an office's roster (the start after a restart makes them again). */
function services(t: Team, o: Office, audits: AuditInput[], unknown = false) {
  const ft = new FollowThrough({ ...t.ft.deps, dispatcher: o.roster.dispatch, escalations: (id) => o.roster.data(id).escalations, flush: (id) => o.roster.file(id).flushCritical(), record: (a) => void audits.push(a), ...(unknown ? { escTarget: unknownTarget } : {}) });
  const c = new ChangeAnswer({ dataDir: o.dataDir, now: () => clock.now, dispatcher: o.roster.dispatch, follow: ft.store, escalations: (id) => o.roster.data(id).escalations, escTarget: unknown ? unknownTarget : ft.deps.escTarget, qTarget: ft.deps.qTarget, sources: () => ({ tasks: [], changeRequests: [] }), flush: (id) => o.roster.file(id).flushCritical(), record: (a) => void audits.push(a) });
  return { ft, c };
}

const onDisk = (t: Team) => {
  try {
    return JSON.parse(readFileSync(path.join(t.o.dataDir, 'change-answer', `${t.floor.id}.pending.json`), 'utf8')) as { decision: string; fromRev: number; toRev: number; dispatchId: string; kind: string }[];
  } catch {
    return [];
  }
};
const escOf = (o: Office, t: Team) => o.roster.data(t.floor.id).escalations.find((x) => x.id === t.e.id)!;

/** A change sent with an unknown outcome, then the office restarted from disk: what's left. */
async function changedThenRestarted() {
  const t = await team();
  const audits: AuditInput[] = [];
  const { c } = services(t, t.o, audits, true);
  const decision = `esc:${t.e.id}`;
  const r = await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 1, verdict: 'reply', text: 'Go with: Use magic links' }, { by: 'Keith' });
  assert.ok(r.ok && r.note, JSON.stringify(r));
  assert.equal(t.e.resolution?.answerRev, 1, 'never moved on an unknown outcome');
  const rec = t.o.roster.dispatch.store.list(t.floor.id).find((x) => x.answerRev === 2)!;
  assert.equal(rec.state, 'outcome-unknown');
  assert.deepEqual(
    onDisk(t).map((p) => [p.decision, p.fromRev, p.toRev, p.dispatchId, p.kind]),
    [[decision, 1, 2, rec.id, 'change']],
    'the pending change is on disk',
  );
  const typed = t.floor.prompts.length;
  const o2 = crashAndRestart(t.floor, t.o);
  const s2 = services(t, o2, audits);
  await o2.roster.reconcile();
  await s2.c.pending.sweep(t.floor.id);
  await settle();
  assert.equal(escOf(o2, t).resolution?.answerRev, 1, 'still rev 1 after the restart: unknown stays unknown');
  assert.equal(onDisk(t).length, 1);
  return { t, o2, s2, rec, typed, audits, decision };
}

test('change-restart-went-through: after a restart, "It went through" moves the decision to rev 2; nothing is typed again', async () => {
  const { t, o2, s2, rec, typed } = await changedThenRestarted();
  assert.deepEqual(await personAct(o2.roster, t.floor, rec.id, 'went-through', 'Keith'), {});
  const e = escOf(o2, t);
  assert.deepEqual([e.resolution?.answerRev, e.resolution?.dispatchId, e.resolution?.text], [2, rec.id, 'Go with: Use magic links']);
  assert.equal(onDisk(t).length, 0, 'the pending entry is cleared');
  assert.equal((await s2.ft.store.get(t.floor.id)).recordings[`esc:${t.e.id}`]?.outcome, 'not-recorded-yet', 'followed through at rev 2');
  assert.equal(t.floor.prompts.length, typed, 'no duplicate typing');
  // It survives another restart as moved.
  const o3 = crashAndRestart(t.floor, o2);
  assert.equal(escOf(o3, t).resolution?.answerRev, 2);
});

test('change-restart-abandon: after a restart, Abandon leaves the decision at rev 1, clears the pending entry and says so', async () => {
  const { t, o2, rec, typed, audits, decision } = await changedThenRestarted();
  assert.deepEqual(await personAct(o2.roster, t.floor, rec.id, 'abandon', 'Keith'), {});
  assert.equal(escOf(o2, t).resolution?.answerRev, 1);
  assert.equal(onDisk(t).length, 0);
  assert.ok(audits.some((a) => a.action === 'answer.change-dropped' && a.ids?.decision === decision && /stays at rev 1/.test(a.summary)));
  // Rev 2 stays in the history; a later change supersedes rev 1, the revision the decision is at.
  assert.equal((await o2.roster.dispatch.answers.history(t.floor.id, decision)).length, 2);
  assert.equal(t.floor.prompts.length, typed);
});

test('correction-restart: a Send correction with an unknown outcome survives a restart; "It went through" then moves it, Abandon leaves it', async () => {
  for (const action of ['went-through', 'abandon'] as const) {
    const t = await team();
    const audits: AuditInput[] = [];
    journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: use magic links for everyone.`);
    await t.scan();
    const { ft } = services(t, t.o, audits, true);
    const r = await ft.act(t.floor.id, `esc:${t.e.id}`, 'send-correction', { by: 'Keith', expectedRev: 1 });
    assert.ok(r.ok && r.note, JSON.stringify(r));
    assert.equal(t.e.resolution?.answerRev, 1);
    const rec = t.o.roster.dispatch.store.list(t.floor.id).find((x) => x.answerRev === 2)!;
    assert.deepEqual(
      onDisk(t).map((p) => [p.kind, p.fromRev, p.toRev, p.dispatchId]),
      [['correction', 1, 2, rec.id]],
    );
    const typed = t.floor.prompts.length;
    const o2 = crashAndRestart(t.floor, t.o);
    const s2 = services(t, o2, audits);
    await o2.roster.reconcile();
    await s2.c.pending.sweep(t.floor.id);
    assert.equal(escOf(o2, t).resolution?.answerRev, 1, action);
    assert.deepEqual(await personAct(o2.roster, t.floor, rec.id, action, 'Keith'), {});
    const e = escOf(o2, t);
    if (action === 'went-through') assert.deepEqual([e.resolution?.answerRev, e.resolution?.dispatchId], [2, rec.id]);
    else assert.equal(e.resolution?.answerRev, 1);
    assert.equal(onDisk(t).length, 0, action);
    assert.equal(t.floor.prompts.length, typed, 'no duplicate typing');
  }
});

test('change-pending-not-saved: when the pending change can\'t be written, nothing is typed and the decision stays', async () => {
  const t = await team();
  const audits: AuditInput[] = [];
  const { c } = services(t, t.o, audits);
  const typed = t.floor.prompts.length;
  c.pending.put = () => Promise.reject(new Error('disk full'));
  const r = await c.change(t.floor.id, { floor: t.floor.id, decision: `esc:${t.e.id}`, expectedRev: 1, verdict: 'approve', text: '' }, { by: 'Keith' });
  assert.equal(r.ok ? 0 : r.status, 502);
  assert.match(r.ok ? '' : r.error, /couldn't be saved.*stays at rev 1/);
  assert.equal(t.floor.prompts.length, typed);
  assert.equal(t.e.resolution?.answerRev, 1);
});
