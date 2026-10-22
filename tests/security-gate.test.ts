// E2, the security baseline and the Mendix check gate (src/shared/security.ts, src/server/security-gate/):
// reading an app's security from a commit's units (level, strict mode, demo users, guest access, password
// length, entities without access rules) and keeping it per commit; mx check's output read (a failing model
// with CE2729 × 6, a pass, no verdict); the gate blocking with reasons and allowing once met, bound to the
// commit; the policy's options (prototype with a reason, strict required, advisory); the sign-off refused
// through its guard; the Needs-you card's words and its tell; the Playbook's section; the new app's
// security set by the wizard with mxcli and read back. Fakes only: no mxcli, mx or Mendix runtime runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_POLICY,
  cleanPolicy,
  gatePointOfStage,
  gateRefusal,
  judgeGate,
  levelOf,
  parseMxCheck,
  policyProblem,
  policyWords,
  securityPlaybookLines,
  securityTell,
  stateFromShowJson,
  type MxCheckResult,
  type SecurityState,
} from '../src/shared/security.js';
import { SecurityReader, stateFromUnits } from '../src/server/security-gate/read.js';
import { SecurityStore } from '../src/server/security-gate/store.js';
import { SecurityGate, securityItem } from '../src/server/security-gate/index.js';
import { pickForCheck, runMxCheck, type CheckDeps } from '../src/server/security-gate/check.js';
import { securityOfProject, securityRole, useSecurityPolicy } from '../src/server/security-gate/playbook.js';
import { withSecurityBaseline, BASELINE_MDL } from '../src/server/security-gate/wizard.js';
import { actMessage, detectAsks } from '../src/server/asks/detect.js';
import { signOff, type SignoffDeps } from '../src/server/signoff/index.js';
import type { CommitModel } from '../src/server/model/units.js';
import type { BsonDoc } from '../src/server/model/bson.js';
import type { Floor } from '../src/server/floor.js';
import type { SetupView } from '../src/shared/wizard.js';
import type { AskItem } from '../src/shared/asks.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const NOW = Date.parse('2026-10-22T09:00:00Z');
const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), `sec-${p}-`));

/** A ProjectSecurity unit as the model writes it (only the fields read; a demo user's password is there to show it isn't kept). */
const SEC = (o: Partial<Record<string, unknown>> = {}): BsonDoc => ({
  $Type: 'Security$ProjectSecurity',
  SecurityLevel: 'CheckEverything',
  StrictMode: false,
  EnableDemoUsers: true,
  EnableGuestAccess: false,
  GuestUserRole: '',
  DemoUsers: [2, { $Type: 'Security$DemoUserImpl', UserName: 'demo_one', Password: 'Secret-1' }, { $Type: 'Security$DemoUserImpl', UserName: 'demo_two', Password: 'Secret-2' }],
  PasswordPolicySettings: { $Type: 'Security$PasswordPolicySettings', MinimumLength: 12 },
  UserRoles: [2, { $Type: 'Security$UserRole', Name: 'Administrator' }, { $Type: 'Security$UserRole', Name: 'User' }],
  ...o,
} as BsonDoc);
const persistent = { $Type: 'DomainModels$NoGeneralization', Persistable: true };
const ENT = (name: string, rules: number, persistable = true): BsonDoc => ({ $ID: name, Name: name, MaybeGeneralization: { ...persistent, Persistable: persistable }, Attributes: [3], AccessRules: [3, ...Array.from({ length: rules }, () => ({ AllowedModuleRoles: [1, 'Sales.User'], AllowCreate: true, AllowDelete: false, MemberAccesses: [3] }))] } as BsonDoc);
const DOMAINS = [
  { module: 'Sales', unit: { Entities: [3, ENT('Order', 1), ENT('Customer', 0), ENT('Draft', 0, false)] } as BsonDoc },
  { module: 'System', unit: { Entities: [3, ENT('User', 0)] } as BsonDoc },
];

test('a level as the model or mxcli says it', () => {
  assert.equal(levelOf('CheckNothing'), 'off');
  assert.equal(levelOf('CheckFormsAndMicroflows'), 'prototype');
  assert.equal(levelOf('CheckEverything'), 'production');
  assert.equal(levelOf('Production'), 'production');
  assert.equal(levelOf('Off'), 'off');
  assert.equal(levelOf('something'), undefined);
});

