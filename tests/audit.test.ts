// The audit log (server/audit/): recording and reading back with filters and a cursor, the hash chain
// and its check, redaction, rotation past the cap, the CSV export, what the GitHub watcher makes of a
// board changing, and that the team's actions (hire, bench, an escalation's answer, the settings) land in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog, audit, changedFields, promptDetails, readAudit, redactValue, setPromptTextLogged, useAudit, verifyAudit } from '../src/server/audit/index.js';
import { csvField, csvHeader, csvRow, decodeCursor } from '../src/server/audit/query.js';
import { GitHubWatch } from '../src/server/audit/github.js';
import { auditQuery } from '../src/server/http/routes/audit.js';
import { actionMatches, auditGroupOf, type AuditEvent } from '../src/shared/audit.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { GhIssue, GhPull, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

const tmp = (p = 'audit-') => mkdtempSync(path.join(os.tmpdir(), p));
const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 1, 0);

function fresh(opts: ConstructorParameters<typeof AuditLog>[1] = {}) {
  const log = new AuditLog(path.join(tmp(), 'audit'), opts);
  const seen: AuditEvent[] = [];
  useAudit(log, (e) => seen.push(e));
  return { log, seen };
}

test('events are recorded per floor (and the office), read back newest first, filtered and paged by cursor', () => {
  const { log, seen } = fresh();
  for (let i = 0; i < 25; i++) audit.record({ floor: i % 2 ? 'alpha' : 'beta', actor: { kind: i % 5 ? 'human' : 'agent', name: i % 5 ? 'Keith' : 'Ada' }, action: i % 3 ? 'worker.hire' : 'escalation.raise', summary: `event ${i}`, at: T0 + i * H });
  audit.record({ actor: { kind: 'human', name: 'Keith' }, action: 'login.ok', summary: 'Signed in', at: T0 + 30 * H });
  assert.equal(seen.length, 26);
  assert.deepEqual(log.floors().sort(), ['_office', 'alpha', 'beta']);
  assert.ok(existsSync(path.join(log.dir, 'alpha.jsonl')) && existsSync(path.join(log.dir, '_office.jsonl')));

  const all = readAudit({ limit: 10 });
  assert.equal(all.total, 26);
  assert.equal(all.events[0].action, 'login.ok');
  assert.deepEqual(all.events.map((e) => e.at), [...all.events.map((e) => e.at)].sort((a, b) => b - a));
  // Paging: three pages, no repeats, nothing missed.
  const ids = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const p = readAudit({ limit: 10, cursor });
    for (const e of p.events) ids.add(e.id);
    cursor = p.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(ids.size, 26);
  assert.equal(decodeCursor('garbage'), undefined);

  const alpha = readAudit({ floor: 'alpha', limit: 100 });
  assert.ok(alpha.events.every((e) => e.floor === 'alpha'));
  assert.equal(alpha.total, 12);
  assert.equal(readAudit({ floor: '_office' }).total, 1);
  assert.equal(readAudit({ actorKind: 'agent' }).total, 5);
  assert.equal(readAudit({ actions: ['escalations'] }).total, 9);
  assert.equal(readAudit({ actions: ['worker.'] }).total, 16);
  assert.equal(readAudit({ since: T0 + 20 * H, until: T0 + 22 * H }).total, 3);
  assert.equal(readAudit({ q: 'EVENT 1' }).total, 11);
  assert.equal(all.counts.actions['worker.hire'], 16);
  assert.equal(all.counts.actors.agent, 5);
  assert.deepEqual(all.chain, { ok: true });
  assert.equal(auditGroupOf('pr.merge'), 'github');
  assert.ok(actionMatches('subagent.bench', ['team']) && actionMatches('firm.review', ['firm.*']) && !actionMatches('worker.hire', ['worker.prompt']));
});

test('the hash chain holds, and editing, dropping or reordering a line breaks it where it happened', () => {
  const { log } = fresh();
  for (let i = 0; i < 6; i++) audit.record({ floor: 'f', actor: { kind: 'human', name: 'Keith' }, action: 'worker.prompt', summary: `p${i}`, at: T0 + i * 1000 });
  const file = log.fileOf('f');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const events = lines.map((l) => JSON.parse(l) as AuditEvent);
  assert.equal(events[0].prev, '');
  assert.match(events[1].prev, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyAudit('f'), { ok: true });
  // Appending more keeps it whole (the check only looks at what's new).
  audit.record({ floor: 'f', actor: { kind: 'office', name: 'The office' }, action: 'queue.start', summary: 'more', at: T0 + 7000 });
  assert.deepEqual(verifyAudit('f'), { ok: true });

  // An edited summary, keeping everything else.
  const edited = [...readFileSync(file, 'utf8').trim().split('\n')];
  edited[2] = edited[2].replace('"p2"', '"nothing to see"');
  writeFileSync(file, `${edited.join('\n')}\n`);
  const r = verifyAudit('f');
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, T0 + 2000);
  assert.equal(readAudit({ floor: 'f' }).chain.ok, false);

  // A line taken out: the one after it no longer points at the one before.
  const dropped = lines.filter((_, i) => i !== 3);
  writeFileSync(file, `${dropped.join('\n')}\n`);
  assert.equal(verifyAudit('f').brokenAt, T0 + 4000);
  // Two swapped.
  const swapped = [lines[0], lines[2], lines[1], ...lines.slice(3)];
  writeFileSync(file, `${swapped.join('\n')}\n`);
  assert.equal(verifyAudit('f').ok, false);
  // The office-wide answer is the earliest break on any floor.
  assert.equal(verifyAudit('all').ok, false);
});

