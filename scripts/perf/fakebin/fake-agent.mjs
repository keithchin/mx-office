#!/usr/bin/env node
// A stand-in for an agent CLI, for test offices only: it never calls a model and never spends anything.
// It stays up like Claude Code does, says who it is to the office's hooks (SessionStart with a session id
// and a transcript path), and writes a transcript of real shape (assistant lines with tool_use blocks and
// usage, user lines with tool_result blocks) to a folder of its own, so the office's Chat view, terminal,
// activity line and budget meter all see a live, busy worker.
//
// FAKE_MODE      live (default): a tool call every FAKE_RATE_MS, forever. turn: one short turn per prompt.
//                cycle: like a real busy agent, turns of FAKE_WORK_MS (default 30000, give or take half) that
//                end with a Stop, then FAKE_IDLE_MS (default 15000) idle before the next prompt, forever.
// FAKE_BIG       1: tool results of real size (a couple of KB, every seventh about 24 KB), so the
//                transcript grows as a real one does.
// FAKE_RATE_MS   how often a live worker calls a tool (default 400).
// FAKE_DIR       where transcripts go (default <tmp>/test-offices-fake-agent). Never a real ~/.claude;
//                claude-home: ~/.claude/projects/… when ~ is a test office's folder (see below).
// FAKE_ESCALATE  raise an escalation to the Project Manager once, this many ms after starting.
// FAKE_TURN_MS   the least time a turn takes (default 0: a few hundred ms).
// FAKE_SLOW_MS   how long a prompt with "slow" in it keeps its turn going (default 60000).
// FAKE_GH_DIR    the fake gh's folder (scripts/perf/journey/fake-gh.mjs): "pr" adds a pull request there.
// Prompts typed into its terminal (one line each) become a user line and a short reply; a prompt with
// "please escalate" at its start raises an escalation; one with "permission" in it stops at a permission
// prompt (needs_input) until anything is typed; one with "pr" in it opens a fake pull request (in the fake gh's
// list) and says it's its own; "deliver" writes a deliverable; "slow" keeps the turn going a while. In
// turn mode, the prompt it was started with is its first turn.
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
// FAKE_DIR=claude-home: where Claude Code keeps it, ~/.claude/projects/<the folder, encoded>, so the office
// finds the session (and can carry it on) as it would a real one; only when ~ is itself a test office's
// folder (the journey points USERPROFILE/HOME there), never a person's real ~/.claude.
const testHome = /(^|[\\/])test-office/i.test(os.homedir());
const dir =
  process.env.FAKE_DIR === 'claude-home' && testHome
    ? path.join(os.homedir(), '.claude', 'projects', path.resolve(process.cwd()).replace(/[^a-zA-Z0-9]/g, '-'))
    : process.env.FAKE_DIR && process.env.FAKE_DIR !== 'claude-home'
      ? process.env.FAKE_DIR
      : path.join(os.tmpdir(), 'test-offices-fake-agent');
fs.mkdirSync(dir, { recursive: true });
// A big-data fixture (scripts/perf/fixture.ts) keeps each worker's past transcript in its floor: carry on in that one.
const fixtureTranscript = path.join(process.cwd(), '.agent-office', 'transcripts', `${sid}.jsonl`);
const transcript = fs.existsSync(fixtureTranscript) ? fixtureTranscript : path.join(dir, `${sid}.jsonl`);
const base = process.env.AGENT_OFFICE_HOOK_URL;
const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
const me = process.env.AGENT_OFFICE_WORKER_ID;
const mode = process.env.FAKE_MODE || 'live';
const rate = Math.max(50, +(process.env.FAKE_RATE_MS || 400));
const big = process.env.FAKE_BIG === '1';
const bulk = (k) => 'checked the module and its tests; nothing to change here. '.repeat(Math.ceil(k / 58)).slice(0, k);

