import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { autonomyOf, buildReport, efficiencyOf, matrix, modelLabel, qualityOf, rank, scoreRun, WEIGHTS, type RunRecord } from '../src/shared/analysis.js';
import { Classifier, fallbackNote, keywordTypes } from '../src/server/analysis/classify.js';
import { exclusionOf, issueOf, outcomeOf, TRIVIAL_CALLS } from '../src/server/analysis/collect.js';
import { parseScorecard, parseSelfReport, scorecardOf, SCORECARD_MARKER } from '../src/server/analysis/scorecard.js';
import { readSession } from '../src/server/analysis/transcript.js';

/** A finished run, as the analyzer records one; the mx-spike experiment's real numbers by default. */
function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: `mx-spike:${over.workerId ?? 'w1'}`,
    floor: 'mx-spike',
    worker: 'Byte',
    workerId: 'w1',
    provider: 'claude',
    model: 'claude-opus-5-5',
    modelLabel: 'Opus 5.5',
    title: 'AIHub Experiment entity and pages',
    prompt: '',
    startedAt: 1,
    endedAt: 1 + 32 * 60_000,
    durationMs: 32 * 60_000,
    activeMs: 9.3 * 60_000,
    apiCalls: 32,
    toolCalls: 33,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    cost: 2.19,
    humanPrompts: 1,
    needsInput: 0,
    needsInputMs: 0,
    outcome: 'merged',
    pr: { number: 1, url: '', title: '', state: 'MERGED', additions: 134, deletions: 0 },
    scorecard: { source: 'self-reported', score: 95, mxErrors: 0 },
    types: ['domain-model', 'ui-pages'],
    typesBy: 'keywords',
    updatedAt: 0,
    ...over,
  };
}

test('the weights add up to one, and each part of a run scores between 0 and 1', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0).toFixed(6), '1.000000');
  assert.equal(efficiencyOf(1, 15 * 60_000), 0.5);
  assert.ok(efficiencyOf(0.5, 5 * 60_000) > efficiencyOf(2.19, 9.3 * 60_000));
  assert.equal(autonomyOf(0), 1);
  assert.equal(autonomyOf(1), 0.5);
  // Quality: the score, a clean consistency check, and tests only when they ran.
  assert.equal(qualityOf({ source: 'ci', score: 100, mxErrors: 0 }), 1);
  assert.equal(qualityOf({ source: 'ci', score: 80, mxErrors: 3 }), (0.8 * 0.6) / 0.85);
  assert.equal(qualityOf({ source: 'ci', score: 86, mxErrors: 0, testsPassed: 2, testsFailed: 2 }), 0.86 * 0.6 + 0.25 + 0.5 * 0.15);
  assert.equal(qualityOf(undefined), undefined);
});

test('a run with no scorecard is scored on what there is, and an unranked run gets no score', () => {
  const noQuality = scoreRun(run({ scorecard: undefined }));
  assert.equal(noQuality.parts.quality, undefined);
  assert.ok(noQuality.score! > 0 && noQuality.score! <= 100);
  assert.equal(scoreRun(run({ outcome: 'running' })).score, undefined);
  assert.equal(scoreRun(run({ excluded: 'still working' })).score, undefined);
  // Merged beats open beats nothing, all else equal.
  const merged = scoreRun(run()).score!;
  const open = scoreRun(run({ outcome: 'open' })).score!;
  const none = scoreRun(run({ outcome: 'no-pr', pr: undefined })).score!;
  assert.ok(merged > open && open > none);
});

