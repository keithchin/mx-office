// The Firm: engagements from call to report with fake floors and a fake runner (no Claude, no
// Fable: they cost money), the reviewers' isolation on a real throwaway git repo, interview routing,
// the budget cap, the report schema and the estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canMove, cleanConfig, defaultConfig, estimateCost, mayAsk, QUESTION_LIMITS, type Engagement } from '../src/shared/firm/engagement.js';
import { validateSection } from '../src/shared/firm/report.js';
import { reportMarkdown } from '../src/shared/firm/report-md.js';
import { Firm, HARD_OVER } from '../src/server/firm/index.js';
import { routeQuestion } from '../src/server/firm/interviews.js';
import { isInstructionFile, prepareReviewer, reviewerEnv } from '../src/server/firm/isolation.js';
import { claudeArgs, readStreamLine, type RunEvents, type RunSpec } from '../src/server/firm/runner.js';
import type { FirmDeps, FirmFloor, LeadState } from '../src/server/firm/types.js';
import { priceOf } from '../src/server/usage.js';
import type { RoleId } from '../src/shared/roster/roles.js';
// @ts-expect-error plain JS, no types
import { parseFirm } from '../bin/office-firm.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'firm-test-'));
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

class FakeRunner {
  runs: { spec: RunSpec; ev: RunEvents; stopped: boolean }[] = [];
  start(spec: RunSpec, ev: RunEvents) {
    const run = { spec, ev, stopped: false };
    this.runs.push(run);
    ev.session(`s-${this.runs.length}`);
    return { stop: () => ((run.stopped = true), queueMicrotask(() => ev.exit(null))) };
  }
  of(cwdEnd: string) {
    return this.runs.filter((r) => r.spec.cwd.endsWith(cwdEnd));
  }
  last(cwdEnd: string) {
    return this.of(cwdEnd).at(-1)!;
  }
}

function fakeFloor(leads: Partial<Record<RoleId, LeadState>> = {}) {
  const delivered: { workerId: string; text: string; asleep: boolean }[] = [];
  const rehired: RoleId[] = [];
  const all: Record<RoleId, LeadState> = {
    pm: { role: 'pm', name: 'Quinn', state: 'active', workerId: 'w-pm' },
    'lead-designer': { role: 'lead-designer', name: 'Ada', state: 'active', workerId: 'w-de' },
    'lead-developer': { role: 'lead-developer', name: 'Linus', state: 'asleep', workerId: 'w-dev' },
    'lead-tester': { role: 'lead-tester', name: 'Grace', state: 'active', workerId: 'w-te' },
    'chief-analyst': { role: 'chief-analyst', name: 'Hedy', state: 'active', workerId: 'w-an' },
    ...leads,
  };
  const floor: FirmFloor = {
    id: 'f1',
    name: 'Test Project',
    dir: '/nowhere',
    lead: (role) => all[role],
    deliver: (workerId, text, asleep) => void delivered.push({ workerId, text, asleep }),
    rehire: async (role) => {
      rehired.push(role);
      all[role] = { ...all[role], state: 'active', workerId: `w-new-${role}` };
      return undefined;
    },
    stats: () => ({ prsMerged: 7, prsOpen: 2, issuesOpen: 4, issuesClosed: 9, ciPassRate: 0.8 }),
    grades: () => [],
    evidence: async () => ({ github: { pulls: [] } }),
  };
  return { floor, delivered, rehired, all };
}

function makeFirm(opts: { leads?: Partial<Record<RoleId, LeadState>> } = {}) {
  const dataDir = tmp();
  const runner = new FakeRunner();
  const f = fakeFloor(opts.leads);
  const notes: string[] = [];
  let now = 1_000_000;
  const deps: FirmDeps = {
    dataDir,
    now: () => now,
    floor: (id) => (id === 'f1' ? f.floor : undefined),
    runner,
    prepare: async (o) => {
      const cwd = path.join(o.engagementDir, o.reviewer);
      mkdirSync(path.join(cwd, 'evidence'), { recursive: true });
      return { cwd, repo: path.join(cwd, 'repo'), moved: [] };
    },
    pin: async () => 'abc1234567',
    baseEnv: () => ({ PATH: '/bin', GH_TOKEN: 'secret-gh', ANTHROPIC_API_KEY: 'keep-me' }),
    hookUrl: () => 'http://127.0.0.1:1',
    priceOf,
    notify: (_f, text) => void notes.push(text),
    changed: () => {},
  };
  const firm = new Firm(deps, 0);
  return { firm, runner, f, notes, dataDir, advance: (ms: number) => (now += ms) };
}