test('the state from the units: level, strict mode, demo users (no passwords), guest, password length, entities without access rules (System left out)', () => {
  const s = stateFromUnits(SEC(), DOMAINS, A, NOW);
  assert.equal(s.level, 'production');
  assert.equal(s.strict, false);
  assert.deepEqual(s.demoUsers, { enabled: true, count: 2 });
  assert.deepEqual(s.guest, { enabled: false });
  assert.equal(s.passwordMinLength, 12);
  assert.equal(s.userRoles, 2);
  assert.deepEqual(s.entities, { total: 2, withoutRules: 1, sample: ['Sales.Customer'] }, 'a non-persistable entity and System are not counted');
  assert.equal(s.source, 'model');
  assert.equal(s.commit, A);
  assert.doesNotMatch(JSON.stringify(s), /Secret|demo_one/, 'never a demo user’s password or name');
  const guest = stateFromUnits(SEC({ EnableGuestAccess: true, GuestUserRole: 'Anonymous', SecurityLevel: 'CheckNothing' }), [], A, NOW);
  assert.deepEqual(guest.guest, { enabled: true, role: 'Anonymous' });
  assert.equal(guest.level, 'off');
  assert.equal(guest.entities, undefined, 'no domain models read: entities not claimed');
  const none = stateFromUnits(null, [], A, NOW);
  assert.equal(none.level, undefined, 'no ProjectSecurity unit: nothing claimed');
});

test('mxcli show project security --json, read as a state', () => {
  const rows = [
    { Property: 'SecurityLevel', Value: 'Production' },
    { Property: 'StrictMode', Value: 'true' },
    { Property: 'DemoUsersEnabled', Value: 'false' },
    { Property: 'DemoUsers', Value: '0' },
    { Property: 'GuestAccess', Value: 'false' },
    { Property: 'UserRoles', Value: '3' },
    { Property: 'PasswordPolicy.MinimumLength', Value: '8' },
  ];
  assert.deepEqual(stateFromShowJson(rows), { level: 'production', strict: true, demoUsers: { enabled: false, count: 0 }, guest: { enabled: false }, passwordMinLength: 8, userRoles: 3 });
  assert.equal(stateFromShowJson('nope'), undefined);
  assert.equal(stateFromShowJson([]), undefined);
});

/** A commit model with these units (the reader asks for the ProjectSecurity unit and each domain model). */
function commitModel(sha: string, sec: BsonDoc | null, domains = DOMAINS): CommitModel {
  const units = new Map<string, { id: string; container: string; type: string; name: string; hash: string; qn: string }>();
  const docs = new Map<string, BsonDoc>();
  if (sec) {
    units.set('sec', { id: 'sec', container: '', type: 'Security$ProjectSecurity', name: '', hash: 'h1', qn: '' });
    docs.set('sec', sec);
  }
  const byName = new Map<string, string>();
  for (const d of domains) {
    units.set(`dm-${d.module}`, { id: `dm-${d.module}`, container: '', type: 'DomainModels$DomainModel', name: '', hash: `h-${d.module}`, qn: d.module });
    docs.set(`dm-${d.module}`, d.unit);
    byName.set(`domainmodel:${d.module}`, `dm-${d.module}`);
  }
  return { sha, ix: { units, byName, read: async (id: string) => docs.get(id) ?? null } } as unknown as CommitModel;
}

test('read once per commit: a second look at the same commit reads nothing; another commit is read', async () => {
  let loads = 0;
  const r = new SecurityReader(async (_dir, sha) => (loads++, commitModel(sha, SEC({ SecurityLevel: sha === A ? 'CheckNothing' : 'CheckEverything' }))), () => NOW);
  assert.equal((await r.read('/p', A))?.level, 'off');
  assert.equal((await r.read('/p', A))?.level, 'off');
  assert.equal(loads, 1, 'kept by commit');
  assert.equal((await r.read('/p', B))?.level, 'production');
  assert.equal(loads, 2);
  // No units here (no node:sqlite): null, not a guess.
  assert.equal(await new SecurityReader(async () => null).read('/p', A), null);
  // No .mpr: the error, and nothing kept, so a later commit with an app is read.
  const bad = new SecurityReader(async () => {
    throw new Error('no Mendix project (.mpr) in this commit');
  });
  await assert.rejects(bad.read('/p', A), /no Mendix project/);
  assert.equal(bad.size, 0);
});

