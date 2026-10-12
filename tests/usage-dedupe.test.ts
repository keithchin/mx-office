// Acceptance V8 ("Subagent double-counting"), as far as it applies today: each API request in a worker's
// transcripts is counted once, wherever and however often its lines appear. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newTracker, restoreTracker, scanTracker, trackerUsage, type UsageTracker } from '../src/server/usage.js';
import { scanTrackerAsync } from '../src/server/usage-async.js';
import { SeenIds } from '../src/server/usage-seen.js';

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-4-5';
let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, 0, clock++ * 1000)).toISOString();

/** One assistant line: message `id`, `out` output tokens (input 100), one content block. */
const asst = (id: string, out = 50, more: Record<string, unknown> = {}, model = OPUS) =>
  JSON.stringify({ type: 'assistant', timestamp: at(), ...more, message: { id, model, content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 100, output_tokens: out } } });
const toolResult = () => JSON.stringify({ type: 'user', timestamp: at(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });
const jsonl = (...lines: string[]) => lines.join('\n') + '\n';

function session(t: { after: (fn: () => void) => void }, main: string, subs: Record<string, { lines: string; type?: string }> = {}): UsageTracker {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-dedupe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 's.jsonl');
  writeFileSync(transcript, main);
  const subDir = path.join(dir, 's', 'subagents');
  mkdirSync(subDir, { recursive: true });
  for (const [name, s] of Object.entries(subs)) {
    writeFileSync(path.join(subDir, `${name}.jsonl`), s.lines);
    if (s.type) writeFileSync(path.join(subDir, `${name}.meta.json`), JSON.stringify({ agentType: s.type }));
  }
  const tr = newTracker();
  tr.transcript = transcript;
  return tr;
}

const tokens = (tr: UsageTracker) => {
  const u = trackerUsage(tr);
  return { input: u.input, output: u.output, calls: u.calls };
};

test('the same message id on three non-adjacent lines is counted once', (t) => {
  const tr = session(t, jsonl(asst('msg_A'), toolResult(), asst('msg_B'), asst('msg_A'), toolResult(), asst('msg_C'), asst('msg_A')));
  scanTracker(tr);
  // A, B and C once each: 3 calls, 300 in, 150 out (the old adjacency rule counted A three times).
  assert.deepEqual(tokens(tr), { input: 300, output: 150, calls: 3 });
});

test('a streamed response whose usage grows counts its final total, and a smaller repeat adds nothing', (t) => {
  const tr = session(t, jsonl(asst('msg_S', 10), asst('msg_X', 5), asst('msg_S', 40), toolResult(), asst('msg_S', 120), asst('msg_S', 60)));
  scanTracker(tr);
  assert.deepEqual(tokens(tr), { input: 200, output: 125, calls: 2 });
  // Also when the growth arrives in a later scan.
  writeFileSync(tr.transcript!, jsonl(asst('msg_S', 10), asst('msg_X', 5), asst('msg_S', 40), toolResult(), asst('msg_S', 120), asst('msg_S', 60)) + jsonl(asst('msg_X', 30)));
  scanTracker(tr);
  assert.deepEqual(tokens(tr), { input: 200, output: 150, calls: 2 });
  const sum = Object.values(tr.parts!).reduce((n, p) => n + p.cost, 0);
  assert.ok(Math.abs(sum - trackerUsage(tr).cost) < 1e-12, 'the parts add up to the total');
});

test('a request in both the session transcript (isSidechain) and a subagent file counts once, under the subagent', async (t) => {
  const main = jsonl(asst('msg_main'), asst('msg_sub', 50, { isSidechain: true, agentId: 'a1' }, HAIKU), asst('msg_sub', 50, { isSidechain: true, agentId: 'a1' }, HAIKU));
  const subs = { 'agent-a1': { lines: jsonl(asst('msg_sub', 50, { isSidechain: true, agentId: 'a1' }, HAIKU)), type: 'Explore' } };
  const sync = session(t, main, subs);
  scanTracker(sync);
  assert.deepEqual(tokens(sync), { input: 200, output: 100, calls: 2 });
  assert.deepEqual(Object.keys(sync.parts!).sort(), ['Explore|claude-haiku-4-5', `|${OPUS}`]);
  assert.equal(sync.parts!['Explore|claude-haiku-4-5'].calls, 1);
  assert.equal(sync.parts![`|${OPUS}`].calls, 1);
  const sum = Object.values(sync.parts!).reduce((n, p) => n + p.cost, 0);
  assert.ok(Math.abs(sum - trackerUsage(sync).cost) < 1e-12);

  // The off-loop reader agrees.
  const off = session(t, main, subs);
  await scanTrackerAsync(off, 1024);
  assert.deepEqual(trackerUsage(off), trackerUsage(sync));
});

test('a request id ties lines together too, and distinct ids are all counted', (t) => {
  const tr = session(t, jsonl(asst('msg_1', 50, { requestId: 'req_1' }), asst('msg_2'), asst('msg_3'), asst('msg_4'), asst('msg_1b', 50, { requestId: 'req_1' })));
  scanTracker(tr);
  assert.deepEqual(tokens(tr), { input: 400, output: 200, calls: 4 });
});

test('the counted ids survive a restart, and the window stays bounded', (t) => {
  const tr = session(t, jsonl(asst('msg_R1'), asst('msg_R2')));
  scanTracker(tr);
  const restored = restoreTracker(JSON.parse(JSON.stringify(tr)));
  writeFileSync(tr.transcript!, jsonl(asst('msg_R1'), asst('msg_R2')) + jsonl(asst('msg_R1'), asst('msg_R3')));
  scanTracker(restored);
  assert.deepEqual(tokens(restored), { input: 300, output: 150, calls: 3 });

  // A tracker saved before SeenIds: its files' last message is still known.
  const legacy = restoreTracker({ transcript: tr.transcript, files: { [tr.transcript!]: { offset: 0, lastId: 'msg_R1', lastUsage: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 0.003, calls: 1 } } }, since: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 0.003, calls: 1 } });
  assert.equal(legacy.seen?.size, 1);

  const max = SeenIds.MAX;
  SeenIds.MAX = 50;
  t.after(() => (SeenIds.MAX = max));
  const many = session(t, jsonl(...Array.from({ length: 200 }, (_, i) => asst(`msg_m${i}`, 1, { requestId: `req_m${i}` }))));
  scanTracker(many);
  assert.equal(trackerUsage(many).calls, 200);
  assert.equal(many.seen!.size, 50);
  assert.ok(JSON.parse(JSON.stringify(many)).seen.length <= SeenIds.SAVED);
});

test('lines inside Claude Code\'s own tally stay out, and are not counted again after it', (t) => {
  const costState = JSON.stringify({ type: 'cost-state', timestamp: at(), totalCostUSD: 1.5, modelUsage: { [OPUS]: { inputTokens: 100, outputTokens: 50 } } });
  const first = asst('msg_T');
  const tr = session(t, jsonl(first, costState));
  scanTracker(tr);
  assert.equal(trackerUsage(tr).cost, 1.5);
  // A resume: a new message, and a repeat of the one already in the tally (now with a later timestamp).
  writeFileSync(tr.transcript!, jsonl(first, costState, asst('msg_T'), asst('msg_U')));
  scanTracker(tr);
  assert.equal(tr.since.calls, 1);
  assert.equal(tr.since.output, 50);
});
