// 🔑 Claude for agents (server/claude-auth/, shared/claude-auth.ts): where the agents' Claude credentials come
// from, what goes into a worker's environment, the one-time decision about an inherited key, the office-wide
// alert when Claude rejects the credentials (one red item and one incident however many agents hit it, cleared
// by a turn that works), "Use the agents' Claude login instead", and the desktop app holding the set back.
// Every key here is a fake string; nothing calls Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeAuthMode, decisionPending, cleanBaseUrl, type ClaudeEnvSeen } from '../src/shared/claude-auth.js';
import { claudeAuthNeeds, CLAUDE_FAILED_KEY } from '../src/shared/decisions/claude-auth.js';
import { envSeen, sourceLogLine, claudeAuthState, withClaudeAuth, type SourceDeps } from '../src/server/claude-auth/source.js';
import { lastVerdict } from '../src/server/claude-auth/transcript.js';
import { AuthWatch } from '../src/server/claude-auth/watch.js';
import { claudeAuthView, noteAuthFailure, noteTurnOk, resetClaudeAuth, restartAffected, setClaudeAuth } from '../src/server/claude-auth/index.js';
import { closeConnections, officeSettings, openConnections, updateOfficeSettings } from '../src/server/connections/store.js';
import { fileCipher } from '../src/server/connections/vault.js';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { IncidentStore, useIncidents } from '../src/server/incidents/index.js';
import { CLAUDE_SET, claudeEnvLine, keepsClaudeEnv, officeEnv } from '../desktop/src/core/options.ts';

const FAKE_KEY = 'fake-gateway-key-0000000000000000wxyz';
const FAKE_API = 'sk-ant-api03-fakefakefakefakefakefake1234';
const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

const deps = (started: Record<string, string | undefined>, stored: Record<string, string> = {}, testMode = false): SourceDeps => ({
  started,
  setting: () => officeSettings().claudeAuth,
  stored: (id) => stored[id],
  testMode: () => testMode,
});

const seen = (o: Partial<ClaudeEnvSeen> = {}): ClaudeEnvSeen => ({ keys: [], baseUrl: false, cloud: [], withheld: [], ...o });

function freshOffice() {
  closeConnections();
  resetClaudeAuth();
  const dir = tmp('claude-auth-');
  const vault = openConnections(dir, fileCipher);
  useAudit(new AuditLog(path.join(dir, 'audit')));
  const store = new IncidentStore(path.join(dir, 'incidents'));
  useIncidents(store);
  return { dir, vault, store };
}

