import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { APP_DIR_MAX, appDirTooLong } from '../src/server/wizard/mendix-app.js';
import { failureWords } from '../src/server/wizard/run.js';

test('a failed command is reported by its ERROR line, not the stack frames under it', () => {
  const err = 'ERROR: System.IO.PathTooLongException: The specified file name or path is too long, or a component of the specified path is too long.';
  const frames = Array.from({ length: 12 }, (_, i) => String.raw`   at Mendix.MxToolset.Step${i}() in Mendix.MxToolset\Step.cs:line ${i}`);
  assert.equal(failureWords(frames, err), err);
  // No error line: the last lines that aren't frames.
  assert.equal(failureWords(['Extracting package...', 'Saving project...', ...frames.slice(0, 3)]), 'Extracting package... Saving project...');
  // Only frames: still something rather than nothing.
  assert.ok(failureWords(frames.slice(0, 2)).includes('Step1'));
  assert.equal(failureWords(['a', 'b', 'c', 'd']), 'b c d');
});

test("a new project's folder longer than Studio Pro can create an app in is refused before anything is made, with what to do", () => {
  const base = path.win32.join('C:', 'Users', 'someone', 'agent-office', 'projects', 'org');
  const fits = path.win32.join(base, 'visitor-registration');
  assert.ok(fits.length <= APP_DIR_MAX);
  assert.equal(appDirTooLong(fits, 'visitor-registration'), undefined);
  const name = 'visitor-registration-and-badge-printing-desk';
  const long = path.win32.join(base, name);
  const why = appDirTooLong(long, name) ?? '';
  assert.ok(why.includes(`${long} (${long.length} characters)`), why);
  assert.ok(why.includes(`at most ${APP_DIR_MAX - (long.length - name.length)} characters`), why);
  // A projects folder so deep no name fits: move the folder.
  const deep = path.win32.join('C:', 'x'.repeat(80), 'o', 'ab');
  assert.match(appDirTooLong(deep, 'ab') ?? '', /shorter path/);
});
