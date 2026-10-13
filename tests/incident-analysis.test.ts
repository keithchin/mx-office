// Mx Office's analysis of a resolved incident (server/incidents/analysis.ts and its input and engines,
// shared/incident-analysis.ts, ui/incidents/analysis-logic.ts): resolving needs no cause; the test
// analyser fills root cause, impact and corrective actions from the evidence; a person's text is never
// overwritten (the analysis sits beside it); secrets are redacted before anything is sent; the cap per
// incident and the hourly limit refuse cleanly; failure, retry, a restart mid-run and a double resolve;
// test mode never calls the real CLI; the spend is metered as `incident` on the incident's floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AuditLog, audit, readAudit, useAudit } from '../src/server/audit/index.js';
import { IncidentStore, createIncident, updateIncident, useIncidents } from '../src/server/incidents/index.js';
import { IncidentAnalyzer, analysisConfig, useAnalyzer, type AnalysisConfig } from '../src/server/incidents/analysis.js';
import { analysisInput, floorEvents, gatherFacts } from '../src/server/incidents/analysis-input.js';
import { cliAnalysisEngine, fakeAnalysisEngine, type AnalysisAnswer, type AnalysisEngine } from '../src/server/incidents/analysis-engine.js';
import { incidentRoutes } from '../src/server/http/routes/incidents.js';
import { onBackgroundSpend, type BackgroundSpend } from '../src/server/budget/meter.js';
import { useTestMode } from '../src/server/testmode.js';
import { analysisView, DRAFTED_LABEL } from '../src/client/ui/incidents/analysis-logic.js';
import type { AnalysisResult } from '../src/shared/incident-analysis.js';

const T0 = Date.UTC(2026, 9, 13, 9, 0);
const ME = { kind: 'human' as const, name: 'Keith', id: 'acc1' };
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const CFG: AnalysisConfig = { mode: 'auto', model: 'sonnet', capUsd: 0.3, timeoutMs: 60_000, perHour: 20 };

function fresh(opts: { config?: Partial<AnalysisConfig>; engine?: AnalysisEngine } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'inc-analysis-'));
  const clock = { t: T0 };
  useAudit(new AuditLog(path.join(dir, 'audit'), { now: () => clock.t }));
  const store = new IncidentStore(path.join(dir, 'incidents'), () => clock.t);
  useIncidents(store, () => clock.t);
  // A test office: the default engine is the test analyser.
  useTestMode({ flag: true, agentCmd: 'claude', agentExplicit: false });
  const analyzer = new IncidentAnalyzer({ config: { ...CFG, ...opts.config }, engine: opts.engine, now: () => clock.t });
  useAnalyzer(analyzer);
  return { dir, clock, store, analyzer };
}

/** An incident a rule raised on a floor, with a linked audit event, resolved by Keith. */
function spike(o: { rootCause?: string; actions?: boolean; summary?: string } = {}) {
  const ev = audit.record({ floor: 'travel', actor: { kind: 'agent', name: 'Dylan', id: 'w1' }, action: 'worker.turn', summary: 'A turn of 40 minutes', details: { cost: 12.5 } })!;
  return createIncident({ title: 'Spend spike on travel-approval', severity: 'sev2', summary: o.summary ?? 'Spent $31 in an hour, 6× the average', floors: ['travel'], impact: { spendUsd: 31, agents: 1 }, workers: [{ name: 'Dylan', id: 'w1', floor: 'travel' }], auditIds: [ev.id], detectedBy: { kind: 'rule', name: 'Incident rules', rule: 'spendSpike' }, ...(o.rootCause ? { rootCause: o.rootCause } : {}), ...(o.actions ? { actions: [{ id: 'a1', text: 'Lower the daily cap', status: 'open' as const }] } : {}) }, ME)!;
}

