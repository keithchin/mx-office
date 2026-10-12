// The new-project setup's five friendly groups (shared/setup-groups.ts): which steps each runs, how a
// group's status rolls up from its steps', and the line each step shows (a skipped step's real reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { failHeadline, groupNameOf, groupStatus, plainError, openGroup, SETUP_GROUP_IDS, SETUP_GROUP_STEPS, setupGroups, stepNote } from '../src/shared/setup-groups.js';
import { SETUP_STEPS, type JobView, type StepId, type StepStatus, type StepView } from '../src/shared/wizard.js';

const plan = { kind: 'new' as const, mendix: '11.12.4' };
function jobOf(status: JobView['status'], set: Partial<Record<StepId, Pick<StepView, 'status' | 'detail'>>>) {
  const steps: StepView[] = SETUP_STEPS.map((s) => ({ id: s.id, label: s.label, status: 'pending', ...set[s.id] }));
  return { steps, status, plan };
}
const done = (ids: StepId[]) => Object.fromEntries(ids.map((id) => [id, { status: 'done' as StepStatus }]));

test('the mapping: five groups in order, every setup step in exactly one', () => {
  assert.deepEqual(SETUP_GROUP_IDS, ['repository', 'app', 'toolkit', 'save', 'team']);
  assert.deepEqual(SETUP_GROUP_STEPS, {
    repository: ['repo', 'clone'],
    app: ['env', 'app'],
    toolkit: ['init', 'hooks', 'intake', 'decisions', 'gates'],
    save: ['settings', 'commit', 'issue'],
    team: ['team', 'queue'],
  });
  const flat = SETUP_GROUP_IDS.flatMap((g) => SETUP_GROUP_STEPS[g]);
  assert.equal(new Set(flat).size, flat.length, 'no step twice');
  assert.deepEqual([...flat].sort(), SETUP_STEPS.map((s) => s.id).sort(), 'every step, and nothing else');
  assert.deepEqual(setupGroups(jobOf('running', {})).map((g) => g.name), ['Repository', 'Mendix app', 'Toolkit & gates', 'Save & publish', 'Team']);
});

test('roll-up: any failed is failed, any running is running, all done or skipped is done (skips counted, not hidden)', () => {
  assert.equal(groupStatus(['done', 'failed']), 'failed');
  assert.equal(groupStatus(['failed', 'running']), 'failed');
  assert.equal(groupStatus(['done', 'running', 'pending']), 'running');
  assert.equal(groupStatus(['done', 'skipped']), 'done');
  assert.equal(groupStatus(['skipped', 'skipped']), 'done');
  assert.equal(groupStatus(['pending', 'pending']), 'pending');
  // Between two steps of a running setup the group is still running; a setup that stopped leaves it waiting.
  assert.equal(groupStatus(['done', 'pending'], true), 'running');
  assert.equal(groupStatus(['done', 'pending'], false), 'pending');
  assert.equal(groupStatus([], true), 'pending');

  const g = setupGroups(jobOf('done', { ...done(SETUP_STEPS.map((s) => s.id)), team: { status: 'skipped', detail: 'offline test office: nobody is hired' }, queue: { status: 'skipped', detail: 'offline test office: no agent is queued' } }));
  const team = g.find((x) => x.id === 'team')!;
  assert.equal(team.status, 'done');
  assert.equal(team.skipped, 2);
  assert.equal(team.announce, 'Team: done, 2 skipped');
  assert.ok(g.every((x) => x.status === 'done'));
});

test('a setup mid-way: the earlier groups done, the running one open, the rest waiting', () => {
  const g = setupGroups(jobOf('running', { ...done(['repo', 'clone', 'env']), app: { status: 'running' } }));
  assert.deepEqual(
    g.map((x) => x.status),
    ['done', 'running', 'pending', 'pending', 'pending'],
  );
  assert.equal(openGroup(g), 'app');
  assert.equal(g[1].announce, 'Mendix app: in progress');
  assert.match(g[1].say, /Mendix 11\.12\.4/);
});

test('the groups tick in order: settings (run before gates) leaves Save & publish waiting until Toolkit & gates is done', () => {
  const mid = setupGroups(jobOf('running', { ...done(['repo', 'clone', 'env', 'app', 'init', 'hooks', 'intake', 'decisions', 'settings']), gates: { status: 'running' } }));
  assert.deepEqual(mid.map((x) => x.status), ['done', 'done', 'running', 'pending', 'pending']);
  assert.equal(mid[3].steps[0].status, 'done', 'the step itself still says done');
  const next = setupGroups(jobOf('running', { ...done(['repo', 'clone', 'env', 'app', 'init', 'hooks', 'intake', 'decisions', 'settings', 'gates']) }));
  assert.deepEqual(next.map((x) => x.status), ['done', 'done', 'done', 'running', 'pending']);
});

