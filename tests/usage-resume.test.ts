// Claude Code's end-of-session tally (the transcript's cost-state line) and resumed sessions: the tally is
// read per run, each run books the larger of it and the office's estimate, so a worker's figure never goes
// down, a resumed session keeps its earlier runs, and a ledger day is never negative. Synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newTracker, restoreTracker, scanTracker, trackerUsage, usageOfMessage, type UsageTracker } from '../src/server/usage.js';
import { splitDelta, seenOf } from '../src/server/budget/attribute.js';

const OPUS = 'claude-opus-5-5';
let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, 0, clock++ * 1000)).toISOString();
const asst = (id: string) => JSON.stringify({ type: 'assistant', timestamp: at(), message: { id, model: OPUS, content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 100, output_tokens: 50 } } });
const tally = (usd: number, out = 50) => JSON.stringify({ type: 'cost-state', timestamp: at(), totalCostUSD: usd, modelUsage: { [OPUS]: { inputTokens: 100, outputTokens: out } } });
/** What the office estimates one asst() costs. */
const ONE = usageOfMessage(OPUS, { input_tokens: 100, output_tokens: 50 }).cost;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} against ${b}`);

/** A tracker on a transcript that grows line by line; `costs` is the worker's figure after each line. */
function grow(t: { after: (fn: () => void) => void }, lines: string[]): { tr: UsageTracker; costs: number[] } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-resume-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tr = newTracker();
  tr.transcript = path.join(dir, 's.jsonl');
  const costs: number[] = [];
  for (let i = 1; i <= lines.length; i++) {
    writeFileSync(tr.transcript, lines.slice(0, i).join('\n') + '\n');
    scanTracker(tr);
    costs.push(trackerUsage(tr).cost);
  }
  return { tr, costs };
}

const neverDown = (costs: number[]) => costs.forEach((c, i) => assert.ok(i === 0 || c >= costs[i - 1] - 1e-12, `went down at line ${i}: ${costs[i - 1]} → ${c}`));

test('a session that ends once still snaps to Claude Code\'s own figure when it is higher (calls the transcript never saw)', (t) => {
  const { tr, costs } = grow(t, [asst('a'), asst('b'), tally(1.5)]);
  near(trackerUsage(tr).cost, 1.5, 'the CLI figure');
  assert.equal(trackerUsage(tr).calls, 2);
  neverDown(costs);
});

test('a tally below the office\'s estimate (a run Claude Code didn\'t count) keeps the estimate instead of booking a negative', (t) => {
  const { tr, costs } = grow(t, [asst('a'), asst('b'), asst('c'), tally(0.0001)]);
  near(trackerUsage(tr).cost, 3 * ONE, 'the estimate');
  neverDown(costs);
});

test('a resumed session whose tally starts again keeps its earlier runs', (t) => {
  // Run 1 ends at $1.50; run 2 (a resume in a new process) ends with a tally of $0.40 for itself; run 3 at $0.25.
  const { tr, costs } = grow(t, [asst('a'), tally(1.5), asst('b'), asst('c'), tally(0.4), asst('d'), tally(0.25)]);
  near(trackerUsage(tr).cost, 1.5 + 0.4 + 0.25, 'every run');
  assert.equal(trackerUsage(tr).calls, 4);
  neverDown(costs);
});

test('a resumed session whose tally carries on counts each run once', (t) => {
  // The tally covers the whole session: $1.50, then $3.00 (run 2 cost $1.50), then the same line again.
  const { tr, costs } = grow(t, [asst('a'), tally(1.5), asst('b'), tally(3, 100), tally(3, 100), asst('c')]);
  near(trackerUsage(tr).cost, 3 + ONE, 'the tally, and the message after it estimated on top');
  neverDown(costs);
});

test('the project ledger never books a negative piece, and a tracker saved before `cli` reads its old base as the last tally', () => {
  assert.deepEqual(splitDelta({ cost: 5, calls: 3 }, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 3, calls: 3 }, OPUS), []);
  assert.deepEqual(splitDelta({ cost: 5, calls: 3 }, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 3, calls: 4 }, OPUS), [{ sub: '', model: OPUS, cost: 0, calls: 1 }]);
  const after = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 7, calls: 4 };
  assert.deepEqual(splitDelta(seenOf({ ...after, cost: 3 }), after, OPUS), [{ sub: '', model: OPUS, cost: 4, calls: 0 }], 'a rise still books');
  const old = restoreTracker({ files: {}, base: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 1.5, calls: 2, at: 10 }, since: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 } });
  assert.deepEqual(old.cli, { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 1.5, calls: 0 });
  const kept = restoreTracker(JSON.parse(JSON.stringify({ ...old, cli: { ...old.cli, cost: 2 } })));
  assert.equal(kept.cli?.cost, 2);
});