test('token-like strings and secret-named details are redacted; prompts keep only their length unless switched on', () => {
  const { log } = fresh();
  const e = audit.record({
    floor: 'f',
    actor: { kind: 'human', name: 'Keith' },
    action: 'settings.change',
    summary: 'Used ghp_abcdefghijklmnopqrstuvwxyz0123 to sign in',
    target: { kind: 'setting', label: 'token sk-ant-abcdefghijklmnop' },
    details: { password: 'hunter2hunter2', token: 'abc', note: 'Bearer abcdefghijklmnop', nested: { list: ['github_pat_ABCDEFGHIJKL_123'] }, on: true },
  })!;
  assert.ok(!JSON.stringify(e).includes('ghp_abc') && !JSON.stringify(e).includes('hunter2') && !JSON.stringify(e).includes('sk-ant'));
  assert.match(e.summary, /\[redacted\]/);
  assert.equal((e.details as any).password, '[redacted]');
  assert.equal((e.details as any).token, '[redacted]');
  assert.equal((e.details as any).nested.list[0], '[redacted]');
  assert.equal((e.details as any).on, true);
  assert.ok(!readFileSync(log.fileOf('f'), 'utf8').includes('hunter2'));
  assert.equal(redactValue('x'.repeat(3000)).toString().length, 2001);
  // Prompt text: off by default.
  assert.deepEqual(promptDetails('please fix the login bug'), { length: 24 });
  setPromptTextLogged(true);
  assert.deepEqual(promptDetails(`fix it ${'y'.repeat(100)}`), { length: 107, start: `fix it ${'y'.repeat(73)}` });
  assert.equal(readAudit().promptText, true);
  setPromptTextLogged(false);
});

test('past the cap the oldest go to the archive by month, never the last 90 days, and the chain carries on', () => {
  let now = T0;
  const { log } = fresh({ cap: 100, keepDays: 90, now: () => now });
  const DAY = 24 * H;
  // 150 events from 200 to 51 days ago: the oldest 110 are past 90 days, but only those past the newest 100 go.
  for (let i = 0; i < 150; i++) audit.record({ floor: 'f', actor: { kind: 'office', name: 'x' }, action: 'queue.start', summary: `e${i}`, at: T0 - (200 - i) * DAY });
  assert.ok(existsSync(log.archiveDir));
  const kept = readAudit({ floor: 'f', limit: 1000 });
  assert.ok(kept.total <= 110 && kept.total >= 100, `kept ${kept.total}`);
  const archived = readdirSync(log.archiveDir);
  assert.ok(archived.length >= 1 && archived.every((f) => /^f-\d{4}-\d{2}\.jsonl$/.test(f)));
  const archivedLines = archived.flatMap((f) => readFileSync(path.join(log.archiveDir, f), 'utf8').trim().split('\n'));
  assert.equal(archivedLines.length + kept.total, 150);
  assert.deepEqual(verifyAudit('f'), { ok: true });
  // Recent events stay, however many there are.
  const { log: log2 } = fresh({ cap: 50, keepDays: 90, now: () => now });
  for (let i = 0; i < 120; i++) audit.record({ floor: 'g', actor: { kind: 'office', name: 'x' }, action: 'queue.start', summary: `r${i}`, at: T0 - i * 1000 });
  now = T0 + 1;
  assert.equal(readAudit({ floor: 'g', limit: 1000 }).total, 120);
  assert.ok(!existsSync(log2.archiveDir));
});

test('the CSV export quotes what it has to and never starts a cell with a formula', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('+1'), "'+1");
  assert.equal(csvField(undefined), '');
  assert.equal(csvField({ a: 1 }), '"{""a"":1}"');
  const e: AuditEvent = { id: 'x1', at: T0, floor: 'f', actor: { kind: 'human', name: 'Keith, Jr' }, action: 'worker.hire', target: { kind: 'worker', label: 'Ada' }, summary: 'Hired Ada', severity: 'info', prev: '', hash: 'h' };
  const row = csvRow(e);
  assert.equal(row.split(',').length >= csvHeader().split(',').length, true);
  assert.match(row, /^2026-10-05T01:00:00.000Z,f,human,"Keith, Jr",worker.hire,worker: Ada,Hired Ada,info,,x1,,h$/);
});