const PASS_OUT = 'Using mx: C:\\Mendix\\11.12.4\\modeler\\mx.exe\nChecking app for errors...\nThe app contains: 0 errors.\nProject check passed.\n';
const CE2729 = '[error] [CE2729] "The demo user \'demo_x\' has no user roles." at Demo user \'demo_x\'';
const FAIL_OUT = `Checking app for errors...\n${Array.from({ length: 6 }, () => CE2729).join('\n')}\n[warning] [CW0001] "Unused" at Page\nThe app contains: 6 errors.\nError: project check failed: exit status 1\n`;

test("mx check's output: 0 errors passes; CE2729 × 6 fails with its code and first lines; no verdict is none", () => {
  const p = parseMxCheck(PASS_OUT);
  assert.equal(p.errors, 0);
  assert.equal(p.passed, true);
  const f = parseMxCheck(FAIL_OUT);
  assert.equal(f.errors, 6);
  assert.equal(f.passed, false);
  assert.equal(f.warnings, 1);
  assert.deepEqual(f.codes, [{ code: 'CE2729', count: 6 }]);
  assert.equal(f.first.length, 5);
  const n = parseMxCheck('Error: something odd\n');
  assert.equal(n.errors, undefined);
  assert.equal(n.passed, false);
});

const STATE = (o: Partial<SecurityState> = {}): SecurityState => ({ commit: A, readAt: NOW, source: 'model', level: 'production', strict: true, demoUsers: { enabled: false, count: 0 }, guest: { enabled: false }, passwordMinLength: 12, entities: { total: 3, withoutRules: 0, sample: [] }, ...o });
const CHECK = (o: Partial<MxCheckResult> = {}): MxCheckResult => ({ commit: A, at: NOW, status: 'pass', errors: 0, ms: 60_000, by: 'Pat', ...o });

