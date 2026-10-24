// The Developer view's docked coordinator chat without a browser (the browser half is docked-chat-dom.test.ts):
//   - one record for every entry point: the intake keeps which entry point asked and what a correction corrects;
//     a guided check's "Something's wrong" queues as a DC when no lead is at work (never refused), linked to the
//     mark; a "Please try this" card's Looks right is a mark for exactly the version served (refused for another,
//     never "accepted"), its Something's wrong a DC correction linked to the change; reviews read back per change
//   - the Model tab's Change this: admins only, checked on the server
//   - the chat's words: this session's changes, the header's summary, receipts from the record (a pause with who and
//     when), when a try card shows and where, the chip and the context line, the note the lead gets
//   - the cards merge into the conversation by time; the composer and the panel plug in by the dock seam, not lite.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges, type ChangeDeps } from '../src/server/dev-changes/service.js';
import { ValidationBook, type ValidationDeps } from '../src/server/guided-validation/store.js';
import { modelChangeRoutes } from '../src/server/http/routes/model-change.js';
import { CHANGE_TONE, CHANGE_WORDS, changeFour, reviewedChange, reviewScenario, type DevChangeView, type QueueWhy } from '../src/shared/dev-changes.js';
import { requestTitle } from '../src/shared/change-requests.js';
import { aboutLine, askedWords, chipFor, pauseWords, queuedNote, receiptWords, reviewAt, sessionChanges, sessionSummary, tryAt, wantsTry } from '../src/client/ui/app-workspace/dock/logic.js';
import { firstPage } from '../src/client/ui/app-workspace/explorer/first-page.js';
import { mergeByTime, type ChatItem } from '../src/client/ui/pm/chat/logic.js';
import type { AuditInput } from '../src/shared/audit.js';
import { removeDir } from './support/cleanup.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const MAIN = 'a'.repeat(40);
const S = 'e0'.padEnd(40, 'e');
const OTHER = 'b'.repeat(40);

