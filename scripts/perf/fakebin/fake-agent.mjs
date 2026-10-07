#!/usr/bin/env node
// A stand-in for an agent CLI, for test offices only: it never calls a model and never spends anything.
// It stays up like Claude Code does, says who it is to the office's hooks (SessionStart with a session id
// and a transcript path), and writes a transcript of real shape (assistant lines with tool_use blocks and
// usage, user lines with tool_result blocks) to a folder of its own, so the office's Chat view, terminal,
// activity line and budget meter all see a live, busy worker.
//
// FAKE_MODE      live (default): a tool call every FAKE_RATE_MS, forever. turn: one short turn per prompt.
// FAKE_RATE_MS   how often a live worker calls a tool (default 400).
// FAKE_DIR       where transcripts go (default <tmp>/test-offices-fake-agent). Never a real ~/.claude.
// FAKE_ESCALATE  raise an escalation to the Project Manager once, this many ms after starting.
// Prompts typed into its terminal (one line each) become a user line and a short reply; a prompt with
// "escalate" in it raises an escalation; one with "pr" in it reports a fake pull request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const at = (...names) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? args[i + 1] : undefined;
};
const sid = at('--resume', '-r', '--session-id') ?? crypto.randomUUID();
const dir = process.env.FAKE_DIR || path.join(os.tmpdir(), 'test-offices-fake-agent');
fs.mkdirSync(dir, { recursive: true });
const transcript = path.join(dir, `${sid}.jsonl`);
const base = process.env.AGENT_OFFICE_HOOK_URL;
const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
const me = process.env.AGENT_OFFICE_WORKER_ID;
const mode = process.env.FAKE_MODE || 'live';
const rate = Math.max(50, +(process.env.FAKE_RATE_MS || 400));

function post(pathname, query, body) {
  if (!base) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const req = http.request(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, (r) => {
      let s = '';
      r.on('data', (d) => (s += d));
      r.on('end', () => resolve(s));
    });
    req.on('error', () => resolve(undefined));
    req.end(JSON.stringify(body));
  });
}
const hook = (event, payload = {}) => post('/hooks/claude', { worker: me, event }, { session_id: sid, transcript_path: transcript, cwd: process.cwd(), hook_event_name: event, ...payload });
const office = (action, body) => post(`/office/workers${action}`, { worker: me }, body);

let seq = 0;
const iso = () => new Date().toISOString();
function line(o) {
  fs.appendFileSync(transcript, JSON.stringify({ sessionId: sid, timestamp: iso(), uuid: `${sid.slice(0, 8)}-${++seq}`, ...o }) + '\n');
}
const usage = () => ({ input_tokens: 40 + (seq % 50), output_tokens: 120 + (seq % 300), cache_read_input_tokens: 2000 + seq * 3, cache_creation_input_tokens: seq % 7 === 0 ? 500 : 0 });
function assistant(content) {
  line({ type: 'assistant', message: { id: `msg_${sid.slice(0, 6)}_${seq + 1}`, role: 'assistant', model: 'claude-fake-1', content, usage: usage() } });
}
const say = (text) => assistant([{ type: 'text', text }]);
const out = (s) => process.stdout.write(s.replace(/\n/g, '\r\n'));

const TOOLS = [
  () => ['Bash', { command: `npm test -- --grep step-${seq}` }],
  () => ['Read', { file_path: `src/module-${seq % 37}.ts` }],
  () => ['Edit', { file_path: `src/module-${seq % 37}.ts`, old_string: 'a', new_string: 'b' }],
  () => ['Grep', { pattern: `todo-${seq % 11}` }],
];
let n = 0;
async function step() {
  n++;
  const [name, input] = TOOLS[n % TOOLS.length]();
  const id = `toolu_${sid.slice(0, 6)}_${n}`;
  await hook('PreToolUse', { tool_name: name, tool_input: input });
  assistant([{ type: 'tool_use', id, name, input }]);
  out(`\x1b[32m●\x1b[0m ${name}(${JSON.stringify(input).slice(0, 60)})\n  ⎿ ok ${'.'.repeat(n % 30)}\n`);
  setTimeout(() => {
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: n % 23 === 0 }] } });
    hook('PostToolUse', { tool_name: name, tool_input: input, tool_response: { stdout: 'ok' } });
  }, Math.min(150, rate / 2));
  if (n % 9 === 0) say(`Step ${n}: checked module ${n % 37}; the tests pass. Moving on to the next one.`);
}

async function escalate(title) {
  const r = await office('/escalate', { title, urgency: 'urgent', trigger: 'design', details: 'Raised by the fake agent in a test office.', options: ['Option A', 'Option B'], recommendation: 'Option A' });
  out(`escalated: ${r ?? 'no answer'}\n`);
}

async function turn(prompt) {
  line({ type: 'user', message: { role: 'user', content: prompt } });
  await hook('UserPromptSubmit', { prompt });
  for (let i = 0; i < 3; i++) await step();
  if (/escalat/i.test(prompt)) await escalate('Which login flow should the leave app use? (fake)');
  if (/\bpr\b/i.test(prompt)) out(await office('/pr', { url: 'https://github.com/example/fake/pull/1' }) ?? '' + '\n');
  say(`Done (fake): ${prompt.slice(0, 80)}`);
  await hook('Stop', {});
}

out(`fake agent (test office) ${me ?? '?'} session ${sid} mode ${mode}\n`);
await hook('SessionStart', { source: at('--resume', '-r') ? 'resume' : 'startup' });
if (mode === 'live') {
  setTimeout(() => hook('UserPromptSubmit', { prompt: 'carry on (fake)' }), 300);
  setInterval(step, rate);
}
if (process.env.FAKE_ESCALATE) setTimeout(() => escalate('Which login flow should the leave app use? (fake)'), +process.env.FAKE_ESCALATE || 1000);

// The office types prompts into the terminal; Enter (\r) ends one.
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  const parts = buf.split(/\r\n|\r|\n/);
  buf = parts.pop() ?? '';
  for (const p of parts) if (p.trim()) turn(p.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b\[20[01]~/g, '').trim());
});
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
