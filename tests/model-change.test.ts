// "Change this" in the Model tab (shared/model-change.ts, server/model-change/, client/ui/model/change-*.ts):
// the picked element(s) and the commit in the task's text, who it goes to by coverage, the held delivery
// by default, the audit record, the badge while a request is open and gone once its PR merged, "View
// change" opening the PR's branch, and the office never writing the model or the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { badgeText, changeTaskText, changeTeam, chipsFor, defaultMember, linkPull, openFor, requestView, type ChangePull, type ChangeRequest } from '../src/shared/model-change.js';
import { defaultCoverage } from '../src/shared/roster/coverage.js';
import type { RoleId } from '../src/shared/roster/roles.js';
import type { AuditInput } from '../src/shared/audit.js';
import { ChangeRequests, cleanElements, deliveryOpts, type ChangeDeps, type ChangeMember } from '../src/server/model-change/service.js';
import { enumValues, nodeElement, pickedElements } from '../src/client/ui/model/change-here.js';
import { removeDir } from './support/cleanup.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
/** The code without its comments. */
const code = (p: string) =>
  read(p)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join('\n');
const SHA = '0123456789abcdef0123456789abcdef01234567';

const pull = (o: Partial<ChangePull> & { number: number }): ChangePull => ({ title: `PR ${o.number}`, body: '', state: 'OPEN', url: `https://github.com/o/r/pull/${o.number}`, headRefName: `office/ada-${o.number}`, createdAt: new Date(2026, 9, 14, 12).toISOString(), ...o });

interface Sent {
  member: ChangeMember;
  text: string;
  o: { by: string; when: string; id: string; onSent: () => void };
}

function harness(o: { members?: ChangeMember[]; pulls?: ChangePull[]; refuse?: string } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-mcr-'));
  const sent: Sent[] = [];
  const audits: AuditInput[] = [];
  const state = { pulls: o.pulls ?? [], workers: new Map<string, { pr?: { number: number }; pastPrs?: number[] }>() };
  const deps: ChangeDeps = {
    dataDir,
    now: () => Date.UTC(2026, 9, 14, 11),
    members: () => o.members ?? [{ role: 'lead-developer', name: 'Ada', workerId: 'w-ada', atWork: true }, { role: 'lead-designer', name: 'Dora', workerId: 'w-dora', atWork: true }, { role: 'lead-tester', name: 'Tess', atWork: false }],
    deliver(_f, member, text, opts) {
      if (o.refuse) return { status: 'refused', why: o.refuse };
      sent.push({ member, text, o: opts });
      return { status: opts.when === 'now' ? 'sent' : 'held' };
    },
    pulls: () => state.pulls,
    worker: (_f, id) => state.workers.get(id),
    record: (e) => audits.push(e),
  };
  return { svc: new ChangeRequests(deps), sent, audits, state, dataDir, done: () => removeDir(dataDir) };
}

test('the task text names the element(s) with qualified names and kinds, the branch and commit, the request and how to do it', () => {
  const text = changeTaskText({ id: 'MCR-4', elements: [{ kind: 'attribute', qn: 'Travel.Request.StartDate' }, { kind: 'attribute', qn: 'Travel.Request.EndDate' }], ref: 'office/ada-12', sha: SHA, request: 'make them required', by: 'Maurits' });
  assert.match(text.split('\n')[0], /^Model change request MCR-4: Travel\.Request\.StartDate and 1 more: make them required$/);
  assert.match(text, /```model-change-request\nid: MCR-4\nbranch: office\/ada-12\ncommit: 0123456789abcdef0123456789abcdef01234567\nelements:\n {2}- Travel\.Request\.StartDate \(attribute\)\n {2}- Travel\.Request\.EndDate \(attribute\)\nrequest: \|\n {2}make them required\n```/);
  assert.match(text, /Make this change with mxcli on a branch \(never on main directly\), run mx check, open a PR that names the element\(s\)\./);
  assert.match(text, /escalate before changing/);
  assert.match(text, /data loss, security, a rename that breaks references/);
  assert.match(text, /"MCR-4" in the PR's title or description/);
  // Impact as the agent's own step, never run by the office.
  assert.match(text, /impact skill, or `mxcli refs` \/ `mxcli impact` on `Travel\.Request\.StartDate`, `Travel\.Request\.EndDate` \(they write only the git-ignored catalog\)/);
});

test('the service types that text to the member: the selection and the commit it was read at', () => {
  const h = harness();
  try {
    const r = h.svc.request('f1', { elements: [{ kind: 'enumvalue', qn: 'Travel.Status.Draft' }], ref: 'main', sha: SHA, request: 'add a Cancelled value', role: 'lead-developer', by: 'Maurits' });
    assert.ok(typeof r !== 'string', String(r));
    assert.equal(r.id, 'MCR-1');
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].member.name, 'Ada');
    assert.match(h.sent[0].text, /Travel\.Status\.Draft \(enumeration value\)/);
    assert.match(h.sent[0].text, new RegExp(`commit: ${SHA}`));
    assert.match(h.sent[0].text, /branch: main/);
    assert.match(h.sent[0].text, /add a Cancelled value/);
    // The next one is MCR-2, and both are kept in the office's data across a restart.
    const again = h.svc.request('f1', { elements: [{ kind: 'page', qn: 'Travel.Request_Edit' }], ref: 'main', request: 'add a Notes field', role: 'lead-developer', by: 'Maurits' });
    assert.ok(typeof again !== 'string' && again.id === 'MCR-2');
    const fresh = new ChangeRequests({ ...(h.svc as unknown as { deps: ChangeDeps }).deps });
    assert.deepEqual(fresh.list('f1').map((x) => x.id), ['MCR-2', 'MCR-1']);
  } finally {
    h.done();
  }
});

