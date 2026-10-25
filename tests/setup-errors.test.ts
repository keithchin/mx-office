import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { APP_DIR_MAX, appDirTooLong, holdsToPathLimit, shorterProjectsFolder } from '../src/server/wizard/mendix-app.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import { isStandInTool } from '../src/server/testmode.js';
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

test('real-build fix: the path check runs in a test office whenever a real Studio Pro mx would make the app, and the message suggests a shorter folder', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rb-mx-'));
  try {
    const mx = path.join(root, 'Mendix', '11.12.4', 'modeler', process.platform === 'win32' ? 'mx.exe' : 'mx');
    mkdirSync(path.dirname(mx), { recursive: true });
    writeFileSync(mx, '');
    const cfg = { mendixDir: path.join(root, 'Mendix') } as WizardConfig;
    // A real office: always held to it.
    assert.equal(holdsToPathLimit(false, cfg, '11.12.4', isStandInTool), true);
    // A test office with the real Studio Pro (the real-build test): held to it too.
    assert.equal(holdsToPathLimit(true, cfg, '11.12.4', isStandInTool), true);
    // A test office whose Studio Pro is a stand-in in its own folder, or no mx at all: let through.
    const fake = { mendixDir: path.join(root, 'test-offices', 'x', 'Mendix') } as WizardConfig;
    const fmx = path.join(fake.mendixDir, '11.12.4', 'modeler', process.platform === 'win32' ? 'mx.exe' : 'mx');
    mkdirSync(path.dirname(fmx), { recursive: true });
    writeFileSync(fmx, '');
    assert.equal(holdsToPathLimit(true, fake, '11.12.4', isStandInTool), false);
    assert.equal(holdsToPathLimit(true, cfg, '10.0.0', isStandInTool), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const dir = path.win32.join('C:', 'Users', 'someone', 'agent-spike', 'scratch', 'rb-proj', 'rb-local', 'rb-equipment-loans-and-more');
  const why = appDirTooLong(dir, 'rb-equipment-loans-and-more') ?? '';
  assert.match(why, /for example C:.mx-projects/);
  assert.match(why, /Nothing was created/);
  assert.equal(shorterProjectsFolder('/home/me/deep/projects/o/n'), '/mx-projects');
});
