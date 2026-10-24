// Every Needs-you surface builds from the same input (shared/decisions/input.ts): the strip, the Overview
// card and the lead panel's count (the strip's snapshot), the team phone, the phone version and Teams.
// They count the same, and card building stays cheap: no per-card fetch, the existing feeds only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectDecisions, hereCount } from '../src/shared/needsyou.js';
import { needsInputOf } from '../src/shared/decisions/input.js';
import { cardCounts } from '../src/shared/decisions/words.js';
import { notifyRows, isRedNeed } from '../src/shared/notify-teams.js';
import type { RosterView } from '../src/shared/roster/types.js';

const root = path.join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const NOW = Date.parse('2026-10-14T12:00:00Z');

const fixture = (n = 1) => {
  const escalations = Array.from({ length: n }, (_, i) => ({ id: `e${i}`, at: NOW - i * 1000, workerId: 'w', by: 'Ada', urgency: 'important', fyi: i % 4 === 3, level: 2, title: i % 5 === 0 ? `merge PR #${100 + (i % 7)}` : `Question ${i}?`, details: '', options: [], status: 'open', refs: i % 5 === 0 ? { pr: 100 + (i % 7) } : {} }));
  const roster = { floor: 'f1', admin: true, escalations, approvals: [], members: [], settings: {} } as unknown as RosterView;
  return needsInputOf({
    floor: 'f1',
    workers: [],
    roster,
    pulls: [],
    floors: [],
    setup: undefined,
    live: undefined,
    firm: undefined,
    studio: undefined,
    incidents: [{ id: 'i1', title: 'Checkout down', severity: 'sev1', status: 'open', floors: ['f1'], detectedAt: NOW - 1000 } as never],
    budget: { floor: 'f1', alerts: [], paused: 'Budget reached' },
    stuck: { floor: 'f1', items: Array.from({ length: n }, (_, i) => ({ id: `pr-${100 + (i % 9)}-${i}`, kind: 'stale-pr', since: NOW - 40 * 3_600_000, blocks: [], evidence: [], pr: { number: 100 + (i % 9), title: 'x' }, raisedAt: NOW })) as never },
    asks: { floor: 'f1', items: [{ id: 'a1', kind: 'assumption', text: 'Assumed EUR', level: 'warn', acts: [{ act: 'agree', label: 'Agree' }] }] },
    questions: { floor: 'f1', waiting: n, brds: 1, blocking: 0, batch: 2, items: Array.from({ length: n }, (_, i) => ({ key: `F001.brd.json#OQ-${i + 1}`, id: `OQ-${i + 1}`, file: 'F001.brd.json', question: `Q${i}`, state: 'RAISED', where: 'main' })) as never },
    splits: [],
    now: NOW,
  });
};

test('decisions-surfaces-agree: one builder names every source, so every surface reads asks, budget and incidents, and the counts agree', () => {
  const input = fixture(3);
  for (const k of ['asks', 'budget', 'incidents', 'stuck', 'questions', 'splits', 'setup', 'live', 'firm', 'studio']) assert.ok(k in input, `${k} is named`);
  const { cards, needs } = collectDecisions(input);
  const c = cardCounts(cards);
  assert.equal(c.decisions + c.actions, hereCount(needs), 'the header and "N waiting on you" agree');
  assert.ok(needs.some((n) => n.kind === 'assumption'), 'asks');
  assert.ok(needs.some((n) => n.kind === 'budget'), 'budget');
  assert.ok(needs.some((n) => n.kind === 'incident'), 'incidents');
  // Teams and phone pushes post from the same rows (a batch of questions is one row).
  assert.equal(notifyRows(needs).filter((n) => n.kind === 'questions').length, 1);
  assert.ok(notifyRows(needs).filter(isRedNeed).length > 0);
  // Every surface goes through the builder.
  for (const f of ['src/client/ui/needsyou/index.ts', 'src/client/ui/phone/index.ts', 'src/client/mobile/app.ts']) assert.match(read(f), /pageNeedsInput\(/, f);
  assert.match(read('src/client/ui/needsyou/input.ts'), /needsInputOf\(\{/);
  const gather = read('src/server/notify-teams/gather.ts');
  assert.match(gather, /needsInputOf\(\{/);
  assert.match(gather, /asks: await asksNeedOf\(ctx, floor\)/);
  assert.match(gather, /splits: await decisionsOf\(ctx\)\.splits\.get\(floor\.id\)/);
  // The Overview card and the lead panel show the strip's published count (shared/needs-count.ts), never their own.
  assert.match(read('src/client/ui/portal/needs-card.ts'), /countOf\(s, /);
  assert.match(read('src/client/ui/lead-panel/panel.ts'), /countOf\(s, /);
  // Needs-you keys don't collide: an agent asking is ask-<worker>, a surfaced ask asks-<id>.
  assert.ok(needs.some((n) => n.key === 'asks-a1'));
});

test('decisions-perf: no per-card fetch; cards are built from the per-floor feeds, fast on a big floor', () => {
  for (const f of ['src/client/ui/portal/decision-card.ts', 'src/client/ui/portal/needs-card.ts', 'src/shared/decisions/group.ts', 'src/shared/decisions/candidates.ts']) assert.doesNotMatch(read(f), /\bfetch\(/, f);
  assert.equal((read('src/client/ui/decisions/feed.ts').match(/\bfetch\(/g) ?? []).length, 1, 'one fetch per floor, for the splits');
  const input = fixture(400);
  const t0 = performance.now();
  const { cards } = collectDecisions(input);
  const ms = performance.now() - t0;
  assert.ok(cards.length > 100);
  assert.ok(ms < 400, `built ${cards.length} cards in ${ms.toFixed(0)} ms`);
});
