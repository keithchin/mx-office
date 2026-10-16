// The office's side of the desktop app (server/desktop/): the IPC channel it opens only for the app (a
// one-time sign-in link out; stop and restart-now in), and the red Needs-you items the tray reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fromDesktop, handleDesktopRequest, wireDesktop } from '../src/server/desktop/ipc.ts';
import { desktopNeedOf } from '../src/server/desktop/status.ts';

test('only an office the app started, with its channel, talks to it', () => {
  const send = () => true;
  assert.equal(fromDesktop({ AGENT_OFFICE_DESKTOP: '1' }, { send }), true);
  assert.equal(fromDesktop({ AGENT_OFFICE_DESKTOP: '1' }, { send: undefined }), false);
  assert.equal(fromDesktop({}, { send }), false);
});

test('requests: stop and restart now do what the office does for Ctrl+C and a restart; anything else nothing', () => {
  const did: string[] = [];
  const w = { stop: () => did.push('stop'), restart: () => did.push('restart') };
  assert.equal(handleDesktopRequest({ t: 'stop' }, w), true);
  assert.equal(handleDesktopRequest({ t: 'restart-now' }, w), true);
  assert.equal(handleDesktopRequest({ t: 'eval', code: 'x' }, w), false);
  assert.equal(handleDesktopRequest('stop', w), false);
  assert.equal(handleDesktopRequest(null, w), false);
  assert.deepEqual(did, ['stop', 'restart']);
});

test('wired: the app gets the sign-in link once, over the channel, and its stop reaches the office', () => {
  const proc = Object.assign(new EventEmitter(), { env: { AGENT_OFFICE_DESKTOP: '1' }, sent: [] as unknown[], channel: { unref() {} } }) as unknown as NodeJS.Process & { sent: unknown[] };
  (proc as unknown as { send: (m: unknown) => boolean }).send = (m) => (proc.sent.push(m), true);
  let stopped = 0;
  let links = 0;
  assert.equal(wireDesktop({ signIn: () => (links++, '/login#key=abc'), stop: () => stopped++ }, proc), true);
  assert.deepEqual(proc.sent, [{ t: 'ready', signIn: '/login#key=abc' }]);
  proc.emit('message', { t: 'stop' });
  assert.equal(stopped, 1);
  assert.equal(links, 1);
  // Without the app: nothing is wired, no link is made.
  const plain = Object.assign(new EventEmitter(), { env: {} }) as unknown as NodeJS.Process;
  assert.equal(wireDesktop({ signIn: () => (links++, 'x'), stop: () => stopped++ }, plain), false);
  assert.equal(links, 1);
});

test('status: a red item keeps its stable id and becomes a path the window opens', () => {
  const base = { id: 'f1:esc:9', floor: 'f1', project: 'Travel', who: 'Ana', summary: 'Pick a DB', urgency: 'URGENT', level: 'block' as const };
  assert.deepEqual(desktopNeedOf({ ...base, link: 'http://desktop.invalid/lite?floor=f1' }), { ...base, path: 'lite?floor=f1' });
  assert.equal(desktopNeedOf({ ...base, link: 'http://desktop.invalid/lite?tab=settings&section=team&floor=f1' }).path, 'lite?tab=settings&section=team&floor=f1');
  assert.equal(desktopNeedOf({ ...base, floor: 'a b' }).path, 'lite?floor=a%20b');
});
