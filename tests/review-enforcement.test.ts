// How much the review is enforced outside the office (shared/merge-gate-protection.ts, merge-gate/gh.ts,
// merge-gate/protection-ask.ts), and a read-only probe of what an agent can do today with what it is given.
//   - the verdict per branch: Enforced (a human review required, or the check restricted to one App) /
//     Weak (the status required, but any holder of the agents' token can post it) / None / Unknown;
//   - the protection read with a fake gh: App restriction, ruleset and classic approvals, never a write;
//   - the one-time Needs-you note, under a stable id, gone once the branch reads Enforced;
//   - the trust probe: an agent's environment, run as a child process with fake values in a temporary office,
//     holds the token the office posts mx-office/review with, can read the office's data folder (its secret
//     store and its session secret), can post the status through gh itself, and could mint a session the office
//     takes as a fresh sign-in. It asserts today's truth so the gap stays visible; it never prints a value.
// Fake gh only (injected, or a fake gh.exe first on PATH), fake values only, no GitHub, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { protectionVerdict, AGENTS_TOKEN_NOTE } from '../src/shared/merge-gate-protection.js';
import { protectionOf } from '../src/shared/merge-gate.js';
import { readProtection, type GhRun } from '../src/server/merge-gate/gh.js';
import { MergeGate } from '../src/server/merge-gate/service.js';
import { useMergeGate } from '../src/server/merge-gate/index.js';
import { PROTECTION_ASK_ID, protectionAsks } from '../src/server/merge-gate/protection-ask.js';

function tmp(t: { after(fn: () => void): void }, name = 'review-enf-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- The verdict ------------------------------------------------------------------------------------

test('the verdict: a human review required is Enforced (with what to verify), the status alone is Weak, neither is None', () => {
  const enforced = protectionVerdict('main', { requiresGate: true, approvals: 1 });
  assert.equal(enforced.verdict, 'enforced');
  assert.match(enforced.verdictText, /requires 1 approving review on main/);
  assert.match(enforced.verdictText, /bypass/, 'it says a person still checks the bypass paths');
  assert.equal(protectionVerdict('main', { requiresGate: false, codeOwners: true, approvals: 0 }).verdict, 'enforced');
  const weak = protectionVerdict('main', { requiresGate: true, approvals: 0 });
  assert.equal(weak.verdict, 'weak');
  assert.match(weak.verdictText, /^Weak: main requires mx-office\/review, but the required status can be posted by any holder of the agents’ token/);
  assert.match(protectionVerdict('main', { requiresGate: true }).verdictText, /couldn’t read whether human approvals are required/);
  assert.equal(protectionVerdict('main', { requiresGate: true, appIds: [42], approvals: 0 }).verdict, 'enforced', 'restricted to one App');
  assert.equal(protectionVerdict('main', { requiresGate: false, approvals: 0 }).verdict, 'none');
  assert.equal(protectionVerdict('main', { requiresGate: false, unknown: true }).verdict, 'unknown');
  // The old claim ("GitHub refuses a merge without a counting review, whoever merges") is gone.
  const p = protectionOf('main', { protected: true, contexts: ['mx-office/review'], approvals: 0 });
  assert.equal(p.verdict, 'weak');
  assert.doesNotMatch(p.text, /whoever merges/);
  assert.match(p.text, /an agent holding that token could post it too/);
});

/** A fake gh for the protection reads; every call recorded. */
function protectionGh(answers: { branch?: unknown; rules?: unknown; reviews?: unknown; reviewsError?: string }) {
  const calls: string[][] = [];
  const run: GhRun = async (args) => {
    calls.push(args);
    if (args[0] !== 'api' || args.includes('--method') || args.includes('-X')) throw new Error(`unexpected gh ${args.join(' ')}`);
    if (/\/rules\/branches\//.test(args[1])) return JSON.stringify(answers.rules ?? []);
    if (/required_pull_request_reviews$/.test(args[1])) {
      if (answers.reviewsError) throw new Error(answers.reviewsError);
      return JSON.stringify(answers.reviews ?? {});
    }
    if (/\/branches\/main$/.test(args[1])) return JSON.stringify(answers.branch ?? { name: 'main', protected: false });
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { calls, run };
}

test('the protection read: App restriction, approvals from rulesets and classic protection, and only reads', async () => {
  const gate = { contexts: [], checks: [{ context: 'mx-office/review', app_id: null }] };
  const cases: [Parameters<typeof protectionGh>[0], string, Record<string, unknown>][] = [
    [{ branch: { name: 'main', protected: false } }, 'none', { approvals: 0 }],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: gate } }, reviewsError: 'gh: Required pull request reviews not enabled (HTTP 404)' }, 'weak', { approvals: 0 }],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: gate } }, reviewsError: 'gh: Resource not accessible by personal access token (HTTP 403)' }, 'weak', { approvals: undefined }],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: gate } }, reviews: { required_approving_review_count: 2, require_code_owner_reviews: true } }, 'enforced', { approvals: 2, codeOwners: true }],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: { checks: [{ context: 'mx-office/review', app_id: 4242 }] } } }, reviewsError: 'gh: Not Found (HTTP 404)' }, 'enforced', { appIds: [4242] }],
    [{ branch: { name: 'main', protected: false }, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'mx-office/review' }] } }, { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: false } }] }, 'enforced', { approvals: 1 }],
    [{ branch: { name: 'main', protected: false }, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'mx-office/review', integration_id: 77 }] } }] }, 'enforced', { appIds: [77] }],
  ];
  for (const [answers, want, facts] of cases) {
    const fake = protectionGh(answers);
    const p = await readProtection(fake.run, '/repo', 'main');
    assert.equal(p.verdict, want, JSON.stringify(answers));
    for (const [k, v] of Object.entries(facts)) assert.deepEqual((p as unknown as Record<string, unknown>)[k], v, `${k} for ${JSON.stringify(answers)}`);
    assert.ok(fake.calls.every((a) => a[0] === 'api' && !a.includes('--method')), 'reads only, never a write');
  }
});