/** The real queue and the real guided-validation book, wired as the office wires them, with the team's conditions faked. */
function office(blocked: Exclude<QueueWhy, 'behind' | 'refused'> | undefined = 'no-lead') {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-dk-'));
  const audits: AuditInput[] = [];
  const store = new ChangeStore(path.join(dir, 'dev-changes'));
  const deps: ChangeDeps = {
    store,
    now: () => Date.UTC(2026, 9, 24, 10),
    blocked: () => blocked,
    mainHead: async () => MAIN,
    recheck: async () => undefined,
    hand: async () => ({ requestId: 'CR-1', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0', member: 'Ada', role: 'pm', delivery: 'held' }),
    facts: async (_f, c) => ({ queue: c.queue }),
    record: (e) => audits.push(e),
  };
  const changes = new DevChanges(deps);
  const vdeps: ValidationDeps = {
    dataDir: dir,
    now: () => Date.UTC(2026, 9, 24, 11),
    served: () => S,
    scenarios: async () => [{ id: 'J-01', title: 'Reception signs a visitor in' }],
    // As server/guided-validation/index.ts wires it: through the one intake.
    async correct(f, a) {
      const r = await changes.intake(f, { text: a.text, page: a.page, revision: a.revision, source: a.revision, ref: a.ref, of: a.of, via: a.via, by: a.by, ...(a.owner ? { owner: a.owner } : {}) });
      return typeof r === 'string' ? r : { id: r.change.id, ...(r.change.activated?.taskId ? { taskId: r.change.activated.taskId } : {}) };
    },
    async change(f, id) {
      const c = await store.get(f, id);
      return c ? { title: requestTitle(c.text) || id, ...(c.page ? { page: c.page } : {}), ...(c.ref ? { ref: c.ref } : {}) } : undefined;
    },
    record: (e) => audits.push(e),
  };
  return { dir, store, changes, book: new ValidationBook(vdeps), audits, done: () => removeDir(dir) };
}

test('a guided check’s Something’s wrong queues as a DC when no lead is at work: kept, linked to the mark, never refused', async () => {
  const x = office('no-lead');
  try {
    const r = await x.book.mark('shop', { revision: S, scenario: 'J-01', verdict: 'wrong', note: 'The host name is missing on the badge', page: '/p/badge', by: 'Alex Lee', owner: 'acc_1' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.ok && r.finding.correction, { id: 'DC-1' }, 'a DC, with no task yet: it waits in the queue');
    const c = (await x.store.get('shop', 'DC-1'))!;
    assert.equal(c.queue, 'queued');
    assert.equal(c.via, 'validation');
    assert.deepEqual(c.source, { sha: S, kind: 'viewed' }, 'its source is the version checked');
    assert.equal(c.page, '/p/badge');
    assert.match(c.text, /^The host name is missing on the badge\n\nSomething's wrong in the guided check "Reception signs a visitor in" \(J-01\) on version e0eeeee/);
    assert.deepEqual(x.book.corrections('shop').map((m) => m.correction?.id), ['DC-1'], 'the C5 mark stays linked to it');
    assert.equal(x.changes.whyQueued('shop', await x.store.all('shop'))?.why, 'no-lead');
    assert.ok(x.audits.some((a) => a.action === 'validation.mark' && /sent to the team as DC-1/.test(a.summary)));
  } finally {
    x.done();
  }
});

test('a Please try this card: Looks right is a mark for exactly the version served (never acceptance); Something’s wrong a DC correction linked to the change', async () => {
  const x = office(undefined);
  try {
    const first = await x.changes.intake('shop', { text: 'Show the host’s name next to each visitor', ref: { docType: 'page', docQn: 'Desk.Visitors', label: 'Today’s visitors' }, page: '/p/visitors', via: 'chat', key: 'draft-0001', by: 'Alex Lee' });
    assert.ok(typeof first !== 'string' && first.change.id === 'DC-1' && first.change.via === 'chat');
    // Another version on screen than the one served: refused, nothing kept.
    const stale = await x.book.mark('shop', { revision: OTHER, change: 'DC-1', verdict: 'works', by: 'Alex Lee' });
    assert.ok(!stale.ok && stale.status === 409);
    assert.equal((await x.book.mark('shop', { revision: S, change: 'DC-9', verdict: 'works', by: 'Alex Lee' })).ok, false, 'an unknown change');
    const looks = await x.book.mark('shop', { revision: S, change: 'DC-1', verdict: 'works', by: 'Alex Lee' });
    assert.ok(looks.ok);
    assert.equal(looks.ok && looks.finding.scenario, reviewScenario('DC-1'));
    assert.equal(looks.ok && looks.finding.revision, S);
    assert.equal(reviewedChange('change:DC-1'), 'DC-1');
    assert.equal(reviewedChange('J-01'), undefined);
    const wrong = await x.book.mark('shop', { revision: S, change: 'DC-1', verdict: 'wrong', note: 'The name is cut off on small screens', by: 'Alex Lee' });
    assert.ok(wrong.ok && wrong.finding.correction?.id === 'DC-2');
    const corr = (await x.store.get('shop', 'DC-2'))!;
    assert.deepEqual([corr.of, corr.via, corr.source.sha, corr.ref?.docQn, corr.page], ['DC-1', 'try', S, 'Desk.Visitors', '/p/visitors']);
    assert.match(corr.text, /^The name is cut off on small screens\n\nSomething's wrong after trying DC-1 \("Show the host’s name next to each visitor"\) on version e0eeeee/);
    // Read back per change, oldest first, for the try card.
    const reviews = x.book.reviews('shop').get('DC-1')!;
    assert.deepEqual(reviews.map((r) => [r.verdict, r.revision, r.correction]), [['works', S, undefined], ['wrong', S, 'DC-2']]);
    assert.ok(x.audits.some((a) => a.action === 'validation.mark' && /Tried DC-1 on version e0eeeee: looks right/.test(a.summary)));
    assert.ok(!x.audits.some((a) => /accept/i.test(a.action)), 'never an acceptance');
    // The intake keeps `of` only for a change of the project.
    const bad = await x.changes.intake('shop', { text: 'A correction of nothing at all', of: 'DC-99', via: 'nonsense', by: 'Alex Lee' });
    assert.ok(typeof bad !== 'string' && bad.change.of === undefined && bad.change.via === undefined);
  } finally {
    x.done();
  }
});

test('the Model tab’s Change this is the Project Manager’s, checked on the server, not only by the button', async () => {
  const call = async (admin: boolean) => {
    let status = 0;
    const res = { writeHead: (s: number) => ((status = s), res), setHeader: () => undefined, end: () => undefined, headersSent: false };
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ floor: 'shop' }))]), { method: 'POST', headers: { origin: 'http://office.test', host: 'office.test', 'content-type': 'application/json' } });
    const ctx = { cfg: { trustProxy: false, port: 80 }, meOf: () => ({ admin }), floors: new Map() };
    await (modelChangeRoutes.create.handle as (c: unknown, r: unknown) => unknown)(ctx, { req, res, url: new URL('http://office.test/api/model/change-request'), path: '/api/model/change-request', session: { account: { id: 'u2', name: 'Member' } } });
    return status;
  };
  assert.equal(await call(false), 403, 'a member is refused');
  assert.equal(await call(true), 404, 'an admin gets past the check (to the project lookup)');
});

