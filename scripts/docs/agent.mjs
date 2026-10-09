#!/usr/bin/env node
// The docs screenshots' stand-in agent (scripts/docs-shots.mjs), for their test office only: it never
// calls a model and never spends anything. Unlike the performance guard's fake (scripts/perf/fakebin),
// it writes nothing: it tells the office's hooks it's at work on one believable thing (DEMO_AGENTS, the
// demo's demo-agents.json, by worker id: its transcript and the tool it's "using") and stays that way,
// so a screenshot shows a working agent and the same text every time. One-shot calls (`-p`) answer empty.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('-p') || args.includes('--print')) {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } })}\n`);
  process.exit(0);
}
const at = (...names) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? args[i + 1] : undefined;
};
const sid = at('--resume', '-r', '--session-id') ?? crypto.randomUUID();
const me = process.env.AGENT_OFFICE_WORKER_ID;
let mine = {};
try {
  mine = JSON.parse(fs.readFileSync(process.env.DEMO_AGENTS ?? '', 'utf8'))[me] ?? {};
} catch {
  // not one of the demo's: it just sits there
}
const base = process.env.AGENT_OFFICE_HOOK_URL;
const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
const hook = (event, payload = {}) =>
  new Promise((resolve) => {
    if (!base) return resolve(undefined);
    const url = new URL(`${base}/hooks/claude`);
    url.searchParams.set('worker', me ?? '');
    url.searchParams.set('event', event);
    const req = http.request(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (r) => (r.resume(), r.on('end', resolve)));
    req.on('error', () => resolve(undefined));
    req.end(JSON.stringify({ session_id: sid, transcript_path: mine.transcript, cwd: process.cwd(), hook_event_name: event, ...payload }));
  });

process.stdout.write(`\x1b[1m${mine.tool ?? 'Ready'}\x1b[0m ${mine.input ? JSON.stringify(mine.input) : ''}\r\n`);
await hook('SessionStart', { source: at('--resume', '-r') ? 'resume' : 'startup' });
if (mine.tool) {
  await hook('UserPromptSubmit', { prompt: 'Carry on.' });
  await hook('PreToolUse', { tool_name: mine.tool, tool_input: mine.input });
}
process.stdin.on('data', () => {});
process.stdin.resume();
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));
