// Change answer, escalations (Slice 1B-3): a new revision superseding the old, dispatched once through the
// 1B-1 dispatcher with a message that cites the new revision; a stale page is a 409 with nothing written; the
// follow-through tracks the new revision, and a record citing the old one reads "recorded for rev n"; linked
// work lists only explicit links, labelled; perms. Real git, the real dispatcher and roster on a fake floor;
// no office, no Claude, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { AuditInput } from '../src/shared/audit.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import { followLine } from '../src/shared/followthrough.js';
import { LINK_WORDS, NO_LINKS } from '../src/shared/change-answer.js';
import { ChangeAnswer, type ChangeDeps } from '../src/server/change-answer/service.js';
import { escalationLinks, questionLinks, type LinkSources } from '../src/server/change-answer/links.js';
import { changeAnswerRoutes } from '../src/server/http/routes/change-answer.js';
import { clock, settle } from './dispatch-helpers.js';
import { git, journal, team, type Team } from './followthrough-helpers.js';

function changer(t: Team, extra: Partial<ChangeDeps> = {}) {
  const audits: AuditInput[] = [];
  const c = new ChangeAnswer({
    dataDir: t.o.dataDir,
    now: () => clock.now,
    dispatcher: t.o.roster.dispatch,
    follow: t.ft.store,
    escalations: (id) => t.o.roster.data(id).escalations,
    escTarget: t.ft.deps.escTarget,
    qTarget: t.ft.deps.qTarget,
    sources: () => ({ tasks: [], changeRequests: [] }),
    flush: (id) => t.o.roster.file(id).flushCritical(),
    record: (a) => void audits.push(a),
    ...extra,
  });
  return { c, audits };
}

test('change-creates-revision: rev 2 supersedes rev 1, dispatched once, and the message cites the new revision', async () => {
  const t = await team();
  const { c, audits } = changer(t);
  const decision = `esc:${t.e.id}`;
  const oldId = t.e.resolution!.dispatchId!;
  const before = t.o.roster.dispatch.store.list(t.floor.id).length;
  const typed = t.floor.prompts.length;
  const r = await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 1, verdict: 'reply', text: 'Go with: Use magic links' }, { by: 'Keith' });
  assert.ok(r.ok, JSON.stringify(r));
  await settle();
  const hist = await t.o.roster.dispatch.answers.history(t.floor.id, decision);
  assert.equal(hist.length, 2);
  assert.deepEqual([hist[1].rev, hist[1].supersedes, hist[1].kind, hist[1].text], [2, 1, 'reply', 'Go with: Use magic links']);
  const recs = t.o.roster.dispatch.store.list(t.floor.id);
  assert.equal(recs.length, before + 1, 'one dispatch');
  const next = recs.find((x) => x.answerRev === 2)!;
  assert.equal(next.supersedes, oldId);
  assert.equal(recs.find((x) => x.id === oldId)?.supersededBy, next.id);
  assert.equal(t.floor.prompts.length, typed + 1, 'typed once');
  const said = t.floor.prompts[t.floor.prompts.length - 1].text;
  assert.ok(said.includes(`This replaces my answer rev 1 to ESC-${t.e.id}: Go with: Use magic links. Record it as \`Decided per ESC-${t.e.id} rev 2\`.`), said);
  assert.match(next.payload, new RegExp(`ESC-${t.e.id} rev 2\\]$`));
  assert.deepEqual([t.e.resolution?.answerRev, t.e.resolution?.dispatchId, t.e.resolution?.text], [2, next.id, 'Go with: Use magic links']);
  assert.ok(audits.some((a) => a.action === 'answer.change' && a.ids?.answerRev === 2));
  assert.ok((await t.o.roster.dispatch.answers.verify(t.floor.id)).ok, 'the chain holds');
});

test('change-stale-409: an old expectedRev is refused, and nothing is written or typed', async () => {
  const t = await team();
  const { c } = changer(t);
  const decision = `esc:${t.e.id}`;
  const before = t.o.roster.dispatch.store.list(t.floor.id).length;
  const typed = t.floor.prompts.length;
  const r = await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 0, verdict: 'approve', text: '' }, { by: 'Keith' });
  assert.deepEqual(r.ok ? 0 : [r.status, (r.current as { rev: number }).rev], [409, 1]);
  assert.equal((await t.o.roster.dispatch.answers.history(t.floor.id, decision)).length, 1);
  assert.equal(t.o.roster.dispatch.store.list(t.floor.id).length, before);
  assert.equal(t.floor.prompts.length, typed);
  assert.equal(t.e.resolution?.answerRev, 1);
  // Changed meanwhile by someone else: the page that saw rev 1 is refused too.
  assert.ok((await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 1, verdict: 'approve', text: '' }, { by: 'Ada' })).ok);
  const late = await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 1, verdict: 'reject', text: 'No' }, { by: 'Keith' });
  assert.equal(late.ok ? 0 : late.status, 409);
  assert.equal((await t.o.roster.dispatch.answers.history(t.floor.id, decision)).length, 2);
  // An open escalation is answered on its card, not changed.
  const open = t.o.roster.escalations.raise(t.floor, t.floor.worker('a1')!, { urgency: 'important', title: 'Another?', details: '', options: [] });
  const o = await c.change(t.floor.id, { floor: t.floor.id, decision: `esc:${open.id}`, expectedRev: 0, verdict: 'reply', text: 'x' }, { by: 'Keith' });
  assert.equal(o.ok ? 0 : o.status, 409);
});

