// The project summary's redraws (client/ui/summary.ts): the board redraws it many times a minute, and
// it used to build its whole panel (45 elements) every time. Now nothing is built when it would show
// the same (same project, facts and "… ago"s, not the same object), a change puts only its section on
// the page, the console kept in the middle keeps its focus, typed text and scroll, and a summary
// answering late for a project the panel has left never paints over the new one.
// On a stand-in for the DOM (tests/support/fakedom.ts) and a stand-in fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeDocument, made, FakeEl } from './support/fakedom.js';
import type { ProjectSummary } from '../src/shared/summary.js';

installFakeDom();

const NOW = Date.now();
function summary(floor: string, over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    floor,
    name: `Project ${floor}`,
    narrative: 'Two agents are building the approval flow.',
    narrativeBy: 'template',
    progress: { issuesOpen: 2, issuesClosed: 3, issuesClosedCapped: false, prsOpen: 1, prsMerged: 4, prsMergedCapped: false, queued: 0, running: 1, done: 2 },
    agents: [
      { id: 'a', name: 'Sprocket', color: '#000', status: 'working', doing: 'Fix dashboard', quietMs: 60_000 },
      { id: 'b', name: 'Gizmo', color: '#111', status: 'needs_input', doing: 'waiting', waitingMs: 12 * 60_000 },
    ],
    needsHuman: { count: 1, longestMs: 12 * 60_000 },
    spend: { today: 9.44, total: 20 },
    activity: [
      { kind: 'started', text: 'Sprocket started Fix dashboard', at: NOW - 5 * 60_000 },
      { kind: 'pr-opened', text: 'PR #12 opened', at: NOW - 30 * 60_000 },
    ],
    risks: [],
    generatedAt: NOW,
    ...over,
  } as ProjectSummary;
}

/** What the office answers per floor (a new object every time), and answers held back to land later. */
const answers = new Map<string, () => ProjectSummary>();
const held = new Map<string, (v: ProjectSummary) => void>();
let asked = 0;
const hold = new Set<string>();
Object.assign(globalThis, {
  fetch: (url: string) => {
    asked++;
    const floor = new URL(url, 'http://office').searchParams.get('floor')!;
    const reply = (v: ProjectSummary) => ({ ok: true, status: 200, json: async () => v });
    if (hold.has(floor)) return new Promise((r) => held.set(floor, (v) => r(reply(v))));
    return Promise.resolve(reply(answers.get(floor)!()));
  },
});

const { renderSummary } = await import('../src/client/ui/summary.js');

/** A summary root on the page with the PM console in the middle (an input in it) and the chatter after. */
function page() {
  const root = new FakeEl('div');
  fakeDocument.body.append(root);
  const middle = new FakeEl('div');
  middle.className = 'pmc';
  const input = new FakeEl('textarea');
  middle.append(input);
  const after = new FakeEl('div');
  after.className = 'chatter';
  return { root, middle, after, input };
}

test('unchanged data: the same elements across ten redraws, nothing built (fresh objects every time)', async () => {
  answers.set('p1', () => summary('p1'));
  const { root, middle, after } = page();
  const opts = { middle, after, fresh: true };
  await renderSummary(root, 'p1', opts);
  const first = root.descendants();
  assert.ok(first.length >= 40, `the panel is drawn (${first.length} elements)`);
  const before = made.elements;
  for (let i = 0; i < 10; i++) await renderSummary(root, 'p1', opts);
  assert.equal(made.elements - before, 0, 'no element built');
  const now = root.descendants();
  assert.equal(now.length, first.length);
  assert.ok(now.every((el, i) => el === first[i]), 'the very same elements');
  // A fresh object each time, not a reused one.
  assert.ok(asked >= 11);
});

