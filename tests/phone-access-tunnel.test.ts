// 📱 Phone access's tunnel (server/phone-access/): the state machine with every CLI stubbed, so nothing
// real is started and no tunnel is opened. Start, sign in, the address read from the output, a drop and
// the restart after it, stop, the Dev Tunnel id kept across restarts, the quick tunnel's warning and
// hour, and a named tunnel that turns out to be public switched straight off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TunnelManager, cleanSaved, type ManagerDeps, type SavedAccess } from '../src/server/phone-access/manager.ts';
import type { Proc, Procs } from '../src/server/phone-access/procs.ts';
import { cloudflareAdapter } from '../src/server/phone-access/providers.ts';
import { cloudflareLoginUrl, cleanHostname, deviceCode, devtunnelAccount, devtunnelId, devtunnelUrl, looksPrivate, quickTunnelUrl, QUICK_TTL_MS } from '../src/shared/phone-access.ts';

class FakeProc implements Proc {
  out: ((t: string) => void)[] = [];
  exit: ((c: number | null) => void)[] = [];
  killed = false;
  constructor(readonly args: readonly string[]) {}
  onOutput(fn: (t: string) => void) {
    this.out.push(fn);
  }
  onExit(fn: (c: number | null) => void) {
    this.exit.push(fn);
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    this.exit.forEach((f) => f(null));
  }
  say(t: string) {
    this.out.forEach((f) => f(t));
  }
  end(code: number) {
    this.exit.forEach((f) => f(code));
  }
}

type Answers = Record<string, { code: number; out: string }>;

function fakeProcs(answers: Answers, tools = { devtunnel: 'C:/fake/devtunnel.exe', cloudflared: 'C:/fake/cloudflared.exe' }) {
  const runs: string[] = [];
  const spawned: FakeProc[] = [];
  const procs: Procs = {
    find: (t) => tools[t] || undefined,
    async run(_cmd, args) {
      const key = args.join(' ');
      runs.push(key);
      const hit = Object.entries(answers).find(([k]) => key.startsWith(k));
      return hit ? hit[1] : { code: 1, out: `no stub for ${key}` };
    },
    spawn(_cmd, args) {
      const p = new FakeProc(args);
      spawned.push(p);
      return p;
    },
  };
  return { procs, runs, spawned };
}

function harness(answers: Answers, saved: Partial<SavedAccess> = {}, extra: Partial<ManagerDeps> = {}) {
  const f = fakeProcs(answers);
  let store: SavedAccess = cleanSaved(saved);
  let now = 1_000_000;
  const timers: { fn: () => void; at: number; dead?: boolean }[] = [];
  const events: string[] = [];
  const m = new TunnelManager({
    procs: f.procs,
    port: 4600,
    load: () => store,
    save: (s) => void (store = s),
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => void ((t as { dead?: boolean }).dead = true),
    checkPrivacy: async () => 'private',
    events: { up: (url, _p, re) => events.push(`up ${url}${re ? ' (again)' : ''}`), down: (why) => events.push(`down ${why}`) },
    ...extra,
  });
  const tick = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.dead && x.at <= now)) {
      t.dead = true;
      t.fn();
    }
    await tick();
  };
  return { m, f, events, tick, advance, saved: () => store };
}

const DEV_OK: Answers = {
  'user show': { code: 0, out: 'Logged in as pm@contoso.com using Microsoft.' },
  create: { code: 0, out: JSON.stringify({ tunnel: { tunnelId: 'agent-office-x7.euw' } }) },
  'port create': { code: 0, out: 'Port 4600 created' },
  show: { code: 0, out: 'Tunnel ID : agent-office-x7.euw' },
};
const HOSTING = 'Hosting port: 4600\nConnect via browser: https://x7abc-4600.euw.devtunnels.ms\nInspect network activity: https://x7abc-4600-inspect.euw.devtunnels.ms\n\nReady to accept connections for tunnel: agent-office-x7.euw\n';
const SIGNED_IN = 'Logged in as pm@contoso.com using Microsoft.';

