// The team-lead panel docked beside every project tab (src/client/ui/lead-panel/): who it talks to on each
// team shape, how many things it says wait on you, what it keeps for you, when its terminal is attached,
// what a send while the lead is mid-turn does, and the unread count. On ./logic.ts (pure), the Needs-you
// feed and the tab hook; the panel's own wiring is checked where it does those things.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultCoverage, type TeamShape } from '../src/shared/roster/coverage.js';
import type { MemberView, RosterView } from '../src/shared/roster/types.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import type { ConvoMsg } from '../src/shared/protocol/convo.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { waitingCount } from '../src/client/ui/needsyou/feed.js';
import { initialsOf, lastAgentId, leadHeading, leadOf, PANEL_KEY, panelShown, PANEL_SHOW_KEY, readPanelState, sendPlan, statusLine, terminalWanted, unreadSince, writePanelState, type TermLook } from '../src/client/ui/lead-panel/logic.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const TITLE: Record<string, string> = { pm: 'Project Coordinator', 'chief-analyst': 'Chief Analyst', 'lead-developer': 'Lead Developer', 'lead-designer': 'Lead Designer', 'lead-tester': 'Lead Tester', 'solo-lead': 'Solo Lead' };
const member = (role: string, o: Partial<MemberView> = {}): MemberView => ({ role, title: TITLE[role], team: 'management', icon: '🧭', name: `${role}-name`, model: 'sonnet', status: 'idle', ...o }) as MemberView;
function roster(shape: TeamShape, o: { hired?: string[]; status?: Partial<Record<string, MemberView['status']>>; escalations?: Escalation[] } = {}): RosterView {
  const roles = Object.keys(TITLE);
  const hired = new Set(o.hired ?? roles);
  return {
    floor: 'f1',
    shape,
    coverage: defaultCoverage(shape),
    admin: true,
    members: roles.map((r) => member(r, { status: o.status?.[r] ?? (hired.has(r) ? 'idle' : 'not-hired'), workerId: hired.has(r) ? `w-${r}` : undefined, name: { pm: 'Ada', 'chief-analyst': 'Grace', 'solo-lead': 'Alan' }[r] ?? `${r}-name` })),
    escalations: o.escalations ?? [],
    approvals: [],
    proposals: [],
    standups: [],
    settings: {},
  } as unknown as RosterView;
}

test('the lead is whoever covers Management on the team’s shape, by its real name and role', () => {
  const ent = leadOf(roster('enterprise'))!;
  assert.equal(ent.kind, 'lead');
  assert.deepEqual(leadHeading(ent), { name: 'Ada', role: 'Project Coordinator' });
  const startup = leadOf(roster('startup', { hired: ['chief-analyst', 'lead-developer'] }))!;
  assert.deepEqual([startup.kind, leadHeading(startup)], ['lead', { name: 'Grace', role: 'Chief Analyst' }]);
  const solo = leadOf(roster('solo', { hired: ['solo-lead'] }))!;
  assert.deepEqual([solo.kind, leadHeading(solo)], ['lead', { name: 'Alan', role: 'Solo Lead' }]);
  // An office from before shapes (no coverage): the Project Coordinator.
  const old = roster('enterprise');
  delete (old as { coverage?: unknown }).coverage;
  assert.equal(leadHeading(leadOf(old)).role, 'Project Coordinator');
  assert.equal(leadOf(undefined), undefined, 'the team not in yet');
});

test('nobody covering Management: "No one leads the team yet", with the member to hire', () => {
  const none = leadOf(roster('enterprise', { hired: ['lead-developer', 'lead-designer'] }))!;
  assert.equal(none.kind, 'none');
  assert.equal(none.kind === 'none' && none.member?.role, 'pm');
  assert.equal(leadHeading(none).name, 'No one leads the team yet');
  assert.equal(statusLine(none, 'not-hired').text, 'No one leads the team yet');
  // A Startup team without its Chief Analyst: the Chief Analyst is the one to hire.
  const s = leadOf(roster('startup', { hired: ['lead-developer'] }))!;
  assert.equal(s.kind === 'none' && s.member?.title, 'Chief Analyst');
});

