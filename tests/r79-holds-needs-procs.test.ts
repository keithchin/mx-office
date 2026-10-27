// Release 79, the rebuild run's queue and housekeeping findings:
//   - a stale data-impact hold has an honest exit: the office tells it is stale (the change is over, a newer
//     candidate replaced it, it changes no model of its own, or the live preview already has it) and offers
//     "Release stale hold" with a reason; a dump can be taken for a candidate's hold too; a hold that still guards
//     something can't be released that way; a held queue is raised in Needs you
//   - Needs you puts new items first and folds old ones behind "Show N older"
//   - orphaned agent processes are found by the office's recorded terminal pids and start times, never by name
// No database, no mxcli, no real processes stopped (fake listing and kill), no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataImpact } from '../src/server/data-impact/index.js';
import { ownModelChange } from '../src/server/data-impact/stale.js';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { recoveryWords, type ImpactAssessment } from '../src/shared/data-impact.js';
import { staleReason } from '../src/shared/data-impact-stale.js';
import { stuckActions, stuckNext, stuckTitle, type StuckDraft } from '../src/shared/stuck.js';
import { foldAt, freshFirst, OLD_MS } from '../src/shared/needs-order.js';
import type { DecisionCard } from '../src/shared/decisions/types.js';
import type { NeedItem } from '../src/shared/needsyou.js';
import { findOrphans, parsePsRows, parseWinRows, type ProcRow, type RootEntry } from '../src/server/agent-procs/sweep.js';
import { orphanWords, sweepOnce } from '../src/server/agent-procs/index.js';

const A = 'a1aafaa'.padEnd(40, '0');
const B = 'b2bbbbb'.padEnd(40, '0');
const C = 'c3ccccc'.padEnd(40, '0');

test('stale holds: why, in words', () => {
  assert.equal(staleReason({ env: 'candidate:DC-8', target: A }), 'DC-8 no longer exists');
  assert.match(staleReason({ env: 'candidate:DC-8', target: A, change: { id: 'DC-8', over: 'cancelled' } }) ?? '', /DC-8 is cancelled: nothing will apply this candidate/);
  assert.match(staleReason({ env: 'candidate:DC-8', target: A, change: { id: 'DC-8', newest: B } }) ?? '', /a newer candidate of DC-8 \(@b2bbbbb\) replaced @a1aafaa/);
  assert.match(staleReason({ env: 'candidate:DC-11', target: A, change: { id: 'DC-11', newest: A }, ownModel: false }) ?? '', /changes no model of its own/);
  assert.match(staleReason({ env: 'candidate:DC-8', target: A, change: { id: 'DC-8', newest: A }, ownModel: true, served: C, servedHas: true }) ?? '', /the live preview already runs @c3ccccc, which has @a1aafaa: its data was migrated then/);
  assert.equal(staleReason({ env: 'candidate:DC-8', target: A, change: { id: 'DC-8', newest: A }, ownModel: true, served: C, servedHas: false }), undefined, 'still guards a change the live preview hasn’t got');
  assert.equal(staleReason({ env: 'live-preview', target: A, served: C, servedHas: false }), undefined);
});

function fakeCtx(dataDir: string) {
  const accounts = [{ id: 'u-admin', name: 'Ada', role: 'admin' }, { id: 'u-member', name: 'Mo', role: 'member' }];
  return { cfg: { dataDir }, accounts: { state: () => ({ accounts, invites: [], sharedPassword: false }) }, meOf: (id: string | undefined) => ({ admin: accounts.find((a) => a.id === id)?.role === 'admin' }) } as unknown as ConstructorParameters<typeof DataImpact>[0];
}