test('parses what the CLIs print', () => {
  assert.equal(devtunnelUrl(HOSTING, 4600), 'https://x7abc-4600.euw.devtunnels.ms');
  assert.equal(quickTunnelUrl('|  https://seven-quiet-words-here.trycloudflare.com  |'), 'https://seven-quiet-words-here.trycloudflare.com');
  const line = 'To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code FGH7K2LMN to authenticate.';
  assert.deepEqual(deviceCode(line), { url: 'https://microsoft.com/devicelogin', code: 'FGH7K2LMN', text: line });
  assert.equal(devtunnelId('Tunnel ID             : bold-wave-q1.euw\nDescription : x'), 'bold-wave-q1.euw');
  assert.equal(devtunnelAccount(SIGNED_IN), 'pm@contoso.com');
  assert.equal(devtunnelAccount('Not logged in.'), undefined);
  assert.match(cloudflareLoginUrl('Please open the following URL and log in with your Cloudflare account:\n\nhttps://dash.cloudflare.com/argotunnel?aud=&callback=https%3A%2F%2Flogin.cloudflareaccess.org%2Fx\n')!.url, /^https:\/\/dash\.cloudflare\.com\/argotunnel\?/);
  assert.equal(cleanHostname('https://Office.Example.com/m'), 'office.example.com');
  assert.equal(cleanHostname('not a host'), undefined);
  assert.equal(looksPrivate(302, 'https://contoso.cloudflareaccess.com/cdn-cgi/access/login'), true);
  assert.equal(looksPrivate(302, 'https://login.microsoftonline.com/common/oauth2'), true);
  assert.equal(looksPrivate(200, null), false);
});

test('Dev Tunnels: signed in, creates a private tunnel, hosts it, reads its address', async () => {
  const h = harness(DEV_OK);
  assert.equal(h.m.start(), undefined);
  await h.tick();
  assert.equal(h.m.state, 'starting');
  assert.ok(h.f.runs.some((r) => r.startsWith('create')));
  assert.ok(!h.f.runs.some((r) => r.includes('allow-anonymous')), 'never anonymous');
  assert.deepEqual(h.f.spawned[0].args, ['host', 'agent-office-x7.euw']);
  h.f.spawned[0].say(HOSTING);
  await h.tick();
  assert.equal(h.m.state, 'up');
  assert.equal(h.m.url, 'https://x7abc-4600.euw.devtunnels.ms');
  assert.equal(h.m.account, 'pm@contoso.com');
  assert.equal(h.m.privacy, 'private');
  assert.equal(h.saved().devtunnelId, 'agent-office-x7.euw');
  assert.equal(h.saved().on, true);
  assert.deepEqual(h.events, ['up https://x7abc-4600.euw.devtunnels.ms']);
});

test('drops and comes back by itself, with the same tunnel; stop kills it and it stays off', async () => {
  const h = harness(DEV_OK, { devtunnelId: 'agent-office-x7.euw' });
  h.m.start();
  await h.tick();
  assert.ok(!h.f.runs.some((r) => r.startsWith('create')), 'the saved tunnel is reused');
  h.f.spawned[0].say(HOSTING);
  await h.tick();
  h.f.spawned[0].end(1);
  await h.tick();
  assert.equal(h.m.state, 'restarting');
  assert.equal(h.events.at(-1), 'down The tunnel dropped (exit 1)');
  await h.advance(1_999);
  assert.equal(h.f.spawned.length, 1, 'waits before trying again');
  await h.advance(1);
  assert.equal(h.f.spawned.length, 2);
  h.f.spawned[1].say(HOSTING);
  await h.tick();
  assert.equal(h.m.state, 'up');
  assert.equal(h.m.restarts, 1);
  assert.equal(h.events.at(-1), 'up https://x7abc-4600.euw.devtunnels.ms (again)');
  h.m.stop();
  assert.equal(h.m.state, 'off');
  assert.equal(h.f.spawned[1].killed, true);
  assert.equal(h.saved().on, false);
  await h.advance(120_000);
  assert.equal(h.f.spawned.length, 2, 'no restart after stop');
  assert.equal(h.saved().devtunnelId, 'agent-office-x7.euw', 'the id is kept for next time');
});

test('the tunnel id survives an office restart, and resume brings it back on', async () => {
  const first = harness(DEV_OK);
  first.m.start();
  await first.tick();
  first.f.spawned[0].say(HOSTING);
  await first.tick();
  first.m.shutdown();
  assert.equal(first.saved().on, true, 'still on for the next start');
  const second = harness({ ...DEV_OK, create: { code: 1, out: 'should not be called' } }, first.saved());
  second.m.resume();
  await second.tick();
  assert.deepEqual(second.f.spawned[0].args, ['host', 'agent-office-x7.euw']);
  assert.ok(second.f.runs.includes('show agent-office-x7.euw'));
});