function call(route: { handle: (...a: never[]) => unknown }, opts: { method?: string; path: string; body?: unknown }) {
  const req = Object.assign(Readable.from(opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]), { method: opts.method ?? 'GET', headers: { origin: 'http://office', host: 'office' } });
  let status = 0;
  let out: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => (out = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: true }) };
  const url = new URL(`http://office${opts.path}`);
  return Promise.resolve((route.handle as (...a: unknown[]) => unknown)(ctx, { req, res, url, path: url.pathname, session: { account: { id: 'acc1', name: 'Keith' } } })).then(() => ({ status, body: out as Record<string, any> }));
}
const resolve = (id: string, note?: string) => call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${id}`, body: { status: 'resolved', ...(note ? { note } : {}) } });

/** An engine the test steers: its answers in turn, how often it was asked, and the inputs it got. */
function steered(answers: (AnalysisAnswer | (() => Promise<AnalysisAnswer>))[]) {
  const inputs: string[] = [];
  const fake = fakeAnalysisEngine();
  const e: AnalysisEngine & { calls: number; inputs: string[] } = {
    kind: 'cli',
    model: 'sonnet',
    why: () => undefined,
    calls: 0,
    inputs,
    async analyse(req) {
      e.calls++;
      inputs.push(req.input);
      const a = answers[Math.min(e.calls - 1, answers.length - 1)];
      if (typeof a === 'function') return a();
      return a.value === undefined ? fake.analyse(req) : a;
    },
  };
  return e;
}
const OK = { value: undefined as unknown as null, cost: 0 }; // "the test analyser's answer"

test('resolving needs no cause: it’s resolved at once, and the test analyser fills root cause, impact and corrective actions', async () => {
  const { analyzer, store } = fresh();
  const i = spike();
  const r = await resolve(i.id, 'I think the cap was off');
  assert.equal(r.status, 200);
  assert.equal(r.body.incident.status, 'resolved');
  assert.equal(r.body.incident.analysis.status, 'pending');
  await analyzer.running.get(i.id);
  const done = store.get(i.id)!;
  const a = done.analysis!;
  assert.equal(a.status, 'done');
  assert.equal(a.model, 'test analyser');
  assert.deepEqual(a.drafted.sort(), ['actions', 'impact', 'rootCause']);
  assert.equal(a.note, 'I think the cap was off');
  assert.match(done.rootCause!, /Spend spike/);
  assert.match(done.rootCause!, /check it/);
  assert.match(done.impact.text!, /\$31\.00 spent/);
  assert.equal(done.impact.spendUsd, 31, 'the rule’s numbers stay');
  assert.equal(done.actions.length, 3);
  assert.deepEqual(done.actions.map((x) => x.kind), ['fix', 'prevent', 'detect']);
  assert.ok(['low', 'medium'].includes(a.result!.rootCause.confidence), 'the test analyser never claims high confidence');
  assert.ok(a.result!.unknowns.length > 0);
  assert.ok(done.timeline.some((t) => /drafted an analysis/.test(t.text)));
  assert.ok(readAudit({ limit: 50, actions: ['incident.analysed'] }).events.length === 1);
  // The page: each field labelled as the analysis's draft, its confidence and what it can't tell.
  const v = analysisView(done);
  assert.equal(v.state, 'done');
  assert.ok(v.fields.rootCause.drafted && v.fields.impact.drafted && v.fields.actions.drafted);
  assert.match(v.line!, /not proof: check it/);
  assert.match(DRAFTED_LABEL, /check it/);
});

test('a person’s text is never overwritten: the analysis sits beside it, and a field the person edits is theirs', async () => {
  const { analyzer, store } = fresh();
  const i = spike({ rootCause: 'The cap was switched off by me', actions: true });
  await resolve(i.id);
  await analyzer.running.get(i.id);
  let done = store.get(i.id)!;
  assert.equal(done.rootCause, 'The cap was switched off by me');
  assert.deepEqual(done.actions.map((x) => x.text), ['Lower the daily cap']);
  assert.deepEqual(done.analysis!.drafted, ['impact']);
  const v = analysisView(done);
  assert.equal(v.fields.rootCause.drafted, false);
  assert.match(v.fields.rootCause.suggestion!, /Spend spike/);
  assert.match(v.fields.actions.suggestion!, /^Fix: /);
  // The person rewrites the impact: it's theirs now; a retry doesn't touch it.
  done = updateIncident(i.id, { impact: { ...done.impact, text: 'Only this project' } }, ME)!;
  assert.deepEqual(done.analysis!.drafted, []);
  store.put({ ...done, analysis: { ...done.analysis!, status: 'failed', error: 'x' } }, 'update', 'test');
  analyzer.start(i.id, 'Keith');
  await analyzer.running.get(i.id);
  done = store.get(i.id)!;
  assert.equal(done.impact.text, 'Only this project');
  assert.equal(done.rootCause, 'The cap was switched off by me');
  // Marking an action done isn't rewriting it.
  const drafted = createIncident({ title: 'Other', severity: 'sev3', floors: ['travel'] }, ME)!;
  await resolve(drafted.id);
  await analyzer.running.get(drafted.id);
  const d = store.get(drafted.id)!;
  const marked = updateIncident(d.id, { actions: d.actions.map((x, n) => (n ? x : { ...x, status: 'done' as const })) }, ME)!;
  assert.ok(marked.analysis!.drafted.includes('actions'));
});

test('secrets are redacted before anything is sent, and the input is capped', async () => {
  const e = steered([OK]);
  const { analyzer, store } = fresh({ engine: e });
  const i = spike({ summary: `Leaked ${TOKEN} in a log, password: hunter2hunter2` });
  await resolve(i.id, `token=${TOKEN}`);
  await analyzer.running.get(i.id);
  assert.equal(e.calls, 1);
  assert.ok(!e.inputs[0].includes(TOKEN), 'the planted token never leaves');
  assert.ok(!e.inputs[0].includes('hunter2hunter2'));
  assert.match(e.inputs[0], /\[redacted\]/);
  // Many nearby events: still under the cap, the nearby ones dropped first.
  for (let n = 0; n < 200; n++) audit.record({ floor: 'travel', actor: { kind: 'agent', name: 'Dylan' }, action: 'worker.turn', summary: `turn ${n} ${'x'.repeat(400)}` });
  const inc = store.get(i.id)!;
  const facts = gatherFacts(inc, floorEvents(inc));
  assert.ok(facts.nearby.length <= 40);
  const { text } = analysisInput(facts);
  assert.ok(text.length <= 24_100);
});

test('the cap per incident and the hourly limit refuse cleanly, and say so on the incident', async () => {
  const e = steered([{ ...(await fakeAnalysisEngine().analyse({ facts: dummyFacts(), input: '', budgetUsd: 1 })), cost: 0.3 }]);
  const { analyzer, store } = fresh({ engine: e, config: { capUsd: 0.3, perHour: 2 } });
  const a = spike();
  await resolve(a.id);
  await analyzer.running.get(a.id);
  assert.equal(store.get(a.id)!.analysis!.costUsd, 0.3);
  // Its cap is spent: a retry is refused without a call.
  store.put({ ...store.get(a.id)!, analysis: { ...store.get(a.id)!.analysis!, status: 'failed' } }, 'update', 'test');
  const again = await call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${a.id}/analyse` });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /reached their \$0\.30 cap/);
  assert.equal(e.calls, 1);
  // Two an hour across the office: the third incident's is refused and recorded as failed, ready to retry.
  const b = spike();
  await resolve(b.id);
  await analyzer.running.get(b.id);
  const c = spike();
  const r = await resolve(c.id);
  assert.equal(r.body.incident.status, 'resolved', 'still resolved');
  assert.equal(r.body.incident.analysis.status, 'failed');
  assert.match(r.body.incident.analysis.error, /capped at 2 an hour/);
  assert.equal(e.calls, 2);
  assert.equal(analysisView(store.get(c.id)!).retry, true);
});