test('the leaderboard ranks models by their mean run score and flags fewer than three runs', () => {
  // The experiment so far: Byte and Gizmo on Opus, Nibble and Widget on Sonnet.
  const runs = [
    run(),
    run({ workerId: 'w2', worker: 'Nibble', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', effort: 'medium', cost: 0.92, activeMs: 6.9 * 60_000, durationMs: 9.7 * 60_000, humanPrompts: 0, scorecard: { source: 'self-reported', score: 85, mxErrors: 0 } }),
    run({ workerId: 'w3', worker: 'Widget', model: 'claude-sonnet-5-5', modelLabel: 'Sonnet 5.5', effort: 'medium', cost: 0.67, activeMs: 4.3 * 60_000, humanPrompts: 0, scorecard: { source: 'self-reported', score: 86, mxErrors: 0 } }),
    run({ workerId: 'w4', worker: 'Gizmo', effort: 'medium', cost: 1.64, activeMs: 10.9 * 60_000, humanPrompts: 0, outcome: 'open', scorecard: { source: 'self-reported', score: 86, mxErrors: 0 } }),
    run({ workerId: 'w5', worker: 'Sprocket', model: 'claude-haiku-4-5-20251001', modelLabel: 'Haiku 4.5', outcome: 'running', excluded: 'still working' }),
  ];
  const rows = rank(runs);
  assert.deepEqual(rows.map((r) => r.label), ['Sonnet 5.5', 'Opus 5.5']);
  assert.ok(rows.every((r) => r.n === 2 && r.lowConfidence));
  assert.equal(rows[0].merged, 2);
  assert.equal(rows[1].avgQuality, 90.5);
  // By effort, Opus splits into its default and medium runs.
  assert.deepEqual(rank(runs, 'effort').map((r) => r.label).sort(), ['Opus 5.5 · default', 'Opus 5.5 · medium', 'Sonnet 5.5 · medium']);
  const m = matrix(runs);
  assert.deepEqual(m.types, ['domain-model', 'ui-pages']);
  assert.equal(m.rows.find((r) => r.label === 'Opus 5.5')?.cells['ui-pages']?.n, 2);
  const report = buildReport(runs, { floor: 'mx-spike', floors: [{ id: 'mx-spike', name: 'mx-spike' }], busy: false });
  assert.equal(report.scope, 'floor');
  assert.equal(report.runs.length, 5);
  assert.equal(buildReport(runs, { floor: 'elsewhere', floors: [], busy: false }).leaderboard.length, 0);
});

test('model ids read as people say them', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelLabel('gpt-5-codex'), 'gpt-5-codex');
});

test('without the model, tasks are sorted by their words, and a passing mention is not enough', () => {
  assert.deepEqual(keywordTypes('Add an entity Order with attributes and an association to Customer'), ['domain-model']);
  assert.deepEqual(keywordTypes('Overview page and edit page; add the page to the navigation menu. Validate with mx check and fix any issues.'), ['ui-pages']);
  assert.deepEqual(keywordTypes('Fix the crash in the validation microflow'), ['logic', 'bugfix']);
  assert.deepEqual(keywordTypes('Harden security: module roles and access rules'), ['security']);
  assert.deepEqual(keywordTypes('Hello there'), ['other']);
});

test('the classifier falls back to keywords without a model, and keeps one answer per run', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-analysis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'classes.json');
  const c = new Classifier(file, null);
  const r = run();
  const got = await c.classify(r, { task: 'Create entity Experiment with attributes and an enumeration', report: '', files: [] }, true);
  assert.equal(got.typesBy, 'keywords');
  assert.deepEqual(got.types, ['domain-model']);
  assert.match(got.note!, /PR #1 merged, best-practices 95\/100 \(self-reported\), mx check clean, needed a human 1 time/);
  // A new classifier reads the same answer back from disk.
  const again = await new Classifier(file, null).classify(r, { task: 'Create entity Experiment with attributes and an enumeration', report: '', files: [] }, true);
  assert.deepEqual(again, got);
  assert.equal(fallbackNote({ ...r, excluded: 'still working' }), 'Not ranked: still working.');
});

test('outcomes, false starts and the issue a task came from', () => {
  assert.equal(outcomeOf(true, 'MERGED', true), 'running');
  assert.equal(outcomeOf(false, 'MERGED', true), 'merged');
  assert.equal(outcomeOf(false, 'CLOSED', true), 'closed');
  assert.equal(outcomeOf(false, undefined, true), 'open');
  assert.equal(outcomeOf(false, undefined, false), 'no-pr');
  assert.equal(exclusionOf('no-pr', false, TRIVIAL_CALLS - 1)?.startsWith('no pull request'), true);
  assert.equal(exclusionOf('no-pr', false, TRIVIAL_CALLS), undefined);
  assert.equal(exclusionOf('open', true, 1), undefined);
  assert.equal(issueOf({ prompt: 'Work on GitHub issue #3 in this repo' }), 3);
  assert.equal(issueOf({ prompt: 'x' }, { issue: 5 } as never), 5);
  assert.equal(issueOf({ prompt: 'no issue here' }), undefined);
});

