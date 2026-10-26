// The Studio Pro hand-add gate (a migration project, 2026-10-16): an agent's escalation asking for a Studio Pro
// hand-add, or saying mxcli can't do something, with no `Tried:` section goes back to the agent through the
// escalate tool's reply, audited (escalation.handadd-returned) and not stored, so nothing waits on the
// Project Manager. With a `Tried:` section it's raised as usual and its card shows the section first. Ones
// the office files itself, and ones already open, are untouched. The Playbook line and the workarounds list
// it points to. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { AuditInput } from '../src/shared/audit.js';
import type { Escalation, EscalationAsk } from '../src/shared/roster/escalation.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { HANDADD_PATTERNS, HANDADD_RETURN, WORKAROUNDS_LOCAL_PATH, WORKAROUNDS_PATH, asksHandAdd, handAddMatches, handAddReturn, triedItems } from '../src/shared/roster/handadd.js';
import { collectDecisions } from '../src/shared/needsyou.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { useAudit } from '../src/server/audit/index.js';
import { handAddReturned } from '../src/server/roster/handadd-gate.js';
import { playbook, writeRoleFiles } from '../src/server/roster/playbooks.js';
import { LOCAL_SEED, TRY_FIRST, officeWorkarounds } from '../src/server/roster/playbook-workarounds.js';
import { ROLES } from '../src/shared/roster/roles.js';
import { ESCALATE_TOOL } from '../bin/office-escalate.js';
import { handleMcp } from '../bin/office-workers.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'handadd-floor-'));
  map = new Map<string, WorkerInfo>();
  feed: string[] = [];
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no';
  stop = async () => {};
  prompt = () => {};
  wake = () => undefined;
  rename = () => {};
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = (t: string) => void this.feed.push(t);
  judged = () => {};
}

function setup() {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'handadd-data-')), floors: () => [floor], makeIssue: async () => ({ number: 7 }), analysis: () => '', now: () => Date.now() }, 0);
  const w = { id: 'w1', kind: 'agent', name: 'Linus', status: 'idle', viewers: [] } as unknown as WorkerInfo;
  floor.map.set(w.id, w);
  const ask = (title: string, details: string, o: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'important', trigger: 'needs-human' as never, title, details, options: [], ...o });
  const view = (escalations: Escalation[] = roster.escalations.view(floor)) => ({ floor: floor.id, admin: true, escalations, approvals: [], members: [], settings: {} }) as unknown as RosterView;
  return { floor, roster, w, ask, view };
}

/** The office's escalate route, in order: the gate, then the roster (hooks/office-escalate.ts). */
async function escalate(t: ReturnType<typeof setup>, a: EscalationAsk) {
  const note = handAddReturned(t.floor, t.w, a);
  if (note) return { returned: true as const, note };
  return { returned: false as const, ...(await t.roster.escalations.raiseOrJoinJudged(t.floor, t.w, a)) };
}

const TRIED = ['Photo upload on Sheet_NewEdit needs an upload control.', '', 'Tried:', '- mxcli syntax widget: no upload widget listed', '- mxcli widget list -p App.mpr: no fileuploader', '- mxcli marketplace search "file uploader": 401 without a PAT', '- --engine legacy: MDL-WIDGET25 not a widget in this project'].join('\n');

test('the patterns catch hand-add asks and "mxcli can\'t", and nothing about Studio Pro in passing', () => {
  const yes = [
    'Studio Pro hand-add needed: photo upload control on Sheet_NewEdit',
    'Studio Pro hand-off: the image uploader',
    'Needs a hand add in Studio Pro',
    'Studio Pro needed for the upload control',
    'Studio Pro required: place the file manager',
    'Only in Studio Pro: conditional visibility on the tab',
    'This needs Studio Pro.',
    'Requires a Studio Pro step to add the chart',
    'Please add the widget manually in Studio Pro',
    'mxcli can’t place the image uploader',
    "mxcli doesn't support the file manager widget",
    'mxcli does not create pluggable widgets',
    'mxcli cannot configure the navigation profile',
    'Not supported by mxcli: data grid 2 column templates',
    'MDL cannot express the upload widget',
  ];
  const no = [
    'Studio Pro version check passed',
    'Open the app in Studio Pro to review the new page',
    'Studio Pro 11.12.4 installed on the build machine',
    'Merge PR #12: the Orders page',
    'mxcli check passed with 0 errors',
    'mxcli can place the data grid now (fixed in v0.21)',
    'Sign off CAC-3',
    'Handover pack for the customer is ready',
    'Stage 3 build plan: the hand-off to Testing is on Friday',
  ];
  for (const s of yes) assert.ok(asksHandAdd(s, ''), `caught: ${s}`);
  for (const s of no) assert.deepEqual(handAddMatches(s, ''), [], `not caught: ${s}`);
  // Every pattern has a name and catches something above.
  for (const p of HANDADD_PATTERNS) assert.ok(yes.some((s) => p.re.test(s)), `${p.name} is exercised`);
  // The details count too.
  assert.ok(asksHandAdd('Photo upload control', 'mxcli can\'t place it.'));
});