function dummyFacts() {
  const { store } = fresh();
  void store;
  const i = spike();
  return gatherFacts(i, []);
}

test('a failed analysis leaves it resolved with the reason and Retry; the retry runs once more', async () => {
  const e = steered([{ value: null, cost: 0.01, error: 'claude exited 1' }, OK]);
  const { analyzer, store } = fresh({ engine: e });
  const i = spike();
  await resolve(i.id);
  await analyzer.running.get(i.id);
  let x = store.get(i.id)!;
  assert.equal(x.status, 'resolved');
  assert.equal(x.analysis!.status, 'failed');
  assert.equal(analysisView(x).line, 'Analysis didn’t finish: claude exited 1');
  assert.equal(analysisView(x).retry, true);
  assert.equal(x.rootCause, undefined);
  const r = await call(incidentRoutes.one, { method: 'POST', path: `/api/incidents/${i.id}/analyse` });
  assert.equal(r.status, 200);
  await analyzer.running.get(i.id);
  x = store.get(i.id)!;
  assert.equal(x.analysis!.status, 'done');
  assert.equal(x.analysis!.attempts, 2);
  assert.equal(x.analysis!.costUsd, 0.01);
  assert.ok(x.rootCause);
  assert.deepEqual(readAudit({ limit: 50, actions: ['incident.analysed'] }).events.map((ev) => ev.details?.analysis).sort(), ['done', 'failed']);
});