// ---- The chat's words (pure) -------------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 24, 12);
type Extra = { preview?: { running: boolean; served?: string }; inServed?: boolean; held?: { env: string; reason: string; findings: number } };
const view = (o: Partial<DevChangeView> & Extra): DevChangeView => {
  const v = { id: 'DC-1', text: 'Sort by arrival\n\nAbout: Today’s visitors (page Desk.Visitors)', by: 'Alex Lee', at: NOW - 3_600_000, source: { sha: MAIN, kind: 'viewed' }, queue: 'queued', candidates: [], branch: 'dev/DC-1', state: 'queued', words: CHANGE_WORDS[o.state ?? 'queued'], detail: 'The project is paused: it starts when the project is resumed.', mayCancel: true, ...o } as DevChangeView;
  v.facts = changeFour({ state: v.state, words: v.words, tone: CHANGE_TONE[v.state], ...(v.revision ? { revision: v.revision, ...(v.state === 'implemented' ? { merged: v.revision } : {}) } : {}), ...(v.checks ? { checks: v.checks } : {}), ...(o.preview ? { preview: o.preview } : {}), ...(o.inServed !== undefined ? { inServed: o.inServed } : {}), ...(o.held ? { held: o.held } : {}), ...(v.reviews ? { reviews: v.reviews } : {}) });
  return v;
};