// ---- The one-time Needs-you note --------------------------------------------------------------------

test('the Needs-you note: once per project with a GitHub remote, under a stable id, gone once the branch reads Enforced', async (t) => {
  const dir = tmp(t);
  let answers: Parameters<typeof protectionGh>[0] = { branch: { name: 'main', protected: true, protection: { required_status_checks: { checks: [{ context: 'mx-office/review' }] } } }, reviewsError: 'gh: Resource not accessible (HTTP 403)' };
  const run: GhRun = (args, cwd) => protectionGh(answers).run(args, cwd);
  let now = 1_000_000;
  const gate = new MergeGate(dir, run, () => now);
  const ctx = { cfg: { dataDir: dir }, floors: new Map([['shop', { id: 'shop', dir }]]) } as never;
  useMergeGate(ctx, gate, () => ({ id: 'shop', dir, look: { agents: [] }, personReviews: false }));
  assert.deepEqual(protectionAsks(ctx, 'shop', { branch: 'main', remote: false }), [], 'no GitHub remote: nothing to say');
  assert.deepEqual(protectionAsks(ctx, 'nope', { branch: 'main', remote: true }), []);
  const first = protectionAsks(ctx, 'shop', { branch: 'main', remote: true });
  assert.equal(first.length, 1);
  assert.equal(first[0].id, PROTECTION_ASK_ID);
  assert.equal(first[0].level, 'info', 'a note, not an alarm');
  assert.ok(first[0].lines?.includes(AGENTS_TOKEN_NOTE));
  assert.deepEqual(first[0].acts.map((a) => a.act), ['seen'], 'Hide keeps it hidden while it stands');
  await gate.protection({ id: 'shop', dir, look: { agents: [] }, personReviews: false }, 'main');
  const weak = protectionAsks(ctx, 'shop', { branch: 'main', remote: true });
  assert.equal(weak[0].id, first[0].id, 'the same id on every look: one card per project, not one per look');
  assert.ok(weak[0].lines?.some((l) => /^Weak: /.test(l)), 'it carries the verdict once read');
  answers = { branch: { name: 'main', protected: true, protection: { required_status_checks: { checks: [{ context: 'mx-office/review' }] } } }, reviews: { required_approving_review_count: 1 } };
  now += 11 * 60_000;
  await gate.protection({ id: 'shop', dir, look: { agents: [] }, personReviews: false }, 'main');
  assert.deepEqual(protectionAsks(ctx, 'shop', { branch: 'main', remote: true }), [], 'Enforced: the note goes');
});