test('requests that make no sense are refused before anything is sent', () => {
  const h = harness();
  try {
    const ask = { elements: [{ kind: 'entity', qn: 'Travel.Request' }], ref: 'main', request: 'rename to Trip', role: 'lead-developer', by: 'M' };
    assert.match(String(h.svc.request('f1', { ...ask, request: '  ' })), /Say what should change/);
    assert.match(String(h.svc.request('f1', { ...ask, elements: [] })), /Pick an element/);
    assert.match(String(h.svc.request('f1', { ...ask, elements: [{ kind: 'domainmodel', qn: 'Travel' }] })), /qualified name/);
    assert.match(String(h.svc.request('f1', { ...ask, role: 'lead-tester' })), /Tess isn't at work/);
    assert.match(String(h.svc.request('f1', { ...ask, ref: '../../etc' })), /branch name looks wrong/);
    assert.match(String(h.svc.request('f1', { ...ask, sha: 'not a sha' })), /commit looks wrong/);
    assert.equal(h.sent.length, 0);
    assert.deepEqual(cleanElements([{ kind: 'attribute', qn: 'A.B.C' }, { kind: 'attribute', qn: 'A.B.C' }]), [{ kind: 'attribute', qn: 'A.B.C' }]);
  } finally {
    h.done();
  }
});

test('routing follows coverage: development changes to whoever covers Development, a page’s look to Design', () => {
  const page = [{ kind: 'page' as const, qn: 'Travel.Request_Edit' }];
  const attr = [{ kind: 'attribute' as const, qn: 'Travel.Request.Title' }];
  const all: RoleId[] = ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst', 'solo-lead'];
  assert.equal(changeTeam(attr, 'change the colour'), 'development', 'an attribute is development whatever the words');
  assert.equal(changeTeam(page, 'change its look and spacing'), 'design');
  assert.equal(changeTeam(page, 'add a Notes field'), 'development');
  assert.equal(defaultMember(defaultCoverage('enterprise'), attr, 'make it required', all), 'lead-developer');
  assert.equal(defaultMember(defaultCoverage('enterprise'), page, 'change the button style', all), 'lead-designer');
  assert.equal(defaultMember(defaultCoverage('startup'), page, 'change the button style', all), 'chief-analyst', 'Startup: the Chief Analyst covers Design');
  assert.equal(defaultMember(defaultCoverage('startup'), attr, 'rename', all), 'lead-developer');
  assert.equal(defaultMember(defaultCoverage('solo'), page, 'its look', all), 'solo-lead');
  // Design not hired: whoever covers Development; nobody covering either: the first hired.
  assert.equal(defaultMember(defaultCoverage('enterprise'), page, 'its look', ['lead-developer', 'pm']), 'lead-developer');
  assert.equal(defaultMember(defaultCoverage('enterprise'), attr, 'rename', ['lead-tester']), 'lead-tester');
  assert.equal(defaultMember(defaultCoverage('enterprise'), attr, 'rename', []), undefined);
  // The dialog's default is defaultMember over the roster's coverage and its hired members.
  const dialog = read('src/client/ui/model/change-this.ts');
  assert.match(dialog, /defaultMember\(coverageOf\(roster\), o\.elements, text\.value, hired\)/);
  assert.ok(chipsFor(page).includes('Change its look'));
  assert.ok(chipsFor([{ kind: 'enumeration', qn: 'A.B' }]).includes('Add value'));
  assert.ok(chipsFor(attr).includes('Make required') && chipsFor(attr).includes('Change default'));
});

test('the held delivery is the default: after their current turn unless the person says now', () => {
  const after = deliveryOpts('after', 'Maurits', 'id1', () => {});
  assert.equal(after.origin, 'person');
  assert.equal(after.hold, true);
  assert.equal(after.between, true, 'held for the end of the turn under way');
  assert.equal(after.wake, true);
  assert.equal(after.id, 'id1');
  const now = deliveryOpts('now', 'Maurits', 'id1', () => {});
  assert.equal(now.between, undefined, 'now goes into the turn');
  assert.equal(now.hold, true, 'still held while a dialog is up');
  const h = harness();
  try {
    const r = h.svc.request('f1', { elements: [{ kind: 'microflow', qn: 'Travel.ACT_Submit' }], ref: 'main', request: 'add a validation for the dates', role: 'lead-developer', by: 'M' });
    assert.ok(typeof r !== 'string');
    assert.equal(h.sent[0].o.when, 'after', 'no "when" means after their turn');
    assert.equal(r.delivery, 'held');
    // Once it's typed, the kept request says so.
    h.sent[0].o.onSent();
    assert.equal(h.svc.list('f1')[0].delivery, 'sent');
    // The wiring passes it through the roster's delivery with these options, and the dialog defaults to after.
    assert.match(read('src/server/model-change/index.ts'), /roster\.delivery\.send\(tf, w, text, deliveryOpts\(o\.when, o\.by, o\.id, onSent\)\)/);
    assert.match(read('src/client/ui/model/change-this.ts'), /let when: ChangeWhen = 'after';/);
  } finally {
    h.done();
  }
});

test('audit: every request is recorded as model.change-requested, with the elements and the commit', () => {
  const h = harness();
  try {
    h.svc.request('f1', { elements: [{ kind: 'entity', qn: 'Travel.Request' }], ref: 'office/ada-3', sha: SHA, request: 'rename to Trip', role: 'lead-developer', when: 'now', by: 'Maurits', owner: 'acc-1' });
    assert.equal(h.audits.length, 1);
    const e = h.audits[0];
    assert.equal(e.action, 'model.change-requested');
    assert.equal(e.floor, 'f1');
    assert.deepEqual(e.actor, { kind: 'human', name: 'Maurits', id: 'acc-1' });
    assert.equal(e.target?.label, 'Ada');
    assert.match(e.summary, /Asked Ada to change Travel\.Request/);
    assert.deepEqual(e.details?.elements, [{ kind: 'entity', qn: 'Travel.Request' }]);
    assert.equal(e.details?.sha, SHA);
    assert.equal(e.details?.when, 'now');
    // A refused one isn't recorded.
    const r = harness({ refuse: 'Spend cap reached' });
    try {
      assert.equal(r.svc.request('f1', { elements: [{ kind: 'entity', qn: 'Travel.Request' }], ref: 'main', request: 'rename to Trip', role: 'lead-developer', by: 'M' }), 'Spend cap reached');
      assert.equal(r.audits.length, 0);
    } finally {
      r.done();
    }
  } finally {
    h.done();
  }
});

test('the badge shows while a request is open, links its PR when there is one, and clears once that PR merged', () => {
  const h = harness();
  try {
    const r = h.svc.request('f1', { elements: [{ kind: 'attribute', qn: 'Travel.Request.Title' }], ref: 'main', request: 'make it required', role: 'lead-developer', by: 'M' });
    assert.ok(typeof r !== 'string');
    let list = h.svc.list('f1');
    assert.equal(list.length, 1);
    assert.equal(list[0].state, 'open');
    assert.equal(list[0].pr, undefined);
    assert.equal(badgeText(list[0]), 'Change requested · Ada · MCR-1');
    assert.equal(openFor(list, 'Travel.Request').length, 1, 'the entity shows its attribute’s request');
    assert.equal(openFor(list, 'Travel.Request.Title', true).length, 1);
    assert.equal(openFor(list, 'Travel.Requester').length, 0, 'a name that only starts the same is another element');
    // The member opens a PR naming the request: the badge says its number.
    h.state.pulls = [pull({ number: 123, body: 'Makes Title required. MCR-1', headRefName: 'office/ada-123' }), pull({ number: 12, body: 'MCR-12' })];
    list = h.svc.list('f1');
    assert.equal(list[0].pr?.number, 123);
    assert.equal(list[0].pr?.branch, 'office/ada-123');
    assert.equal(badgeText(list[0]), 'Change requested · Ada · #123');
    // It merges: the request is gone from the open list (and from the badges).
    h.state.pulls = [pull({ number: 123, body: 'MCR-1', state: 'MERGED' })];
    list = h.svc.list('f1');
    assert.equal(list.length, 0);
    assert.equal(openFor(h.svc.list('f1', true), 'Travel.Request').length, 0);
    assert.equal(h.svc.list('f1', true)[0].state, 'merged');
  } finally {
    h.done();
  }
});

test('a PR that doesn’t name the request is linked by the member’s worker: its PR opened since the request', () => {
  const at = Date.UTC(2026, 9, 14, 11);
  const r = { id: 'MCR-7', at };
  const old = pull({ number: 40, createdAt: new Date(at - 86_400_000).toISOString() });
  const mine = pull({ number: 41, createdAt: new Date(at + 600_000).toISOString() });
  assert.equal(linkPull(r, [old, mine], { pr: { number: 40 } }), undefined, 'its PR from before is another task’s');
  assert.equal(linkPull(r, [old, mine], { pr: { number: 41 }, pastPrs: [40] })?.number, 41);
  assert.equal(linkPull(r, [old, mine], { pastPrs: [40, 41] })?.number, 41);
  assert.equal(linkPull(r, [pull({ number: 50, title: 'MCR-70 something' })], undefined), undefined, 'MCR-70 is not MCR-7');
  const req = { id: 'MCR-7', elements: [{ kind: 'entity', qn: 'A.B' }], ref: 'main', request: 'x', role: 'lead-developer', member: 'Ada', when: 'after', at, by: 'M', delivery: 'held' } as ChangeRequest;
  assert.equal(requestView(req, [{ ...mine, state: 'CLOSED' }], { pr: { number: 41 } }).state, 'closed', 'closed unmerged stays until it’s settled');
});

test('View change opens the Model tab’s branch diff for the PR’s branch, with Changes in this branch on', async () => {
  const { installFakeDom } = await import('./support/fakedom.js');
  installFakeDom();
  const { ChangeHere } = await import('../src/client/ui/model/change-here.js');
  const views = [{ id: 'MCR-1', elements: [{ kind: 'entity', qn: 'Travel.Request' }], ref: 'main', request: 'rename', role: 'lead-developer', member: 'Ada', when: 'after', at: 1, by: 'M', delivery: 'sent', state: 'open', pr: { number: 123, url: 'u', branch: 'office/ada-123', state: 'OPEN' } }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ requests: views }) })) as unknown as typeof fetch;
  try {
    const opened: string[] = [];
    let marks: ((n: { type: string; qn?: string; label: string }) => string | undefined) | undefined;
    const here = new ChangeHere({
      floor: () => 'f1',
      ref: () => 'main',
      sha: () => SHA,
      picked: () => ({ doc: null, open: null, selected: null }),
      redraw: () => {},
      viewBranch: (b) => opened.push(b),
      fallback: () => document.body as unknown as HTMLElement,
      marks: (fn) => (marks = fn as typeof marks),
    });
    await here.load();
    const badge = here.badges('Travel.Request');
    assert.ok(badge);
    assert.match(badge.textContent ?? '', /Change requested · Ada · #123/);
    const view = badge.querySelector('.mx-creq-view') as unknown as { click(): void; textContent: string };
    assert.equal(view.textContent, 'View change');
    view.click();
    assert.deepEqual(opened, ['office/ada-123']);
    assert.equal(marks?.({ type: 'entity', qn: 'Travel.Request', label: 'Request' }), 'Change requested · Ada · #123', 'the tree row is marked');
    assert.equal(marks?.({ type: 'module', qn: 'Travel', label: 'Travel' }), undefined, 'a module is not an element');
    // The tab's viewBranch turns Changes in this branch on and loads that branch.
    const tab = read('src/client/ui/model/index.ts');
    assert.match(tab, /function viewBranch\(branch: string\) \{\n {4}ref = branch;\n {4}treeSha = undefined;\n {4}changesOn = changesBox\.checked = true;/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('what Change this acts on: the element clicked, the ticked attributes or values, the document on show, a tree row', () => {
  const dm = { kind: 'domainmodel', module: 'Travel', source: 'units', annotations: [], entities: [{ id: 'e1', name: 'Request', kind: 'persistent', x: 0, y: 0, attrs: [{ name: 'Title', type: 'String' }, { name: 'Start', type: 'Date' }, { name: 'End', type: 'Date' }] }], associations: [{ id: 'a1', name: 'Request_Employee', parent: 'e1', child: 'e2', type: 'Reference', owner: 'Default' }] } as never;
  const open = { type: 'domainmodel', qn: 'Travel' };
  assert.deepEqual(pickedElements({ doc: dm, open, selected: null, ticked: new Set() }), []);
  assert.deepEqual(pickedElements({ doc: dm, open, selected: 'e1', ticked: new Set() }), [{ kind: 'entity', qn: 'Travel.Request' }]);
  assert.deepEqual(pickedElements({ doc: dm, open, selected: 'e1', ticked: new Set(['Travel.Request.Title', 'Travel.Request.Start', 'Travel.Request.End']) }).map((e) => e.qn), ['Travel.Request.Title', 'Travel.Request.Start', 'Travel.Request.End']);
  assert.deepEqual(pickedElements({ doc: dm, open, selected: 'a1', ticked: new Set() }), [{ kind: 'association', qn: 'Travel.Request_Employee' }]);
  const enumDoc = { kind: 'text', type: 'enumeration', name: 'Travel.Status', mdl: "CREATE ENUMERATION Travel.Status (\n  Draft 'Draft',\n  Submitted 'Submitted'\n);" } as never;
  assert.deepEqual(enumValues("CREATE ENUMERATION Travel.Status (\n  Draft 'Draft',\n  Submitted 'Submitted'\n);"), ['Draft', 'Submitted']);
  assert.deepEqual(pickedElements({ doc: enumDoc, open: { type: 'enumeration', qn: 'Travel.Status' }, selected: null, ticked: new Set() }), [{ kind: 'enumeration', qn: 'Travel.Status' }]);
  assert.deepEqual(pickedElements({ doc: enumDoc, open: { type: 'enumeration', qn: 'Travel.Status' }, selected: null, ticked: new Set(['Travel.Status.Submitted']) }), [{ kind: 'enumvalue', qn: 'Travel.Status.Submitted' }]);
  const flow = { kind: 'nanoflow', name: 'Travel.NAV_Home', nodes: [], edges: [], mdl: '', source: 'units' } as never;
  assert.deepEqual(pickedElements({ doc: flow, open: { type: 'nanoflow', qn: 'Travel.NAV_Home' }, selected: 'n1', ticked: new Set() }), [{ kind: 'nanoflow', qn: 'Travel.NAV_Home' }]);
  assert.deepEqual(nodeElement({ type: 'constant', qn: 'Travel.MaxDays' }), { kind: 'constant', qn: 'Travel.MaxDays' });
  assert.equal(nodeElement({ type: 'module', qn: 'Travel' }), null);
  assert.equal(nodeElement({ type: 'folder' }), null);
});

test('no office-side writes to the model or the repository: only the office’s own data folder', () => {
  const h = harness();
  const repo = mkdtempSync(path.join(tmpdir(), 'ao-mcr-repo-'));
  try {
    writeFileSync(path.join(repo, 'App.mpr'), 'model');
    const before = readdirSync(repo);
    h.svc.request('f1', { elements: [{ kind: 'entity', qn: 'Travel.Request' }], ref: 'main', request: 'rename to Trip', role: 'lead-developer', by: 'M' });
    assert.deepEqual(readdirSync(repo), before);
    assert.equal(readFileSync(path.join(repo, 'App.mpr'), 'utf8'), 'model');
    assert.deepEqual(readdirSync(h.dataDir), ['model-change']);
    // Nothing in the feature runs a process, git, gh or mxcli, or writes outside the data folder.
    for (const f of ['src/server/model-change/service.ts', 'src/server/model-change/index.ts', 'src/server/http/routes/model-change.ts', 'src/shared/model-change.ts', 'src/client/ui/model/change-here.ts', 'src/client/ui/model/change-this.ts']) {
      const src = code(f);
      assert.doesNotMatch(src, /child_process|execFile|spawn\(|from '\.\.\/github\.js'|\bgh\(|mxcliRun|runMxcli|ModelService/, `${f} runs nothing`);
    }
    assert.doesNotMatch(code('src/server/model-change/service.ts'), /floor\.dir|\.mpr/);
  } finally {
    h.done();
    removeDir(repo);
  }
});