test('a Tried: section counts only with at least one item', () => {
  assert.deepEqual(triedItems(TRIED).length, 4);
  assert.deepEqual(triedItems('Tried: mxcli syntax widget (nothing), widget list (no uploader)'), ['mxcli syntax widget (nothing), widget list (no uploader)']);
  assert.deepEqual(triedItems('**Tried:**\n1. mxcli widget describe fileuploader: MDL-WIDGET25'), ['mxcli widget describe fileuploader: MDL-WIDGET25']);
  assert.deepEqual(triedItems('## Tried:\n- marketplace search: no result\n  (searched "upload" and "image")\n\nThe rest.'), ['marketplace search: no result (searched "upload" and "image")']);
  assert.deepEqual(triedItems('Tried:'), []);
  assert.deepEqual(triedItems('Tried: none'), []);
  assert.deepEqual(triedItems('Tried:\n\nSomething else'), []);
  assert.deepEqual(triedItems('I tried: nothing worked'), [], 'only a line starting with Tried:');
  assert.equal(handAddReturn({ title: 'Studio Pro hand-add needed: upload', details: TRIED }), undefined);
  assert.deepEqual(handAddReturn({ title: 'Studio Pro hand-add needed: upload', details: 'Tried: none' })?.matched, ['studio-pro-hand-add', 'hand-add']);
});

test('no Tried: section: handed back to the agent through the escalate reply, audited, not stored and not waiting on the person', async () => {
  const t = setup();
  const before = events.length;
  const r = await escalate(t, t.ask('Studio Pro hand-add needed: photo upload control on Sheet_NewEdit', 'mxcli cannot place the image uploader.'));
  assert.equal(r.returned, true);
  assert.equal(r.returned && r.note, HANDADD_RETURN);
  assert.match(HANDADD_RETURN, /^Before this reaches the Project Manager: list what you tried — mxcli syntax, widget list\/describe, a Marketplace search for a pluggable widget or module, --engine legacy, and the office's workarounds list — each with its exact error, in a `Tried:` section, then escalate again\./);
  assert.ok(HANDADD_RETURN.includes(WORKAROUNDS_PATH));
  const audited = events.slice(before).filter((e) => e.action === 'escalation.handadd-returned');
  assert.equal(audited.length, 1);
  assert.deepEqual((audited[0].details as { matched: string[] }).matched, ['studio-pro-hand-add', 'hand-add', 'mxcli-cant']);
  assert.equal(events.slice(before).some((e) => e.action === 'escalation.raise'), false, 'not raised');
  assert.equal(t.roster.data(t.floor.id).escalations.length, 0, 'nothing stored');
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view() });
  assert.equal(cards.length, 0, 'nothing waits on the Project Manager');
  assert.match(t.floor.feed.at(-1)!, /handed Linus's escalation back/);
});

test('with a Tried: section it is raised as usual, and its card shows the section', async () => {
  const t = setup();
  const r = await escalate(t, t.ask('Studio Pro hand-add needed: photo upload control on Sheet_NewEdit', TRIED));
  assert.equal(r.returned, false);
  const e = t.roster.data(t.floor.id).escalations[0];
  assert.equal(e.status, 'open');
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view() });
  const c = cards.find((x) => x.escalation === e.id)!;
  assert.deepEqual(c.tried, triedItems(TRIED));
  assert.equal(c.tried!.length, 4);
});

test('an ordinary escalation is untouched, and so are office-filed ones and ones already open', async () => {
  const t = setup();
  const r = await escalate(t, t.ask('Merge PR #12: the Orders page', 'Checks are green.'));
  assert.equal(r.returned, false);
  // Office-filed (handoff note, noticed, a subagent gate's FYI) never pass the gate.
  t.roster.escalations.raiseFor(t.floor, { workerId: 'w1', by: 'Linus' }, t.ask('Studio Pro hand-add needed: the chart', 'From the handoff note.'));
  t.roster.escalations.raiseFyi(t.floor, t.w, t.ask('mxcli can\'t place the chart widget', ''));
  assert.equal(t.roster.data(t.floor.id).escalations.length, 3);
  // One already open before the gate is shown as before, without a Tried: section.
  const old: Escalation = { id: 'old1', at: Date.now() - 3_600_000, workerId: 'w1', by: 'Linus', urgency: 'important', fyi: false, level: 2, title: 'Studio Pro hand-add needed: photo upload', details: 'mxcli can\'t place it.', options: [], refs: {}, status: 'open' };
  const { cards } = collectDecisions({ floor: t.floor.id, workers: [], pulls: [], floors: [], now: Date.now(), roster: t.view([old]) });
  assert.ok(cards.some((c) => c.escalation === 'old1'));
});

