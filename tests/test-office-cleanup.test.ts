// The test-office scripts' clean-up (scripts/perf/office.mjs killProcessesUnder, realAgentsUnder; desktop e2e's
// office finder) kills only processes of its own office: its root as a whole path, never a sibling office whose
// name starts with the same letters, never the shared test-offices folder. During a real build test a script's
// sweep of `test-offices/real-b` matched `test-offices/real-build/home` as a plain substring and killed that office
// twice, leaving no log line and no crash event. Nothing is started or killed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { namesRoot, killProcessesUnder } = (await import('../scripts/perf/office.mjs')) as { namesRoot: (line: string, root: string) => boolean; killProcessesUnder: (root: string) => number };

const PARENT = path.resolve('C:\\work\\scratch\\test-offices');
const MINE = path.join(PARENT, 'real-b');
const node = (home: string) => `"C:\\Program Files\\nodejs\\node.exe" C:\\work\\office\\bin\\agent-office.js --home ${home} --port 4731 --test-mode`;

test('the matcher takes its own office and what runs inside it', () => {
  assert.equal(namesRoot(node(path.join(MINE, 'office')), MINE), true, 'its office');
  assert.equal(namesRoot(node(MINE), MINE), true, 'the root itself, at the end of the line');
  assert.equal(namesRoot(`node fake-agent.mjs "${path.join(MINE, 'floors', 'qb0')}"`, MINE), true, 'quoted, inside it');
  assert.equal(namesRoot(node(path.join(MINE, 'office')).replaceAll('\\', '/').toUpperCase(), MINE), true, 'slashes and case as Windows writes them');
  assert.equal(namesRoot(`node x.js --dir=${MINE}\\\\office`, MINE), true, 'doubled separators');
});

test('the matcher never takes a sibling office whose name starts the same, nor one elsewhere', () => {
  assert.equal(namesRoot(node(path.join(PARENT, 'real-build', 'home')), MINE), false, 'real-b never matches real-build');
  assert.equal(namesRoot(node(path.join(PARENT, 'real-b-2')), MINE), false);
  assert.equal(namesRoot(node(path.join(PARENT, 'real-b.old')), MINE), false);
  assert.equal(namesRoot(node(path.join(PARENT, 'other')), MINE), false);
  assert.equal(namesRoot('', MINE), false);
});

test('a sweep of the shared test-offices folder is refused, and the scripts use the matcher, not a substring', () => {
  assert.throws(() => killProcessesUnder(PARENT), /every test office shares/);
  const office = readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'perf', 'office.mjs'), 'utf8');
  const e2e = readFileSync(path.join(import.meta.dirname, '..', 'desktop', 'scripts', 'e2e.mjs'), 'utf8');
  for (const [name, src] of [['office.mjs', office], ['e2e.mjs', e2e]]) assert.doesNotMatch(src, /\.includes\((r|h)\)/, `${name}: no plain substring match on a command line`);
  assert.match(e2e, /namesRoot\(/);
});
