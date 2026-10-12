// The New project planner (server/wizard/planner/): the Chief Analyst's planning calls under their caps
// (spend per draft, calls per hour, one request at a time per person), the fallback when it can't draft,
// attachments, the test planner, and test mode never calling the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { Planner, plannerConfig, type PlannerConfig } from '../src/server/wizard/planner/index.js';
import { fakeBrief, fakeChat, fakeDomains, fakeEngine } from '../src/server/wizard/planner/fake.js';
import type { PlannerEngine } from '../src/server/wizard/planner/engine.js';
import { cliEngine } from '../src/server/wizard/planner/engine.js';
import { cliArgs, parseAnswer, runPlannerCall } from '../src/server/wizard/planner/cli.js';
import { docxText, docxXmlText } from '../src/server/wizard/planner/docx.js';
import { useTestMode } from '../src/server/testmode.js';
import { counts } from '../src/shared/brief.js';

const me = { id: 'u1', name: 'Alex Lee' };
const cfg = (over: Partial<PlannerConfig> = {}): PlannerConfig => ({ mode: 'auto', model: 'sonnet', capUsd: 2, timeoutMs: 1000, perHour: 20, ...over });

function tmp(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-planner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An engine that answers like the test planner but costs `cost` per call, and can be told to fail. */
function paidEngine(cost: number, o: { why?: string; fail?: 'brief' | 'chat' | 'domains'; budgetHit?: boolean; hold?: Promise<void> } = {}): PlannerEngine & { calls: string[] } {
  const calls: string[] = [];
  const fails = (k: string) => o.fail === k;
  return {
    calls,
    kind: 'cli',
    model: 'sonnet',
    why: () => o.why,
    async brief(req) {
      calls.push('brief');
      await o.hold;
      return fails('brief') ? { value: null, cost, error: 'The call reached the draft’s planning budget and stopped', budgetHit: o.budgetHit } : { value: fakeBrief(req.files), cost };
    },
    async chat(req) {
      calls.push('chat');
      await o.hold;
      return fails('chat') ? { value: null, cost, error: 'boom' } : { value: fakeChat(req.brief, req.history, req.text), cost };
    },
    async domains() {
      calls.push('domains');
      await o.hold;
      return fails('domains') ? { value: null, cost, error: 'The call reached the draft’s planning budget and stopped', budgetHit: true } : { value: fakeDomains(), cost };
    },
  };
}

const settle = (p: Planner, id: string) => p.running.get(id) ?? Promise.resolve();

test('the test planner is deterministic and costs nothing', async () => {
  assert.deepEqual(fakeBrief([]), fakeBrief([]));
  assert.deepEqual(fakeDomains(), fakeDomains());
  const withDoc = fakeBrief([{ name: 'notes.md', path: 'x', text: 'hi' }, { name: 'scan.pdf', path: 'y' }]);
  assert.deepEqual(withDoc.filesRead, ['notes.md'], 'it never claims to have read a PDF');
  assert.ok(withDoc.brief.sections.success.some((x) => x.source === 'from notes.md p.2'));
  const e = fakeEngine(0);
  const a = await e.brief({ mode: 'plan', prompt: 'x', files: [], budgetUsd: 2 });
  const b = await e.brief({ mode: 'plan', prompt: 'something else entirely', files: [], budgetUsd: 2 });
  assert.deepEqual(a, b);
  assert.equal(a.cost, 0);
  assert.equal(counts(a.value!.brief).assumed, 3);
  assert.equal(counts(a.value!.brief).open, 2);
});

test('a draft with the test planner: draft, confirm, chat (a highlighted change), approve, domains', async (t) => {
  const p = new Planner(tmp(t), { engine: fakeEngine(0), config: cfg({ mode: 'fake' }) });
  assert.equal(p.status().fake, true);
  assert.equal(p.status().estimateUsd, 0);
  const d = p.create(me, { mode: 'plan', prompt: 'Visitor sign-in for our offices', interview: 'assist' });
  assert.equal(d.interview, 'assist');
  assert.equal(p.addFile(d, 'workshop.md', Buffer.from('# Workshop\nHosts approve.')), undefined);
  assert.equal(p.addFile(d, 'scan.pdf', Buffer.from('%PDF-1.4')), undefined);
  assert.deepEqual(d.attachments.map((a) => [a.name, a.read]), [['workshop.md', 'text'], ['scan.pdf', 'not-read']]);
  assert.match(d.attachments[1].note!, /test planner doesn’t read PDFs/);
  assert.equal(p.draft(d, me), undefined);
  assert.equal(d.status, 'drafting');
  await settle(p, d.id);
  assert.equal(d.status, 'ready');
  assert.equal(d.version, 1);
  assert.equal(d.brief!.title, 'Visitor Registration');
  assert.equal(d.chat.at(-1)!.who, 'ca');
  assert.equal(p.op(d, { op: 'confirm', id: 's2' }, me), undefined);
  assert.equal(d.brief!.sections.success[1].tag, 'answered');
  assert.equal(d.version, 2);
  assert.equal(p.chat(d, 'We also have a security desk', me), undefined);
  await settle(p, d.id);
  const reply = d.chat.at(-1)!;
  assert.match(reply.text, /Security officer/);
  assert.equal(reply.changed!.length, 1);
  assert.equal(d.brief!.sections.roles.at(-1)!.by?.how, 'chat');
  assert.equal(p.approve(d, me), undefined);
  assert.equal(d.approved!.by, 'Alex Lee');
  assert.equal(d.approved!.assumed, 2);
  await settle(p, d.id);
  assert.equal(d.domainsStatus, 'ready');
  assert.equal(d.domains!.domains.length, 4);
  assert.match(String(p.op(d, { op: 'confirm', id: 'r3' }, me)), /approved/);
  assert.equal(d.spent, 0);
  // Another person can't see it; a fresh planner over the same folder reads it back.
  assert.equal(p.get(d.id, { id: 'u2', name: 'B' }), undefined);
  const again = new Planner(path.dirname(p.drafts.dir), { engine: fakeEngine(0), config: cfg({ mode: 'fake' }) });
  assert.equal(again.get(d.id, me)?.brief?.title, 'Visitor Registration');
  assert.deepEqual(again.attachmentFiles(d.id).map((f) => f.name), ['workshop.md', 'scan.pdf']);
});

test('the spend cap: each call gets what the draft has left, a call that hits it keeps the brief so far and says so, and then planning stops', async (t) => {
  const e = paidEngine(0.9);
  const seen: number[] = [];
  const brief = e.brief.bind(e);
  e.brief = async (req) => (seen.push(req.budgetUsd), brief(req));
  const p = new Planner(tmp(t), { engine: e, config: cfg({ capUsd: 2 }) });
  const d = p.create(me, { prompt: 'x' });
  assert.equal(p.draft(d, me), undefined);
  await settle(p, d.id);
  assert.equal(seen[0], 2);
  assert.equal(d.spent, 0.9);
  assert.equal(p.chat(d, 'one more thing', me), undefined);
  await settle(p, d.id);
  assert.ok(Math.abs(d.spent - 1.8) < 1e-9);
  // The domains call reaches the cap: no domains, the brief is kept, a message says why.
  const f = paidEngine(0.2, { fail: 'domains' });
  (p as unknown as { engine: PlannerEngine }).engine = f;
  assert.equal(p.approve(d, me), undefined);
  await settle(p, d.id);
  assert.equal(d.domainsStatus, 'failed');
  assert.match(d.message!, /planning budget.*left to the BRDs at Stage 2/);
  assert.equal(d.brief!.title, 'Visitor Registration', 'the brief so far is kept');
  assert.ok(d.spent >= 1.99);
  // After the approval a message is noted for Discovery, without a planning call.
  const callsBefore = f.calls.length;
  assert.equal(p.chat(d, 'more?', me), undefined);
  assert.match(d.chat.at(-1)!.text, /scope change/);
  assert.equal(f.calls.length, callsBefore);
  const d2 = p.create(me, { prompt: 'y' });
  d2.spent = 2;
  assert.match(String(p.draft(d2, me)), /planning budget \(\$2\.00\) is used up: carry on by hand/);
});

test('a brief call that fails before anything was drafted says so and offers the brief by hand', async (t) => {
  const p = new Planner(tmp(t), { engine: paidEngine(0.5, { fail: 'brief', budgetHit: true }), config: cfg() });
  const d = p.create(me, { prompt: 'x' });
  p.draft(d, me);
  await settle(p, d.id);
  assert.equal(d.status, 'failed');
  assert.match(d.message!, /planning budget.*You can fill the brief in yourself/);
  assert.equal(d.spent, 0.5, 'what it spent is still counted');
});

test('the hourly cap and one request at a time per person', async (t) => {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const p = new Planner(tmp(t), { engine: paidEngine(0, { hold }), config: cfg({ perHour: 2 }) });
  const a = p.create(me, { prompt: 'a' });
  const b = p.create(me, { prompt: 'b' });
  assert.equal(p.draft(a, me), undefined);
  assert.match(String(p.draft(b, me)), /still working on your last request/, 'one at a time, even on another draft');
  const other = { id: 'u2', name: 'Sam' };
  const c = p.create(other, { prompt: 'c' });
  assert.equal(p.draft(c, other), undefined, 'someone else may draft meanwhile');
  release();
  await settle(p, a.id);
  await settle(p, c.id);
  assert.match(String(p.draft(b, me)), /capped at 2 an hour/);
  assert.equal(p.status().available, false);
  assert.match(p.status().why!, /capped at 2 an hour/);
});

test('when the Chief Analyst can’t draft, the page is told why and the brief is filled in by hand', (t) => {
  const p = new Planner(tmp(t), { engine: paidEngine(0, { why: 'The office can’t find the claude CLI on its machine' }), config: cfg() });
  const s = p.status();
  assert.equal(s.available, false);
  assert.match(s.why!, /claude CLI/);
  const d = p.create(me, { prompt: 'x' });
  assert.match(String(p.draft(d, me)), /claude CLI/);
  p.manual(d);
  assert.equal(d.manual, true);
  assert.equal(d.status, 'ready');
  assert.equal(d.brief!.sections.goal.length, 0);
  assert.equal(p.op(d, { op: 'add', section: 'goal', text: 'Sign visitors in fast' }, me), undefined);
  assert.equal(d.brief!.sections.goal[0].tag, 'answered');
  assert.equal(p.op(d, { op: 'title', text: 'Visitor Registration' }, me), undefined);
  assert.equal(p.approve(d, me), undefined);
  assert.equal(d.domainsStatus, 'skipped', 'no AI for a brief by hand');
  const off = new Planner(tmp(t), { engine: fakeEngine(0), config: cfg({ mode: 'off' }) });
  assert.match(off.status().why!, /switched off/);
  assert.equal(plannerConfig({ AGENT_OFFICE_PLANNER: 'fake', AGENT_OFFICE_PLANNER_CAP_USD: '0.5', AGENT_OFFICE_PLANNER_MODEL: 'haiku' }).capUsd, 0.5);
  assert.equal(plannerConfig({}).model, 'sonnet');
  assert.equal(plannerConfig({ AGENT_OFFICE_PLANNER_MODEL: 'x; rm -rf' }).model, 'sonnet');
});

test('the start page’s estimate comes from the configured model’s prices', (t) => {
  const sonnet = new Planner(tmp(t), { engine: paidEngine(0), config: cfg({ model: 'sonnet' }) }).status();
  const opus = new Planner(tmp(t), { engine: paidEngine(0), config: cfg({ model: 'opus' }) }).status();
  assert.ok(sonnet.estimateUsd > 0.05 && sonnet.estimateUsd < 0.5, String(sonnet.estimateUsd));
  assert.ok(opus.estimateUsd > sonnet.estimateUsd);
  assert.equal(sonnet.capUsd, 2);
});

test('attachments: limits and types are enforced on the server, and a .docx is read as its text', (t) => {
  const p = new Planner(tmp(t), { engine: fakeEngine(0), config: cfg({ mode: 'fake' }) });
  const d = p.create(me, { prompt: 'x' });
  assert.match(String(p.addFile(d, 'pic.png', Buffer.from('x'))), /only/);
  assert.match(String(p.addFile(d, 'big.md', Buffer.alloc(5 * 1024 * 1024 + 1, 97))), /at most 5 MB/);
  for (let i = 0; i < 5; i++) assert.equal(p.addFile(d, `n${i}.txt`, Buffer.from('hello')), undefined);
  assert.match(String(p.addFile(d, 'n6.txt', Buffer.from('x'))), /At most 5 files/);
  assert.equal(p.addFile(d, 'n0.txt', Buffer.from('replaced')), undefined, 'the same name replaces');
  p.removeFile(d, 'n0.txt');
  assert.equal(d.attachments.length, 4);
  const docx = zip('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Visitors sign in</w:t></w:r><w:r><w:t xml:space="preserve"> at reception &amp; kiosk</w:t></w:r></w:p><w:p><w:r><w:t>Hosts approve</w:t></w:r></w:p></w:body></w:document>');
  assert.equal(docxText(docx), 'Visitors sign in at reception & kiosk\nHosts approve');
  assert.equal(p.addFile(d, 'spec.docx', docx), undefined);
  assert.equal(d.attachments.at(-1)!.read, 'extracted');
  assert.equal(docxText(Buffer.from('not a zip')), undefined);
  assert.equal(docxXmlText('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>'), 'a\tb');
});

test('test mode never calls the CLI: the real planner is refused before anything starts', async (t) => {
  useTestMode({ flag: true, agentCmd: 'fake-claude.exe', agentExplicit: true });
  t.after(() => useTestMode(undefined));
  let ran = 0;
  const runner = async () => (ran++, { code: 0, out: '{}', timedOut: false });
  const r = await runPlannerCall('C:\\Users\\me\\.local\\bin\\claude.exe', {}, { model: 'sonnet', system: 's', input: 'i', schema: {}, timeoutMs: 1000, budgetUsd: 2 }, runner);
  assert.equal(ran, 0);
  assert.match(r.error!, /Test mode/);
  // The office's own planner in a test office: unavailable, so the page offers the brief by hand.
  const p = new Planner(tmp(t), { config: cfg() });
  assert.equal(p.status().available, false);
  assert.match(p.status().why!, /Test mode: this office only drafts with the test planner/);
  const d = p.create(me, { prompt: 'x' });
  assert.match(String(p.draft(d, me)), /Test mode/);
  // And the test planner is what runs there.
  assert.equal(new Planner(tmp(t), { config: cfg({ mode: 'fake' }) }).status().available, true);
  // An engine handed the real CLI still asks before every call.
  const e = cliEngine({ claude: 'C:\\x\\claude.exe', env: {}, model: 'sonnet', timeoutMs: 1000, run: runner });
  const out = await e.brief({ mode: 'plan', prompt: 'x', files: [], budgetUsd: 1 });
  assert.equal(out.value, null);
  assert.equal(ran, 0);
});

test('a planning call: print mode, the schema, the draft’s budget left, no tools unless a PDF has to be read (sandboxed)', async () => {
  const c = { model: 'sonnet', system: 's', input: 'i', schema: { type: 'object' }, timeoutMs: 1000, budgetUsd: 1.234 };
  const plain = cliArgs(c, false);
  assert.deepEqual(plain.slice(0, 3), ['-p', '--model', 'sonnet']);
  assert.equal(plain[plain.indexOf('--max-budget-usd') + 1], '1.23');
  assert.equal(plain[plain.indexOf('--tools') + 1], '');
  assert.ok(!plain.includes('--restricted'));
  assert.ok(plain.includes('--no-session-persistence') && plain.includes('--strict-mcp-config'));
  const files = cliArgs(c, true);
  assert.ok(files.includes('--restricted'));
  assert.equal(files[files.indexOf('--tools') + 1], 'Read');
  assert.equal(parseAnswer(JSON.stringify({ is_error: true, subtype: 'error_max_budget_usd', result: '' })).budgetHit, true);
  assert.deepEqual(parseAnswer(JSON.stringify({ structured_output: { title: 'x' } })).value, { title: 'x' });
  assert.match(parseAnswer('garbage').error!, /couldn’t be read/);
  // Outside test mode a run goes through the runner, with a fresh sandbox folder as its cwd, and is metered.
  let cwd = '';
  const r = await runPlannerCall('C:\\x\\claude.exe', {}, c, async (_c, _e, _a, _i, dir) => ((cwd = dir), { code: 0, out: JSON.stringify({ structured_output: { ok: 1 }, modelUsage: { 'claude-sonnet-4-5': { inputTokens: 1000, outputTokens: 1000 } } }), timedOut: false }));
  assert.match(path.basename(cwd), /^ao-planner-/);
  assert.deepEqual(r.value, { ok: 1 });
  assert.ok(r.cost > 0.01 && r.cost < 0.05, String(r.cost));
  const late = await runPlannerCall('C:\\x\\claude.exe', {}, c, async () => ({ code: null, out: '', timedOut: true }));
  assert.match(late.error!, /longer than 1 s/);
  assert.match((await runPlannerCall('C:\\x\\claude.exe', {}, { ...c, budgetUsd: 0 })).error!, /used up/);
});

test('drafts outlive a restart; one that was drafting says so; old ones are pruned', async (t) => {
  const dir = tmp(t);
  let release!: () => void;
  const p = new Planner(dir, { engine: paidEngine(0, { hold: new Promise<void>((r) => (release = r)) }), config: cfg() });
  const d = p.create(me, { prompt: 'x' });
  p.draft(d, me);
  const after = new Planner(dir, { engine: fakeEngine(0), config: cfg({ mode: 'fake' }) });
  const back = after.get(d.id, me)!;
  assert.equal(back.status, 'failed');
  assert.match(back.message!, /office restarted/);
  assert.equal(back.busy, undefined);
  release();
  await settle(p, d.id);
  const old = after.create(me, { prompt: 'old' });
  const at = new Date(Date.now() - 15 * 24 * 3_600_000);
  old.updatedAt = at.getTime();
  (after.drafts as unknown as { cache: Map<string, unknown> }).cache.set(old.id, old);
  utimesSync(path.join(after.drafts.dir, old.id), at, at);
  after.drafts.prune();
  assert.equal(after.drafts.get(old.id), undefined);
  assert.ok(after.drafts.get(d.id));
});

/** A zip of one stored-then-deflated file, enough for docxText. */
function zip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, 'utf8'));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, central, n, eocd]);
}