test('change-follow-tracks-new-rev: follow-through moves to rev 2; a record of rev 1 now reads "recorded for rev 1", and the history keeps rev 1 as recorded', async () => {
  const t = await team();
  const { c } = changer(t);
  const decision = `esc:${t.e.id}`;
  journal(t.repo.dir, `Decided per ESC-${t.e.id} rev 1: Use SSO.`);
  git(t.repo.dir, 'commit', '-qam', 'journal');
  git(t.repo.dir, 'push', '-q', 'origin', 'main');
  assert.equal((await t.scan())?.outcome, 'recorded');
  assert.ok((await c.change(t.floor.id, { floor: t.floor.id, decision, expectedRev: 1, verdict: 'reply', text: 'Go with: Use magic links' }, { by: 'Keith' })).ok);
  await settle();
  let item = (await t.ft.view(t.floor.id, true)).items.find((i) => i.decision === decision);
  assert.deepEqual([item?.rev, item?.recording.outcome], [2, 'not-recorded-yet']);
  const r = await t.scan();
  assert.deepEqual([r?.outcome, r?.rev], ['recorded-older-rev', 1]);
  item = (await t.ft.view(t.floor.id, true)).items.find((i) => i.decision === decision);
  assert.match(followLine(item!), /Decided \(rev 2\) · .* · Recorded for rev 1/);
  const d = await c.detail(t.floor.id, decision);
  assert.ok(typeof d !== 'string');
  assert.deepEqual(
    d.revs.map((x) => [x.rev, x.outcome?.outcome]),
    [
      [1, 'recorded'],
      [2, 'recorded-older-rev'],
    ],
  );
  assert.equal(d.revs[1].dispatch[0]?.state, 'submitted');
  assert.equal(d.rev, 2);
});

const esc = (refs: Escalation['refs']): Escalation => ({ id: 'abc123', at: 0, workerId: 'w', by: 'Ada', urgency: 'important', fyi: false, level: 'L2' as never, title: 'SSO?', details: '', options: [], status: 'resolved', refs });

test('change-linked-work: only explicit links, each labelled recorded or inferred; none found says so, never "no impact"', async () => {
  const s: LinkSources = {
    escalations: [esc({ questionKey: 'F001.brd.json#OQ-01' })],
    tasks: [
      { member: 'Ada', text: 'work on issue #4', pending: { escalationId: 'abc123' } },
      { member: 'Linus', text: 'PR #9', verify: { escalationId: 'abc123', pr: 9 } },
      { member: 'Tim', text: 'unrelated', pending: { escalationId: 'zzz' } },
    ],
    changeRequests: [
      { id: 'MCR-3', request: 'Rename the entity as decided in ESC-abc123' },
      { id: 'MCR-4', request: 'Something else' },
    ],
    blocks: (k) => (k === 'F001.brd.json#OQ-01' ? 'FR-2 sign-in' : undefined),
  };
  const links = escalationLinks(esc({ questionKey: 'F001.brd.json#OQ-01', pr: 12, decisionId: 'OW-1' }), s);
  assert.deepEqual(
    links.map((l) => [l.kind, l.strength]),
    [
      ['question', 'recorded'],
      ['decision', 'recorded'],
      ['pr', 'recorded'],
      ['blocks', 'inferred'],
      ['waiting', 'recorded'],
      ['verification', 'recorded'],
      ['model-change', 'inferred'],
    ],
  );
  assert.ok(!links.some((l) => /Tim|MCR-4/.test(l.label)));
  assert.deepEqual(
    questionLinks('F001.brd.json#OQ-01', s).map((l) => [l.kind, l.strength]),
    [
      ['escalation', 'recorded'],
      ['blocks', 'inferred'],
    ],
  );
  assert.deepEqual(LINK_WORDS, { recorded: 'Recorded link', inferred: 'Inferred' });
  // Nothing linked: an empty list, which the dialog shows as "No linked work found…".
  const t = await team();
  const { c } = changer(t);
  const d = await c.detail(t.floor.id, `esc:${t.e.id}`);
  assert.ok(typeof d !== 'string');
  assert.deepEqual(d.links, []);
  assert.equal(NO_LINKS, 'No links found: the office located no work that used this revision (that is not the same as no work being needed)');
  assert.doesNotMatch(NO_LINKS, /no impact/i);
});

type Handle = (ctx: unknown, x: unknown) => Promise<void>;

function call(route: { path: string; handle: unknown; method: string }, o: { admin: boolean; body?: unknown; url?: string; origin?: string }) {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body ?? {}))]), { method: route.method, headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: o.admin }), floors: new Map() };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(o.url ?? `http://office.test${route.path}`), path: route.path, session: { account: { id: 'u1', name: 'Guest' } } })).then(() => ({ status, body: body as { error?: string } }));
}

test('change-perms: only the Project Manager (an admin) can change an answer or see its history, from the office’s own page', async () => {
  const body = { floor: 'f', decision: 'esc:x', expectedRev: 1, verdict: 'reply', text: 'x' };
  const change = await call(changeAnswerRoutes.change, { admin: false, origin: 'http://office.test', body });
  assert.equal(change.status, 403);
  assert.match(change.body.error ?? '', /Project Manager \(an admin\)/);
  const hist = await call(changeAnswerRoutes.detail, { admin: false, url: 'http://office.test/api/answers/detail?floor=f&decision=esc:x' });
  assert.equal(hist.status, 403);
  assert.equal((await call(changeAnswerRoutes.change, { admin: true, origin: 'https://evil.test', body })).status, 403, 'another site');
  assert.equal((await call(changeAnswerRoutes.change, { admin: true, origin: 'http://office.test', body })).status, 404, 'an admin gets past the check');
  assert.equal((await call(changeAnswerRoutes.detail, { admin: true, url: 'http://office.test/api/answers/detail?floor=f&decision=esc:x' })).status, 404);
});