const SCORECARD = `${SCORECARD_MARKER}
## ❌ Mendix PR checks — failing

| | Check | Result |
|---|---|---|
| ✅ | Studio Pro \`mx check\` | 0 error(s) |
| ⚠️ | \`mxcli lint\` | 0 error(s), 17 warning(s), 23 info |
| ✅ | Best-practices score (\`mxcli report\`) | **86**/100 — Security 69 · Quality 94 |
| ❌ | Unit tests (\`mxcli test\`) | rc=1 error: mxcli test produced no JUnit XML (exit 1) |
| ❌ | E2E UI tests (Playwright) | 2 passed, 2 failed, 0 skipped |
`;

test('the CI scorecard comment is read, and wins over what the agent wrote itself', () => {
  assert.deepEqual(parseScorecard(SCORECARD), { source: 'ci', mxErrors: 0, lintErrors: 0, lintWarnings: 17, score: 86, testsPassed: 2, testsFailed: 2 });
  assert.equal(parseScorecard('no marker | here |'), undefined);
  // The descriptions the experiment's agents wrote (PRs #1, #2 and #6).
  assert.deepEqual(parseSelfReport('Lint: 0 errors, 4 warnings (CONV006 ×2). Report: 95/100. mxbuild check: 0 errors.'), { source: 'self-reported', score: 95, mxErrors: 0, lintErrors: 0, lintWarnings: 4 });
  assert.deepEqual(parseSelfReport('- `mxcli lint`: 0 errors, 18 warnings\n- `mxcli report`: 85/100 (was 95; Security 63)\n- `mxcli docker check` (mx check): 0 errors'), { source: 'self-reported', score: 85, mxErrors: 0, lintErrors: 0, lintWarnings: 18 });
  assert.equal(parseSelfReport('- Gates: check clean, lint 0 errors / 17 warnings, mx check 0 errors, report 86/100')?.score, 86);
  assert.equal(parseSelfReport('Nothing measured here'), undefined);
  assert.equal(scorecardOf('Report: 95/100', ['thanks!', SCORECARD])?.source, 'ci');
  assert.equal(scorecardOf('Report: 95/100', ['thanks!'])?.score, 95);
});

test('a transcript gives the run its time, calls, cost and the nudges before its PR', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-analysis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  const at = (min: number) => new Date(Date.UTC(2026, 9, 4, 10, min)).toISOString();
  const lines = [
    { type: 'user', timestamp: at(0), message: { content: 'Build the Experiment entity' } },
    { type: 'assistant', timestamp: at(1), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'tool_use', id: 't1' }] } },
    // The same message logged again for its second block: counted once.
    { type: 'assistant', timestamp: at(1), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'tool_use', id: 't2' }] } },
    { type: 'user', timestamp: at(2), message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'system', subtype: 'turn_duration', durationMs: 120_000, timestamp: at(2) },
    { type: 'user', timestamp: at(20), message: { content: 'whats the outcome' } },
    { type: 'assistant', timestamp: at(21), message: { id: 'm2', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'PR opened.' }] } },
    { type: 'pr-link', prNumber: 1, timestamp: at(21) },
    { type: 'system', subtype: 'turn_duration', durationMs: 60_000, timestamp: at(21) },
    { type: 'user', timestamp: at(30), message: { content: 'thanks, and what about tests?' } },
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const s = readSession(file);
  assert.equal(s.model, 'claude-opus-5-5');
  assert.equal(s.apiCalls, 2);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.activeMs, 180_000);
  assert.equal(s.endedAt! - s.startedAt!, 30 * 60_000);
  assert.equal(s.prLinked, 1);
  assert.equal(s.lastText, 'PR opened.');
  // Two typed after the task: one before the PR (a nudge), one after (review).
  assert.equal(s.humanPromptsAt.length, 2);
  assert.equal(s.humanPromptsAt.filter((x) => x < s.prLinkedAt!).length, 1);
  assert.ok(Math.abs(s.cost - (1010 * 4 + 110 * 20) / 1e6) < 1e-9);
});
