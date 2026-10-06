// Microsoft Teams notifications (src/server/notify-teams/): which Needs you items go out, the Adaptive
// Cards, one card per item across restarts, the minute's batch, quiet hours and pauses with a catch-up,
// the daily digest, and retries, against a stub webhook server on this machine (never a real one).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { collectNeeds, type NeedsInput } from '../src/shared/needsyou.js';
import { inQuietHours, isRedNeed } from '../src/shared/notify-teams.js';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import type { StandupSchedule } from '../src/shared/roster/schedule.js';
import { catchUpCard, digestCard, needsCard, type RedItem, type TeamsMessage } from '../src/server/notify-teams/cards.js';
import { redItems } from '../src/server/notify-teams/gather.js';
import { BATCH_MS, COOLDOWN_MS, TeamsNotifier } from '../src/server/notify-teams/notifier.js';
import { postToTeams } from '../src/server/notify-teams/sender.js';
import { buildDigest, digestDue, DIGEST_FALLBACK_MS } from '../src/server/notify-teams/digest.js';
import { TeamsSettings } from '../src/server/notify-teams/settings.js';
import { useSecretSlot } from '../src/server/notify-teams/secret.js';
import type { Floor } from '../src/server/floor.js';

const worker = (id: string, o: Partial<WorkerInfo> = {}): WorkerInfo => ({ id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status: 'working', acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], ...o }) as WorkerInfo;
const esc = (id: string, o: Partial<Escalation> = {}): Escalation => ({ id, at: 0, workerId: 'w', by: 'Lead', urgency: 'important', fyi: false, level: 2, title: `esc ${id}`, details: '', options: [], status: 'open', ...o }) as Escalation;
const roster = (o: Partial<RosterView> = {}): RosterView => ({ floor: 'f1', approvals: [], escalations: [], admin: true, ...o }) as RosterView;
const pull = (number: number, o: Partial<GhPull> = {}): GhPull => ({ number, title: `pr ${number}`, state: 'OPEN', isDraft: false, checks: 'pass', author: 'octo', updatedAt: '2026-10-01T00:00:00Z', ...o }) as GhPull;
const jr = (rank: number) => ({ rank, score: 10 - rank, by: 'haiku', at: 0, blocking: 0.5, risk: 0.5, level: 'Soon: x', priority: 0.5, sig: 's' }) as Escalation['jeffRank'];
const floor = { id: 'f1', def: { name: 'Shop' } } as unknown as Floor;
const input = (o: Partial<NeedsInput> = {}): NeedsInput => ({ floor: 'f1', workers: [], pulls: [], floors: [], ...o });
const item = (id: string, o: Partial<RedItem> = {}): RedItem => ({ id: `f1:${id}`, floor: 'f1', project: 'Shop', who: 'Ada', summary: `about ${id}`, urgency: 'Blocking', level: 'block', ...o });

