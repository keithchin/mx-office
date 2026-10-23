// C4 of the App Workspace proposal: change requests and business decisions with artifacts.
//   - Request a change mints a task (its id kept with the request), goes to the team's lead, is audited, and is
//     refused for anyone who can't create work (not signed in, another site's page)
//   - the state table: Received → Being worked on → Ready to try → Done / Needs your answer (and Stopped)
//   - the business-kind filter of the decision cards, an explicit table; unknown kinds stay out
//   - a related artifact only from an explicit id, never from the words of a question
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { cleanPage, currentRequest, requestState, requestTaskText, REQUEST_WORDS, type ChangeRequestRecord, type ChangeRequestView, type RequestFacts, type RequestState } from '../src/shared/change-requests.js';
import { RequestBook, type RequestDeps, type RequestMember } from '../src/server/change-requests/service.js';
import { factsOf, pullOf, type ViewInputs } from '../src/server/change-requests/view.js';
import { changeRequestRoutes } from '../src/server/http/routes/change-requests.js';
import { requestHandler } from '../src/server/http/router.js';
import { audienceOf, BUSINESS_TRIGGERS, ENGINEERING_TRIGGERS } from '../src/shared/app-workspace/business-decisions.js';
import { ESCALATION_TRIGGERS, type EscalationTrigger } from '../src/shared/roster/autonomy.js';
import { artifactInText, readArtifact, withoutArtifactLine } from '../src/shared/decisions/artifact.js';
import { makeEscalation, readEscalationAsk, type Escalation } from '../src/shared/roster/escalation.js';
import { escalationCandidates } from '../src/shared/decisions/candidates.js';
import { bannedIn } from '../src/shared/app-workspace/words.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { RosterView } from '../src/shared/roster/types.js';
import type { DecisionCard } from '../src/shared/decisions/types.js';
import { removeDir } from './support/cleanup.js';

const SHA = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MERGE = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TASK = 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0';

// ---- Request a change: a task, the lead, the audit ------------------------------------------------------