test('not signed in: shows the device code, then carries on once signed in', async () => {
  let signedIn = false;
  const h = harness({ ...DEV_OK, 'user show': { code: 0, out: 'Not logged in.' } });
  const run = h.f.procs.run.bind(h.f.procs);
  h.f.procs.run = async (cmd, args, t) => (args.join(' ') === 'user show' && signedIn ? { code: 0, out: SIGNED_IN } : run(cmd, args, t));
  h.m.start();
  await h.tick();
  assert.equal(h.m.state, 'signin');
  const login = h.f.spawned[0];
  assert.deepEqual(login.args, ['user', 'login', '-d']);
  login.say('To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD2345 to authenticate.\n');
  await h.tick();
  assert.equal(h.m.signIn?.code, 'ABCD2345');
  signedIn = true;
  login.end(0);
  await h.tick();
  assert.equal(h.m.signIn, undefined);
  assert.deepEqual(h.f.spawned[1].args.slice(0, 1), ['host']);
});

test('a missing CLI is refused with how to install it', () => {
  const f = fakeProcs(DEV_OK, { devtunnel: '', cloudflared: 'C:/fake/cloudflared.exe' });
  const m = new TunnelManager({ procs: f.procs, port: 4600, load: () => cleanSaved({}), save: () => undefined });
  assert.match(m.start() ?? '', /winget install Microsoft\.devtunnel/);
});

test('quick tunnel: refused without the warning accepted, public, and off after an hour', async () => {
  const h = harness({}, { provider: 'cloudflare-quick' });
  assert.match(h.m.start() ?? '', /warning/);
  assert.equal(h.f.spawned.length, 0);
  assert.equal(h.m.start({ acceptRisk: true }), undefined);
  await h.tick();
  assert.deepEqual(h.f.spawned[0].args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:4600']);
  h.f.spawned[0].say('2026-10-06 INF |  https://seven-quiet-words-here.trycloudflare.com  |');
  await h.tick();
  assert.equal(h.m.state, 'up');
  assert.equal(h.m.expiresAt, 1_000_000 + QUICK_TTL_MS);
  await h.advance(QUICK_TTL_MS);
  assert.equal(h.m.state, 'off');
  assert.equal(h.m.url, undefined);
  assert.equal(h.f.spawned[0].killed, true);
  assert.match(h.events.at(-1)!, /hour is up/);
  // Never back on by itself after a restart.
  const again = harness({}, { provider: 'cloudflare-quick', on: true });
  again.m.resume();
  assert.equal(again.saved().on, false);
  assert.equal(again.f.spawned.length, 0);
});

test('a named Cloudflare tunnel without Access in front is switched off at once', async () => {
  let procs: Procs | undefined;
  const h = harness(
    { 'tunnel create': { code: 0, out: 'Created tunnel agent-office-1a2b3c with id 6ff42ae2-765d-4adf-8112-31c55c1551ef' }, 'tunnel route dns': { code: 0, out: 'Added CNAME office.example.com' } },
    { provider: 'cloudflare', hostname: 'office.example.com' },
    // A signed-in cloudflared (its cert.pem stood in for).
    { checkPrivacy: async () => 'public', adapter: () => cloudflareAdapter(procs!, 4600, false, () => true) },
  );
  procs = h.f.procs;
  h.m.start();
  await h.tick();
  const run = h.f.spawned[0];
  assert.deepEqual(run.args, ['tunnel', '--no-autoupdate', 'run', '--url', 'http://127.0.0.1:4600', '6ff42ae2-765d-4adf-8112-31c55c1551ef']);
  run.say('INF Registered tunnel connection connIndex=0 location=fra08');
  await h.tick();
  assert.equal(h.m.state, 'error');
  assert.match(h.m.error ?? '', /Cloudflare Access isn’t protecting office\.example\.com/);
  assert.equal(run.killed, true);
  assert.equal(h.saved().on, false);
  assert.equal(h.saved().cloudflareTunnelId, '6ff42ae2-765d-4adf-8112-31c55c1551ef');
});