const cfg = (over: Record<string, unknown> = {}) => ({ floor: 'f1', teams: ['development', 'testing'], reviewers: ['partner', 'code', 'qa'], tests: ['static', 'unit'], depth: 'standard', budget: 50, ...over });

async function started(m: ReturnType<typeof makeFirm>, over: Record<string, unknown> = {}): Promise<Engagement> {
  const e = m.firm.start(cfg(over), 'PM');
  assert.equal(typeof e, 'object', String(e));
  const eng = e as Engagement;
  await until(() => eng.phase === 'fieldwork');
  return eng;
}

const SECTION = {
  summary: 'Reviewed the code.',
  findings: [{ id: 'CODE-1', severity: 'high', team: 'development', title: 'No error handling', evidence: [{ text: 'saw it', file: 'a.mdl', line: 3 }], recommendation: 'Add it', effort: 'M' }],
  pros: ['Clean modules'],
  cons: ['No tests'],
};

test('the lifecycle only moves forward, and the end states go nowhere', () => {
  assert.ok(canMove('requested', 'staffing'));
  assert.ok(canMove('fieldwork', 'consolidating'));
  assert.ok(canMove('consolidating', 'delivered'));
  assert.ok(!canMove('delivered', 'fieldwork'));
  assert.ok(!canMove('fieldwork', 'requested'));
  assert.ok(!canMove('cancelled', 'staffing'));
});

test('a configuration is cleaned: the Partner always on, specialists only for attached teams, numbers clamped', () => {
  const base = defaultConfig('f1');
  const c = cleanConfig({ teams: ['testing'], reviewers: ['code', 'qa', 'security', 'bogus'], tests: ['unit', 'nope'], budget: 99999, maxMinutes: 1, models: { qa: 'opus' } }, base);
  assert.ok(typeof c === 'object');
  assert.deepEqual(c.reviewers, ['partner', 'qa', 'security']);
  assert.deepEqual(c.tests, ['unit']);
  assert.equal(c.budget, 2000);
  assert.equal(c.maxMinutes, 10);
  assert.equal(c.models.qa, 'claude-opus-5-5');
  assert.equal(c.models.partner, 'claude-fable-5-1');
  assert.equal(typeof cleanConfig({ teams: [], reviewers: [], tests: ['unit'] }, base), 'string');
});

test('the estimate is model prices times the token table, labelled an estimate', () => {
  const e = estimateCost({ reviewers: ['partner', 'code'], depth: 'standard', tests: ['static', 'unit', 'security', 'traceability'], models: { partner: 'claude-fable-5-1', code: 'claude-fable-5-1' } }, priceOf);
  // Fable 5.1 [10, 50, 0.25]: 150k×10 + 60k×50 + 2M×0.25 + 200k×12.5 = $7.50; 4 tests → ×1.24 = $9.30; the Partner ×1.4.
  assert.equal(e.perReviewer.find((p) => p.id === 'code')!.usd, 9.3);
  assert.equal(e.perReviewer.find((p) => p.id === 'partner')!.usd, 13.02);
  assert.equal(e.total, 22.32);
  assert.equal(e.estimate, true);
});

