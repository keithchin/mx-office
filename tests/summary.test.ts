import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStage, decisions, firstParagraph, intakeGoal, stageVerdicts } from '../src/server/summary/project.js';
import { significance, templateNarrative } from '../src/server/summary/narrate.js';
import { oneLine, type ProjectSummary } from '../src/shared/summary.js';

test("a README's goal is its first paragraph of prose, past the title and badges", () => {
  assert.equal(firstParagraph('# travel-approval\nRun 4: travel request approval app - consultant-led discovery then agent build\n'), 'Run 4: travel request approval app - consultant-led discovery then agent build');
  assert.equal(firstParagraph('# travel-approval\n\n[![CI](x.svg)](y)\n\nRun 4: a **travel request** approval app, see [docs](docs/).\n\n## Setup'), 'Run 4: a travel request approval app, see docs.');
});

test("a toolkit project's intake goal counts only once it's answered", () => {
  const md = (answer: string) => `# intake\n\n## 1. Entry mode?\n\nAnswered (CONFIRMED): greenfield\n\n## 2. What is this project, and what is driving it?\n\n${answer}\n\n## 3. Fidelity?\n\n_Not yet asked._\n`;
  assert.equal(intakeGoal(md('_Not yet asked._ Sets stakes.')), undefined);
  assert.equal(intakeGoal(md('Answered (CONFIRMED): A POC of travel approvals for the Q3 demo.')), 'A POC of travel approvals for the Q3 demo.');
});

const PROJECT = `# PROJECT.md

## Current stage

**Stage P — Kickoff**, needs attention — gates passed: none yet (derived by gate-check on 2026-10-04; re-run it).

Toolkit commit: 8abd614

## Decisions

| Stage | Decision | Status | Notes |
|---|---|---|---|
| P | Greenfield build | CONFIRMED | asked in chat |
| 0 | Mendix 11.6.4 | ASSUMED | |

## Open questions
`;

test("a toolkit project's stage and decisions come from PROJECT.md, its verdicts from gate-check's dashboard", () => {
  assert.equal(currentStage(PROJECT), 'Stage P — Kickoff, needs attention');
  assert.deepEqual(decisions(PROJECT), [
    { stage: 'P', decision: 'Greenfield build', status: 'CONFIRMED' },
    { stage: '0', decision: 'Mendix 11.6.4', status: 'ASSUMED' },
  ]);
  const html = '<table><tr><th>Stage</th><th>Title</th><th>Status</th><th>Detail</th></tr><tr><td>P</td><td>Kickoff</td><td><span class="FAIL">FAIL</span></td><td>unanswered &amp; open</td></tr><tr><td>1</td><td>Analysis</td><td>PENDING</td><td>no KB</td></tr></table>';
  assert.deepEqual(stageVerdicts(html), [
    { id: 'P', title: 'Kickoff', status: 'FAIL', detail: 'unanswered & open' },
    { id: '1', title: 'Analysis', status: 'PENDING', detail: 'no KB' },
  ]);
});

function facts(over: Partial<ProjectSummary> = {}): Omit<ProjectSummary, 'narrative' | 'narrativeBy'> {
  return {
    floor: 'mx-spike',
    name: 'mx-spike',
    progress: { issuesOpen: 2, issuesClosed: 3, issuesClosedCapped: false, prsOpen: 2, prsMerged: 3, prsMergedCapped: false, queued: 0, running: 1, done: 2 },
    agents: [
      { id: 'a', name: 'Sprocket', color: '#000', status: 'working', doing: 'Fix dashboard — running checks', quietMs: 60_000 },
      { id: 'b', name: 'Gizmo', color: '#000', status: 'needs_input', doing: 'waiting', waitingMs: 12 * 60_000 },
    ],
    needsHuman: { count: 1, longestMs: 12 * 60_000 },
    spend: { today: 9.44, total: 9.44 },
    activity: [],
    risks: [{ level: 'bad', text: 'Gizmo has waited on a human for 12 min' }],
    generatedAt: 0,
    ...over,
  };
}

test('the template says only what the facts say, who needs a human first', () => {
  const text = templateNarrative(facts());
  assert.equal(text, 'Gizmo is waiting on a human, the longest for 12 min. 1 agent is working on mx-spike: Sprocket. 2 pull requests open, 3 merged, and 2 issues open. Watch: Gizmo has waited on a human for 12 min.');
  assert.match(templateNarrative(facts({ agents: [], needsHuman: { count: 0, longestMs: 0 }, risks: [] })), /^Nobody is working on mx-spike right now\./);
  // Minutes ticking by don't make the model's note out of date; a change of who's doing what does.
  const later = facts({ risks: [{ level: 'bad', text: 'Gizmo has waited on a human for 14 min' }] });
  assert.equal(significance(facts()), significance(later));
  assert.notEqual(significance(facts()), significance(facts({ needsHuman: { count: 0, longestMs: 0 } })));
});

test("a floor card's one line", () => {
  assert.equal(oneLine({ ...facts(), phase: { label: 'Stage 3 — Architecture, needs attention', from: 'PROJECT.md', stages: [], decisions: [] } }), 'Stage 3 — Architecture · 1 agent working · 🙋 1 needs you · 2 PRs open');
  assert.equal(oneLine(facts({ agents: [], needsHuman: { count: 0, longestMs: 0 }, progress: { ...facts().progress, prsOpen: 0 } })), 'nobody working');
});