test('a failure: its group is failed with the step and its error, and that group is the one open', () => {
  const g = setupGroups(jobOf('failed', { ...done(['repo', 'clone', 'env']), app: { status: 'failed', detail: 'Mendix 11.12.4 is not installed' } }));
  const app = g.find((x) => x.id === 'app')!;
  assert.equal(app.status, 'failed');
  assert.equal(app.failed?.id, 'app');
  assert.equal(app.steps.find((s) => s.id === 'app')?.note, 'Mendix 11.12.4 is not installed');
  assert.equal(app.announce, 'Mendix app: failed: Create the Mendix app (.mpr)');
  assert.equal(openGroup(g), 'app');
  assert.deepEqual(g.slice(2).map((x) => x.status), ['pending', 'pending', 'pending'], 'nothing after it ran');
  assert.equal(failHeadline('Create the Mendix app (.mpr)'), 'Couldn’t create the Mendix app (.mpr).');
});

test('the skip reasons shown are the step’s real ones', () => {
  assert.equal(stepNote({ status: 'skipped', detail: 'offline test office: nobody is hired' }), 'skipped: offline test office: nobody is hired');
  assert.equal(stepNote({ status: 'skipped', detail: 'not asked for' }), 'skipped: not asked for');
  assert.equal(stepNote({ status: 'skipped' }), 'skipped');
  assert.equal(stepNote({ status: 'done', detail: 'offline: a local bare repository at C:\\x' }), 'offline: a local bare repository at C:\\x');
  assert.equal(stepNote({ status: 'pending', detail: 'stale' }), undefined);
  // The offline test office's own words for its skipped steps, as the server writes them (steps.ts).
  const steps = readFileSync(path.join(import.meta.dirname, '..', 'src', 'server', 'wizard', 'steps.ts'), 'utf8');
  for (const why of ['offline test office: nobody is hired', 'offline test office: no agent is queued']) assert.ok(steps.includes(why), why);
  const g = setupGroups(jobOf('done', { ...done(SETUP_STEPS.map((s) => s.id)), queue: { status: 'skipped', detail: 'offline test office: no agent is queued' } }));
  assert.equal(g.find((x) => x.id === 'team')!.steps.find((s) => s.id === 'queue')!.note, 'skipped: offline test office: no agent is queued');
});

test('a change to an existing app says so, rather than creating a repository', () => {
  const g = setupGroups({ ...jobOf('running', {}), plan: { kind: 'change', mendix: '10.24.0' } });
  assert.match(g[0].say, /existing repository/);
  assert.match(g[1].say, /existing Mendix app/);
});

test('the page draws the groups: Retry, Cancel & undo with its note, the ready card and View setup details', () => {
  const src = (p: string) => readFileSync(path.join(import.meta.dirname, '..', p), 'utf8');
  const view = src('src/client/ui/wizard/progress.ts');
  for (const s of ['setupGroups(', "'Retry'", "'Cancel & undo…'", 'Cancel & undo only removes what this setup recorded creating.', 'is ready', 'Open in Studio Pro', 'View setup details', 'openCancelDialog(']) assert.ok(view.includes(s), s);
  const groups = src('src/client/ui/wizard/groups.ts');
  assert.match(groups, /'aria-live': 'polite'/);
  assert.match(groups, /'aria-expanded'/);
});

test('an unfinished setup’s card names the group its step is in', () => {
  assert.equal(groupNameOf('Create the Mendix app (.mpr)'), 'Mendix app');
  assert.equal(groupNameOf('queue'), 'Team');
  assert.equal(groupNameOf('Taking the project off the office'), undefined);
});

test('a failed step’s error names a command by its file, not its full path', () => {
  assert.equal(plainError('C:\\Users\\x\\Mendix\\11.12.4\\modeler\\mx.exe create-project failed (exit 1): Mendix 11.12.4 is not installed'), 'mx.exe create-project failed (exit 1): Mendix 11.12.4 is not installed');
  assert.equal(plainError('/usr/bin/gh repo create failed'), 'gh repo create failed');
  assert.equal(plainError('the folder C:\\a\\b is not empty'), 'the folder C:\\a\\b is not empty', 'paths later in the line stay');
  assert.equal(stepNote({ status: 'failed', detail: 'C:\\m\\mx.exe create-project failed' }), 'mx.exe create-project failed');
});