test('a benched lead: its name, "Benched", and the panel offers its handoff note and Hire again', () => {
  const b = leadOf(roster('enterprise', { status: { pm: 'benched' } }))!;
  assert.deepEqual([b.kind, leadHeading(b).name], ['benched', 'Ada']);
  assert.equal(statusLine(b, 'benched').dot, 'off');
  const panel = read('src/client/ui/lead-panel/panel.ts');
  assert.match(panel, /'Hire again'/);
  assert.match(panel, /l\.member\.handoffAt \? '📝 Latest handoff note' : '📓 Latest journal entry'/);
});

test('the status line: a dot and words, "Working: <activity>"', () => {
  const l = leadOf(roster('enterprise'));
  assert.deepEqual(statusLine(l, 'working', 'Reviewing PR #81'), { dot: 'work', text: 'Working: reviewing PR #81' });
  assert.deepEqual(statusLine(l, 'idle'), { dot: 'idle', text: 'Ready: waiting for work' });
  assert.equal(statusLine(l, 'needs-you', 'PR #8 needs a choice').text, 'Asking you: PR #8 needs a choice');
  assert.equal(initialsOf('Ada Lovelace'), 'AL');
  assert.equal(initialsOf('Ada'), 'AD');
});

const esc = (o: Partial<Escalation> = {}): Escalation => ({ id: 'e1', at: Date.now() - 60_000, workerId: 'w-lead-developer', by: 'Dylan', role: 'lead-developer', urgency: 'urgent', fyi: false, level: 2, title: 'Notify the approver?', details: 'An employee can withdraw a request.', options: ['Notify', 'Silently'], recommendation: 'Notify', status: 'open', ...o }) as Escalation;