test('each change puts only its section on the page', async () => {
  let s = summary('p2');
  answers.set('p2', () => structuredClone(s));
  const { root, middle, after } = page();
  const opts = { middle, after, fresh: true };
  await renderSummary(root, 'p2', opts);
  const sec = (key: string) => root.querySelector(`[data-fold=${key}]`)!;
  const head = () => root.querySelector('.sm-head')!;
  const keep = { story: sec('story'), progress: sec('progress'), agents: sec('agents'), activity: sec('activity'), head: head() };
  const same = (...names: (keyof typeof keep)[]) => {
    for (const n of names) assert.equal(n === 'head' ? head() : sec(n), keep[n], `${n} kept`);
  };

  s = { ...s, agents: s.agents.map((a) => (a.id === 'a' ? { ...a, status: 'idle', doing: 'idle' } : a)) } as ProjectSummary;
  await renderSummary(root, 'p2', opts);
  assert.notEqual(sec('agents'), keep.agents);
  assert.match(sec('agents').textContent, /idle/);
  same('story', 'progress', 'activity', 'head');
  keep.agents = sec('agents');

  s = { ...s, progress: { ...s.progress, issuesClosed: 9 } };
  await renderSummary(root, 'p2', opts);
  assert.notEqual(sec('progress'), keep.progress);
  assert.match(sec('progress').textContent, /9 closed/);
  same('story', 'agents', 'activity', 'head');
  keep.progress = sec('progress');

  s = { ...s, activity: [{ kind: 'pr-merged', text: 'PR #12 merged', at: NOW }, ...s.activity] };
  await renderSummary(root, 'p2', opts);
  assert.notEqual(sec('activity'), keep.activity);
  assert.match(sec('activity').textContent, /PR #12 merged/);
  same('story', 'agents', 'progress', 'head');
  keep.activity = sec('activity');

  assert.doesNotMatch(root.querySelector('.sm-risks')!.textContent, /CI is red/);
  s = { ...s, risks: [{ level: 'bad', text: 'CI is red on main' }] };
  await renderSummary(root, 'p2', opts);
  assert.match(root.querySelector('.sm-risks')!.textContent, /CI is red/);
  same('story', 'agents', 'progress', 'activity', 'head');

  s = { ...s, phase: { label: 'Stage 3 — Build', from: 'PROJECT.md', stages: [], decisions: [] } } as ProjectSummary;
  await renderSummary(root, 'p2', opts);
  assert.notEqual(head(), keep.head);
  assert.match(head().textContent, /Stage 3/);
  same('story', 'agents', 'progress', 'activity');
});

test('the shown "… ago" moving on is a change; the same words are not', async () => {
  answers.set('p3', () => summary('p3'));
  const { root, middle, after } = page();
  const realNow = Date.now;
  try {
    await renderSummary(root, 'p3', { middle, after });
    const act = root.querySelector('[data-fold=activity]')!;
    assert.match(act.textContent, /5m ago/);
    Date.now = () => realNow() + 20_000;
    await renderSummary(root, 'p3', { middle, after });
    assert.equal(root.querySelector('[data-fold=activity]'), act, 'still "5m ago": kept');
    Date.now = () => realNow() + 61_000;
    await renderSummary(root, 'p3', { middle, after, fresh: true });
    assert.notEqual(root.querySelector('[data-fold=activity]'), act);
    assert.match(root.querySelector('[data-fold=activity]')!.textContent, /6m ago/);
  } finally {
    Date.now = realNow;
  }
});

test("the console's focus, typed text and the chatter's scroll survive redraws, changed ones too", async () => {
  let n = 0;
  answers.set('p4', () => summary('p4', { spend: { today: n, total: 20 } }));
  const { root, middle, after, input } = page();
  await renderSummary(root, 'p4', { middle, after });
  input.focus();
  input.value = 'half a question';
  after.scrollTop = 240;
  for (let i = 0; i < 10; i++) {
    n = i;
    await renderSummary(root, 'p4', { middle, after, fresh: true });
  }
  assert.equal(fakeDocument.activeElement, input, 'still focused');
  assert.equal(input.value, 'half a question');
  assert.equal(after.scrollTop, 240);
  const kids = root.children;
  assert.ok(kids.indexOf(middle) > kids.indexOf(root.querySelector('.sm-main')!), 'the console after the details');
  assert.equal(kids[kids.length - 1], after, 'the chatter last');
  assert.ok(kids.indexOf(middle) < kids.indexOf(root.querySelector('.sm-activity')!), 'the activity after the console');
});

test("a summary answering late for the project the panel left doesn't paint over the new one", async () => {
  answers.set('new', () => summary('new'));
  const { root, middle, after } = page();
  hold.add('old');
  const late = renderSummary(root, 'old', { middle, after });
  await renderSummary(root, 'new', { middle, after });
  hold.delete('old');
  held.get('old')!(summary('old'));
  assert.equal(await late, undefined, 'resolves with nothing');
  assert.match(root.textContent, /Project new/);
  assert.doesNotMatch(root.textContent, /Project old/);
});