/** A stub Teams webhook: answers each POST with the next status in `statuses` (then 202), keeping the bodies. */
async function stub(statuses: number[] = []) {
  const bodies: TeamsMessage[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      bodies.push(JSON.parse(raw));
      const status = statuses.shift() ?? 202;
      res.writeHead(status, { 'content-type': 'text/plain' }).end(status >= 400 ? 'nope' : '');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRET123`;
  return { url, bodies, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const noWait = { sleep: async () => {}, baseMs: 1 };

/** A notifier on a fake clock, posting to `url`. */
function notifier(url: string, o: { file?: string; hold?: () => string | undefined; clock?: { t: number } } = {}) {
  const clock = o.clock ?? { t: 1_000_000 };
  const posts: string[] = [];
  const n = new TeamsNotifier({
    now: () => clock.t,
    file: o.file,
    holdReason: o.hold ?? (() => undefined),
    post: async (msg, what) => {
      const r = await postToTeams(url, msg, noWait);
      posts.push(`${what.kind}:${what.items}:${r.ok}`);
      return r.ok ? undefined : r.error;
    },
  });
  return { n, clock, posts };
}

test('the red items are the Needs you rules, minus what can wait for the Command Center', () => {
  const full = input({
    workers: [worker('Ada', { status: 'needs_input', activity: 'Wants permission: Bash', waitingSince: 5 }), worker('Bo', { status: 'done', waitingSince: 6 })],
    roster: roster({ escalations: [esc('e1', { urgency: 'urgent', by: 'Lead Dev', title: 'Which DB?', jeffRank: jr(1) }), esc('e2', { fyi: true })], settings: { jeff: { priority: 'on' } } as never, paused: 'Daily cap reached' }),
    pulls: [pull(7, { checks: 'fail', author: 'Cy' })],
    setup: { show: true, stages: [{ id: '2', title: 'Design', status: 'MANUAL' }], questions: [], checking: false, checkout: { branch: 'x', behind: 99, defaultBranch: 'main' } },
  });
  const needs = collectNeeds(full);
  assert.deepEqual(
    needs.filter(isRedNeed).map((n) => n.kind),
    ['asking', 'escalation', 'paused', 'pr', 'setup'],
  );
  // Finished turns (the office's quiet turns end that way) and a stale folder stay off Teams.
  assert.ok(needs.some((n) => n.kind === 'finished') && needs.some((n) => n.key === 'setup-stale'));
  const red = redItems(floor, { input: full, needs }, undefined);
  const ask = red[0];
  assert.equal(ask.id, 'f1:ask-Ada@5');
  assert.equal(ask.who, 'Ada');
  assert.equal(ask.summary, 'Wants permission: Bash');
  assert.equal(ask.link, undefined, 'no public address: no Open button');
  const linked = redItems(floor, { input: full, needs }, 'https://office.example.com');
  const e = linked.find((i) => i.id === 'f1:esc-e1')!;
  assert.equal(e.who, 'Lead Dev');
  assert.equal(e.summary, 'Which DB?');
  assert.equal(e.urgency, 'URGENT');
  assert.equal(e.rank, 1);
  assert.equal(e.link, 'https://office.example.com/lite?floor=f1');
  assert.equal(linked.find((i) => i.id === 'f1:pr-7')!.who, 'Cy');
});

test('a card is a Workflows message with one Adaptive Card 1.4: project, who, line, urgency, age, rank, Open', () => {
  const now = 10 * 60_000;
  const msg = needsCard([item('a', { since: now - 4 * 60_000, rank: 2, link: 'https://o.example/lite?floor=f1', summary: 'Use *bold* [link](x)' }), item('b', { project: 'Shop' })], now);
  assert.equal(msg.type, 'message');
  assert.equal(msg.attachments.length, 1);
  const a = msg.attachments[0];
  assert.equal(a.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(a.content.type, 'AdaptiveCard');
  assert.equal(a.content.version, '1.4');
  const [title, first, second] = a.content.body as { type: string; text?: string; items?: { type: string; text?: string; facts?: { title: string; value: string }[]; actions?: { type: string; url: string }[] }[] }[];
  assert.equal(title.text, '🔴 2 things need you in Shop');
  assert.equal(first.type, 'Container');
  assert.equal(first.items![0].text, '**Shop** · Ada');
  assert.equal(first.items![1].text, 'Use \\*bold\\* \\[link\\](x)', "a worker's words can't format the card");
  assert.deepEqual(first.items![2].facts, [
    { title: 'Urgency', value: 'Blocking' },
    { title: 'Waiting', value: '4 min' },
    { title: "Jeff's priority", value: '#2' },
  ]);
  assert.deepEqual(first.items![3].actions, [{ type: 'Action.OpenUrl', title: 'Open', url: 'https://o.example/lite?floor=f1' }]);
  assert.equal(second.items!.length, 3, 'no link, no button');
  assert.ok(Buffer.byteLength(JSON.stringify(needsCard(Array.from({ length: 40 }, (_, i) => item(`x${i}`, { summary: 'y'.repeat(300) })), now))) < 28 * 1024, 'a big batch stays under 28 KB');
});

test('items raised within a minute go out in one card; one handled before then never goes', async () => {
  const s = await stub();
  try {
    const { n, clock, posts } = notifier(s.url);
    n.observe('f1', [item('a')]);
    clock.t += 30_000;
    n.observe('f1', [item('a'), item('b'), item('c')]);
    await n.tick();
    assert.equal(s.bodies.length, 0, 'still inside the minute');
    clock.t += 20_000;
    n.observe('f1', [item('a'), item('b')]); // c was answered meanwhile
    clock.t += BATCH_MS - 50_000;
    await n.tick();
    assert.deepEqual(posts, ['needs:2:true']);
    const body = JSON.stringify(s.bodies[0]);
    assert.ok(body.includes('about a') && body.includes('about b') && !body.includes('about c'));
    // Seen again on the next polls: not posted again.
    clock.t += BATCH_MS * 3;
    n.observe('f1', [item('a'), item('b')]);
    await n.tick();
    assert.equal(s.bodies.length, 1);
  } finally {
    await s.close();
  }
});

test('one card per item across restarts; a new question from the same agent is new', async () => {
  const s = await stub();
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-teams-'));
  try {
    const file = path.join(dir, 'notify-teams-state.json');
    const clock = { t: 5_000_000 };
    const one = notifier(s.url, { file, clock });
    one.n.observe('f1', [item('ask-w1@100')]);
    clock.t += BATCH_MS;
    await one.n.tick();
    assert.equal(s.bodies.length, 1);
    // The office restarts hours later: the item is still there.
    clock.t += 3 * 3_600_000;
    const two = notifier(s.url, { file, clock });
    two.n.observe('f1', [item('ask-w1@100')]);
    clock.t += BATCH_MS * 2;
    await two.n.tick();
    assert.equal(s.bodies.length, 1, 'not posted again after a restart');
    two.n.observe('f1', [item('ask-w1@100'), item('ask-w1@900')]);
    clock.t += BATCH_MS;
    await two.n.tick();
    assert.equal(s.bodies.length, 2);
    assert.ok(JSON.stringify(s.bodies[1]).includes('about ask-w1@900'));
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours and pauses hold cards back (across a restart too), then one catch-up says what still needs you', async () => {
  const s = await stub();
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-teams-'));
  try {
    const file = path.join(dir, 'state.json');
    let hold: string | undefined = 'quiet hours';
    const clock = { t: 9_000_000 };
    const one = notifier(s.url, { file, clock, hold: () => hold });
    one.n.observe('f1', [item('a'), item('b')]);
    clock.t += BATCH_MS * 5;
    await one.n.tick();
    assert.equal(s.bodies.length, 0);
    assert.equal(one.n.heldCount, 2);
    const two = notifier(s.url, { file, clock, hold: () => hold });
    two.n.observe('f1', [item('a'), item('c')]); // b handled overnight, c new
    await two.n.tick();
    assert.equal(two.n.heldCount, 2);
    hold = undefined;
    await two.n.tick();
    assert.deepEqual(two.posts, ['catch-up:3:true']);
    const text = JSON.stringify(s.bodies[0]);
    assert.ok(text.includes('While notifications were held (quiet hours): 3 items came up'));
    assert.ok(text.includes('2 still need you; 1 was handled or sorted itself out'));
    assert.ok(text.includes('about a') && text.includes('about c') && !text.includes('about b'));
    clock.t += BATCH_MS * 2;
    two.n.observe('f1', [item('a'), item('c')]);
    await two.n.tick();
    assert.equal(s.bodies.length, 1, 'held items are not posted again after the catch-up');
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours span midnight or sit inside a day', () => {
  const at = (h: number, m = 0) => h * 60 + m;
  assert.equal(inQuietHours({ start: '22:00', end: '07:00' }, at(23)), true);
  assert.equal(inQuietHours({ start: '22:00', end: '07:00' }, at(6, 59)), true);
  assert.equal(inQuietHours({ start: '22:00', end: '07:00' }, at(7)), false);
  assert.equal(inQuietHours({ start: '12:00', end: '13:00' }, at(12, 30)), true);
  assert.equal(inQuietHours({ start: '12:00', end: '13:00' }, at(13, 30)), false);
  assert.equal(inQuietHours(undefined, at(3)), false);
});

test('the daily digest: due after the standup compiles, else half an hour after the slot, once per slot', () => {
  const schedule: StandupSchedule = { enabled: true, time: '09:00', timeZone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] };
  const slot = Date.parse('2026-10-06T09:00:00Z');
  assert.equal(digestDue(slot + 5 * 60_000, schedule, undefined, undefined), undefined);
  assert.equal(digestDue(slot + 5 * 60_000, schedule, slot + 4 * 60_000, undefined), slot, 'the standup compiled: now');
  assert.equal(digestDue(slot + DIGEST_FALLBACK_MS, schedule, undefined, undefined), slot, 'no standup: half an hour on');
  assert.equal(digestDue(slot + DIGEST_FALLBACK_MS, schedule, undefined, slot), undefined, 'already sent for this slot');
  assert.equal(digestDue(slot + 13 * 3_600_000, schedule, undefined, undefined), undefined, 'too late in the day');

  const now = slot + 60_000;
  const needs = collectNeeds(
    input({
      workers: [worker('Ada', { status: 'needs_input', waitingSince: 1 })],
      roster: roster({
        settings: { jeff: { priority: 'on' } } as never,
        escalations: [esc('low', { title: 'Low one', urgency: 'info' }), esc('j2', { title: 'Second', jeffRank: jr(2) }), esc('j1', { title: 'First', jeffRank: jr(1) }), esc('j3', { title: 'Third', jeffRank: jr(3) })],
      }),
    }),
  );
  const d = buildDigest({
    floor: 'f1',
    project: 'Shop',
    now,
    pulls: [pull(1, { state: 'MERGED', title: 'Login', updatedAt: new Date(now - 3_600_000).toISOString() }), pull(2, { state: 'MERGED', updatedAt: new Date(now - 3 * 86_400_000).toISOString() }), pull(3)],
    needs,
    spent: 3.5,
    cap: 10,
    setup: { show: true, stages: [{ id: '1', title: 'Intake', status: 'PASS' }, { id: '2', title: 'Design', status: 'MANUAL' }, { id: '3', title: 'Build', status: 'PENDING' }], next: 'Sign off Stage 2', questions: [], checking: false },
  });
  assert.deepEqual(d.merges, [{ number: 1, title: 'Login' }]);
  assert.equal(d.openNeeds, needs.length);
  assert.deepEqual(d.stages, { passed: 1, total: 3, waiting: ['Stage 2'], next: 'Sign off Stage 2' });
  assert.deepEqual(
    d.topEscalations.map((e) => e.rank),
    [1, 2, 3],
    "Jeff's top three",
  );
  const card = JSON.stringify(digestCard(d));
  assert.ok(card.includes('Daily digest: Shop') && card.includes('$3.50 of $10.00 cap') && card.includes('1 of 3 passed') && card.includes('#1 '));
});

test('retries: a 503 or 429 is tried again with backoff, a 400 is not, and errors never carry the URL', async () => {
  const s = await stub([503, 429, 202]);
  const waits: number[] = [];
  try {
    const ok = await postToTeams(s.url, needsCard([item('a')], 0), { sleep: async (ms) => void waits.push(ms), baseMs: 100, random: () => 0.5 });
    assert.deepEqual({ ok: ok.ok, attempts: ok.attempts }, { ok: true, attempts: 3 });
    assert.deepEqual(waits, [100, 200]);
  } finally {
    await s.close();
  }
  const bad = await stub([400]);
  try {
    const r = await postToTeams(bad.url, needsCard([item('a')], 0), noWait);
    assert.equal(r.attempts, 1);
    assert.match(r.error!, /Teams answered 400/);
  } finally {
    await bad.close();
  }
  // Nothing listening: tried four times, and the error says why without the URL.
  const gone = await stub();
  await gone.close();
  const r = await postToTeams(gone.url, needsCard([item('a')], 0), noWait);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 4);
  assert.ok(!r.error!.includes('SECRET123') && !r.error!.includes('127.0.0.1'), r.error);
});

test('a batch that failed for good waits out a cooldown, then goes', async () => {
  const s = await stub([500, 500, 500, 500]);
  try {
    const { n, clock, posts } = notifier(s.url);
    n.observe('f1', [item('a')]);
    clock.t += BATCH_MS;
    await n.tick();
    assert.deepEqual(posts, ['needs:1:false']);
    clock.t += COOLDOWN_MS - 1;
    await n.tick();
    assert.equal(posts.length, 1, 'cooling down');
    clock.t += 1;
    n.observe('f1', [item('a')]);
    await n.tick();
    assert.deepEqual(posts, ['needs:1:false', 'needs:1:true']);
  } finally {
    await s.close();
  }
});

test('a catch-up card with nothing left open says so', () => {
  const text = JSON.stringify(catchUpCard([], 2, 'paused', 0));
  assert.ok(text.includes('2 items came up') && text.includes('All of them were handled meanwhile.'));
});

test('settings: the URL is checked, kept out of what a browser sees, saved 0600, and can live in a credential store', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-teams-'));
  try {
    const s = TeamsSettings.in(dir, () => 1000);
    assert.match(s.patch({ url: 'http://example.com/hook' }, 'Ann')!, /https/);
    assert.match(s.patch({ quiet: { start: '22:00', end: '22:00' } }, 'Ann')!, /two different times/);
    assert.equal(s.patch({ url: 'https://prod-1.westeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=TOPSECRET', floors: ['f2'], level: 'digest', quiet: { start: '22:00', end: '07:00' }, pauseMinutes: 60, publicUrl: 'https://o.example.com/' }, 'Ann'), undefined);
    assert.ok(!JSON.stringify(s.get()).includes('TOPSECRET'));
    assert.equal(s.hint(), 'prod-1.westeurope.logic.azure.com/…voke');
    assert.equal(s.posts('f1'), false);
    assert.equal(s.paused(1000 + 59 * 60_000), true);
    assert.equal(s.get().publicUrl, 'https://o.example.com');
    const file = path.join(dir, 'notify-teams.json');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(readFileSync(file, 'utf8').includes('TOPSECRET'), 'kept in the settings file until Connections takes it');
    assert.equal(TeamsSettings.in(dir).url()?.includes('TOPSECRET'), true, 'read back after a restart');
    // Connections' seam: a credential store takes over the secret.
    let kept: string | undefined;
    useSecretSlot({ where: 'credential-store', get: () => kept, set: (v) => (kept = v) });
    try {
      const c = TeamsSettings.in(dir);
      assert.equal(c.where(), 'credential-store');
      c.patch({ url: 'https://example.org/hook?sig=VAULT' }, 'Ann');
      assert.equal(kept, 'https://example.org/hook?sig=VAULT');
    } finally {
      useSecretSlot(undefined);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