test('this session’s changes, the header’s summary and each receipt (four facts apart), only from the record', () => {
  const M = 'f'.repeat(40);
  const old = view({ id: 'DC-1', at: NOW - 2 * 86_400_000, state: 'implemented', revision: M });
  const oldOpen = view({ id: 'DC-2', at: NOW - 2 * 86_400_000, state: 'working' });
  const fresh = view({ id: 'DC-3', at: NOW - 600_000 });
  const s = sessionChanges([fresh, old, oldOpen], NOW);
  assert.deepEqual(s.map((c) => c.id), ['DC-2', 'DC-3'], 'asked in the last 12 hours, or still on its way; oldest first');
  assert.deepEqual(sessionSummary(s), { head: '2 changes this session', parts: ['1 working', '1 queued'] });
  assert.deepEqual(sessionSummary([view({ state: 'implemented', revision: M, preview: { running: true, served: S }, inServed: true }), view({ id: 'DC-9', state: 'implemented', revision: M, preview: { running: false } })]).parts, ['2 implemented', '1 in the preview']);
  assert.equal(sessionSummary([]).head, 'No changes this session');
  // The receipt: the execution with the revision it names, then the four facts, each from its own source.
  const cand = receiptWords(view({ state: 'candidate', revision: 'c1'.padEnd(40, '1'), detail: 'x' }));
  assert.deepEqual([cand.head, cand.line], ['→ DC-1 · Working · candidate @c111111', 'x']);
  assert.deepEqual(cand.facts.map((f) => [f.key, f.status, f.text]), [
    ['execution', 'candidate', 'Working · candidate @c111111'],
    ['verification', 'incomplete', 'Incomplete @c111111: no CI'],
    ['preview', 'main', 'Runs main, not this candidate'],
    ['review', 'none', 'No review yet'],
  ]);
  // Implemented is its own fact: never "in preview", "ready to try" or "accepted" by itself.
  const behind = receiptWords(view({ state: 'implemented', revision: M, detail: 'y', preview: { running: true, served: S }, inServed: false }));
  assert.equal(behind.head, '→ DC-1 · Implemented @fffffff');
  assert.equal(behind.facts.find((f) => f.key === 'preview')?.text, 'Preview behind: runs @e0eeeee');
  assert.equal(behind.facts.find((f) => f.key === 'review')?.text, 'No review yet');
  const unknown = receiptWords(view({ state: 'implemented', revision: M, detail: 'y' }));
  assert.equal(unknown.facts.find((f) => f.key === 'preview')?.status, 'unknown', 'merged with nothing known of the preview: unknown, never "available"');
  assert.equal(unknown.facts.find((f) => f.key === 'verification')?.status, 'incomplete', 'no checks at M: incomplete, never passed');
  // Held by the data-impact guard: a fact of its own, beside Implemented.
  const held = receiptWords(view({ state: 'implemented', revision: M, detail: 'y', preview: { running: true, served: S }, inServed: true, held: { env: 'candidate:DC-1', reason: 'Possible data impact', findings: 2 } }));
  assert.deepEqual([held.facts[0].status, held.facts[2].status, held.facts[2].text], ['implemented', 'held', 'Held: possible data impact']);
  const inPrev = receiptWords(view({ state: 'implemented', revision: M, detail: 'z', preview: { running: true, served: S }, inServed: true, reviews: [{ id: 'GV-2', verdict: 'works', revision: S, by: 'Alex', at: NOW }] }));
  assert.equal(inPrev.facts.find((f) => f.key === 'preview')?.text, 'In the preview @e0eeeee');
  assert.equal(inPrev.facts.find((f) => f.key === 'review')?.text, 'Looks right for @e0eeeee (Alex)');
  for (const r of [cand, behind, inPrev, held]) assert.doesNotMatch(JSON.stringify(r), /accepted/i);
  const paused = receiptWords(fresh, { by: 'Keith', at: NOW - 1_000, why: 'person' });
  assert.equal(paused.head, '→ DC-3 · Queued');
  assert.match(paused.line, /^Project paused by Keith \(.+\)\. Queued changes start when someone resumes it in Project Management \(▶ Resume\)\.$/);
  assert.match(pauseWords({ by: 'x', at: NOW, why: 'budget' }), /because its budget is reached/);
  assert.equal(askedWords(fresh.text), 'Sort by arrival', 'the person’s words without the added context line');
});

test('Please try this: only once it’s in the preview (not held), after the latest event; a review counts for its exact version', () => {
  const M = 'f'.repeat(40);
  const c = view({ state: 'implemented', revision: M, preview: { running: true, served: S }, inServed: true, settled: { at: NOW - 100, why: 'merged' }, candidates: [{ sha: 'c', via: 'branch', branch: 'dev/DC-1', seenAt: NOW - 500 }], reviews: [{ id: 'GV-1', verdict: 'works', revision: S, by: 'Alex', at: NOW }] });
  assert.equal(wantsTry(c), true);
  assert.equal(wantsTry(view({ state: 'implemented', revision: M, preview: { running: true, served: S }, inServed: false })), false);
  assert.equal(wantsTry(view({ state: 'implemented', revision: M })), false, 'merged alone is never ready to try');
  assert.equal(wantsTry(view({ state: 'implemented', revision: M, preview: { running: true, served: S }, inServed: true, held: { env: 'live-preview', reason: 'held', findings: 1 } })), false, 'held: not available');
  assert.equal(tryAt(c), NOW - 99);
  assert.equal(reviewAt(c, S)?.id, 'GV-1');
  assert.equal(reviewAt(c, S.slice(0, 7))?.id, 'GV-1');
  assert.equal(reviewAt(c, OTHER), undefined, 'a review of another version doesn’t count');
});

