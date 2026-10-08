// What the off-loop pass (2026-10-08) moved off the server's event loop for a loaded Windows machine:
// the machine monitor's CPU reading (offloop/cpu.ts), the files saved often (offloop/save.ts), the
// journals and project files the ranking reads (roster/journal-io.ts, summary/project.ts), and the
// transcript lookup the analyzer does for every recorded run (analysis/transcript.ts). Each gives the
// same answer as the synchronous read it stands in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cpuTimesOff, stopCpuWorker, sumCpus } from '../src/server/offloop/cpu.js';
import { BackgroundFile } from '../src/server/offloop/save.js';
import { journalFileAsync, readJournal, readJournalSoon } from '../src/server/roster/journal-io.js';
import { projectFacts, projectFactsAsync } from '../src/server/summary/project.js';
import { encodeProjectDir, findTranscript, findTranscriptAsync } from '../src/server/analysis/transcript.js';
import { journalPath } from '../src/shared/roster/roles.js';

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

test('the CPU reading from the worker thread adds up like os.cpus() does', async () => {
  try {
    const a = await cpuTimesOff();
    const b = sumCpus(os.cpus());
    assert.ok(a.total > 0 && a.idle > 0 && a.idle <= a.total);
    assert.ok(b.total >= a.total * 0.5, 'the same counters, read moments apart');
    const later = await cpuTimesOff();
    assert.ok(later.total >= a.total, 'they only go up');
  } finally {
    await stopCpuWorker();
  }
});

test('a file saved in the background: the latest text lands, and flush() wins over a write still out', async () => {
  const dir = tmp('offloop-save-');
  try {
    const file = path.join(dir, 'sub', 'x.json');
    const f = new BackgroundFile(file, { mkdir: true });
    void f.write('1');
    void f.write('2');
    await f.write('3');
    assert.equal(readFileSync(file, 'utf8'), '3');
    // A background write out when the office flushes at exit never lands over what flush() wrote.
    const out = f.write('old');
    f.flush('new');
    await out;
    assert.equal(readFileSync(file, 'utf8'), 'new');
    // flush() with nothing new still writes what a background write had out.
    const pending = f.write('last');
    f.flush();
    await pending;
    assert.equal(readFileSync(file, 'utf8'), 'last');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("journals read off the loop: the same entries, the worker's copy first; readJournalSoon answers from the last read", async () => {
  const dir = tmp('offloop-journal-');
  try {
    const wt = path.join(dir, 'wt');
    const file = path.join(dir, journalPath('development'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '## 2026-10-08 — Standup\nShipped the login page.\n');
    const floor = { dir, cwdOf: () => wt };
    const w = { id: 'w1' } as never;
    assert.deepEqual(await journalFileAsync(file), readJournal(floor, undefined, 'development'));
    assert.equal(await journalFileAsync(path.join(wt, journalPath('development'))), undefined, 'not there');
    // Soon: from what was read; the worker's own copy is read in the background for the next look.
    assert.deepEqual(readJournalSoon(floor, w, 'development'), readJournal(floor, w, 'development'));
    mkdirSync(path.dirname(path.join(wt, journalPath('development'))), { recursive: true });
    writeFileSync(path.join(wt, journalPath('development')), '## 2026-10-08 — Handoff\nOver to testing.\n');
    // A look while an earlier read is still out may miss the change; the look after the next read has it.
    await new Promise((r) => setTimeout(r, 50));
    readJournalSoon(floor, w, 'development');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(readJournalSoon(floor, w, 'development'), readJournal(floor, w, 'development'));
    assert.match(readJournalSoon(floor, w, 'development')[0].heading, /Handoff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project facts read off the loop are the same as read in place', async () => {
  const dir = tmp('offloop-project-');
  try {
    writeFileSync(path.join(dir, 'README.md'), '# Shop\n\nA small shop for plants.\n');
    writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n\nCurrent stage: Build\n');
    const a = await projectFactsAsync(dir);
    assert.deepEqual(a, projectFacts(dir));
    assert.equal(await projectFactsAsync(dir), a, 'unchanged files: the same facts, not read again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session transcript is found off the loop where findTranscript finds it', async () => {
  const home = tmp('offloop-home-');
  const before = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const sid = 'abcd1234-5678';
    const cwd = path.join(home, 'proj');
    const other = path.join(home, '.claude', 'projects', 'elsewhere');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, `${sid}.jsonl`), '{}\n');
    assert.equal(await findTranscriptAsync(sid, cwd), findTranscript(sid, cwd));
    assert.equal(await findTranscriptAsync(sid, cwd), path.join(other, `${sid}.jsonl`));
    const guess = path.join(home, '.claude', 'projects', encodeProjectDir(cwd));
    mkdirSync(guess, { recursive: true });
    writeFileSync(path.join(guess, `${sid}.jsonl`), '{}\n');
    assert.equal(await findTranscriptAsync(sid, cwd), path.join(guess, `${sid}.jsonl`), 'the folder it ran in first');
    assert.equal(await findTranscriptAsync('bad id!', cwd), undefined);
  } finally {
    process.env.HOME = before.HOME;
    process.env.USERPROFILE = before.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  }
});
