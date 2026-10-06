// The Teams webhook moved into 🔌 Connections (connections/teams-webhook.ts, notify-teams/settings.ts),
// and the Teams cards' Open buttons following the tunnel (phone-access/teams-link.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault, fileCipher } from '../src/server/connections/vault.ts';
import { teamsWebhookSlot } from '../src/server/connections/teams-webhook.ts';
import { useSecretSlot } from '../src/server/notify-teams/secret.ts';
import { TeamsSettings } from '../src/server/notify-teams/settings.ts';
import { linkTeams, unlinkTeams, type PublicUrlSlot } from '../src/server/phone-access/teams-link.ts';
import { CREDENTIAL_META } from '../src/shared/connections.ts';

const HOOK = 'https://prod-12.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRETsig123';

test('a webhook URL in notify-teams.json moves into the vault once, then out of the file', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-teams-'));
  const file = path.join(dir, 'notify-teams.json');
  writeFileSync(file, JSON.stringify({ url: HOOK, floors: 'all', level: 'needs', publicUrl: 'https://office.example.com' }));
  const vault = new Vault(path.join(dir, 'credentials.json'), fileCipher).load();
  useSecretSlot(teamsWebhookSlot(() => vault));
  try {
    const s = new TeamsSettings(file);
    assert.equal(s.url(), HOOK, 'usable at once');
    assert.equal(s.where(), 'credential-store');
    await s.migrated;
    assert.equal(vault.get('teams-webhook'), HOOK);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.url, undefined, 'gone from the settings file');
    assert.equal(saved.publicUrl, 'https://office.example.com', 'the rest kept');
    assert.doesNotMatch(readFileSync(path.join(dir, 'credentials.json'), 'utf8'), /SECRETsig123/, 'not in plain text in the vault file');
    // The next start finds nothing to move, and still has it.
    const again = new TeamsSettings(file);
    await again.migrated;
    assert.equal(again.url(), HOOK);
    // A new URL from ⚙️ Settings goes to the vault too, never the file.
    assert.equal(again.patch({ url: `${HOOK}x` }, 'Pat'), undefined);
    await new Promise((r) => setImmediate(r));
    assert.equal(vault.get('teams-webhook'), `${HOOK}x`);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /sig=/);
    assert.equal(again.patch({ url: '' }, 'Pat'), undefined);
    await new Promise((r) => setImmediate(r));
    assert.equal(vault.get('teams-webhook'), undefined);
  } finally {
    useSecretSlot(undefined);
  }
});

test('without Connections the URL stays in the settings file, as before', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-teams-'));
  const file = path.join(dir, 'notify-teams.json');
  writeFileSync(file, JSON.stringify({ url: HOOK }));
  const s = new TeamsSettings(file);
  await s.migrated;
  assert.equal(s.where(), 'settings-file');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).url, HOOK);
  assert.ok(existsSync(file));
});

test('the webhook has a card in Connections that only takes a webhook link', () => {
  const m = CREDENTIAL_META['teams-webhook'];
  assert.ok(m.shape!.test(HOOK));
  assert.ok(!m.shape!.test('ghp_abcdefghijklmnopqrstuvwxyz'));
  assert.equal(m.hidden, undefined);
  assert.equal(CREDENTIAL_META['web-push-key'].hidden, true);
});

function slot(initial?: string): PublicUrlSlot & { value?: string } {
  const s = {
    value: initial,
    get: () => s.value,
    set: (u: string) => void (s.value = u || undefined),
  };
  return s;
}

test('the tunnel’s address goes into the Teams cards’ Open buttons, unless someone typed their own', () => {
  const empty = slot();
  const owned = linkTeams(empty, 'https://x7-4600.euw.devtunnels.ms', undefined);
  assert.equal(empty.value, 'https://x7-4600.euw.devtunnels.ms');
  assert.equal(owned, 'https://x7-4600.euw.devtunnels.ms');
  // A new address replaces the one phone access put there.
  assert.equal(linkTeams(empty, 'https://office.example.com', owned), 'https://office.example.com');
  assert.equal(empty.value, 'https://office.example.com');
  // One typed by hand stays.
  const manual = slot('https://intranet.example.com/office');
  assert.equal(linkTeams(manual, 'https://x7-4600.euw.devtunnels.ms', undefined), undefined);
  assert.equal(manual.value, 'https://intranet.example.com/office');
  // A quick tunnel's address comes out when it stops; a persistent tunnel's stays.
  const quick = slot();
  const q = linkTeams(quick, 'https://a-b-c.trycloudflare.com', undefined);
  assert.equal(unlinkTeams(quick, 'https://a-b-c.trycloudflare.com', q, true), undefined);
  assert.equal(quick.value, undefined);
  const dev = slot();
  const d = linkTeams(dev, 'https://x7-4600.euw.devtunnels.ms', undefined);
  assert.equal(unlinkTeams(dev, 'https://x7-4600.euw.devtunnels.ms', d, false), d);
  assert.equal(dev.value, 'https://x7-4600.euw.devtunnels.ms');
});

test('phone access puts the tunnel address into the Teams settings as it comes up', async () => {
  const { PhoneAccess } = await import('../src/server/phone-access/index.ts');
  const { tunnelHost } = await import('../src/server/phone-access/origin.ts');
  const outs: ((t: string) => void)[] = [];
  const procs = {
    find: () => 'C:/fake/devtunnel.exe',
    run: async (_c: string, args: readonly string[]) => (args[0] === 'user' ? { code: 0, out: 'Logged in as pm@contoso.com using Microsoft.' } : args[0] === 'create' ? { code: 0, out: 'Tunnel ID : t1.euw' } : { code: 0, out: '' }),
    spawn: () => ({ onOutput: (f: (t: string) => void) => void outs.push(f), onExit: () => undefined, kill: () => undefined }),
  };
  const teams = slot();
  let saved: unknown = {};
  const ctx = { cfg: { port: 4600 } } as never;
  const p = new PhoneAccess(ctx, { procs, load: () => saved as never, save: (s) => void (saved = s), checkPrivacy: async () => 'private' }, teams);
  assert.equal(p.manager.start(), undefined);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  outs.forEach((f) => f('Connect via browser: https://t1-4600.euw.devtunnels.ms\nReady to accept connections for tunnel: t1.euw\n'));
  assert.equal(teams.value, 'https://t1-4600.euw.devtunnels.ms');
  assert.equal(tunnelHost(), 't1-4600.euw.devtunnels.ms');
  const v = p.view(true);
  assert.equal(v.teamsLinked, true);
  assert.equal(v.state, 'up');
  assert.equal(v.tunnelId, 't1.euw');
  p.manager.stop();
  assert.equal(tunnelHost(), undefined, 'not trusted once it is down');
  assert.equal(teams.value, 'https://t1-4600.euw.devtunnels.ms', 'a Dev Tunnel keeps its address for next time');
});
