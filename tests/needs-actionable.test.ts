// One count of what waits on you for every server-fed surface (shared/needs-actionable.ts): the desktop tray,
// Home and Teams (redItems), the Teams digest's red count and phone pushes (pushItemsOf) agree on the same
// items, and an answer whose delivery the office couldn't confirm (durable dispatch, outcome unknown) is one
// of them: it needs intervention, where before it was only a card on the Command Center.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableCount, actionableRows, deliveryNeedsOf, isActionable } from '../src/shared/needs-actionable.js';
import type { NeedItem } from '../src/shared/needsyou.js';
import { redItems } from '../src/server/notify-teams/gather.js';
import { buildDigest } from '../src/server/notify-teams/digest.js';
import { pushItemsOf } from '../src/server/webpush/notifier.js';

const need = (o: Partial<NeedItem> & Pick<NeedItem, 'key' | 'kind'>): NeedItem => ({ icon: '•', text: o.key, level: 'warn', action: 'Open', target: { to: 'floor', floor: 'f1' }, ...o });

const delivery = deliveryNeedsOf('f1', [
  { id: 'dsp_1', state: 'outcome-unknown', channel: 'type', workerName: 'Ada', typedAt: 1000 },
  { id: 'dsp_2', state: 'submitted', channel: 'type', workerName: 'Ada' },
] as never);

const NEEDS: NeedItem[] = [
  need({ key: 'esc-1', kind: 'escalation', level: 'block', target: { to: 'escalation', id: 'e1' } }),
  need({ key: 'setup-signed', kind: 'setup', level: 'info' }),
  need({ key: 'setup-manual', kind: 'setup', level: 'block' }),
  need({ key: 'q-a', kind: 'questions', notify: { key: 'questions-b1', text: '2 questions for the client' } }),
  need({ key: 'q-b', kind: 'questions', notify: { key: 'questions-b1', text: '2 questions for the client' } }),
  need({ key: 'idle-dev', kind: 'idle' }),
  need({ key: 'live-refresh', kind: 'live', level: 'info' }),
  need({ key: 'floor-f2', kind: 'floor', level: 'block' }),
  ...delivery,
];

test('an answer whose delivery is unconfirmed is a needs-intervention item; a delivered one is not', () => {
  assert.deepEqual(delivery.map((d) => [d.key, d.kind, d.level, d.tag]), [['delivery-dsp_1', 'delivery', 'block', 'Needs intervention']]);
  assert.match(delivery[0].text, /Typed into Ada's terminal but not received/);
  assert.equal(isActionable(delivery[0]), true);
});

test('the rule: red, a batch once, never a recorded-later sign-off or another project’s row', () => {
  assert.deepEqual(actionableRows(NEEDS).map((n) => n.key), ['esc-1', 'setup-manual', 'questions-b1', 'delivery-dsp_1']);
  assert.equal(actionableCount(NEEDS), 4);
});

test('tray, Home and Teams (redItems), the digest and phone pushes count the same items', () => {
  const floor = { id: 'f1', def: { name: 'Demo' } } as never;
  const input = { floor: 'f1', workers: [], pulls: [], floors: [], roster: { escalations: [] } } as never;
  const red = redItems(floor, { input, needs: NEEDS }, undefined);
  const push = pushItemsOf({ id: 'f1', name: 'Demo' }, NEEDS, () => false);
  const digest = buildDigest({ floor: 'f1', project: 'Demo', now: Date.now(), pulls: [], needs: NEEDS });
  assert.equal(red.length, actionableCount(NEEDS));
  assert.equal(push.length, actionableCount(NEEDS), 'a sign-off waiting to be recorded no longer buzzes the phone either');
  assert.equal(digest.redCount, actionableCount(NEEDS));
  assert.deepEqual(red.map((r) => r.id), push.map((p) => p.id), 'the same ids, so the same items');
  assert.equal(red.find((r) => r.id === 'f1:delivery-dsp_1')?.who, 'Your answer');
});