// One-shot calls (`claude -p`: the task namer, when the office's --agent is this fake): answer with an
// empty result at once and leave, rather than staying up as a live worker would.
if (args.includes('-p') || args.includes('--print')) {
  const done = () => {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: null, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }) + '\n');
    process.exit(0);
  };
  process.stdin.on('data', () => {});
  process.stdin.on('end', done);
  process.stdin.resume();
  setTimeout(done, 2000);
  await new Promise(() => {});
}


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
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: big ? bulk(n % 7 === 0 ? 24000 : 1800) : 'ok', is_error: n % 23 === 0 }] } });
    hook('PostToolUse', { tool_name: name, tool_input: input, tool_response: { stdout: big ? bulk(1800) : 'ok' } });
  }, Math.min(150, rate / 2));
  if (n % 9 === 0) say(`Step ${n}: checked module ${n % 37}; the tests pass. Moving on to the next one.`);
}

async function escalate(title) {
  const r = await office('/escalate', { title, urgency: 'urgent', trigger: 'design', details: 'Raised by the fake agent in a test office.', options: ['Option A', 'Option B'], recommendation: 'Option A' });
  out(`escalated: ${r ?? 'no answer'}\n`);
}

/** A pull request for this worker's branch: added to the fake gh's list (FAKE_GH_DIR/pulls.json), then said to be its own. */
async function fakePr() {
  const gh = process.env.FAKE_GH_DIR;
  if (!gh) return 'no FAKE_GH_DIR';
  let branch = 'fake';
  try {
    const dotgit = path.join(process.cwd(), '.git');
    const gitdir = fs.statSync(dotgit).isFile() ? path.resolve(process.cwd(), fs.readFileSync(dotgit, 'utf8').replace('gitdir:', '').trim()) : dotgit;
    branch = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim().replace('ref: refs/heads/', '');
  } catch {
    // not a checkout
  }
  const file = path.join(gh, 'pulls.json');
  let pulls = [];
  try {
    pulls = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // the first one
  }
  const n = (pulls.at(-1)?.number ?? 0) + 1;
  const now = new Date().toISOString();
  pulls.push({ number: n, title: `Fake work by ${me ?? 'an agent'}`, state: 'OPEN', isDraft: false, url: `https://github.com/test-org/fake/pull/${n}`, author: { login: 'perf-tester' }, labels: [], reviewDecision: '', headRefName: branch, headRefOid: '0'.repeat(40), baseRefName: 'main', createdAt: now, updatedAt: now, additions: 3, deletions: 1, statusCheckRollup: [], body: 'Opened by the fake agent in a test office.', closingIssuesReferences: [] });
  fs.mkdirSync(gh, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(pulls, null, 2));
  return (await office('/pr', { pr: n })) ?? 'no answer';
}

/** A deliverable in its checkout: the Chief Analyst's source triage (shared/deliverables.ts 'triage'). */
function deliver() {
  fs.writeFileSync(path.join(process.cwd(), 'triage.md'), '# Source triage (fake)\n\nWritten by the fake agent in a test office.\n');
  out('wrote triage.md\n');
}

