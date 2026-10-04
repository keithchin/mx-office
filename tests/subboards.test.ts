import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GhIssue, GhPull, QueueTask, WorkerInfo } from '../src/shared/protocol.js';
import { CARD_TEAMS, issueTeam, pullTeam, taskTeam, teamFromLabels, teamLabel, workerTeam, type TeamWorld } from '../src/shared/roster/card-team.js';
import { countTeams, formatTeams, parseTeams, showsTeam, startingPick, toggleTeam } from '../src/shared/roster/team-filter.js';
import { teamPageData } from '../src/server/teams/page-data.js';

const label = (name: string) => ({ name, color: '#000000' });
const issue = (number: number, labels: string[] = []): GhIssue => ({ number, title: `Issue ${number}`, state: 'OPEN', url: `https://github.com/o/r/issues/${number}`, author: 'cto', labels: labels.map(label), assignees: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', body: '', comments: 0 });
const pull = (number: number, labels: string[] = [], closes: number[] = []): GhPull => ({
  number,
  title: `PR ${number}`,
  state: 'OPEN',
  isDraft: false,
  url: `https://github.com/o/r/pull/${number}`,
  author: 'bot',
  labels: labels.map(label),
  reviewDecision: '',
  headRefName: 'b',
  baseRefName: 'main',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  additions: 1,
  deletions: 0,
  checks: 'none',
  body: '',
  closes,
});
const worker = (id: string, extra: Partial<WorkerInfo> = {}) => ({ id, name: id, kind: 'agent', status: 'working', ...extra }) as WorkerInfo;
const task = (id: string, extra: Partial<QueueTask> = {}) => ({ id, title: id, prompt: '', addedBy: 'cto', addedAt: 0, status: 'queued', ...extra }) as QueueTask;
const world = (w: Partial<TeamWorld> = {}): TeamWorld => ({ issues: [], pulls: [], tasks: [], workers: [], members: [], ...w });

test('a team: label names the team, whatever its case and spacing; other labels and unknown teams are ignored', () => {
  assert.equal(teamFromLabels([label('bug'), label('team:testing')]), 'testing');
  assert.equal(teamFromLabels([label('Team: Design ')]), 'design');
  assert.equal(teamFromLabels([label('team:marketing'), label('team:analysis')]), 'analysis');
  assert.equal(teamFromLabels([label('bug')]), undefined);
  assert.equal(teamFromLabels(undefined), undefined);
  assert.equal(teamLabel('development'), 'team:development');
  assert.equal(issueTeam(issue(1, ['team:management'])), 'management');
  assert.equal(issueTeam(issue(2)), 'unassigned');
});

test("a worker is its roster role's team; else its task's issue's team; else its PR's label; else unassigned", () => {
  const lead = worker('w1');
  const hired = worker('w2');
  const prWorker = worker('w3', { pr: { number: 30, url: '' } });
  const w = world({
    issues: [issue(5, ['team:design'])],
    pulls: [pull(30, ['team:testing'])],
    tasks: [task('t1', { issue: 5, workerId: 'w2', status: 'running' })],
    members: [{ workerId: 'w1', team: 'analysis' }],
  });
  assert.equal(workerTeam(lead, w), 'analysis');
  assert.equal(workerTeam(hired, w), 'design');
  assert.equal(workerTeam(prWorker, w), 'testing');
  assert.equal(workerTeam(worker('w4'), w), 'unassigned');
  // The roster wins over what the worker's PR says.
  assert.equal(workerTeam(worker('w1', { pr: { number: 30, url: '' } }), w), 'analysis');
});

test("a PR is its label's team; else its author worker's roster team; else the team of an issue it closes", () => {
  const w = world({
    issues: [issue(7, ['team:testing']), issue(8)],
    workers: [worker('dev', { pr: { number: 41, url: '' } }), worker('old', { pastPrs: [42] })],
    members: [{ workerId: 'dev', team: 'development' }, { workerId: 'old', team: 'design' }],
  });
  assert.equal(pullTeam(pull(40, ['team:analysis'], [7]), w), 'analysis');
  assert.equal(pullTeam(pull(41, [], [7]), w), 'development');
  assert.equal(pullTeam(pull(42), w), 'design');
  assert.equal(pullTeam(pull(43, [], [8, 7]), w), 'testing');
  assert.equal(pullTeam(pull(44, [], [8]), w), 'unassigned');
});

test("a queued task is its issue's team, and unassigned without one", () => {
  const w = world({ issues: [issue(9, ['team:management'])] });
  assert.equal(taskTeam(task('a', { issue: 9 }), w), 'management');
  assert.equal(taskTeam(task('b', { issue: 99 }), w), 'unassigned');
  assert.equal(taskTeam(task('c'), w), 'unassigned');
});

test('the filter pick reads and writes the address: unknown names dropped, every team the same as none', () => {
  assert.deepEqual([...parseTeams('design, Testing,bogus')], ['design', 'testing']);
  assert.equal(parseTeams(null).size, 0);
  assert.equal(parseTeams(CARD_TEAMS.join(',')).size, 0);
  // Written in the bar's order, whatever order it was picked in.
  assert.equal(formatTeams(new Set(['testing', 'design'])), 'design,testing');
  assert.equal(formatTeams(new Set()), null);
  assert.equal(formatTeams(new Set(CARD_TEAMS)), null);
  assert.equal(formatTeams(parseTeams(formatTeams(new Set(['unassigned', 'analysis'])))), 'analysis,unassigned');
});

test('toggling chips picks several teams; picking the last one left means every team again', () => {
  let pick = toggleTeam(new Set(), 'design');
  assert.deepEqual([...pick], ['design']);
  pick = toggleTeam(pick, 'testing');
  assert.deepEqual([...pick].sort(), ['design', 'testing']);
  assert.equal(showsTeam(pick, 'design'), true);
  assert.equal(showsTeam(pick, 'analysis'), false);
  pick = toggleTeam(pick, 'design');
  assert.deepEqual([...pick], ['testing']);
  assert.equal(showsTeam(new Set(), 'unassigned'), true);
  let all = new Set<(typeof CARD_TEAMS)[number]>();
  for (const t of CARD_TEAMS) all = toggleTeam(all, t);
  assert.equal(all.size, 0);
});

test("the address's pick beats what the browser remembered; counts cover every team", () => {
  assert.deepEqual([...startingPick('analysis', 'design')], ['analysis']);
  assert.deepEqual([...startingPick(null, 'design')], ['design']);
  assert.equal(startingPick('', 'design').size, 0);
  const n = countTeams(['design', 'design', 'unassigned']);
  assert.equal(n.design, 2);
  assert.equal(n.unassigned, 1);
  assert.equal(n.testing, 0);
});

test("a team page reads the team's journal from the checkout, newest first, and lists nothing that isn't there", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'subboards-'));
  mkdirSync(path.join(dir, 'docs', 'team'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'team', 'testing.md'), '# Testing journal\n\n## 2026-10-01 09:00 — Standup\n### Done\n- e2e harness\n\n## 2026-10-02 10:00 — Decision\nUse Playwright.\n');
  const d = await teamPageData('f-test', dir, 'testing');
  assert.equal(d.journalPath, 'docs/team/testing.md');
  assert.deepEqual(
    d.journal.map((e) => e.date),
    ['2026-10-02', '2026-10-01'],
  );
  assert.equal(d.journal[0].body, 'Use Playwright.');
  const none = await teamPageData('f-test', dir, 'design');
  assert.deepEqual(none.journal, []);
  assert.deepEqual(none.design, []);
});
