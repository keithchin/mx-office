// 🔑 Claude for agents, gateway mode end to end: a worker started by the office (hired, resumed after it
// exited, put to sleep and woken as ⏸/▶ Pause/Resume project does, and restarted from the card) gets the
// gateway's ANTHROPIC_BASE_URL with its key, and the key approved in the Claude config it reads (else Claude
// Code's interactive screen ignores the key and asks for /login). A test office keeps withholding both.
// Fake keys and a fake agent only: the fake writes the NAMES of the Claude variables it got, the base URL, and
// whether the key is the fake one. 🧪 Test the gateway is checked against a fake fetch, never a real gateway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeDir } from './support/cleanup.js';
import { runnable } from './support/winshim.js';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { childEnv } from '../src/server/workers/env.js';
import { closeConnections, officeSettings, openConnections, updateOfficeSettings } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { AuditLog, useAudit } from '../src/server/audit/index.js';
import { officeClaudeKey, withClaudeAuth, type SourceDeps } from '../src/server/claude-auth/source.js';
import { resetClaudeAuth, restartAgents, testGateway } from '../src/server/claude-auth/index.js';
import { apiKeyTail, approveApiKey } from '../src/server/claude-trust.js';
import { sourceWords } from '../src/shared/claude-auth.js';

const FAKE_GW_KEY = 'fake-gateway-key-for-tests-0000000000wxyz';
const GW = 'https://llm-gateway.example.com';
const NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

const fakeAgent = `#!/usr/bin/env node
const fs = require('node:fs');
const names = ${JSON.stringify(NAMES)}.filter((k) => process.env[k] !== undefined);
fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({
  worker: process.env.AGENT_OFFICE_WORKER_ID,
  args: process.argv.slice(2),
  names,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  keyIsFake: process.env.ANTHROPIC_API_KEY === process.env.FAKE_EXPECTED_KEY,
}) + '\\n');
if (process.argv.includes('--output-format')) { process.stdout.write('{}'); process.exit(0); }
process.stdout.write('fake-agent-ready\\r\\n');
process.stdin.resume();
`;

type Rec = { worker?: string; args: string[]; names: string[]; baseUrl?: string; keyIsFake: boolean };

const saved: Record<string, string | undefined> = {};
const VARS = ['CLAUDE_CONFIG_DIR', 'FAKE_AGENT_LOG', 'FAKE_EXPECTED_KEY', 'AGENT_OFFICE_TEST_MODE', 'HOME', 'USERPROFILE', ...NAMES];

function office(t: { after(fn: () => void | Promise<void>): void }) {
  for (const k of VARS) saved[k] = process.env[k];
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-office-gw-'));
  const data = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  const config = path.join(root, 'claude-config');
  for (const d of [data, bin, config]) mkdirSync(d, { recursive: true });
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, fakeAgent, { mode: 0o700 });
  runnable(claude);
  const log = path.join(root, 'env.jsonl');
  writeFileSync(log, '');
  // Nothing of the machine's own: no Claude variables, a Claude config of the test's own.
  for (const k of NAMES) delete process.env[k];
  delete process.env.AGENT_OFFICE_TEST_MODE;
  process.env.HOME = process.env.USERPROFILE = path.join(root, 'home');
  process.env.CLAUDE_CONFIG_DIR = config;
  process.env.FAKE_AGENT_LOG = log;
  process.env.FAKE_EXPECTED_KEY = FAKE_GW_KEY;
  closeConnections();
  resetClaudeAuth();
  const vault = openConnections(data, fileCipher);
  useAudit(new AuditLog(path.join(data, 'audit')));
  const events: WorkerEvents = { update() {}, remove() {}, data() {}, screen() {}, toast() {} };
  const m = new WorkerManager(root, data, claude, [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  t.after(async () => {
    m.shutdown();
    updateOfficeSettings({ claudeAuth: undefined });
    closeConnections();
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await new Promise((r) => setTimeout(r, 200));
    removeDir(root);
  });
  const read = (): Rec[] => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
  const launches = () => read().filter((r) => r.args.includes('--settings'));
  return { root, data, config, vault, m, read, launches };
}

async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let v = read();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 30));
    v = read();
  }
  assert.ok(ok(v), 'timed out waiting for the fake agent');
  return v;
}

