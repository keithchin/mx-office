// 🔑 Claude for agents on the pages (real build test P0-2): no part of a key on a project's pages (not its tail,
// not its prefix), the one-time choice about the Claude access the office was started with never on a project's
// Overview or Needs you (members and admins alike: it's an office admin's setting, in Settings › Connections),
// and at most one office-level note on Home, for admins only. Drawn on a stand-in DOM (tests/support/fakedom.ts)
// from the server's own view built with a fake key. Nothing calls Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeEl } from './support/fakedom.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { healthItems } from '../src/shared/start.js';
import { usd } from '../src/shared/budget/money.js';
import type { SourceDeps } from '../src/server/claude-auth/source.js';
import { claudeAuthView, noteAuthFailure, resetClaudeAuth } from '../src/server/claude-auth/index.js';
import { closeConnections, officeSettings, updateOfficeSettings } from '../src/server/connections/store.js';

installFakeDom();
const toasts = document.createElement('div');
toasts.id = 'toasts';
document.body.append(toasts);
const made = document.createElement;
document.createElement = ((t: string) => Object.assign(made(t), { style: {} })) as typeof document.createElement;
Object.assign(globalThis, { requestAnimationFrame: (f: () => void) => setTimeout(f, 0), CSS: { escape: (s: string) => s } });
const { needsCard } = await import('../src/client/ui/portal/needs-card.js');
const { publishNeeds } = await import('../src/client/ui/needsyou/feed.js');

// A fake key with a recognisable start and end: neither may reach a page.
const PREFIX = 'sk-fakepfx';
const TAIL = 'Zq9w';
const FAKE_KEY = `${PREFIX}-0000000000000000000000${TAIL}`;
const deps = (started: Record<string, string>): SourceDeps => ({ started, setting: () => officeSettings().claudeAuth, stored: () => undefined, testMode: () => false });
const text = (el: FakeEl) => el.outerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noKey = (s: string, what: string) => {
  assert.ok(!s.includes(FAKE_KEY), `${what}: not the key`);
  assert.ok(!s.includes(TAIL), `${what}: not its tail`);
  assert.ok(!s.includes(PREFIX), `${what}: not its prefix`);
};

function drawOverview(claude: ReturnType<typeof claudeAuthView>) {
  const card = needsCard({ show: () => {}, answer: async () => undefined, ask: () => true });
  const items = collectNeeds({ floor: 'f1', workers: [], pulls: [], floors: [], claude });
  publishNeeds({ floor: 'f1', items, go: () => {} } as never);
  return { items, page: text(card.el as unknown as FakeEl) };
}

test('the choice about the office’s Claude access is never on a project’s Overview or Needs you, for a member or an admin', () => {
  closeConnections();
  resetClaudeAuth();
  updateOfficeSettings({ claudeAuth: undefined });
  const d = deps({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: 'https://gw.example' });
  const admin = claudeAuthView(true, d);
  assert.ok(admin.decision, 'the choice is open (for the admin’s Connections page)');
  assert.match(admin.decision!.text, /Agents use the Claude access this office was started with/);
  const member = claudeAuthView(false, d);
  assert.equal(member.decision, undefined, 'a member’s view never carries it');
  for (const [who, v] of [['member', member], ['admin', admin]] as const) {
    const { items, page } = drawOverview(v);
    assert.equal(items.filter((i) => i.kind === 'claude').length, 0, `${who}: no Claude card on the project`);
    assert.doesNotMatch(page, /Claude sign-in|Keep using it|credential/i, `${who}: nothing about it on the Overview`);
    noKey(page, `${who}'s Overview`);
    noKey(JSON.stringify(v), `${who}'s view`);
  }
});

test('when Claude refuses the agents, the red alert on a project names the source, never a character of the key', () => {
  closeConnections();
  resetClaudeAuth();
  updateOfficeSettings({ claudeAuth: { mode: 'env' } });
  try {
    const d = deps({ ANTHROPIC_API_KEY: FAKE_KEY });
    noteAuthFailure({ id: 'w1', name: 'Sophie', floor: 'f1' }, Date.now(), d);
    for (const admin of [false, true]) {
      const v = claudeAuthView(admin, d);
      const { items, page } = drawOverview(v);
      assert.equal(items.filter((i) => i.kind === 'claude').length, 1, 'the one office-wide alert');
      assert.match(page, /ANTHROPIC_API_KEY from the office’s environment/);
      noKey(page, admin ? 'admin Overview' : 'member Overview');
      noKey(JSON.stringify(items), 'the Needs-you items (the phone, Teams and pushes are built from them)');
    }
  } finally {
    resetClaudeAuth();
    updateOfficeSettings({ claudeAuth: undefined });
  }
});

test('Home has at most one office-level note about it, for admins only', () => {
  const admin = healthItems({ working: 0, claude: 'decision', admin: true }, usd).filter((i) => i.id === 'claude');
  assert.equal(admin.length, 1);
  assert.equal(admin[0].ok, false);
  assert.match(admin[0].text, /Agents use the Claude access this office was started with/);
  assert.match(admin[0].href ?? '', /connections/);
  const member = healthItems({ working: 0, claude: 'decision', admin: false }, usd).filter((i) => i.id === 'claude');
  assert.deepEqual(member.map((i) => [i.text, i.ok]), [['Credentials OK', true]], 'a member sees no choice');
});