test('the chip, the context line a question carries, and the note the lead gets when a change queues', () => {
  const element = { ref: { docType: 'page' as const, docQn: 'Desk.Visitors', widgetName: 'btnSave', label: 'Save button' }, chip: 'Today’s visitors › Save button', where: 'widget btnSave on page Desk.Visitors' };
  const w = chipFor({ about: 'Page: Today’s visitors', element, rev: MAIN });
  assert.deepEqual([w.kind, w.label], ['widget', 'Today’s visitors › Save button']);
  assert.equal(chipFor({ about: 'Page: Today’s visitors', element: { ...element, ref: { docType: 'page', docQn: 'Desk.Visitors' }, chip: 'Today’s visitors' }, rev: MAIN }).kind, 'page');
  assert.deepEqual([chipFor({ about: 'Logic: Save visit' }).kind, chipFor({ about: 'Logic: Save visit' }).label], ['item', 'Logic: Save visit']);
  assert.notEqual(chipFor({ about: 'x', element, rev: MAIN }).key, chipFor({ about: 'x', element, rev: OTHER }).key, 'another revision is another context');
  assert.equal(aboutLine({ about: 'x', element, rev: MAIN }), 'About: Today’s visitors › Save button (widget btnSave on page Desk.Visitors) at revision @aaaaaaa');
  const note = queuedNote({ id: 'DC-4', by: 'Alex Lee' }, 'Rename it\n\nAbout: Today’s visitors');
  assert.match(note, /kept as DC-4 and queued\. It reaches you as its own task when it's next, on branch dev\/DC-4: nothing to do for it now\.\n\nTheir words: Rename it$/);
});

test('the first page the canvas shows: the app’s own first page with an address; Marketplace left out', () => {
  const P = (qn: string, url?: string) => ({ id: `page:${qn}`, label: qn, kind: 'page' as const, type: 'page', qn, ...(url ? { url } : {}) });
  const levels = {
    '': [{ id: 'pages', label: 'Pages', kind: 'group' as const, folder: true }],
    pages: [{ id: 'pages/@marketplace', label: 'Marketplace', kind: 'group' as const, folder: true }, { id: 'pages/Desk', label: 'Desk', kind: 'module' as const, folder: true }],
    'pages/@marketplace': [P('Atlas.Login', '/login')],
    'pages/Desk': [P('Desk.Visit_Edit'), P('Desk.Visitors', '/p/visitors')],
  };
  assert.equal(firstPage(levels)?.page.qn, 'Desk.Visitors');
  assert.deepEqual(firstPage(levels)?.above, ['pages', 'pages/Desk'], 'the rows above it, to open');
  assert.equal(firstPage({ ...levels, 'pages/Desk': [P('Desk.Visit_Edit')] })?.page.qn, 'Desk.Visit_Edit');
  assert.equal(firstPage({ '': [] }), undefined);
});

test('cards merge into the conversation by time; a row with no time keeps its place', () => {
  const msg = (id: string, at?: number): ChatItem => ({ kind: 'msg', id, msg: { id, kind: 'agent', text: id, ...(at ? { at } : {}) } });
  const out = mergeByTime([msg('a', 10), msg('b'), msg('c', 30)], [{ id: 'x', at: 20 }, { id: 'y', at: 5 }, { id: 'z', at: 99 }]);
  assert.deepEqual(out.map((r) => r.id), ['y', 'a', 'b', 'x', 'c', 'z']);
  assert.deepEqual(mergeByTime([msg('a', 1)], []).map((r) => r.id), ['a']);
});

test('it plugs in by the dock seam: the panel and composer lend their places, the Developer view fills them; nothing in lite.ts', () => {
  assert.doesNotMatch(read('src/client/lite.ts'), /lead-panel\/dock|app-workspace|setPanelDock/);
  assert.match(read('src/client/ui/lead-panel/panel.ts'), /onPanelDock\(\(\) => this\.docked\(\)\)/);
  assert.match(read('src/client/ui/app-workspace/dock/index.ts'), /setPanelDock\(on \? lent : null\)/);
  for (const f of ['src/client/ui/app-workspace/dock/index.ts', 'src/client/ui/app-workspace/dock/cards.ts', 'src/client/ui/app-workspace/dock/logic.ts', 'src/client/ui/lead-panel/dock.ts']) assert.doesNotMatch(read(f), /setInterval|setTimeout|fetch\(/, `${f}: no timers or fetches of its own`);
  // One record for every entry point: the composer, the dialog, a guided check, a try card.
  assert.match(read('src/client/ui/app-workspace/dock/index.ts'), /via: 'chat'/);
  assert.match(read('src/client/ui/app-workspace/requests.ts'), /via: 'dialog'/);
  assert.match(read('src/server/guided-validation/index.ts'), /devChangesOf\(ctx\)\.changes\.intake/);
  assert.doesNotMatch(read('src/server/guided-validation/index.ts'), /changeRequestBook/);
});