let waiting = false;
async function turn(prompt) {
  line({ type: 'user', message: { role: 'user', content: prompt } });
  await hook('UserPromptSubmit', { prompt });
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await step();
  // A turn takes at least FAKE_TURN_MS, as a real one does (the office polls some states every few seconds).
  while (Date.now() - t0 < +(process.env.FAKE_TURN_MS || 0)) {
    await new Promise((r) => setTimeout(r, 1000));
    await step();
  }
  if (/^\s*please escalate/i.test(prompt)) await escalate('Which login flow should the leave app use? (fake)');
  if (/\bpr\b/i.test(prompt)) out(`pr: ${await fakePr()}\n`);
  if (/deliver/i.test(prompt)) deliver();
  if (/slow/i.test(prompt)) {
    const until = Date.now() + Math.max(1000, +(process.env.FAKE_SLOW_MS || 60000));
    while (Date.now() < until) {
      await step();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (/permission/i.test(prompt)) {
    // Stops at a permission prompt (needs_input) until something is typed: the office holds what's for it meanwhile.
    waiting = true;
    // After the last tool call has finished (its PostToolUse would read as working again).
    await new Promise((r) => setTimeout(r, 400));
    await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
    await hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    out('Do you want to proceed?\n> 1. Yes\n  2. No\n');
    return;
  }
  say(`Done (fake): ${prompt.slice(0, 80)}`);
  await hook('Stop', {});
}

out(`fake agent (test office) ${me ?? '?'} session ${sid} mode ${mode}\n`);
await hook('SessionStart', { source: at('--resume', '-r') ? 'resume' : 'startup' });
if (mode === 'live') {
  setTimeout(() => hook('UserPromptSubmit', { prompt: 'carry on (fake)' }), 300);
  setInterval(step, rate);
}
if (mode === 'cycle') {
  const work = +(process.env.FAKE_WORK_MS || 30000);
  const idle = +(process.env.FAKE_IDLE_MS || 15000);
  const cycle = async () => {
    line({ type: 'user', message: { role: 'user', content: 'carry on with the next step (fake)' } });
    await hook('UserPromptSubmit', { prompt: 'carry on with the next step (fake)' });
    const until = Date.now() + work * (0.5 + Math.random());
    while (Date.now() < until) {
      await step();
      await new Promise((r) => setTimeout(r, rate));
    }
    say('Done with this step (fake). Waiting for the next one.');
    line({ type: 'system', subtype: 'turn_duration', durationMs: Math.round(work), isSidechain: false });
    await hook('Stop', {});
    setTimeout(cycle, idle * (0.5 + Math.random()));
  };
  setTimeout(cycle, 300 + Math.random() * 3000);
}
// turn mode: the prompt it was started with (after `--`, as the office passes it) is its first turn.
const dd = args.indexOf('--');
if (mode === 'turn' && dd >= 0 && args[dd + 1]) setTimeout(() => turn(args.slice(dd + 1).join(' ')), 300);
if (process.env.FAKE_ESCALATE) setTimeout(() => escalate('Which login flow should the leave app use? (fake)'), +process.env.FAKE_ESCALATE || 1000);

// The office types prompts into the terminal as a bracketed paste (\x1b[200~ … \x1b[201~), then Enter (\r)
// ends one. As in Claude Code, a newline inside the paste is part of the prompt, not the end of it: a
// multi-line message (an answer, then its resume line) is one prompt. A Linux terminal hands the paste
// over line by line, so where a prompt ends is worked out here, across reads, rather than by splitting
// each read on newlines (which made each of those lines a prompt of its own off Windows).
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
let buf = '';
let cur = '';
let pasting = false;
process.stdin.on('data', (d) => {
  buf += d.toString();
  const parts = [];
  let i = 0;
  while (i < buf.length) {
    if (buf.startsWith(PASTE_START, i)) {
      pasting = true;
      i += PASTE_START.length;
    } else if (buf.startsWith(PASTE_END, i)) {
      pasting = false;
      i += PASTE_END.length;
    } else if (buf[i] === '\x1b' && buf.length - i < PASTE_START.length && (PASTE_START.startsWith(buf.slice(i)) || PASTE_END.startsWith(buf.slice(i)))) {
      break; // the rest of a paste marker is still to come
    } else {
      const c = buf[i++];
      if (c === '\r' || c === '\n') {
        if (pasting) cur += '\n';
        else {
          parts.push(cur);
          cur = '';
        }
      } else cur += c;
    }
  }
  buf = buf.slice(i);
  if (waiting && parts.length) {
    // The answer to its permission prompt: the turn carries on and ends.
    waiting = false;
    say('Done (fake): permission answered');
    hook('Stop', {});
    return;
  }
  for (const p of parts) if (p.trim()) turn(p.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b\[20[01]~/g, '').trim());
});
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