test('a candidate hold: a dump can be taken for it, and a stale one is released with a reason (never a false "no data to keep")', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r79-holds-'));
  useAudit(new AuditLog(path.join(dir, 'audit')));
  t.after(() => {
    useAudit(undefined);
    rmSync(dir, { recursive: true, force: true });
  });
  const di = new DataImpact(fakeCtx(dir), {
    pg: () => ({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'demo_live' }),
    takeDump: async (_pg, file) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'PGDMP fake');
      return { size: 10, sha256: (await import('node:crypto')).createHash('sha256').update('PGDMP fake').digest('hex'), verified: 'pg_restore --list read 3 entries' };
    },
  });
  const assessment: ImpactAssessment = { base: B, target: A, status: 'impact', findings: [], warnings: [], uncertainty: '', at: 1 };
  di.guard.store.update('demo', (r) => void (r.holds['candidate:DC-8'] = { env: 'candidate:DC-8', base: B, target: A, status: 'impact', reason: 'Update held: possible data impact at a1aafaa', at: 1, assessment }));

  // The dump route used to answer "Nothing is held on the live preview" for a candidate's hold.
  assert.equal(await di.dump('demo', { name: 'Ada' }), 'Nothing is held on the live preview');
  const d = await di.dump('demo', { name: 'Ada' }, 'candidate:DC-8');
  assert.ok(typeof d !== 'string', String(d));
  assert.equal(d.env, 'candidate:DC-8', 'bound to the candidate’s hold');
  assert.equal(di.view('demo', 'u-admin', 'candidate:DC-8').dumps.length, 1, 'shown with that hold');

  const body = { env: 'candidate:DC-8', base: B, target: A, reason: 'DC-8 runs on the live preview since yesterday' };
  assert.deepEqual(di.releaseStale('demo', { name: 'Mo', id: 'u-member' }, 'u-member', body, 'x'), [403, "You don't have the data-impact approval permission. Who has it: office admins (Ada)"]);
  const notStale = di.releaseStale('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', body, undefined);
  assert.ok(Array.isArray(notStale) && notStale[0] === 409 && /still guards a change/.test(notStale[1]), 'not stale: approve it with a recovery step');
  assert.deepEqual(di.releaseStale('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { ...body, target: C }, 'stale'), [409, 'The hold changed: it is now b2bbbbb → a1aafaa. Look again']);
  assert.deepEqual(di.releaseStale('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { ...body, reason: ' ' }, 'stale'), [400, 'Say why (a reason is required)']);
  const why = 'the live preview already runs @c3ccccc, which has @a1aafaa: its data was migrated then';
  const a = di.releaseStale('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { ...body, reason: 'DC-8 runs on the live preview â€” since yesterday' }, why);
  assert.ok(!Array.isArray(a));
  assert.deepEqual(a.recovery, { kind: 'stale', statement: why });
  assert.equal(a.reason, 'DC-8 runs on the live preview — since yesterday', 'mojibake in the reason is repaired');
  assert.match(recoveryWords(a.recovery), /^none needed, a stale hold released \(the live preview already runs/);
  const audits = readAudit({ floor: 'demo', limit: 100 }).events;
  assert.ok(audits.some((e) => e.action === 'data-impact.approve' && /stale hold released/.test(e.summary)), 'audited with the stale reason');
});

test('ownModelChange: a notes branch that merged main in changes no model of its own', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r79-own-'));
  try {
    const g = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'user.name=T', '-c', 'user.email=t@x', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'App.mpr'), 'v1');
    g('add', '.');
    g('commit', '-q', '-m', 'v1');
    g('checkout', '-q', '-b', 'dev/DC-11');
    writeFileSync(path.join(dir, 'notes.md'), 'notes');
    g('add', '.');
    g('commit', '-q', '-m', 'notes');
    g('checkout', '-q', 'main');
    writeFileSync(path.join(dir, 'App.mpr'), 'v2');
    g('commit', '-qam', 'v2 on main');
    const main = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'dev/DC-11');
    g('merge', '-q', '--no-edit', 'main');
    const notes = g('rev-parse', 'HEAD');
    assert.equal(await ownModelChange(dir, notes, main), false, 'its model difference came in from main');
    writeFileSync(path.join(dir, 'App.mpr'), 'v3');
    g('commit', '-qam', 'model on the branch');
    assert.equal(await ownModelChange(dir, g('rev-parse', 'HEAD'), main), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a held queue in Needs you: which changes wait, the stale reason, Open the hold', () => {
  const d: StuckDraft = { id: 'held-DC-8', kind: 'held', since: Date.now() - 3_600_000, blocks: ['DC-9'], evidence: [], hold: { env: 'candidate:DC-8', change: 'DC-8', target: A, waiting: ['DC-9'], stale: 'DC-8 is cancelled' } };
  assert.match(stuckTitle(d, Date.now()), /^DC-9 waits in the change queue behind a stale data-impact hold on DC-8 \(DC-8 is cancelled\): release it with a reason/);
  assert.deepEqual(stuckActions(d), ['open-hold', 'snooze', 'dismiss']);
  assert.match(stuckNext(d), /Release stale hold/);
  const fresh = { ...d, hold: { ...d.hold!, stale: undefined } };
  assert.match(stuckTitle(fresh, Date.now()), /DC-9 waits in the change queue: DC-8 is merged but held for possible data impact for 1 hour/);
});

test('Needs you: new items first, old ones (or with their source gone) behind "Show N older"', () => {
  const now = Date.UTC(2026, 9, 27, 12);
  const card = (key: string, since: number | undefined, o: Partial<NeedItem> = {}, gone = false) => ({ id: key, need: { key, kind: 'escalation', icon: '', text: key, level: 'warn', action: 'Answer', target: { to: 'approvals' }, ...(since !== undefined ? { since } : {}), ...o }, ...(gone ? { gone: { at: 1, what: 'on main now' } } : {}) }) as unknown as DecisionCard;
  const old = Array.from({ length: 6 }, (_, i) => card(`merge-ask-${i}`, now - OLD_MS - 3_600_000 * (i + 1)));
  const cards = [...old, card('gone-ask', now - 60_000, {}, true), card('info', now, { level: 'info' }), card('marketplace', now - 60_000), card('other-floor', undefined, { kind: 'floor' })];
  const r = freshFirst({ cards, needs: cards.map((c) => c.need) }, now);
  assert.deepEqual(r.needs.map((n) => n.key), ['marketplace', ...old.map((c) => c.need.key), 'gone-ask', 'other-floor', 'info']);
  assert.equal(r.needs[0].older, undefined);
  assert.equal(r.needs[1].older, true);
  assert.equal(r.needs.find((n) => n.key === 'other-floor')?.older, undefined, 'another project’s row is never folded as older');
  assert.deepEqual(r.cards.map((c) => c.need), r.needs, 'cards and rows stay in step');
  assert.deepEqual(foldAt(r.needs, 6), { show: 1, label: 'Show 9 older ▾' });
  assert.deepEqual(foldAt(cards.map(() => ({})), 6), { show: 6, label: 'Show 4 more ▾' });
  assert.deepEqual(foldAt([{}, {}, {}], 6), { show: 3, label: 'Show 0 more ▾' });
});

test('orphaned agent processes: children of a gone recorded terminal, by pid and start time, never a live one or a reused pid', () => {
  const t0 = Date.UTC(2026, 9, 26, 9);
  const root: RootEntry = { floor: 'demo', workerId: 'w-maya', name: 'Maya', pid: 100, seenAt: t0 + 5_000, created: t0, officePid: 1 };
  const live: RootEntry = { floor: 'demo', workerId: 'w-carl', name: 'Carl', pid: 200, seenAt: t0, created: t0, officePid: 1 };
  const reused: RootEntry = { floor: 'demo', workerId: 'w-old', name: 'Old', pid: 300, seenAt: t0, created: t0, officePid: 1 };
  const procs: ProcRow[] = [
    { pid: 101, ppid: 100, created: t0 + 60_000, cmd: 'bash -c until curl -s localhost:8180; do sleep 5; done' },
    { pid: 102, ppid: 101, created: t0 + 61_000, cmd: 'sleep 5' },
    { pid: 103, ppid: 100, created: t0 - 3_600_000, cmd: 'older than the terminal: not its child' },
    { pid: 200, ppid: 1, created: t0, cmd: 'claude' },
    { pid: 201, ppid: 200, created: t0 + 1_000, cmd: 'bash -c npm run watch' },
    { pid: 300, ppid: 1, created: t0 + 86_400_000, cmd: 'an unrelated program that took pid 300' },
    { pid: 301, ppid: 300, created: t0 + 86_500_000, cmd: 'its child' },
    { pid: 302, ppid: 300, created: t0 + 1_000, cmd: 'an orphan of the old terminal 300' },
  ];
  const found = findOrphans([root, live, reused], procs, new Set([200]), new Set([1]));
  assert.deepEqual(found.map((f) => [f.entry.name, f.tops.map((p) => p.pid), f.count]), [['Maya', [101], 2], ['Old', [302], 1]]);
  assert.match(orphanWords(found[0]), /^Stopped 2 processes an earlier session of Maya left running \(its terminal, pid 100, is gone\): pid 101 bash -c until curl/);
  // A recorded terminal still alive (taken over again after a restart) is never touched.
  assert.deepEqual(findOrphans([{ ...root, pid: 200, created: t0 }], procs, new Set(), new Set([1])), []);
  // Listings parse, on both systems.
  assert.deepEqual(parseWinRows([{ ProcessId: 7, ParentProcessId: 3, CreationDate: '/Date(1761469200000)/', CommandLine: 'bash' }]), [{ pid: 7, ppid: 3, created: 1761469200000, cmd: 'bash' }]);
  assert.deepEqual(parsePsRows('  7     3   10 bash -c x\n', 100_000), [{ pid: 7, ppid: 3, created: 90_000, cmd: 'bash -c x' }]);
});

test('the sweep records terminals, stops what a gone one left, reports it, and forgets a root with nothing left', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r79-procs-'));
  try {
    const now = Date.UTC(2026, 9, 27, 9);
    let roots = [{ floor: 'demo', workerId: 'w-maya', name: 'Maya', pid: 100 }];
    let procs: ProcRow[] = [{ pid: 100, ppid: 1, created: now - 1000, cmd: 'claude' }];
    const killed: number[] = [];
    const reports: string[] = [];
    const deps = { dataDir: dir, roots: () => roots, list: async () => procs, kill: (p: number) => void killed.push(p), now: () => now, self: new Set([1]), report: (f: string, x: Parameters<typeof orphanWords>[0]) => void reports.push(`${f}: ${orphanWords(x)}`) };
    assert.deepEqual(await sweepOnce(deps), []);
    const saved = JSON.parse(readFileSync(path.join(dir, 'agent-procs.json'), 'utf8')) as { roots: RootEntry[] };
    assert.equal(saved.roots[0].created, now - 1000, 'pinned by its start time');
    // The office restarts: Maya's terminal is gone, her background loop is not.
    roots = [];
    procs = [{ pid: 101, ppid: 100, created: now + 5_000, cmd: 'bash -c until curl localhost:8180; do sleep 5; done' }];
    const found = await sweepOnce(deps);
    assert.deepEqual(killed, [101]);
    assert.equal(found.length, 1);
    assert.match(reports[0], /^demo: Stopped 1 process an earlier session of Maya left running/);
    // Next look: nothing left under it, so it's forgotten.
    procs = [];
    assert.deepEqual(await sweepOnce(deps), []);
    assert.deepEqual((JSON.parse(readFileSync(path.join(dir, 'agent-procs.json'), 'utf8')) as { roots: RootEntry[] }).roots, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