test('"N waiting on you" counts every actionable item: escalations, a merged PR not verified, sign-offs, agents asking; not other floors', () => {
  const r = roster('enterprise', {
    escalations: [
      esc(),
      esc({ id: 'e2', urgency: 'important', title: 'Cost limit?' }),
      esc({ id: 'e3', urgency: 'important', title: 'PR #79 merged, not verified: required checks didn’t pass on merge commit abc1234', options: ['Re-run checks', 'Waive (with a reason)', 'Send back for rework'], recommendation: undefined }),
      // An FYI that asks nothing (an FYI with options is shown, and counted, as a decision: Slice 1A).
      esc({ id: 'e4', fyi: true, title: 'Just so you know', options: [], recommendation: undefined }),
      esc({ id: 'e5', status: 'resolved', title: 'Done already' }),
    ],
  });
  const items = collectNeeds({
    floor: 'f1',
    roster: r,
    workers: [{ id: 'w9', kind: 'agent', name: 'Sprocket', status: 'needs_input', activity: 'Allow Bash?', waitingSince: Date.now() - 1000 } as never],
    pulls: [],
    floors: [{ id: 'f2', name: 'Other', waiting: 3 } as never],
    setup: { show: true, stages: [{ id: '4', title: 'Build Plan', status: 'MANUAL' }] } as never,
  });
  // 3 open escalations (the FYI and the answered one aren't asks), the sign-off and the agent asking.
  assert.equal(waitingCount(items), 5);
  assert.ok(items.some((i) => i.kind === 'floor'), 'the other floor is listed, but not counted here');
  // The panel's strip and the Overview's tab count are the same number.
  assert.match(read('src/client/ui/needsyou/feed.ts'), /export const waitingCount = \(items: readonly NeedItem\[\], admin = true\): number => needsCount\(items, \{ admin \}\)\.forYou;/);
  assert.match(read('src/client/ui/lead-panel/panel.ts'), /countOf\(s, /);
});

/** A storage stand-in, and one that throws (a private window that blocks it). */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

test('what the panel keeps for you (open or collapsed, drafts and scroll per project) survives a reload, and storage failing', () => {
  const s = mem();
  writePanelState(s, { collapsed: true, drafts: { f1: 'half a question', f2: '' }, scroll: { f1: 120 }, seen: { 'w-pm': 'm4' } });
  const back = readPanelState(s);
  assert.deepEqual(back, { collapsed: true, drafts: { f1: 'half a question' }, scroll: { f1: 120 }, seen: { 'w-pm': 'm4' } }, 'an empty draft is not kept');
  s.setItem(PANEL_KEY, '{garbled');
  assert.deepEqual(readPanelState(s), { collapsed: false, drafts: {}, scroll: {}, seen: {} });
  s.setItem(PANEL_KEY, JSON.stringify({ collapsed: 'yes', drafts: { f1: 3 }, scroll: { f1: 'x' } }));
  assert.deepEqual(readPanelState(s), { collapsed: false, drafts: {}, scroll: {}, seen: {} }, 'wrong types are dropped');
  assert.doesNotThrow(() => writePanelState(blocked, back));
  assert.deepEqual(readPanelState(blocked), { collapsed: false, drafts: {}, scroll: {}, seen: {} });
  assert.equal(panelShown(s), true, 'shown unless turned off');
  s.setItem(PANEL_SHOW_KEY, '0');
  assert.equal(panelShown(s), false);
  assert.equal(panelShown(blocked), true);
});

test('a tab change never touches the panel’s state: it is mounted once, outside the tabs, and only re-checks its terminal', async () => {
  const host = read('src/client/tabs/host.ts');
  assert.match(host, /export function onProjectTab\(fn: \(id: string\) => void\)/);
  assert.match(host, /shownTab = id;\n      for \(const fn of tabListeners\) fn\(id\);/);
  const index = read('src/client/ui/lead-panel/index.ts');
  assert.match(index, /onProjectTab\(\(\) => panel\.attach\(\)\);/);
  assert.match(index, /document\.body\.append\(aside, rail, fab, backdrop\);/, 'outside every tab’s view');
  const lite = read('src/client/lite.ts');
  assert.equal((lite.match(/leadPanel\(/g) ?? []).length, 1, 'lite.ts mounts it once');
  assert.doesNotMatch(lite.slice(lite.indexOf('function showTab('), lite.indexOf('function renderKanban(')), /\bpm\./, 'and showTab has no line for it');
  // The hook itself: every listener hears each tab shown, and a late one the tab showing now.
  const { installFakeDom } = await import('./support/fakedom.js');
  installFakeDom();
  const { projectTabs, onProjectTab, currentProjectTab } = await import('../src/client/tabs/host.js');
  const seen: string[] = [];
  const before = document.createElement('div');
  document.body.append(before);
  const tabs = projectTabs(before, null, () => {});
  onProjectTab((id) => seen.push(id));
  tabs.show('command');
  tabs.show('board');
  tabs.show('testing');
  assert.deepEqual(seen, ['command', 'board', 'testing']);
  const late: string[] = [];
  onProjectTab((id) => late.push(id));
  assert.deepEqual([late, currentProjectTab()], [['testing'], 'testing']);
});

const look = (o: Partial<TermLook> = {}): TermLook => ({ open: true, phone: false, view: 'terminal', expanded: false, pageHidden: false, live: true, fallback: false, ...o });

test('the terminal is attached only while it is on screen: the Terminal view of an open panel, or the overlay', () => {
  assert.equal(terminalWanted(look()), true);
  assert.equal(terminalWanted(look({ open: false })), false, 'collapsed: let go');
  assert.equal(terminalWanted(look({ view: 'chat' })), false, 'on the Chat view: let go');
  assert.equal(terminalWanted(look({ pageHidden: true })), false, 'the browser tab hidden: let go');
  assert.equal(terminalWanted(look({ live: false })), false, 'asleep or no desk: nothing to attach');
  assert.equal(terminalWanted(look({ open: false, expanded: true })), true, 'the expanded overlay shows it');
  assert.equal(terminalWanted(look({ expanded: true, pageHidden: true })), false);
  assert.equal(terminalWanted(look({ phone: true })), false, 'a phone’s sheet is chat only');
  assert.equal(terminalWanted(look({ phone: true, expanded: true })), true, 'Open terminal, full screen');
  assert.equal(terminalWanted(look({ view: 'chat', fallback: true })), true, 'the chat showing the terminal’s text needs it');
  assert.equal(terminalWanted(look({ view: 'chat', fallback: true, open: false })), false);
  // The panel asks it on every change that could matter, and attaches or detaches to match (term.show(null) detaches).
  const panel = read('src/client/ui/lead-panel/panel.ts');
  assert.match(panel, /const id = want \? \(this\.view\.workerId \?\? null\) : null;\n    this\.term\.show\(id\);/);
  const index = read('src/client/ui/lead-panel/index.ts');
  assert.match(index, /function setCollapsed[\s\S]*?apply\(\);/);
  assert.match(index, /function apply\(\) \{[\s\S]*?panel\.draw\(\);/);
  assert.match(index, /document\.addEventListener\('visibilitychange', \(\) => panel\.attach\(\)\);/);
  // And the terminal's detach is the existing one: worker.detach unless the full window has it open.
  assert.match(read('src/client/ui/pm/term.ts'), /if \(id && openTerminalFor\(\) !== id\) this\.net\.send\(\{ t: 'worker\.detach', workerId: id \}\);/);
});

test('sending while the lead is mid-turn: Send now types it in, After their turn (and Enter) uses the office’s existing hold', () => {
  assert.deepEqual(sendPlan(false, 'enter'), { via: 'prompt' });
  assert.deepEqual(sendPlan(false, 'after'), { via: 'prompt' }, 'not mid-turn: there is no turn to wait for');
  assert.deepEqual(sendPlan(true, 'now'), { via: 'prompt' });
  assert.deepEqual(sendPlan(true, 'after'), { via: 'tell', when: 'after' });
  assert.deepEqual(sendPlan(true, 'enter'), { via: 'tell', when: 'after' });
  const panel = read('src/client/ui/lead-panel/panel.ts');
  // "tell … after" is the team action the console always used for "after their turn"; a prompt is worker.prompt.
  assert.match(panel, /if \(plan\.via === 'tell'\) \{\n      const r = await this\.run\('tell', \{ prompt: text, when: 'after' \}\);/);
  assert.match(panel, /this\.deps\.net\.send\(\{ t: 'worker\.prompt', workerId: this\.view\.workerId, prompt: text \}\);/);
  // The quick questions and the standup go through the "OK to interrupt?" check.
  assert.match(panel, /const choices = await checkStandup\(r\);/);
  assert.match(panel, /const choices = await checkTeamAsk\(r, q\.label, m\?\.name \?\? 'the lead'\);/);
  const composer = read('src/client/ui/lead-panel/composer.ts');
  assert.match(composer, /'Send now'/);
  assert.match(composer, /'After their turn \(Enter\)'/);
  assert.match(composer, /this\.history\.back\(\)/);
});

const msgs = (...kinds: ('agent' | 'user' | 'tool')[]): ConvoMsg[] => kinds.map((k, i) => (k === 'tool' ? { id: `m${i}`, kind: 'tool', tool: 'Bash', summary: 'Ran', status: 'ok' } : { id: `m${i}`, kind: k, text: 'x' }) as ConvoMsg);

test('unread: the lead’s messages since the one you last saw', () => {
  const m = msgs('user', 'agent', 'tool', 'agent', 'user', 'agent');
  assert.equal(lastAgentId(m), 'm5');
  assert.equal(unreadSince(m, undefined), 0, 'never looked: the conversation so far counts as read');
  assert.equal(unreadSince(m, 'm1'), 2);
  assert.equal(unreadSince(m, 'm5'), 0);
  assert.equal(unreadSince(m, 'gone'), 3, 'what you saw scrolled out of what the page keeps: every agent message there');
});