test('the source: none → their Claude login; an inherited key without a base URL is not passed; with its base URL it is; a saved key or a choice wins', () => {
  const none = envSeen({});
  assert.deepEqual(claudeAuthMode(undefined, false, none), { mode: 'login', chosen: false });
  const bare = envSeen({ ANTHROPIC_API_KEY: FAKE_KEY });
  assert.deepEqual(bare.keys, [{ name: 'ANTHROPIC_API_KEY', tail: '••••wxyz' }], 'a name and the last 4, never the value');
  assert.equal(claudeAuthMode(undefined, false, bare).mode, 'login', 'a key without its base URL may be a gateway’s: not passed by default');
  const gw = envSeen({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' });
  assert.equal(gw.baseUrl, true);
  assert.equal(claudeAuthMode(undefined, false, gw).mode, 'env', 'a complete set keeps working as it did');
  assert.equal(claudeAuthMode(undefined, false, envSeen({ CLAUDE_CODE_USE_BEDROCK: '1' })).mode, 'env');
  assert.equal(claudeAuthMode(undefined, true, bare).mode, 'key', 'an API key saved in Connections');
  assert.deepEqual(claudeAuthMode({ mode: 'gateway' }, true, gw), { mode: 'gateway', chosen: true });
  assert.deepEqual(envSeen({ AGENT_OFFICE_CLAUDE_WITHHELD: 'ANTHROPIC_API_KEY,PATH' }).withheld, ['ANTHROPIC_API_KEY'], 'only the set’s names');
});

test('the one-time decision appears only when the environment has a key nobody chose about', () => {
  assert.equal(decisionPending(undefined, false, seen()), false, 'no key: nothing to decide');
  assert.equal(decisionPending(undefined, false, seen({ keys: [{ name: 'ANTHROPIC_API_KEY' }] })), true);
  assert.equal(decisionPending(undefined, false, seen({ withheld: ['ANTHROPIC_API_KEY'] })), true, 'held back by the desktop app counts');
  assert.equal(decisionPending(undefined, true, seen({ keys: [{ name: 'ANTHROPIC_API_KEY' }] })), false, 'a saved API key wins anyway');
  assert.equal(decisionPending({ mode: 'login' }, false, seen({ keys: [{ name: 'ANTHROPIC_API_KEY' }] })), false, 'decided');
  assert.equal(decisionPending(undefined, false, seen({ cloud: ['CLAUDE_CODE_USE_VERTEX'] })), false);
});

test('a worker’s environment: the set taken out unless the environment is the source; a saved key or gateway in its place; never in a test office', () => {
  closeConnections();
  const started = { ANTHROPIC_API_KEY: FAKE_KEY };
  const worker = () => ({ PATH: 'p', ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_AUTH_TOKEN: 'fake-token', ANTHROPIC_BASE_URL: 'https://wrong.example', CLAUDE_CODE_OAUTH_TOKEN: 'keep-login' });
  // Undecided, no base URL: their login.
  let env = withClaudeAuth(worker(), deps(started));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'keep-login', 'a login token is a login');
  assert.equal(env.PATH, 'p');
  // A complete set, undecided: as before.
  env = withClaudeAuth(worker(), deps({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' }));
  assert.equal(env.ANTHROPIC_API_KEY, FAKE_KEY);
  // The switch on (login chosen): taken out even with its base URL.
  updateOfficeSettings({ claudeAuth: { mode: 'login' } });
  env = withClaudeAuth(worker(), deps({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' }));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  // Confirmed: passed as the office has it.
  updateOfficeSettings({ claudeAuth: { mode: 'env' } });
  assert.equal(withClaudeAuth(worker(), deps(started)).ANTHROPIC_API_KEY, FAKE_KEY);
  assert.equal(withClaudeAuth(worker(), deps(started, {}, true)).ANTHROPIC_API_KEY, undefined, 'a test office never passes it on');
  // A saved API key, and a gateway: always with what belongs to it.
  updateOfficeSettings({ claudeAuth: { mode: 'key' } });
  env = withClaudeAuth(worker(), deps(started, { anthropic: FAKE_API }));
  assert.equal(env.ANTHROPIC_API_KEY, FAKE_API);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  updateOfficeSettings({ claudeAuth: { mode: 'gateway', baseUrl: 'https://gw.example' } });
  env = withClaudeAuth(worker(), deps(started, { 'claude-gateway': FAKE_KEY }));
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://gw.example');
  assert.equal(env.ANTHROPIC_API_KEY, FAKE_KEY);
  env = withClaudeAuth(worker(), deps(started));
  assert.equal(env.ANTHROPIC_BASE_URL, undefined, 'no gateway key saved: neither goes');
  updateOfficeSettings({ claudeAuth: undefined });
});

test('the view says where the credentials come from, warns about an inherited key, and the log line has names only', () => {
  closeConnections();
  const d = deps({ ANTHROPIC_API_KEY: FAKE_KEY });
  const v = claudeAuthView(true, d);
  assert.equal(v.mode, 'login');
  assert.match(v.source, /Claude login \(no key passed\)/);
  assert.match(v.warning ?? '', /ANTHROPIC_API_KEY \(••••wxyz\) found in the office’s environment without ANTHROPIC_BASE_URL — not passed to agents; it may belong to a gateway/);
  assert.ok(v.decision, 'the one-time decision');
  assert.ok(!JSON.stringify(v).includes(FAKE_KEY), 'never the value');
  assert.equal(claudeAuthView(false, d).env.keys[0].tail, undefined, 'not even the tail for a non-admin');
  updateOfficeSettings({ claudeAuth: { mode: 'env' } });
  const env = claudeAuthView(true, d);
  assert.match(env.source, /ANTHROPIC_API_KEY \(••••wxyz\) without a base URL from the office’s environment \(started with it — e.g. a Windows user variable\)/);
  assert.match(env.warning ?? '', /Invalid API key/);
  assert.equal(env.decision, undefined);
  const line = sourceLogLine(claudeAuthState(d));
  assert.match(line, /the office’s environment has ANTHROPIC_API_KEY/);
  assert.ok(!line.includes('wxyz') && !line.includes(FAKE_KEY));
  updateOfficeSettings({ claudeAuth: undefined });
});

test('the transcript: Claude Code’s authentication failure, a real answer, other API errors say nothing', () => {
  const at = '2026-10-17T20:23:00.000Z';
  const fail = JSON.stringify({ type: 'assistant', timestamp: at, isApiErrorMessage: true, error: 'authentication_failed', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Invalid API key · Fix external API key' }] } });
  const old = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { model: '<synthetic>', content: [{ type: 'text', text: 'Invalid API key · Fix external API key' }] } });
  const ok = JSON.stringify({ type: 'assistant', timestamp: at, message: { model: 'claude-sonnet', content: [{ type: 'text', text: 'Done.' }] } });
  const rate = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { content: [{ type: 'text', text: 'Rate limited' }] } });
  const user = JSON.stringify({ type: 'user', message: { content: 'hi' } });
  assert.deepEqual(lastVerdict(`{"cut off half a line\n${ok}\n${user}\n${fail}\n`), { kind: 'auth-failed', at: Date.parse(at) });
  assert.equal(lastVerdict(`${old}\n`)?.kind, 'auth-failed', 'by its words, for a Claude Code that doesn’t name the error');
  assert.equal(lastVerdict(`${fail}\n${ok}\n`)?.kind, 'ok');
  assert.equal(lastVerdict(`${ok}\n${rate}\n`), undefined);
  assert.equal(lastVerdict(`${user}\n`), undefined);
  assert.equal(lastVerdict(`${ok}\n${JSON.stringify({ type: 'assistant', isSidechain: true, isApiErrorMessage: true, error: 'authentication_failed' })}\n`)?.kind, 'ok', 'a subagent’s line isn’t the turn');
});

test('the watch reads a transcript only when it changed, and reports failures and turns that worked', async () => {
  const files: Record<string, { size: number; text: string }> = {};
  const fails: string[] = [];
  const oks: string[] = [];
  let reads = 0;
  const now = Date.parse('2026-10-17T20:30:00Z');
  const watch = new AuthWatch({
    workers: () => [
      { id: 'w1', name: 'Sophie', floor: 'sample-checksheet-demo', transcript: 't1.jsonl' },
      { id: 'w2', name: 'Leslie', floor: 'sample-checksheet-demo' },
    ],
    onFail: (w) => fails.push(w.name),
    onOk: (w) => oks.push(w.name),
    now: () => now,
    stat: async (f) => (files[f] ? { size: files[f].size, mtimeMs: files[f].size } : undefined),
    tail: async (f) => (reads++, files[f].text),
  });
  const line = (o: object) => `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-17T20:23:00Z', ...o })}\n`;
  files['t1.jsonl'] = { size: 1, text: line({ isApiErrorMessage: true, error: 'authentication_failed' }) };
  await watch.tick();
  await watch.tick();
  assert.deepEqual(fails, ['Sophie']);
  assert.equal(reads, 1, 'unchanged: not read again');
  files['t1.jsonl'] = { size: 2, text: line({ message: { model: 'claude-sonnet', content: 'ok' } }) };
  await watch.tick();
  assert.deepEqual(oks, ['Sophie']);
  // A failure from hours ago (an office restarted long after) isn't news.
  files['t1.jsonl'] = { size: 3, text: `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-17T10:00:00Z', isApiErrorMessage: true, error: 'authentication_failed' })}\n` };
  await watch.tick();
  assert.deepEqual(fails, ['Sophie']);
});

test('an authentication failure is one red item and one incident for the office, cleared by a turn that works', () => {
  const { store } = freshOffice();
  try {
    const d = deps({ ANTHROPIC_API_KEY: FAKE_KEY });
    updateOfficeSettings({ claudeAuth: { mode: 'env' } });
    const T = Date.parse('2026-10-17T20:23:00Z');
    noteAuthFailure({ id: 'w1', name: 'Sophie', floor: 'sample-checksheet-demo' }, T, d);
    noteAuthFailure({ id: 'w1', name: 'Sophie', floor: 'sample-checksheet-demo' }, T, d);
    noteAuthFailure({ id: 'w2', name: 'Leslie', floor: 'other' }, T + 1000, d);
    const v = claudeAuthView(true, d);
    assert.equal(v.failure?.workers.length, 2);
    assert.match(v.failure!.text, /Claude rejected the API key agents use \(source: ANTHROPIC_API_KEY \(••••wxyz\) from the office’s environment\)\. A key from the office’s environment was passed without a base URL; it may be a gateway key\. Agents can’t work until it’s fixed\./);
    const needs = claudeAuthNeeds(v);
    assert.equal(needs.length, 1, 'one item for the office, not one per agent (and no decision beside it)');
    assert.equal(needs[0].key, CLAUDE_FAILED_KEY);
    assert.equal(needs[0].level, 'block', 'red');
    assert.deepEqual(needs[0].target, { to: 'claude-auth', act: 'login' });
    assert.equal(needs[0].action, 'Use the agents’ Claude login instead');
    assert.deepEqual(needs[0].alt, { action: 'How to fix', target: { to: 'claude-auth', act: 'help' } });
    assert.deepEqual(claudeAuthNeeds(claudeAuthView(false, d)).map((n) => n.action), ['How to fix'], 'a non-admin can only read how to fix it');
    const incidents = store.list().filter((i) => i.dedupeKey?.startsWith('claudeAuth:'));
    assert.equal(incidents.length, 1, 'one incident, office-wide');
    assert.equal(incidents[0].floors.length, 0);
    assert.equal(incidents[0].occurrences, 2);
    // A turn from before the failure doesn't clear it; one after does, with its incident.
    noteTurnOk(T - 1);
    assert.ok(claudeAuthView(true, d).failure);
    noteTurnOk(T + 5000);
    assert.equal(claudeAuthView(true, d).failure, undefined);
    assert.equal(store.get(incidents[0].id)?.status, 'resolved');
    const actions = readAudit({}).events.map((e) => e.action);
    assert.ok(actions.includes('claude-auth.failed') && actions.includes('claude-auth.cleared'));
    assert.equal(actions.filter((a) => a === 'claude-auth.failed').length, 1);
  } finally {
    updateOfficeSettings({ claudeAuth: undefined });
    closeConnections();
  }
});

test('“Use the agents’ Claude login instead” switches (admin, audited), then restarting brings the refused agents back', async () => {
  const { vault } = freshOffice();
  try {
    const d: SourceDeps = { started: { ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' }, setting: () => officeSettings().claudeAuth, stored: (id) => vault.get(id), testMode: () => false };
    assert.equal(claudeAuthView(true, d).mode, 'env');
    noteAuthFailure({ id: 'w1', name: 'Sophie', floor: 'sample-checksheet-demo' }, Date.now(), d);
    assert.equal(await setClaudeAuth({ mode: 'login' }, { name: 'Keith' }, d), undefined);
    const v = claudeAuthView(true, d);
    assert.deepEqual([v.mode, v.chosen], ['login', true]);
    assert.equal(withClaudeAuth({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' }, d).ANTHROPIC_API_KEY, undefined);
    assert.deepEqual(claudeAuthNeeds(v)[0].target, { to: 'claude-auth', act: 'restart' }, 'switched already: what’s left is restarting');
    const change = readAudit({}).events.find((e) => e.action === 'claude-auth.change');
    assert.match(change?.summary ?? '', /Keith set the agents’ Claude credentials to their Claude login \(was the office’s environment \(nobody chose\)\)/);
    // A gateway needs its address and key; the key goes in the vault, never in the settings or the audit log.
    assert.match((await setClaudeAuth({ mode: 'gateway', baseUrl: 'ftp://x', key: FAKE_KEY }, { name: 'Keith' }, d)) ?? '', /https:\/\//);
    assert.match((await setClaudeAuth({ mode: 'gateway', baseUrl: 'https://gw.example' }, { name: 'Keith' }, d)) ?? '', /key/);
    assert.equal(await setClaudeAuth({ mode: 'gateway', baseUrl: 'https://gw.example/', key: FAKE_KEY }, { name: 'Keith' }, d), undefined);
    assert.equal(vault.get('claude-gateway'), FAKE_KEY);
    assert.deepEqual(officeSettings().claudeAuth?.baseUrl, 'https://gw.example');
    assert.ok(!JSON.stringify(officeSettings()).includes(FAKE_KEY));
    assert.ok(!JSON.stringify(readAudit({}).events).includes(FAKE_KEY));
    assert.match((await setClaudeAuth({ mode: 'nope' }, { name: 'Keith' }, d)) ?? '', /Pick/);
    // Restart: the refused agent is put to sleep and resumed with a note.
    const calls: string[] = [];
    let status = 'working';
    const floors = new Map([['sample-checksheet-demo', { workers: { list: () => [{ id: 'w1', status }], sleep: (id: string) => (calls.push(`sleep ${id}`), (status = 'exited'), undefined), resume: (id: string, prompt?: string) => (calls.push(`resume ${id} ${/authentication/.test(prompt ?? '')}`), undefined) } }]]);
    assert.equal(await restartAffected({ floors } as never, { name: 'Keith' }), 1);
    assert.deepEqual(calls, ['sleep w1', 'resume w1 true']);
  } finally {
    updateOfficeSettings({ claudeAuth: undefined });
    closeConnections();
  }
});

test('the desktop app holds the Claude set back unless the office’s Connections say to keep it, and logs names only', () => {
  const base = { PATH: 'p', ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: undefined };
  const held = officeEnv(base, { home: '/h' });
  for (const k of CLAUDE_SET) assert.equal(held[k], undefined);
  assert.equal(held.AGENT_OFFICE_CLAUDE_WITHHELD, 'ANTHROPIC_API_KEY,ANTHROPIC_BASE_URL');
  assert.equal(held.PATH, 'p');
  const kept = officeEnv(base, { home: '/h' }, true);
  assert.equal(kept.ANTHROPIC_API_KEY, FAKE_KEY);
  assert.equal(kept.AGENT_OFFICE_CLAUDE_WITHHELD, undefined);
  assert.equal(officeEnv({ PATH: 'p' }, { home: '/h' }).AGENT_OFFICE_CLAUDE_WITHHELD, undefined);
  assert.equal(keepsClaudeEnv(JSON.stringify({ claudeAuth: { mode: 'env' } })), true);
  assert.equal(keepsClaudeEnv(JSON.stringify({ claudeAuth: { mode: 'login' } })), false);
  assert.equal(keepsClaudeEnv(undefined), false);
  assert.equal(keepsClaudeEnv('{not json'), false);
  const line = claudeEnvLine(base, false);
  assert.match(line, /not passing ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL/);
  assert.ok(!line.includes(FAKE_KEY) && !line.includes('gw.example'));
  // The office reads what was held back as names.
  assert.deepEqual(envSeen({ AGENT_OFFICE_CLAUDE_WITHHELD: held.AGENT_OFFICE_CLAUDE_WITHHELD }).withheld, ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
});

test('a gateway address is http(s) with no credentials in it', () => {
  assert.equal(cleanBaseUrl('https://llm.example.com/'), 'https://llm.example.com');
  assert.equal(cleanBaseUrl('https://u:p@llm.example.com'), undefined);
  assert.equal(cleanBaseUrl('javascript:alert(1)'), undefined);
  assert.equal(cleanBaseUrl(''), undefined);
});