const gatewayEnv = (r: Rec | undefined) => {
  assert.ok(r, 'the fake agent started');
  assert.deepEqual([...r.names].sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
  assert.equal(r.baseUrl, GW);
  assert.equal(r.keyIsFake, true);
};

test('gateway mode, not a test office: every way a worker starts gets the base URL with its key, approved for Claude Code', async (t) => {
  const o = office(t);
  // An inherited key without its base URL in the office's own environment (the case that started this): never passed.
  process.env.ANTHROPIC_API_KEY = 'fake-inherited-key-1234';
  await o.vault.set('claude-gateway', FAKE_GW_KEY, 'Admin');
  updateOfficeSettings({ claudeAuth: { mode: 'gateway', baseUrl: GW, at: Date.now(), by: 'Admin' } });

  // Every one-off command the office runs for itself, too.
  const env = childEnv(o.root);
  assert.equal(env.ANTHROPIC_BASE_URL, GW);
  assert.equal(env.ANTHROPIC_API_KEY, FAKE_GW_KEY);

  // 1. Hired.
  const w = await o.m.spawn('desk-1', 'test', 'first prompt');
  assert.equal(typeof w, 'object');
  if (typeof w === 'string') return;
  gatewayEnv((await until(o.launches, (l) => l.length >= 1))[0]);
  // The key is approved (by its last 20 characters, as Claude Code keys it) in the config this Claude reads.
  const cfg = () => JSON.parse(readFileSync(path.join(o.config, '.claude.json'), 'utf8'));
  assert.deepEqual(cfg().customApiKeyResponses.approved, [apiKeyTail(FAKE_GW_KEY)]);
  assert.ok(!readFileSync(path.join(o.config, '.claude.json'), 'utf8').includes(FAKE_GW_KEY), 'only the tail is written');

  // 2. Paused (⏸ Pause project puts it to sleep) and resumed (▶ Resume project / a wake).
  o.m.sleep(w.id);
  await until(() => o.m.get(w.id)?.status, (s) => s === 'exited');
  assert.equal(o.m.resume(w.id), undefined);
  gatewayEnv((await until(o.launches, (l) => l.length >= 2))[1]);

  // 3. 🔁 Restart all agents from the card: running ones too, not only the ones Claude refused.
  const other = await o.m.spawn('desk-2', 'test', 'second prompt');
  if (typeof other === 'string') assert.fail(other);
  await until(o.launches, (l) => l.length >= 3);
  const floors = new Map([['f1', { workers: o.m }]]);
  const r = await restartAgents({ floors } as never, { name: 'Admin' });
  assert.equal(r.restarted, 2);
  const after = await until(o.launches, (l) => l.length >= 5);
  for (const rec of after.slice(3)) gatewayEnv(rec);
  assert.deepEqual(new Set(after.slice(3).map((x) => x.worker)), new Set([w.id, other.id]));

  // A key rejected before (an earlier "No" to Claude Code's question) is approved again, the rest kept.
  writeFileSync(path.join(o.config, '.claude.json'), JSON.stringify({ customApiKeyResponses: { approved: ['someone-else'], rejected: [apiKeyTail(FAKE_GW_KEY)] }, keep: 1 }));
  assert.equal(approveApiKey(path.join(o.config, '.claude.json'), FAKE_GW_KEY), 'approved');
  assert.deepEqual(cfg(), { customApiKeyResponses: { approved: ['someone-else', apiKeyTail(FAKE_GW_KEY)], rejected: [] }, keep: 1 });
  assert.equal(approveApiKey(path.join(o.config, '.claude.json'), FAKE_GW_KEY), 'already');
});

test('a test office keeps withholding: gateway mode passes nothing, approves nothing, and never tests the gateway', async (t) => {
  const o = office(t);
  await o.vault.set('claude-gateway', FAKE_GW_KEY, 'Admin');
  updateOfficeSettings({ claudeAuth: { mode: 'gateway', baseUrl: GW } });
  process.env.AGENT_OFFICE_TEST_MODE = '1';
  process.env.ANTHROPIC_API_KEY = 'fake-inherited-key-1234';
  const env = childEnv(o.root);
  assert.deepEqual(NAMES.filter((k) => env[k] !== undefined), []);
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: FAKE_GW_KEY, ANTHROPIC_BASE_URL: GW }), undefined);
  let called = false;
  const check = await testGateway(undefined, (async () => ((called = true), new Response(''))) as typeof fetch);
  assert.equal(check.ok, false);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(o.config, '.claude.json')), false);
});