test('the gate: blocks with reasons, allows once met, and only counts what was read or checked at that very commit', () => {
  const p = DEFAULT_POLICY;
  // Off, never checked: the build can't start, nor can a release.
  const off = judgeGate(p, 'release', A, STATE({ level: 'off' }), undefined);
  assert.equal(off.meets, false);
  assert.deepEqual(off.missing, [`App security is Off at aaaaaaa; the policy needs Production`, 'No mx check at aaaaaaa yet']);
  assert.equal(off.enforced, true);
  // Production, mx check failing.
  const fail = judgeGate(p, 'release', A, STATE(), CHECK({ status: 'fail', errors: 6, codes: [{ code: 'CE2729', count: 6 }] }));
  assert.deepEqual(fail.missing, ['mx check at aaaaaaa found 6 errors (CE2729 ×6)']);
  // Met.
  const ok = judgeGate(p, 'release', A, STATE(), CHECK());
  assert.equal(ok.meets, true);
  assert.deepEqual(ok.missing, []);
  // Bound to the revision: a pass of another commit, or a state read elsewhere, doesn't count.
  assert.deepEqual(judgeGate(p, 'release', B, STATE(), CHECK()).missing, ['App security not read at bbbbbbb yet', 'No mx check at bbbbbbb yet']);
  // The build point doesn't need mx check, only the level.
  assert.equal(judgeGate(p, 'build', A, STATE(), undefined).meets, true);
  assert.equal(judgeGate(p, 'build', A, STATE({ level: 'prototype' }), undefined).meets, false);
  // An mx check that didn't finish is no pass.
  assert.match(judgeGate(p, 'release', A, STATE(), CHECK({ status: 'error', why: 'no mxbuild' })).missing[0], /didn't finish: no mxbuild/);
  // Entities without access rules at Production are missing; demo users, guest, a short password are flagged only.
  const flagged = judgeGate(p, 'release', A, STATE({ strict: false, demoUsers: { enabled: true, count: 2 }, guest: { enabled: true, role: 'Anonymous' }, passwordMinLength: 6, entities: { total: 4, withoutRules: 2, sample: ['Sales.A', 'Sales.B'] } }), CHECK());
  assert.deepEqual(flagged.missing, ['2 persistable entities have no access rule at aaaaaaa (Sales.A, Sales.B)']);
  assert.equal(flagged.flags.length, 4);
  assert.match(flagged.flags.join('\n'), /Strict mode is off .*recommended.*mx\.data/);
  assert.match(flagged.flags.join('\n'), /Demo users are on at aaaaaaa \(2\): fine while building, switch them off before a release/);
  // No main branch.
  assert.deepEqual(judgeGate(p, 'build', undefined, undefined, undefined).missing, ['No commit to check: the project has no main branch yet']);
  // The refusal says what's missing and where to fix it; never "secure".
  const words = gateRefusal(off, 'Signing off Stage 5');
  assert.match(words, /^Signing off Stage 5 needs the project's security baseline met at aaaaaaa\. Missing: App security is Off/);
  assert.match(words, /App Insights › Security \(Run mx check there\)/);
  assert.doesNotMatch(words, /\bsecure\b/);
});

test('the policy options: prototype only (with a reason), strict mode required, advisory (with a reason)', () => {
  assert.deepEqual(cleanPolicy({}), DEFAULT_POLICY);
  assert.deepEqual(cleanPolicy({ level: 'nonsense', enforce: 'yes' }), DEFAULT_POLICY);
  assert.equal(policyProblem(cleanPolicy({ level: 'prototype' })), 'Say why this project is a prototype only (a spike, a throwaway demo…)');
  assert.equal(policyProblem(cleanPolicy({ enforce: false })), 'Say why the office should only advise');
  const proto = cleanPolicy({ level: 'prototype', reason: 'a two-day spike\nnever shipped' });
  assert.equal(policyProblem(proto), undefined);
  assert.equal(proto.reason, 'a two-day spike never shipped');
  // Prototype: Prototype security is enough, Off isn't.
  assert.equal(judgeGate(proto, 'build', A, STATE({ level: 'prototype' }), undefined).meets, true);
  assert.match(judgeGate(proto, 'build', A, STATE({ level: 'off' }), undefined).missing[0], /policy needs Prototype/);
  // Strict mode required: off is missing, not flagged.
  const strict = cleanPolicy({ strict: 'required' });
  assert.deepEqual(judgeGate(strict, 'build', A, STATE({ strict: false }), undefined).missing, ['Strict mode is off at aaaaaaa; the policy requires it']);
  // Advisory: unmet, not enforced.
  const adv = cleanPolicy({ enforce: false, reason: 'no Studio Pro on this machine' });
  assert.equal(judgeGate(adv, 'build', A, STATE({ level: 'off' }), undefined).enforced, false);
  assert.match(policyWords(DEFAULT_POLICY), /^Production security before the build starts \(by the end of Stage 3, Architecture & Design\); strict mode recommended; demo users allowed while building, flagged for release; a clean mx check/);
  assert.match(policyWords(adv), /advisory only/);
  // Where the gate applies.
  assert.deepEqual(['P', '0', '3', '4', '5', '6', '7', 'Stage 5'].map(gatePointOfStage), [undefined, undefined, undefined, 'build', 'release', 'release', 'release', 'release']);
});

test('the record: policy, reads and checks per revision, kept on disk and read back', async () => {
  const dir = tmp('store');
  try {
    const s = new SecurityStore(dir);
    assert.deepEqual(await s.policy('f1'), DEFAULT_POLICY);
    await s.addRead('f1', STATE());
    await s.addRead('f1', STATE({ level: 'off' }));
    await s.addCheck('f1', CHECK({ status: 'fail', errors: 2 }));
    await s.addCheck('f1', CHECK());
    await s.update('f1', (r) => ({ ...r, policy: cleanPolicy({ level: 'prototype', reason: 'spike' }) }));
    const again = await new SecurityStore(dir).get('f1');
    assert.equal(again.reads.length, 1, 'one per commit');
    assert.equal(again.reads[0].level, 'off');
    assert.deepEqual(again.checks.map((c) => c.status), ['pass']);
    assert.equal(again.policy?.level, 'prototype');
    assert.ok(JSON.parse(readFileSync(path.join(dir, 'f1.json'), 'utf8')).checks);
    assert.throws(() => s.file('../x'), /not a project id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A gate with fakes: the units say `level`; mx check prints `out`. */
function fakeGate(o: { level?: string; out?: string; main?: string | null; noApp?: boolean } = {}) {
  const dir = tmp('gate');
  const runs: string[][] = [];
  let reads = 0;
  const check: CheckDeps = {
    dataDir: dir,
    now: () => NOW,
    tool: async () => ({ bin: 'fake-mxcli', version: 'test-1' }),
    prepare: async (_f, sha) => ({ dir: path.join(dir, 'testing', 'work', 'f1', 'instance-mxcheck'), commit: sha, mpr: 'App.mpr' }),
    pick: () => ({ path: path.join('C:', 'Mendix', '11.12.4', 'modeler', 'mxbuild.exe'), skipped: [] }),
    run: async (_bin, args) => (runs.push(args), { code: o.out === FAIL_OUT ? 1 : 0, stdout: o.out ?? PASS_OUT, stderr: '', ms: 5 }),
  };
  const gate = new SecurityGate({
    dataDir: dir,
    store: new SecurityStore(path.join(dir, 'security')),
    reader: {
      read: async (_d, sha) => {
        reads++;
        if (o.noApp) throw new Error('no Mendix project (.mpr) in this commit');
        return stateFromUnits(SEC({ SecurityLevel: o.level ?? 'CheckEverything', StrictMode: true, EnableDemoUsers: false }), [], sha, NOW);
      },
    },
    check,
    main: async () => (o.main === null ? undefined : { branch: 'main', sha: o.main ?? A, remote: true }),
    now: () => NOW,
  });
  return { gate, dir, runs, reads: () => reads };
}
const FLOOR = { id: 'f1', dir: '/projects/f1' };

test('the service: a release step with no mx check is refused and starts one; after a pass at that commit it goes ahead', async () => {
  const { gate, dir, runs, reads } = fakeGate();
  try {
    const first = await gate.refusal(FLOOR, 'release', 'Signing off Stage 5');
    assert.match(first ?? '', /Missing: No mx check at aaaaaaa yet/);
    assert.match(first ?? '', /has started an mx check at aaaaaaa/);
    assert.ok(gate.runningOn('f1'), 'running in the background');
    const r = await gate.startCheck(FLOOR, A, 'Mx Office (gate)');
    assert.equal(r.status, 'pass');
    assert.deepEqual(runs[0], ['docker', 'check', '-p', path.join(dir, 'testing', 'work', 'f1', 'instance-mxcheck', 'App.mpr'), '--mxbuild-path', path.join('C:', 'Mendix', '11.12.4', 'modeler')]);
    assert.equal(runs.length, 1, 'the refusal and the explicit start shared one run');
    assert.equal(await gate.refusal(FLOOR, 'release', 'Signing off Stage 5'), undefined);
    assert.equal(reads(), 1, 'the state was read once for the commit and then kept in the record');
    // The card's view says the same.
    const v = await gate.view(FLOOR, true);
    assert.equal(v.state?.level, 'production');
    assert.equal(v.check?.commit, A);
    assert.equal(v.gates.release.meets, true);
    // Main moved: the pass of the old commit no longer counts.
    const moved = await gate.gate(FLOOR, 'release', B);
    assert.deepEqual(moved.missing, ['No mx check at bbbbbbb yet']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the service: a failing mx check keeps refusing with its errors; Off security refuses the build; advisory and no app never refuse', async () => {
  const failing = fakeGate({ out: FAIL_OUT });
  try {
    const r = await failing.gate.startCheck(FLOOR, A, 'Pat');
    assert.equal(r.status, 'fail');
    assert.equal(r.errors, 6);
    assert.match((await failing.gate.refusal(FLOOR, 'release', 'Accepting this delivery', A)) ?? '', /mx check at aaaaaaa found 6 errors \(CE2729 ×6\)/);
  } finally {
    rmSync(failing.dir, { recursive: true, force: true });
  }
  const off = fakeGate({ level: 'CheckNothing' });
  try {
    assert.match((await off.gate.refusal(FLOOR, 'build', 'Signing off Stage 4')) ?? '', /App security is Off at aaaaaaa; the policy needs Production/);
    assert.equal(await off.gate.setPolicy(FLOOR, cleanPolicy({ enforce: false }), { kind: 'human', name: 'Pat' }), 'Say why the office should only advise');
    assert.equal(await off.gate.setPolicy(FLOOR, cleanPolicy({ enforce: false, reason: 'a demo laptop' }), { kind: 'human', name: 'Pat' }), undefined);
    assert.equal(await off.gate.refusal(FLOOR, 'build', 'Signing off Stage 4'), undefined, 'advisory: said on the card, not refused');
    const v = await off.gate.view(FLOOR, true);
    assert.equal(v.gates.build.meets, false);
    assert.equal(v.gates.build.enforced, false);
    assert.equal(v.policy.by, 'Pat');
  } finally {
    rmSync(off.dir, { recursive: true, force: true });
  }
  const none = fakeGate({ noApp: true });
  try {
    assert.equal(await none.gate.refusal(FLOOR, 'release', 'Signing off Stage 5'), undefined, 'no .mpr: nothing to check');
    assert.equal((await none.gate.view(FLOOR, false)).noApp, true);
  } finally {
    rmSync(none.dir, { recursive: true, force: true });
  }
});

test('the mx check runner: test mode refuses a real mxcli; a Linux mxbuild, a timeout and no verdict are errors, never a pass', async () => {
  const base = fakeGate();
  try {
    const d = (over: Partial<CheckDeps>): CheckDeps => ({ ...(base.gate.d.check as CheckDeps), ...over });
    const refused = await runMxCheck(d({ tool: async () => ({ why: 'Test mode is on: only a fake mxcli runs here' }) }), FLOOR, A, 'Pat');
    assert.equal(refused.result.status, 'error');
    assert.match(refused.result.why ?? '', /Test mode/);
    const linux = await runMxCheck(d({ run: async () => ({ code: 1, stdout: 'Error: mxbuild at /cache/mxbuild is a linux binary and cannot run on windows', stderr: '', ms: 1 }) }), FLOOR, A, 'Pat');
    assert.equal(linux.result.status, 'error');
    assert.match(linux.result.why ?? '', /Linux mxbuild/);
    const slow = await runMxCheck(d({ run: async () => ({ code: null, stdout: '', stderr: '', killed: true, ms: 1 }) }), FLOOR, A, 'Pat');
    assert.match(slow.result.why ?? '', /was stopped/);
    const odd = await runMxCheck(d({ run: async () => ({ code: 2, stdout: 'WARNING: This is a vibe-coded PoC\nsomething unexpected', stderr: '', ms: 1 }) }), FLOOR, A, 'Pat');
    assert.equal(odd.result.status, 'error');
    assert.match(odd.result.why ?? '', /no verdict \(exit 2\): something unexpected/);
    const prep = await runMxCheck(d({ prepare: async () => Promise.reject(new Error('no commit')) }), FLOOR, A, 'Pat');
    assert.match(prep.result.why ?? '', /couldn't prepare its copy of the app: no commit/);
    // The units couldn't be read: the same copy is asked with mxcli's show project security.
    const both = await runMxCheck(d({ run: async (_b, args) => ({ code: 0, stdout: args[0] === '--json' ? 'WARNING\n[{"Property":"SecurityLevel","Value":"Prototype"}]' : PASS_OUT, stderr: '', ms: 1 }) }), FLOOR, A, 'Pat', true);
    assert.equal(both.result.status, 'pass');
    assert.equal(both.state?.level, 'prototype');
    assert.equal(both.state?.source, 'mxcli');
  } finally {
    rmSync(base.dir, { recursive: true, force: true });
  }
});

test("the mx for a check: the office's MXBUILD_PATH of another Mendix version gives way to the project's Studio Pro", () => {
  const env = { ProgramFiles: 'C:\\Program Files' };
  const office = () => ({ path: 'C:\\Program Files\\Mendix\\10.24.25.1\\modeler\\mxbuild.exe', source: 'office' as const, version: '11.12.4', skipped: [] });
  const p = pickForCheck('/x/App.mpr', {}, office, () => true, env);
  assert.equal(p.source, 'studio-pro');
  assert.match(p.path ?? '', /11\.12\.4[\\/]modeler[\\/]mxbuild\.exe$/);
  assert.match(p.skipped[0], /is not Mendix 11\.12\.4/);
  assert.equal(pickForCheck('/x/App.mpr', {}, office, () => false, env).source, 'office', 'no such Studio Pro: the pick as it was');
  const toolkit = () => ({ path: 'D:\\mx\\mxbuild.exe', source: 'toolkit.env' as const, version: '11.12.4', skipped: [] });
  assert.equal(pickForCheck('/x/App.mpr', {}, toolkit, () => true, env).source, 'toolkit.env', "the project's own toolkit.env setting wins");
});

const v = (id: string, title: string, status: string) => ({ id, title, status });
const AT_BUILD = [v('P', 'Kickoff', 'PASS'), v('0', 'Triage', 'PASS'), v('1', 'Analysis', 'PASS'), v('2', 'Requirements', 'PASS'), v('3', 'Architecture & Design', 'PASS'), v('4', 'Build Plan', 'PASS'), v('5', 'Build', 'MANUAL'), v('6', 'Test', 'PENDING'), v('7', 'Cutover', 'PENDING')];

test("the sign-off goes through the gate's guard: refused with what's missing, the lead never told; met, it goes", async () => {
  const told: string[] = [];
  const dataDir = tmp('signoff');
  try {
    const d: SignoffDeps = { dataDir, now: () => NOW, setup: async () => ({ show: false, stages: [], questions: [], checking: false, toolkit: true, verdicts: AT_BUILD }) as SetupView, lead: () => 'Ada', tell: async (_f, text) => void told.push(text), guard: async (_f, stage) => (stage === '5' ? 'Signing off Stage 5 needs the project\'s security baseline met at aaaaaaa. Missing: No mx check at aaaaaaa yet.' : undefined) };
    const r = await signOff(d, { id: 'f1' } as Floor, '5', 'Pat', undefined);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /Missing: No mx check/);
    assert.equal(told.length, 0, 'nothing is told while refused');
    const ok = await signOff({ ...d, guard: async () => undefined }, { id: 'f1' } as Floor, '5', 'Pat', undefined);
    assert.ok(ok.ok);
    assert.equal(told.length, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Needs you: the card only once the build has started, listing what is missing on main and a failing check; stable across commits with the same gaps', () => {
  const offAt = (sha: string) => judgeGate(DEFAULT_POLICY, 'build', sha, STATE({ commit: sha, level: 'off' }), undefined);
  assert.equal(securityItem('4', offAt(A), undefined), undefined, 'before the build: no card');
  const it = securityItem('5', offAt(A), CHECK({ status: 'fail', errors: 6, codes: [{ code: 'CE2729', count: 6 }] }), 'Ada')!;
  assert.equal(it.kind, 'security');
  assert.equal(it.level, 'warn');
  assert.equal(it.text, 'Security baseline not met on main (Stage 5): App security is Off at aaaaaaa; the policy needs Production and 1 more');
  assert.deepEqual(it.lines, ['App security is Off at aaaaaaa; the policy needs Production', 'mx check at aaaaaaa found 6 errors (CE2729)']);
  assert.deepEqual(it.acts.map((a) => a.label), ['Ask Ada to fix', 'Hide']);
  assert.equal(securityItem('6', offAt(B), undefined)!.id, securityItem('6', offAt(A), undefined)!.id, 'the same gaps on a new commit: the same card (Hide holds)');
  assert.equal(securityItem('all', judgeGate(DEFAULT_POLICY, 'build', A, STATE(), undefined), CHECK()), undefined, 'nothing missing: no card');
  assert.equal(securityItem('5', judgeGate(cleanPolicy({ enforce: false, reason: 'demo' }), 'build', A, STATE({ level: 'off' }), undefined), undefined)!.level, 'info', 'advisory: an info card');
});

test('Needs you: the card is carried by the asks look, and its button tells the lead exactly what is missing', () => {
  const item: AskItem = { id: 'security:aaaa:1', kind: 'security', text: 'Security baseline not met on main (Stage 5): App security is Off at aaaaaaa; the policy needs Production', level: 'warn', lines: ['App security is Off at aaaaaaa; the policy needs Production'], acts: [{ act: 'ask-lead', label: 'Ask Ada to fix' }, { act: 'seen', label: 'Hide' }] };
  assert.deepEqual(detectAsks({ reads: [], now: NOW, security: [item] }).items.map((i) => i.id), [item.id]);
  const tell = actMessage('ask-lead', item, 'Pat')!;
  assert.equal(tell, securityTell(item.lines!));
  assert.match(tell, /1\. App security is Off at aaaaaaa; the policy needs Production/);
  assert.match(tell, /mxcli docker check -p <app>\.mpr/);
});

test("the Playbook: the baseline as instruction for the roles that write or check the model, only once the service hands the policy in", async () => {
  const { playbook } = await import('../src/server/roster/playbooks.js');
  const { ROLES } = await import('../src/shared/roster/roles.js');
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id.toUpperCase()])) as never;
  const base = { project: 'p', name: 'Dee', level: 2 as const, lessons: 'L.md', names };
  const HEAD = '## Security baseline (checked by the office)';
  assert.ok(!playbook('lead-developer', base).includes(HEAD), 'no service, no section (as before)');
  assert.deepEqual(securityOfProject('f1'), {});
  useSecurityPolicy(() => DEFAULT_POLICY);
  try {
    const ctx = { ...base, ...securityOfProject('f1') };
    for (const role of ['lead-developer', 'solo-lead', 'lead-tester'] as const) assert.ok(playbook(role, ctx).includes(HEAD), role);
    assert.ok(!playbook('chief-analyst', ctx).includes(HEAD));
    assert.ok(!playbook('lead-designer', ctx).includes(HEAD));
    assert.equal(securityRole('pm', ['lead-developer']), true, 'whoever covers Development');
    const text = playbook('lead-developer', ctx);
    assert.match(text, /ALTER APP SECURITY \( SecurityLevel: PRODUCTION \)/);
    assert.match(text, /mx\.data\.\*/);
    assert.match(text, /`mx check`, not only `mxcli check`/);
    assert.match(text, /it refuses the Project Manager's sign-off of Stage 4 or later/);
    assert.match(securityPlaybookLines(cleanPolicy({ level: 'prototype', reason: 'spike' })).join('\n'), /prototype only\*\* \(spike\)/);
  } finally {
    useSecurityPolicy(undefined);
  }
});

test('the new app: security set to the baseline with mxcli and read back; no mxcli or a refusal is said, never a failed setup', async () => {
  const dir = tmp('wizard');
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'App.mpr'), '');
    const calls: string[][] = [];
    const run = (async (_cmd: string, args: string[]) => {
      calls.push(args);
      return { code: 0, tail: [], stdout: args[0] === '--json' ? 'WARNING\n[{"Property":"SecurityLevel","Value":"Production"},{"Property":"StrictMode","Value":"true"},{"Property":"DemoUsersEnabled","Value":"true"}]' : '' };
    }) as never;
    const r = { run, env: {}, onLine: () => undefined };
    assert.equal(await withSecurityBaseline('mxcli', dir, 'App.mpr made', r), 'App.mpr made; app security now Production, strict mode on, demo users on (for building) (read back with mxcli)');
    assert.deepEqual(calls[0], ['-p', path.join(dir, 'App.mpr'), '-c', BASELINE_MDL]);
    assert.match(await withSecurityBaseline(undefined, dir, 'made', r), /left as the template made it \(no mxcli/);
    const refusing = (async () => ({ code: 1, tail: ['Parse error'], stdout: '' })) as never;
    assert.match(await withSecurityBaseline('mxcli', dir, 'made', { ...r, run: refusing }), /couldn't set app security \(mxcli exit 1: Parse error\)/);
    const throwing = (async () => {
      throw new Error('spawn ENOENT');
    }) as never;
    assert.match(await withSecurityBaseline('mxcli', dir, 'made', { ...r, run: throwing }), /couldn't set app security \(spawn ENOENT\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