function harness(o: { intake?: RequestMember[]; refuse?: string; noTask?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-cr-'));
  const handed: { m: RequestMember; text: string; id: string; onSent: () => void }[] = [];
  const audits: AuditInput[] = [];
  const deps: RequestDeps = {
    dataDir,
    now: () => Date.UTC(2026, 9, 23, 10),
    intake: () => o.intake ?? [{ role: 'pm', name: 'Ada', workerId: 'w-ada', atWork: true }, { role: 'chief-analyst', name: 'Cleo', workerId: 'w-cleo', atWork: true }],
    hand(_f, m, text, x) {
      if (o.refuse) return { status: 'refused', why: o.refuse };
      handed.push({ m, text, id: x.id, onSent: x.onSent });
      return { status: 'held', taskId: o.noTask ? '' : TASK, executionId: 'exe_01JABCDEFGHJKMNPQRSTVWXYZ0', dispatchId: 'dsp_1' };
    },
    record: (e) => audits.push(e),
  };
  return { book: new RequestBook(deps), handed, audits, dataDir, done: () => removeDir(dataDir) };
}

test('a request becomes a task for the team lead: its task id kept, the page and version in the text, audited with the task id', async () => {
  const x = harness();
  try {
    const r = await x.book.request('shop', { text: 'Let reception see who signed a visitor in.', page: '/p/Visitors', revision: SHA, by: 'Alex Lee', owner: 'acc_1' });
    assert.ok(typeof r !== 'string');
    assert.equal(r.id, 'CR-1');
    assert.equal(r.taskId, TASK, 'every request has a task id');
    assert.equal(r.member, 'Ada', 'the lead (whoever covers management) takes it, as intake does');
    assert.equal(r.delivery, 'held', 'after the lead’s turn under way');
    assert.equal(x.handed.length, 1);
    const text = x.handed[0].text;
    assert.match(text.split('\n')[0], /^Change request CR-1 from Alex Lee: Let reception see who signed a visitor in\.$/);
    assert.match(text, /```change-request\nid: CR-1\npage: \/p\/Visitors\nversion: 7d3f0b1a+\nrequest: \|\n {2}Let reception see who signed a visitor in\.\n```/);
    assert.match(text, /Task:` line \(below\)/);
    assert.equal(x.audits.length, 1);
    assert.equal(x.audits[0].action, 'change-request.created');
    assert.equal(x.audits[0].ids?.taskId, TASK);
    assert.deepEqual(x.audits[0].actor, { kind: 'human', name: 'Alex Lee', id: 'acc_1' });
    // Kept on disk: the link from the request to its task.
    const saved = JSON.parse(readFileSync(path.join(x.dataDir, 'change-requests', 'shop.json'), 'utf8'));
    assert.equal(saved.items[0].taskId, TASK);
    x.handed[0].onSent();
    assert.equal(x.book.list('shop')[0].delivery, 'sent');
    const r2 = await x.book.request('shop', { text: 'And print the host on the badge.', by: 'Alex Lee' });
    assert.ok(typeof r2 !== 'string' && r2.id === 'CR-2' && !r2.page && !r2.revision);
  } finally {
    x.done();
  }
});

test('a request is refused, with nothing kept or audited, when there is no task, no lead at work, or no words', async () => {
  const none = harness({ intake: [{ role: 'pm', name: 'Ada', atWork: false }] });
  const noTask = harness({ noTask: true });
  const refused = harness({ refuse: 'The office couldn’t save the task’s record' });
  try {
    assert.match(String(await none.book.request('shop', { text: 'Show the host on the badge', by: 'A' })), /No team lead is at work/);
    assert.match(String(await noTask.book.request('shop', { text: 'Show the host on the badge', by: 'A' })), /couldn’t make a task/);
    assert.match(String(await refused.book.request('shop', { text: 'Show the host on the badge', by: 'A' })), /couldn’t save/);
    assert.equal(await none.book.request('shop', { text: '   ', by: 'A' }), 'Say what should change');
    for (const x of [none, noTask, refused]) {
      assert.equal(x.book.list('shop').length, 0);
      assert.equal(x.audits.length, 0);
    }
    // The analyst takes it when the lead isn't at work.
    const analyst = harness({ intake: [{ role: 'pm', name: 'Ada', atWork: false }, { role: 'chief-analyst', name: 'Cleo', workerId: 'w-cleo', atWork: true }] });
    const r = await analyst.book.request('shop', { text: 'Show the host on the badge', by: 'A' });
    assert.ok(typeof r !== 'string' && r.member === 'Cleo');
    analyst.done();
  } finally {
    none.done();
    noTask.done();
    refused.done();
  }
});

test('the page is a path within the app, never another site; the revision only when it reads as one', () => {
  assert.equal(cleanPage('/p/Visitors?x=1#a'), '/p/Visitors?x=1#a');
  for (const bad of ['https://evil.test/p', '//evil.test', 'p/Visitors', '/a b', 42, undefined]) assert.equal(cleanPage(bad), undefined, String(bad));
  assert.match(requestTaskText({ id: 'CR-3', text: 'x', by: 'A' }), /page: unknown\nversion: unknown/);
});

type Call = { status: number; body: { error?: string; request?: ChangeRequestRecord } };
function call(route: { handle: unknown; path: string }, o: { origin?: string; body: unknown }): Promise<Call> {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body))]), { method: 'POST', headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: false }), floors: new Map() };
  return Promise.resolve((route.handle as (c: unknown, r: unknown) => unknown)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: {} })).then(() => ({ status, body: body as Call['body'] }));
}

test('who may ask is who may create work: signed in, from the office’s own page; anyone else is refused before anything happens', async () => {
  assert.equal(changeRequestRoutes.create.auth, 'session');
  // Another site's page, and a script with no Origin: refused.
  assert.equal((await call(changeRequestRoutes.create, { origin: 'https://evil.test', body: { floor: 'shop', text: 'x' } })).status, 403);
  assert.equal((await call(changeRequestRoutes.create, { body: { floor: 'shop', text: 'x' } })).status, 403);
  // A member (not an admin) from the office's page gets past the check, to "no such project" here.
  assert.equal((await call(changeRequestRoutes.create, { origin: 'http://office.test', body: { floor: 'shop', text: 'x' } })).status, 404);
  // Not signed in: the router's 401, the route never runs.
  const handler = requestHandler({ cfg: { port: 4999 }, auth: { fromAnyCookie: () => false, fromRequest: () => undefined }, services: { lookup: () => undefined } } as never, [changeRequestRoutes.create, changeRequestRoutes.list]);
  for (const method of ['POST', 'GET']) {
    let status = 0;
    const res = { writeHead: (s: number) => ((status = s), res), end: () => undefined, headersSent: false, setHeader: () => undefined };
    await handler({ method, url: '/api/change-requests?floor=shop', headers: { host: 'office.test' } } as never, res as never);
    assert.equal(status, 401, method);
  }
});

// ---- The state table ---------------------------------------------------------------------------------

const F = (o: Partial<RequestFacts>): RequestFacts => ({ delivery: 'held', assigned: false, ...o });
const accepted = { state: 'accepted' as const, revision: SHA };

test('the state table: from the task, its change, the running version and the business status', () => {
  const rows: [string, RequestFacts, RequestState, string?][] = [
    ['made, held for the lead’s turn', F({}), 'received'],
    ['typed to the lead', F({ delivery: 'sent' }), 'working'],
    ['the lead has it as its task', F({ assigned: true, outcome: 'open' }), 'working'],
    ['set aside for other work', F({ assigned: true, ended: 'superseded' }), 'received'],
    ['its change is open', F({ assigned: true, change: { state: 'OPEN' } }), 'working'],
    ['its first change closed unmerged', F({ assigned: true, change: { state: 'CLOSED' } }), 'working'],
    ['finished, merge commit not known', F({ assigned: true, outcome: 'integrated', change: { state: 'MERGED' } }), 'working'],
    ['finished, not in the running version', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, served: SHA, inServed: false }), 'working'],
    ['finished, the running version unknown', F({ assigned: true, change: { state: 'MERGED', commit: MERGE } }), 'working'],
    ['in the running version', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, served: SHA, inServed: true }), 'ready', SHA],
    ['in a version accepted', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, served: SHA, inServed: true, business: accepted, inBusiness: true }), 'done', SHA],
    ['deployed (recorded)', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, business: { state: 'deployed-recorded', revision: SHA }, inBusiness: true }), 'done', SHA],
    ['accepted, but a version without it', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, served: SHA, inServed: true, business: accepted, inBusiness: false }), 'ready', SHA],
    ['verification passed is not done', F({ assigned: true, change: { state: 'MERGED', commit: MERGE }, served: SHA, inServed: true, business: { state: 'verification-passed', revision: SHA }, inBusiness: true }), 'ready', SHA],
    ['waits on your decision', F({ assigned: true, outcome: 'decision', change: { state: 'OPEN' } }), 'needs-answer'],
    ['cancelled', F({ assigned: true, ended: 'cancelled', change: { state: 'MERGED', commit: MERGE }, inServed: true, served: SHA }), 'stopped'],
  ];
  for (const [what, f, want, version] of rows) {
    const s = requestState(f);
    assert.equal(s.state, want, what);
    assert.equal(s.words, REQUEST_WORDS[want], what);
    assert.equal(s.version, version, `${what}: the version that has it`);
    assert.deepEqual(bannedIn(`${s.words} ${s.detail}`), [], `${what}: business words`);
  }
  assert.deepEqual(Object.values(REQUEST_WORDS), ['Received', 'Being worked on', 'Ready to try', 'Done', 'Needs your answer', 'Stopped']);
});

test('the facts come from the PR naming the task (or the request id), and the running version containing its merge commit', async () => {
  const r: ChangeRequestRecord = { id: 'CR-4', taskId: TASK, text: 'x', by: 'A', at: 1, role: 'pm', member: 'Ada', delivery: 'sent' };
  const pulls = [
    { number: 7, title: 'Unrelated', body: 'Task: tsk_01JZZZZZZZZZZZZZZZZZZZZZZZ', state: 'MERGED', mergeCommit: 'aaa' },
    { number: 8, title: 'Badge shows host', body: `Does it.\n\nTask: ${TASK}`, state: 'MERGED', mergeCommit: MERGE },
    { number: 9, title: 'CR-4 follow-up', body: '', state: 'OPEN' },
  ];
  assert.equal(pullOf(r, pulls)?.number, 8, 'the merged one naming the task first');
  assert.equal(pullOf({ id: 'CR-4', taskId: 'tsk_none' }, pulls)?.number, 9, 'else one naming the request id');
  assert.equal(pullOf({ id: 'CR-40', taskId: 'tsk_none' }, pulls), undefined, 'CR-4 is not CR-40');
  const asked: string[] = [];
  const i: ViewInputs = { task: () => ({ id: TASK, createdAt: 1, source: 'request', text: 'x', events: [{ type: 'assigned', at: 2, worker: 'w-ada', executionId: 'e' }] }), assignments: [], pulls, served: SHA, contains: async (a, b) => (asked.push(`${a.slice(0, 7)}>${b.slice(0, 7)}`), true) };
  const f = await factsOf(r, i);
  assert.equal(f.assigned, true);
  assert.deepEqual(f.change, { state: 'MERGED', commit: MERGE });
  assert.equal(f.inServed, true);
  assert.deepEqual(asked, ['1111111>7d3f0b1']);
  assert.equal(requestState(f).state, 'ready');
  // A git that can't tell: never moves it forward.
  const g = await factsOf(r, { ...i, contains: async () => undefined });
  assert.equal(requestState(g).state, 'working');
});

test('the current request is the newest that isn’t settled', () => {
  const v = (id: string, at: number, state: RequestState) => ({ id, at, state }) as ChangeRequestView;
  assert.equal(currentRequest([v('CR-1', 1, 'working'), v('CR-2', 2, 'done')])?.id, 'CR-1');
  assert.equal(currentRequest([v('CR-1', 1, 'done'), v('CR-2', 2, 'stopped')])?.id, 'CR-2');
  assert.equal(currentRequest([]), undefined);
});

// ---- Business decisions ------------------------------------------------------------------------------

const card = (o: Partial<DecisionCard> & { type?: string; sid?: string }): DecisionCard => ({ id: 'x', kind: 'decision', question: 'q', evidence: [], blocks: [], owner: 'o', sources: [{ id: o.sid ?? 'esc:1', type: (o.type ?? 'escalation') as never, label: 'l', target: { to: 'approvals' } }], after: '', level: 'warn', notes: [], related: [], need: {} as never, ...o });

test('the business-kind filter: an explicit table; unknown kinds stay out of the App view', () => {
  const rows: [string, DecisionCard, string][] = [
    ['a client question', card({ type: 'question', sid: 'q:F1#OQ-1' }), 'business'],
    ['a stage sign-off', card({ type: 'signoff', sid: 'stage:2' }), 'business'],
    ['a design system to adopt', card({ type: 'other', sid: 'design:shop:abc' }), 'business'],
    ['scope', card({ trigger: 'scope' }), 'business'],
    ['a question', card({ trigger: 'question' }), 'business'],
    ['architecture', card({ trigger: 'architecture' }), 'engineering'],
    ['security', card({ trigger: 'security' }), 'engineering'],
    ['a hands-on step', card({ kind: 'hands-on', trigger: 'needs-human' }), 'engineering'],
    ['an FYI', card({ kind: 'fyi', trigger: 'scope' }), 'engineering'],
    ['a permission card', card({ trigger: 'question', permission: { command: 'gh', rule: 'Bash(gh)', count: 1, who: 'A' } }), 'engineering'],
    ['a merge or proposal', card({ type: 'approval', sid: 'appr:m-12' }), 'engineering'],
    ['failing PR checks', card({ kind: 'status', type: 'pr-check', sid: 'pr:12' }), 'engineering'],
    ['a company brain', card({ type: 'brain', sid: 'brain:shop:k' }), 'engineering'],
    ['an escalation with no trigger', card({}), 'unknown'],
    ['a stuck register decision', card({ type: 'stuck', sid: 'stuck:1' }), 'unknown'],
    ['a stuck client question', card({ type: 'stuck', sid: 'stuck:2', questionKey: 'F1#OQ-1' }), 'business'],
    ['an assumption without consent', card({ type: 'ask', sid: 'ask:1' }), 'unknown'],
  ];
  for (const [what, c, want] of rows) assert.equal(audienceOf(c).audience, want, what);
  // Every trigger is in exactly one list.
  for (const t of ESCALATION_TRIGGERS) assert.equal(Number(BUSINESS_TRIGGERS.includes(t)) + Number(ENGINEERING_TRIGGERS.includes(t as EscalationTrigger)), 1, t);
});

// ---- Related artifacts -------------------------------------------------------------------------------

test('an artifact reads only as one of its kinds, exactly', () => {
  assert.deepEqual(readArtifact('process-map:docs/process-map.html'), { kind: 'process-map', ref: 'docs/process-map.html' });
  assert.deepEqual(readArtifact('screenshot: design/shots/visitors.png'), { kind: 'screenshot', ref: 'design/shots/visitors.png' });
  assert.deepEqual(readArtifact({ kind: 'journey', ref: 'J-08' }), { kind: 'journey', ref: 'J-08' });
  assert.deepEqual(readArtifact('walkthrough:wt_01J9'), { kind: 'walkthrough', ref: 'wt_01J9' });
  assert.deepEqual(readArtifact('document:analysis/F001.brd.json'), { kind: 'document', ref: 'analysis/F001.brd.json' });
  for (const bad of ['screenshot:docs/brief.md', 'document:../secrets.txt', 'document:/etc/passwd.txt', 'document:C:/x.md', 'process-map:https://evil.test/m.html', 'journey:the sign-in check', 'picture:a.png', 'the process map', '', 42]) assert.equal(readArtifact(bad), undefined, String(bad));
  assert.deepEqual(artifactInText('Which way?\n\nArtifact: process-map:docs/process-map.html\nMore.'), { kind: 'process-map', ref: 'docs/process-map.html' });
  assert.equal(artifactInText('See the process map in docs/process-map.html'), undefined, 'words alone are never an artifact');
  assert.equal(artifactInText('Artifact: document:a.md\nArtifact: document:b.md'), undefined, 'two named: neither');
  assert.equal(withoutArtifactLine('A\nArtifact: document:a.md\nB'), 'A\nB');
});

const roster = (es: Escalation[]): RosterView => ({ floor: 'shop', admin: true, escalations: es, approvals: [], members: [], settings: {} }) as unknown as RosterView;
const raise = (body: Record<string, unknown>, id: string) => {
  const ask = readEscalationAsk(body);
  assert.ok(typeof ask !== 'string');
  return makeEscalation(ask, { workerId: 'w1', by: 'Ada' }, 2, id, 1);
};

test('a decision card carries the artifact only when the escalation names it explicitly (field or Artifact: line)', () => {
  const named = raise({ title: 'Amend the rejected visit, or start a new one?', trigger: 'question', options: ['Amend', 'New'], artifact: 'process-map:docs/process-map.html' }, 'e1');
  const inLine = raise({ title: 'Keep visitor records for 30 or 90 days?', trigger: 'scope', details: 'Artifact: document:docs/retention.md' }, 'e2');
  const words = raise({ title: 'Which flow in the process map do we keep?', trigger: 'question', details: 'The process map in docs/process-map.html shows both; see the screenshot design/a.png.' }, 'e3');
  const bad = raise({ title: 'Which badge layout?', trigger: 'design', artifact: 'the badge screenshot' }, 'e4');
  const cards = escalationCandidates(roster([named, inLine, words, bad]));
  const by = (id: string) => cards.find((c) => c.source.escalation === id)!.body;
  assert.deepEqual(by('e1').artifact, { kind: 'process-map', ref: 'docs/process-map.html' });
  assert.deepEqual(by('e2').artifact, { kind: 'document', ref: 'docs/retention.md' });
  assert.equal(by('e2').detail, undefined, 'the Artifact: line is shown as the artifact, not as words');
  assert.equal(by('e3').artifact, undefined, 'never guessed from the words');
  assert.equal(by('e4').artifact, undefined, 'a ref that isn’t one: nothing');
  assert.equal(by('e1').trigger, 'question');
});