test('only the office’s own key is approved, and never in a real config under the test runner', () => {
  const d = (mode: 'gateway' | 'key' | 'env', test = false): SourceDeps => ({ started: { ANTHROPIC_API_KEY: 'fake-env-key' }, setting: () => ({ mode, baseUrl: GW }), stored: (id) => (id === 'claude-gateway' ? FAKE_GW_KEY : id === 'anthropic' ? 'sk-ant-api03-fake' : undefined), testMode: () => test });
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: FAKE_GW_KEY, ANTHROPIC_BASE_URL: GW }, d('gateway')), FAKE_GW_KEY);
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: FAKE_GW_KEY }, d('gateway')), undefined, 'not without its base URL');
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: 'fake-env-key' }, d('env')), undefined, 'the environment’s key is the environment’s');
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: 'sk-ant-api03-fake' }, d('key')), 'sk-ant-api03-fake');
  assert.equal(officeClaudeKey({ ANTHROPIC_API_KEY: FAKE_GW_KEY, ANTHROPIC_BASE_URL: GW }, d('gateway', true)), undefined);
  assert.equal(approveApiKey(path.join(os.homedir(), '.claude.json'), FAKE_GW_KEY), 'skipped');
  // The environment back as the source restores the office's own set, even into an environment built before.
  const env = withClaudeAuth({ ANTHROPIC_API_KEY: FAKE_GW_KEY, ANTHROPIC_BASE_URL: GW }, d('env'));
  assert.deepEqual(env, { ANTHROPIC_API_KEY: 'fake-env-key' });
  // And the page warns that such a key goes to Anthropic directly.
  assert.match(sourceWords('env', true, { keys: [{ name: 'ANTHROPIC_API_KEY' }], baseUrl: false, cloud: [], withheld: [] }, {}).warning ?? '', /no ANTHROPIC_BASE_URL: agents will send this key to Anthropic directly.*choose A gateway/);
});

test('🧪 Test the gateway: one GET of its models list with the key; reachable, refused, missing, unreachable', async () => {
  const d: SourceDeps = { started: {}, setting: () => ({ mode: 'gateway', baseUrl: GW }), stored: (id) => (id === 'claude-gateway' ? FAKE_GW_KEY : undefined), testMode: () => false };
  const asked: { url: string; method?: string; key?: string }[] = [];
  const fake = (status: number | Error) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(url), method: init?.method, key: (init?.headers as Record<string, string>)['x-api-key'] });
      if (status instanceof Error) throw status;
      return new Response('{}', { status });
    }) as typeof fetch;
  const ok = await testGateway(d, fake(200));
  assert.equal(ok.ok, true);
  assert.deepEqual(asked[0], { url: `${GW}/v1/models`, method: 'GET', key: FAKE_GW_KEY });
  const refused = await testGateway(d, fake(401));
  assert.match(refused.text, /refused the key \(401\)/);
  assert.match((await testGateway(d, fake(404))).text, /404/);
  assert.match((await testGateway(d, fake(new Error('getaddrinfo ENOTFOUND')))).text, /Couldn’t reach .*ENOTFOUND/);
  for (const c of [ok, refused]) assert.ok(!c.text.includes(FAKE_GW_KEY));
  const none = await testGateway({ ...d, stored: () => undefined }, fake(200));
  assert.match(none.text, /Save the gateway/);
  assert.equal(officeSettings().claudeAuth, undefined);
});