test('the office route gates before it raises, and the escalate tool shows the hand-back', async () => {
  const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'server', 'hooks', 'office-escalate.ts'), 'utf8');
  assert.ok(src.indexOf('handAddReturned(') > 0 && src.indexOf('handAddReturned(') < src.indexOf('raiseOrJoinJudged('));
  const io = {
    env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' },
    fetch: (async () => new Response(JSON.stringify({ ok: true, returned: true, note: HANDADD_RETURN }))) as unknown as typeof fetch,
  };
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'escalate', arguments: { title: 'Studio Pro hand-add needed' } } }, io);
  assert.equal(res?.result.content[0].text, `Escalation not raised: ${HANDADD_RETURN}`);
  assert.match(ESCALATE_TOOL.description, /Tried:/);
  assert.match(ESCALATE_TOOL.description, /mxcli marketplace search/);
});

test('the Playbook rule is in the building roles\' Playbooks only, and points to the workarounds list', () => {
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id.toUpperCase()])) as never;
  const pb = (id: (typeof ROLES)[number]['id']) => playbook(id, { project: 'p', name: 'N', level: 2, lessons: 'L.md', names });
  for (const id of ['lead-developer', 'lead-designer', 'solo-lead'] as const) assert.ok(pb(id).includes(TRY_FIRST), id);
  for (const id of ['pm', 'lead-tester', 'chief-analyst'] as const) assert.equal(pb(id).includes(TRY_FIRST), false, id);
  for (const s of ['mxcli syntax <topic>', 'mxcli widget list -p', 'mxcli widget describe', 'mxcli marketplace search', '--engine legacy', 'mxcli check -p', WORKAROUNDS_PATH, WORKAROUNDS_LOCAL_PATH, '`Tried:`']) assert.ok(TRY_FIRST.includes(s), s);
});

test('the workarounds list ships with the office, starts with image/file upload, and is copied into the project', () => {
  const list = officeWorkarounds();
  assert.ok(list, 'docs/mendix-workarounds.md is found');
  assert.match(list!, /## Image or file upload on a page/);
  for (const s of ['235351', 'Apache-2.0', '2.4.1', 'MDL-WIDGET25', 'office-marketplace add', 'Never install it yourself', 'mxcli widget init', 'fileuploader', 'System.Image', 'System.FileDocument', 'mxcli check -p', 'mxbuild', 'running app: not']) assert.ok(list!.includes(s), s);
  for (const s of ['**Problem:**', "**Why mxcli can't do it directly:**", '**Workaround:**', '**Verified with:**', '**Source:**']) assert.ok(list!.includes(s), s);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'handadd-proj-'));
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id.toUpperCase()])) as never;
  const wrote = writeRoleFiles(dir, 'lead-developer', { project: 'p', name: 'N', level: 2, lessons: 'L.md', names });
  assert.ok(wrote.includes(WORKAROUNDS_PATH) && wrote.includes(WORKAROUNDS_LOCAL_PATH));
  assert.equal(readFileSync(path.join(dir, WORKAROUNDS_PATH), 'utf8'), list);
  assert.equal(readFileSync(path.join(dir, WORKAROUNDS_LOCAL_PATH), 'utf8'), LOCAL_SEED);
  // The project's own list is never overwritten; a tester's files don't include either.
  writeFileSync(path.join(dir, WORKAROUNDS_LOCAL_PATH), `${LOCAL_SEED}\n## Our entry\n`);
  writeRoleFiles(dir, 'lead-developer', { project: 'p', name: 'N', level: 3, lessons: 'L.md', names });
  assert.match(readFileSync(path.join(dir, WORKAROUNDS_LOCAL_PATH), 'utf8'), /## Our entry/);
  const t = mkdtempSync(path.join(os.tmpdir(), 'handadd-proj-'));
  writeRoleFiles(t, 'lead-tester', { project: 'p', name: 'N', level: 2, lessons: 'L.md', names });
  assert.equal(existsSync(path.join(t, WORKAROUNDS_PATH)), false);
});
