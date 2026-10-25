// The office's exit lines (src/server/exit-trace.ts): every exit it can see leaves a line in its log (a normal
// exit with its code, the event loop running dry, a signal, an uncaught exception), so a future silent exit means
// a kill from outside. A stand-in process for the signals, and real child processes for the exits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installExitTrace, type ExitTraceDeps } from '../src/server/exit-trace.js';

function standIn() {
  const ee = new EventEmitter();
  const lines: string[] = [];
  const exits: number[] = [];
  const proc = Object.assign(ee, { pid: 4242, exit: ((c: number) => void exits.push(c)) as never }) as unknown as ExitTraceDeps['proc'];
  const t = installExitTrace({ write: (l) => lines.push(l), now: () => new Date('2026-10-25T10:00:00Z'), proc, uptime: () => 61 });
  return { ee, lines, exits, t };
}

test('a signal is noted, and the exit line says the code and why', () => {
  const s = standIn();
  s.ee.emit('SIGTERM');
  s.ee.emit('exit', 0);
  assert.deepEqual(s.lines, ['agent-office: exiting with code 0 after signal SIGTERM (pid 4242, 2026-10-25T10:00:00.000Z, up 61 s)']);
});

test('a hang-up (console window closed) is logged and ends the process as it would have', () => {
  const s = standIn();
  s.ee.emit('SIGHUP');
  assert.match(s.lines[0], /received SIGHUP .*: exiting \(pid 4242/);
  assert.deepEqual(s.exits, [129]);
});

test('an uncaught exception and an empty event loop each leave a line', () => {
  const s = standIn();
  s.ee.emit('uncaughtExceptionMonitor', new Error('boom'), 'uncaughtException');
  s.ee.emit('beforeExit', 0);
  assert.match(s.lines[0], /fatal uncaught exception: Error: boom/);
  assert.match(s.lines[1], /event loop empty, exiting \(code 0\)/);
});

const MOD = pathToFileURL(path.join(import.meta.dirname, '..', 'src', 'server', 'exit-trace.ts')).href;
const run = (body: string) => spawnSync(process.execPath, ['--input-type=module', '-e', `const { installExitTrace } = await import(${JSON.stringify(MOD)}); installExitTrace(); ${body}`], { encoding: 'utf8', timeout: 30_000, windowsHide: true });

test('a real process: process.exit(3) and a crash both write their line to stderr', () => {
  const a = run('process.exit(3);');
  assert.equal(a.status, 3);
  assert.match(a.stderr, /agent-office: exiting with code 3 \(pid \d+/);
  const b = run('setTimeout(() => { throw new Error("kaboom"); }, 0);');
  assert.notEqual(b.status, 0, 'still crashes as it would');
  assert.match(b.stderr, /agent-office: fatal uncaught exception: Error: kaboom/);
  assert.match(b.stderr, /agent-office: exiting with code \d+ after uncaught exception/);
});