// ---- The trust probe: what an agent can do today ----------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('trust probe (read only, fake values): an agent holds the status-posting token, can read the office’s secrets, post the status, and mint a fresh session', async (t) => {
  const { openConnections, closeConnections } = await import('../src/server/connections/store.js');
  const { fileCipher } = await import('../src/server/connections/vault.js');
  const { childEnv } = await import('../src/server/workers/env.js');
  const { Auth, SESSION_TTL_MS } = await import('../src/server/auth.js');
  const { ReauthBook } = await import('../src/server/mobile/reauth.js');
  const { runnable } = await import('./support/winshim.js');
  const data = tmp(t, 'review-enf-office-');
  const project = tmp(t, 'review-enf-project-');
  const bin = tmp(t, 'review-enf-gh-');
  // A fake agents' token (the shape of one, random, never real), saved in Connections as an admin would.
  const FAKE = `github_pat_${randomBytes(24).toString('hex')}`;
  const before = { allow: process.env.AGENT_OFFICE_TEST_ALLOW_GH_TOKEN, gh: process.env.GH_TOKEN, github: process.env.GITHUB_TOKEN };
  process.env.AGENT_OFFICE_TEST_ALLOW_GH_TOKEN = '1';
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  t.after(() => {
    closeConnections();
    for (const [k, v] of [['AGENT_OFFICE_TEST_ALLOW_GH_TOKEN', before.allow], ['GH_TOKEN', before.gh], ['GITHUB_TOKEN', before.github]] as const) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const vault = openConnections(data, fileCipher);
  await vault.set('github-agents', FAKE, 'probe');
  // The office's config.json as config.ts keeps it: the session secret and the password's hash, in the data folder.
  const salt = randomBytes(16);
  const verifier = scryptSync(`pw-${randomBytes(8).toString('hex')}`, salt, 32);
  const secret = randomBytes(32).toString('hex');
  writeFileSync(path.join(data, 'config.json'), JSON.stringify({ secret, salt: salt.toString('hex'), verifier: verifier.toString('hex') }));

  // 1. What the office gives an agent: the same GitHub token the office's own gh posts mx-office/review with.
  const env = childEnv(project);
  assert.ok(env.GH_TOKEN === FAKE && env.GITHUB_TOKEN === FAKE, 'agents get the agents’ token (connections/env.ts)');
  assert.ok(!Object.keys(env).some((k) => k.startsWith('AGENT_OFFICE_')), 'office variables are scrubbed from the agent’s environment (workers/env.ts)');

  // 2. Run as the agent would (a child process with that environment): can it read the office's data folder?
  const probe = `const fs = require('fs'); const p = require('path'); const d = process.argv[1];
    const can = (f) => { try { return fs.readFileSync(p.join(d, f), 'utf8').length > 0; } catch { return false; } };
    let secret = false; try { secret = typeof JSON.parse(fs.readFileSync(p.join(d, 'config.json'), 'utf8')).secret === 'string'; } catch {}
    process.stdout.write(JSON.stringify({ credentials: can('credentials.json'), config: can('config.json'), secret, token: !!process.env.GH_TOKEN }));`;
  const saw = JSON.parse(execFileSync(process.execPath, ['-e', probe, data], { env, encoding: 'utf8' })) as Record<string, boolean>;
  assert.deepEqual(saw, { credentials: true, config: true, secret: true, token: true }, 'same OS user: the secret store and the session secret are readable by an agent');

  // 3. Can the agent post a passing mx-office/review itself? Through a fake gh.exe first on its PATH.
  const log = path.join(bin, 'calls.log');
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('fs'); const c = require('crypto');
const t = process.env.GH_TOKEN || '';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), token: t ? c.createHash('sha256').update(t).digest('hex') : '' }) + '\\n');
process.stdout.write('{"state":"success","context":"mx-office/review"}');
`,
  );
  runnable(path.join(bin, 'gh'));
  const PATH = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const agentEnv = { ...env, [PATH]: `${bin}${path.delimiter}${env[PATH] ?? ''}` };
  const head = 'a'.repeat(40);
  const out = execFileSync('gh', ['api', '--method', 'POST', `repos/{owner}/{repo}/statuses/${head}`, '-f', 'state=success', '-f', 'context=mx-office/review', '-f', 'description=Reviewed'], { env: agentEnv, encoding: 'utf8', cwd: project });
  assert.match(out, /"state":"success"/);
  const call = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop()!) as { args: string[]; token: string };
  assert.ok(call.token === sha(FAKE), 'the agent’s gh posted it with the very token the office posts with: GitHub can’t tell them apart');
  assert.ok(call.args.includes('context=mx-office/review'));

  // 4. With config.json's secret and hash, an agent can sign a session the office accepts, and it counts as a fresh sign-in.
  const officeAuth = new Auth(verifier, salt, secret, { sharedPassword: true } as never);
  const read = JSON.parse(readFileSync(path.join(data, 'config.json'), 'utf8')) as { secret: string; salt: string; verifier: string };
  const minted = new Auth(Buffer.from(read.verifier, 'hex'), Buffer.from(read.salt, 'hex'), read.secret, {} as never).issue();
  assert.ok(officeAuth.verify(minted), 'the office accepts a session signed with its own secret');
  assert.ok(new ReauthBook().fresh(minted), 'a minted session is “signed in within the last 10 minutes”: the review and override routes take it');
  assert.ok(SESSION_TTL_MS > 0);

  // Nothing above printed a value; the files the probe wrote hold only a hash.
  assert.ok(!readFileSync(log, 'utf8').includes(FAKE), 'the probe’s log holds no token');
});