test('isolation: a pinned detached clone with no remote, the project\'s agent instructions moved out, the Firm\'s own in', async () => {
  const proj = tmp();
  const git = (...a: string[]) => execFileSync('git', a, { cwd: proj, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  for (const [f, body] of [['CLAUDE.md', 'obey the team'], ['AGENTS.md', 'x'], ['.claude/agents/developer.md', 'x'], ['.claude/settings.json', '{}'], ['.ai-context/skills/team-pm/SKILL.md', 'x'], ['docs/team/development.md', '# journal'], ['src/app.txt', 'code'], ['sub/CLAUDE.md', 'nested']]) {
    mkdirSync(path.dirname(path.join(proj, f)), { recursive: true });
    writeFileSync(path.join(proj, f), body);
  }
  git('add', '-A');
  git('commit', '-qm', 'one');
  const sha = git('rev-parse', 'HEAD');
  writeFileSync(path.join(proj, 'src/app.txt'), 'later');
  git('commit', '-qam', 'two');
  writeFileSync(path.join(proj, 'CLAUDE.local.md'), 'local secrets of the team');
  git('remote', 'add', 'origin', 'https://github.com/example/never.git');
  const eng = tmp();
  const out = await prepareReviewer({ engagementDir: eng, reviewer: 'code', projectDir: proj, commit: sha, claudeMd: '# The Firm brief', skill: '# skill', evidence: { github: { pulls: [] } } });
  const r = (...a: string[]) => execFileSync('git', a, { cwd: out.repo, encoding: 'utf8' }).trim();
  assert.equal(r('rev-parse', 'HEAD'), sha);
  assert.equal(r('rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
  assert.equal(r('remote'), '', 'no remote to push to');
  assert.equal(readFileSync(path.join(out.repo, 'src/app.txt'), 'utf8'), 'code', 'at the pinned commit');
  for (const gone of ['CLAUDE.md', 'AGENTS.md', '.claude', '.ai-context/skills/team-pm', 'sub/CLAUDE.md', 'CLAUDE.local.md']) assert.ok(!existsSync(path.join(out.repo, gone)), `${gone} is not in the reviewer's checkout`);
  assert.ok(existsSync(path.join(out.repo, 'docs/team/development.md')), 'journals stay, as evidence');
  assert.equal(readFileSync(path.join(out.cwd, 'evidence/project-instructions/CLAUDE.md.txt'), 'utf8'), 'obey the team');
  assert.equal(readFileSync(path.join(out.cwd, 'CLAUDE.md'), 'utf8'), '# The Firm brief');
  assert.ok(!existsSync(path.join(out.cwd, '.claude/agents')), 'no project subagents in the reviewer\'s folder');
  assert.ok(existsSync(path.join(out.cwd, '.claude/skills/firm-code/SKILL.md')));
  assert.ok(JSON.parse(readFileSync(path.join(out.cwd, '.claude/settings.json'), 'utf8')).permissions.deny.includes('Bash(git push:*)'));
  assert.ok(existsSync(path.join(out.cwd, 'evidence/github.json')));
  assert.ok(isInstructionFile('.cursor/rules/x.md') && !isInstructionFile('docs/team/x.md'));
  rmSync(proj, { recursive: true, force: true });
  rmSync(eng, { recursive: true, force: true });
});

test('isolation: a reviewer\'s environment has no GitHub token, no git credentials, no office worker token', () => {
  const env = reviewerEnv({ PATH: '/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'x', GH_ENTERPRISE_TOKEN: 'x', GCM_CREDENTIAL_STORE: 'x', SSH_AUTH_SOCK: 'x', AGENT_OFFICE_HOOK_TOKEN: 'x', ANTHROPIC_API_KEY: 'k' }, '/firm/e/code', { url: 'http://h', key: 'e:code', token: 't', bin: '/firm/bin' });
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GCM_CREDENTIAL_STORE', 'SSH_AUTH_SOCK', 'AGENT_OFFICE_HOOK_TOKEN']) assert.equal(env[k], undefined, k);
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GH_CONFIG_DIR, path.join('/firm/e/code', '.gh'));
  assert.equal(env.AGENT_OFFICE_FIRM_REVIEWER, 'e:code');
  assert.ok(env.PATH.startsWith('/firm/bin'));
  assert.ok(claudeArgs({ model: 'claude-fable-5-1' }).includes('--strict-mcp-config'));
});

test('an engagement staffs each reviewer in its own folder, with no GitHub token, on its model', async () => {
  const m = makeFirm();
  const e = await started(m);
  assert.equal(e.commit, 'abc1234567');
  assert.equal(m.runner.runs.length, 3);
  for (const r of m.runner.runs) {
    assert.equal(r.spec.env.GH_TOKEN, undefined);
    assert.equal(r.spec.env.ANTHROPIC_API_KEY, 'keep-me');
    assert.equal(r.spec.model, 'claude-fable-5-1');
    assert.ok(r.spec.cwd.includes(path.join('firm', 'engagements', e.id)));
  }
  assert.ok(m.runner.last('qa').spec.prompt.includes('CLAUDE.md'));
  assert.equal(typeof m.firm.start(cfg(), 'PM'), 'string', 'one audit per floor at a time');
});

test('interviews: to the Lead (woken if asleep), relayed when benched, rehired when allowed, else unanswered; rate-limited', async () => {
  assert.equal(routeQuestion({ role: 'lead-tester', name: 'G', state: 'asking', workerId: 'w' }, { role: 'pm', name: 'Q', state: 'active', workerId: 'p' }, false).kind, 'wait');
  const m = makeFirm({ leads: { 'lead-tester': { role: 'lead-tester', name: 'Grace', state: 'benched' } } });
  const e = await started(m);
  const code = e.reviewers.find((r) => r.id === 'code')!;
  const qa = e.reviewers.find((r) => r.id === 'qa')!;
  const a = await m.firm.desk.ask(e, code, 'development', 'Why no error handling?');
  assert.ok(typeof a === 'object');
  assert.equal(m.f.delivered[0].workerId, 'w-dev');
  assert.equal(m.f.delivered[0].asleep, true, 'the asleep Lead Developer is woken with it');
  assert.match(m.f.delivered[0].text, /The Firm's Marcus Reed, Code & Architecture Reviewer \(independent audit\) asks/);
  assert.match(m.f.delivered[0].text, new RegExp(`office-workers firm answer ${a.question.id}`));
  assert.equal(typeof (await m.firm.desk.ask(e, code, 'testing', 'x')), 'string', 'a specialist asks only its own team');
  assert.match(String(await m.firm.desk.ask(e, code, 'development', 'again?')), /open question|One question every/);
  const b = await m.firm.desk.ask(e, qa, 'testing', 'What do your e2e tests cover?');
  assert.ok(typeof b === 'object');
  assert.equal(b.question.to?.workerId, 'w-pm', 'benched Lead Tester: the Project Coordinator answers for them');
  assert.match(m.f.delivered[1].text, /benched/);
  // The answer: only from whom it went to, then back to the reviewer as its next prompt.
  assert.equal(typeof m.firm.desk.answer('w-te', a.question.id, 'nope'), 'string');
  const runsBefore = m.runner.of('code').length;
  m.runner.last('code').ev.exit(0);
  assert.equal(code.status, 'interviewing');
  assert.deepEqual(m.firm.desk.answer('w-dev', a.question.id, 'We ran out of time.'), { engagement: e.id, reviewer: 'Marcus Reed' });
  assert.equal(m.runner.of('code').length, runsBefore + 1);
  assert.match(m.runner.last('code').spec.prompt, /Linus \(Lead Developer\) answered.*\n\nWe ran out of time\./s);
  assert.ok(m.runner.last('code').spec.sessionId, 'it carries its session on');
  assert.ok(e.transcript.some((t) => t.text.includes('We ran out of time')));
  // Limits per depth.
  const lim = QUESTION_LIMITS.quick;
  const fake = { config: { depth: 'quick' }, questions: Array.from({ length: lim.total }, (_, i) => ({ reviewer: 'qa', status: 'answered', at: i })) } as unknown as Engagement;
  assert.match(String(mayAsk(fake, 'qa', 1e9)), /asked your 3 questions/);
});

test('interviews: a benched Lead is hired back only when the engagement allows it, and nobody to ask is recorded unanswered', async () => {
  const m = makeFirm({ leads: { 'lead-developer': { role: 'lead-developer', name: 'Linus', state: 'benched' }, pm: { role: 'pm', name: 'Quinn', state: 'benched' } } });
  const e = await started(m, { allowRehire: true });
  const got = await m.firm.desk.ask(e, e.reviewers.find((r) => r.id === 'code')!, 'development', 'Who designed the domain model?');
  assert.ok(typeof got === 'object');
  assert.deepEqual(m.f.rehired, ['lead-developer']);
  assert.equal(got.question.to?.workerId, 'w-new-lead-developer');
  const p = await m.firm.desk.ask(e, e.reviewers.find((r) => r.id === 'partner')!, 'management', 'What was the plan?');
  assert.ok(typeof p === 'object');
  assert.equal(p.question.status, 'unanswered');
  assert.match(p.note, /Project Coordinator is benched/);
});

test('the budget: a warning at 80%, a wrap-up at 100% (the turn is cut short), a hard stop past it with a partial report', async () => {
  const m = makeFirm();
  const e = await started(m, { budget: 10 });
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  m.runner.last('code').ev.usage(8.1, t);
  assert.ok(e.warned80);
  assert.ok(m.notes.some((n) => n.includes('80%')));
  assert.equal(m.firm.floorStatus('f1').budgetWarn?.budget, 10);
  m.runner.last('qa').ev.usage(2, t);
  assert.ok(e.wrapUpAt, 'wrapped up at the cap');
  assert.ok(m.runner.last('qa').stopped, 'its running turn was cut short');
  await until(() => m.runner.last('qa').spec.prompt.includes('Wrap up now'));
  assert.equal(e.phase, 'consolidating');
  assert.ok(m.runner.last('partner').spec.prompt.includes('executive, findings and recommendations'));
  // The QA reviewer sends what it has in its wrap-up; then the spend runs past the hard stop.
  const qa = e.reviewers.find((r) => r.id === 'qa')!;
  assert.ok(typeof m.firm.desk.submit(e, qa, 'reviewer', SECTION) === 'object');
  m.runner.last('code').ev.usage(10 * HARD_OVER, t);
  assert.equal(e.phase, 'delivered');
  const report = m.firm.report(e.reportId!)!;
  assert.ok(report.partial);
  assert.equal(report.findings[0].id, 'CODE-1');
  assert.equal(report.findings[0].reviewer, 'qa');
  assert.ok(report.statistics.auditCost! > 10);
  assert.equal(report.statistics.prsMerged, 7, 'the office fills in what it knows');
  assert.ok(e.reviewers.every((r) => ['done', 'stopped', 'failed'].includes(r.status)));
});

test('the happy path: specialists send and finish, the Partner consolidates, the report is delivered and read', async () => {
  const m = makeFirm();
  const e = await started(m);
  const [partner, code, qa] = ['partner', 'code', 'qa'].map((id) => e.reviewers.find((r) => r.id === id)!);
  assert.match(String(m.firm.desk.done(e, code, '')), /Send your section first/);
  assert.match(String(m.firm.desk.submit(e, code, 'executive', {})), /one section/);
  assert.match(String(m.firm.desk.submit(e, code, 'reviewer', { summary: 'x', findings: [{ ...SECTION.findings[0], evidence: [] }] })), /findings\[0\]\.evidence needs at least one/);
  for (const r of [code, qa]) {
    assert.ok(typeof m.firm.desk.submit(e, r, 'reviewer', SECTION) === 'object');
    assert.equal(m.firm.desk.done(e, r, 'all sent'), undefined);
  }
  m.runner.last('partner').ev.exit(0);
  assert.equal(e.phase, 'consolidating');
  await until(() => m.runner.last('partner').spec.prompt.includes('Every specialist is done'));
  assert.ok(existsSync(path.join(m.dataDir, 'firm/engagements', e.id, 'partner/evidence/sections/code.json')));
  assert.match(String(m.firm.desk.done(e, partner, '')), /Send executive, findings, recommendations first/);
  m.firm.desk.submit(e, partner, 'executive', { verdict: 'at-risk', headline: 'Behind plan, fixable', summary: 'S', keyPoints: ['a'] });
  m.firm.desk.submit(e, partner, 'findings', SECTION.findings);
  m.firm.desk.submit(e, partner, 'recommendations', [{ priority: 'now', title: 'Tests', detail: 'Write them', owner: 'testing' }]);
  assert.equal(m.firm.desk.done(e, partner, 'delivered'), undefined);
  assert.equal(e.phase, 'delivered');
  const r = m.firm.report(e.reportId!)!;
  assert.ok(!r.partial);
  assert.equal(r.executive.headline, 'Behind plan, fixable');
  assert.deepEqual(r.prosCons.pros, ['Clean modules', 'Clean modules'], 'merged from the specialists where the Partner sent none');
  assert.match(reportMarkdown(r), /## Executive summary[\s\S]*\*\*AT-RISK\*\* — Behind plan, fixable/);
  assert.ok(existsSync(path.join(m.dataDir, 'firm/reports', `${r.id}.md`)));
  assert.equal(m.firm.floorStatus('f1').reportReady?.report, r.id);
  m.firm.markRead(r.id);
  assert.equal(m.firm.floorStatus('f1').reportReady, undefined);
  assert.ok(m.notes.some((n) => n.startsWith('📑 Audit report ready')));
});

test('the Project Manager can cancel: every session stops, nothing is delivered', async () => {
  const m = makeFirm();
  const e = await started(m);
  assert.equal(m.firm.cancel(e.id, 'PM'), undefined);
  assert.equal(e.phase, 'cancelled');
  assert.ok(m.runner.runs.every((r) => r.stopped));
  assert.equal(e.reportId, undefined);
  assert.equal(typeof m.firm.cancel(e.id, 'PM'), 'string');
});

test('report sections are checked against the schema, naming the bad field', () => {
  assert.ok(validateSection('reviewer', SECTION).ok);
  const bad = validateSection('findings', [{ ...SECTION.findings[0], severity: 'urgent' }]);
  assert.ok(!bad.ok && /findings\[0\]\.severity must be one of critical, high, medium, low/.test(bad.error));
  const w = validateSection('workers', [{ name: 'Linus', grade: 'B', output: 'x', evidence: 'y' }]);
  assert.ok(!w.ok && /slacking must be true or false/.test(w.error));
  assert.ok(!validateSection('nope', {}).ok);
  const t = validateSection('timeline', { milestones: [{ name: 'MVP', planned: '2026-10-01', forecast: '2026-10-20', status: 'late', confidence: 'medium' }] });
  assert.ok(t.ok);
});

test('the headless runner books spend per message and snaps to Claude Code\'s own total', () => {
  const got: number[] = [];
  let session = '';
  const ev: RunEvents = { session: (s) => (session = s), usage: (u) => void got.push(u), activity: () => {}, exit: () => {} };
  const seen = { ids: new Set<string>(), usd: 0 };
  readStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }), seen, ev);
  const msg = { type: 'assistant', message: { id: 'm1', model: 'claude-fable-5-1', usage: { input_tokens: 1_000_000, output_tokens: 0 }, content: [] } };
  readStreamLine(JSON.stringify(msg), seen, ev);
  readStreamLine(JSON.stringify(msg), seen, ev);
  readStreamLine(JSON.stringify({ type: 'result', session_id: 'abc', total_cost_usd: 12 }), seen, ev);
  assert.equal(session, 'abc');
  assert.deepEqual(got, [10, 2]);
});

test('office-workers firm reads its command line', () => {
  assert.deepEqual(parseFirm(['ask', '--team', 'testing', 'Why', 'so?']), { sub: 'ask', team: 'testing', text: 'Why so?' });
  assert.deepEqual(parseFirm(['answer', 'Q1-2', 'Because']), { sub: 'answer', question: 'Q1-2', text: 'Because' });
  assert.deepEqual(parseFirm(['report', '--section=reviewer', '--file', 'out/s.json']), { sub: 'report', section: 'reviewer', file: 'out/s.json' });
  assert.throws(() => parseFirm(['report', '--section', 'x']));
});

test('a seeded SAMPLE engagement never starts a reviewer, even after a restart', async () => {
  const m = makeFirm();
  const e = await started(m);
  const before = m.runner.runs.length;
  e.sample = true;
  m.firm.send(e, e.reviewers[0], 'carry on');
  assert.equal(m.runner.runs.length, before);
});

test('the Needs-you strip gets "Audit report ready" and "Audit budget at 80%"', async () => {
  const { collectNeeds } = await import('../src/client/ui/needsyou/logic.js');
  const items = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], firm: { floor: 'f1', reportReady: { engagement: 'e', report: 'r-e', at: 1 }, budgetWarn: { engagement: 'e', spent: 41, budget: 50 } } });
  assert.deepEqual(items.map((i) => [i.text, i.action]), [['Audit report ready from The Firm', 'Read'], ['Audit budget at 82%: $41.00 of $50.00', 'View']]);
  assert.deepEqual(items[0].target, { to: 'firm', url: '/firm?report=r-e' });
});