test('the API query is read from the URL: kinds checked, lists split, times as ms or dates', () => {
  const q = auditQuery(new URL('http://x/api/audit?floor=alpha&actor=human,robot,jeff&action=github,worker.hire&since=2026-10-01&until=1790000000000&q=ada&limit=50&cursor=abc'));
  assert.equal(q.floor, 'alpha');
  assert.deepEqual(q.actorKind, ['human', 'jeff']);
  assert.deepEqual(q.actions, ['github', 'worker.hire']);
  assert.equal(q.since, Date.parse('2026-10-01'));
  assert.equal(q.until, 1790000000000);
  assert.equal(q.limit, 50);
  assert.equal(auditQuery(new URL('http://x/api/audit')).floor, 'all');
  assert.deepEqual(changedFields({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: true }), { before: { b: { c: 2 }, d: null }, after: { b: { c: 3 }, d: true } });
});

test("the GitHub watcher takes the first look as the baseline, then logs PRs opened, merged and closed and issues' changes", () => {
  const w = new GitHubWatch();
  const pr = (number: number, state: string, extra: Partial<GhPull> = {}) => ({ number, state, title: `PR ${number}`, headRefName: `b${number}`, baseRefName: 'main', author: 'ada', labels: [], updatedAt: new Date(T0).toISOString(), additions: 1, deletions: 2, ...extra }) as GhPull;
  const issue = (number: number, state: string, labels: string[] = []) => ({ number, state, title: `Issue ${number}`, author: 'bob', labels: labels.map((name) => ({ name, color: '' })) }) as unknown as GhIssue;
  assert.deepEqual(w.onPulls('f', [pr(1, 'OPEN'), pr(2, 'MERGED')], T0, () => undefined), []);
  const ev = w.onPulls('f', [pr(1, 'MERGED'), pr(2, 'MERGED'), pr(3, 'OPEN'), pr(4, 'CLOSED', { updatedAt: new Date(T0 - H).toISOString() })], T0 + 1, (b) => (b === 'b3' ? { kind: 'agent', name: 'Ada' } : undefined));
  assert.deepEqual(ev.map((e) => e.action), ['pr.merge', 'pr.open']);
  assert.equal(ev[1].actor.kind, 'agent');
  assert.deepEqual(w.onIssues('f', [issue(5, 'OPEN')], T0), []);
  const iv = w.onIssues('f', [issue(5, 'CLOSED', ['team:dev']), issue(6, 'OPEN')], T0 + 1);
  assert.deepEqual(iv.map((e) => e.action), ['issue.close', 'issue.label', 'issue.open']);
});

// ---- The team's actions land in the log -----------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = 'team-floor';
  name = 'audit-test';
  dir = tmp('audit-floor-');
  map = new Map<string, WorkerInfo>();
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo | string> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'idle', acked: true, createdBy: ask.by, createdAt: T0, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt = (id: string) => (this.map.has(id) ? undefined : 'Worker is not running');
  wake = () => undefined;
  rename = () => {};
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  set(id: string, status: WorkerStatus) {
    this.map.get(id)!.status = status;
  }
}

test('hiring, benching, a model change, the settings and an escalation and its answer are all audited', async () => {
  fresh();
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: tmp('audit-roster-'), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => T0 }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'lead-tester', 'Keith', 'acct1'), undefined);
  assert.equal(roster.members.setModel(floor, 'lead-tester', 'opus', 'Keith'), undefined);
  const w = floor.workers()[0];
  assert.equal(roster.members.bench(floor, 'lead-tester', 'Keith'), undefined);
  assert.equal(roster.members.settings(floor, { ...roster.data(floor.id).settings, autonomy: 3, idleMinutes: 15 }, 'Keith', 'acct1'), undefined);
  // Unchanged settings log nothing.
  roster.members.settings(floor, roster.data(floor.id).settings, 'Keith');
  const e = roster.escalations.raise(floor, w, { urgency: 'urgent', trigger: 'blocked', title: 'Need a decision on the DB', details: 'x', options: [] });
  assert.equal(roster.escalations.resolve(floor, e.id, 'reply', 'Use Postgres', 'Keith'), undefined);

  const page = readAudit({ floor: floor.id, limit: 100 });
  const actions = page.events.map((x) => x.action).reverse();
  assert.deepEqual(actions, ['worker.hire', 'worker.model', 'worker.bench', 'roster.settings', 'roster.autonomy', 'escalation.raise', 'escalation.answer']);
  const by = (a: string) => page.events.find((x) => x.action === a)!;
  assert.deepEqual(by('worker.hire').actor, { kind: 'human', name: 'Keith', id: 'acct1' });
  assert.deepEqual(by('roster.settings').details, { before: { autonomy: 2, idleMinutes: 0 }, after: { autonomy: 3, idleMinutes: 15 } });
  assert.equal(by('escalation.raise').actor.kind, 'agent');
  assert.equal((by('escalation.raise').details as any).urgency, 'urgent');
  assert.equal(by('escalation.answer').actor.name, 'Keith');
  // The answer's text isn't kept, only how long it was.
  assert.ok(!JSON.stringify(by('escalation.answer')).includes('Postgres'));
  assert.deepEqual(page.chain, { ok: true });
  useAudit(undefined);
  assert.equal(audit.record({ actor: { kind: 'office', name: 'x' }, action: 'x', summary: 'nothing' }), undefined);
});