test('a restart mid-run leaves it failed and retryable; a double resolve never runs two analyses', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const e = steered([async () => (await gate, fakeAnalysisEngine().analyse({ facts: gatherFacts(spikeOnce!, []), input: '', budgetUsd: 1 }))]);
  const { analyzer, store } = fresh({ engine: e });
  const i = spike();
  spikeOnce = i;
  const [one, two] = await Promise.all([resolve(i.id), resolve(i.id)]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(analyzer.start(i.id, 'Keith').error, 'Mx Office is already analysing this incident');
  assert.equal(store.get(i.id)!.analysis!.status, 'running');
  // The office stops here: a new office finds it running and marks it failed.
  const next = new IncidentAnalyzer({ config: CFG, engine: steered([OK]), now: () => T0 });
  assert.equal(next.recover(), 1);
  assert.equal(store.get(i.id)!.analysis!.status, 'failed');
  assert.match(store.get(i.id)!.analysis!.error!, /restarted/);
  release();
  await analyzer.running.get(i.id);
  assert.equal(e.calls, 1, 'one analysis for the double resolve');
  useAnalyzer(next);
  assert.equal(next.start(i.id, 'Keith').error, undefined);
  await next.running.get(i.id);
  assert.equal(store.get(i.id)!.analysis!.status, 'done');
  // Written once per field: no duplicate actions.
  assert.equal(store.get(i.id)!.actions.length, 3);
});
let spikeOnce: ReturnType<typeof spike> | undefined;

test('test mode never calls the real CLI: the test analyser drafts, and the CLI engine refuses', async () => {
  fresh();
  assert.equal(new IncidentAnalyzer({ config: CFG }).engine().kind, 'fake');
  assert.equal(new IncidentAnalyzer({ config: analysisConfig({ AGENT_OFFICE_INCIDENT_ANALYSIS: 'fake' }) }).engine().kind, 'fake');
  let ran = 0;
  const cli = cliAnalysisEngine({ claude: 'claude', env: {}, model: 'sonnet', timeoutMs: 1000, run: async () => (ran++, { code: 0, out: '{}', timedOut: false }) });
  const r = await cli.analyse({ facts: gatherFacts(spike(), []), input: '{}', budgetUsd: 0.3 });
  assert.equal(ran, 0);
  assert.equal(r.value, null);
  assert.match(r.error!, /Test mode/);
  const c = analysisConfig({ AGENT_OFFICE_INCIDENT_ANALYSIS_CAP_USD: '0.5', AGENT_OFFICE_INCIDENT_ANALYSIS_PER_HOUR: '3' });
  assert.deepEqual([c.capUsd, c.perHour, c.model], [0.5, 3, 'sonnet']);
  assert.equal(analysisConfig({}).capUsd, 0.3);
});

test('the call is capped and tool-less, and its spend is metered as incident on the incident’s floor', async () => {
  const answer: AnalysisResult = { rootCause: { text: 'Likely a runaway turn', confidence: 'medium', evidence: ['rule'] }, impact: { text: '$31', scope: 'travel, 1 hour' }, correctiveActions: [{ action: 'Lower the cap', kind: 'prevent' }], unknowns: ['why'] };
  let args: string[] = [];
  let cwd = '';
  const cli = cliAnalysisEngine({ claude: '/opt/stand-in/fake-claude', env: {}, model: 'sonnet', timeoutMs: 5000, run: async (_c, _e, a, _i, dir) => ((args = a), (cwd = dir), { code: 0, out: JSON.stringify({ structured_output: answer, modelUsage: { 'claude-sonnet-4-5': { inputTokens: 3000, outputTokens: 800 } } }), timedOut: false }) });
  const { analyzer, store } = fresh({ engine: cli });
  useTestMode({ flag: false, agentCmd: 'claude', agentExplicit: false });
  const spent: BackgroundSpend[] = [];
  const off = onBackgroundSpend((s) => spent.push(s));
  try {
    const i = spike();
    await resolve(i.id);
    await analyzer.running.get(i.id);
    assert.equal(store.get(i.id)!.analysis!.status, 'done');
    assert.equal(store.get(i.id)!.rootCause, 'Likely a runaway turn');
    assert.equal(spent.length, 1);
    assert.deepEqual([spent[0].source, spent[0].floor], ['incident', 'travel']);
    assert.ok(store.get(i.id)!.analysis!.costUsd > 0);
    for (const flag of ['-p', '--json-schema', '--max-budget-usd', '--strict-mcp-config', '--no-session-persistence', '--setting-sources']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--max-budget-usd') + 1], '0.30');
    assert.match(path.basename(cwd), /^ao-planner-/);
  } finally {
    off();
  }
});
