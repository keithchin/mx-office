// The Portal layout of the 1D view (ui/portal/layout.ts and its parts): the left navigation's groups,
// selection, open groups, folded rail and flyouts (ui/portal/nav-logic.ts), deep links still picking the
// right item, the badges, the Overview's cards (ui/portal/overview-logic.ts), the search's groups and
// ranking (ui/portal/search-logic.ts), and all of it drawn only in a Portal theme, the other themes
// keeping the tab row. Also the Workers → Agents wording, Go to Office in place of the view dropdown and
// the docs' brand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  groupBadge,
  groupOf,
  groupOpen,
  NAV_BOTTOM,
  NAV_GROUPS,
  navItem,
  pageTitle,
  parseNavState,
  readBadge,
  revealGroup,
  serializeNavState,
  showsFlyout,
  toggleGroup,
  visibleItems,
} from '../src/client/ui/portal/nav-logic.js';
import { alertKey, budgetText, detailRows, faceDot, teamFaces, technicalContact } from '../src/client/ui/portal/overview-logic.js';
import { KIND_ORDER, searchGroups } from '../src/client/ui/portal/search-logic.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

/** The 1D view's tabs: its tab row's buttons, and the test lab (no button, the ☰ opens it). */
function liteTabs(): string[] {
  const ids = [...read('src/client/lite.html').matchAll(/id="tab-([a-z]+)"/g)].map((m) => m[1]);
  return [...ids, 'tests'];
}

test('every tab of the 1D view is one item of the navigation, in one group or under the rule, with the same id', () => {
  const items = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_BOTTOM].filter((i) => i.kind === 'tab').map((i) => i.id);
  assert.deepEqual([...items].sort(), [...liteTabs()].sort());
  assert.equal(new Set(items).size, items.length, 'no tab twice');
  // The groups as the portal's app pane has them.
  assert.deepEqual(NAV_GROUPS.map((g) => g.label), ['General', 'Project Management', 'App Insights', 'Repository', 'Deployment', 'Monitoring']);
  assert.deepEqual(NAV_GROUPS[0].items.map((i) => i.label), ['Overview', 'Team', 'Team boards', 'Documents']);
  assert.deepEqual(NAV_GROUPS[1].items.map((i) => i.id), ['board', 'approvals', 'standup']);
  assert.deepEqual(NAV_BOTTOM.map((i) => i.label), ['Settings', 'View App', 'Edit in Studio Pro']);
  assert.equal(groupOf('model')?.id, 'repo');
  assert.equal(groupOf('settings'), undefined);
  assert.equal(pageTitle('command'), 'Overview');
  assert.equal(pageTitle('workers'), 'Agents');
  assert.equal(pageTitle('nonsense'), 'Overview');
  assert.equal(navItem('studio')?.kind, 'action');
  for (const i of [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_BOTTOM]) assert.ok(i.hint.length > 10, `${i.id} has a line for the header`);
});

test('Tests is only for admins', () => {
  const monitor = NAV_GROUPS.find((g) => g.id === 'monitor')!;
  assert.deepEqual(visibleItems(monitor, false).map((i) => i.id), ['workers']);
  assert.deepEqual(visibleItems(monitor, true).map((i) => i.id), ['workers', 'tests']);
});

test('the open groups and the rail are remembered safely, and the page’s group opens by itself', () => {
  assert.deepEqual(parseNavState(null), { open: {}, rail: false });
  assert.deepEqual(parseNavState('not json'), { open: {}, rail: false });
  assert.deepEqual(parseNavState('{"open":{"pm":true,"bogus":true,"repo":"yes"},"rail":1}'), { open: { pm: true }, rail: false });
  const s = parseNavState(serializeNavState({ open: { insights: true, general: false }, rail: true }));
  assert.deepEqual(s, { open: { insights: true, general: false }, rail: true });
  const none = parseNavState(null);
  // Never touched: only the group of the page showing is open.
  assert.equal(groupOpen(none, 'general', 'command'), true);
  assert.equal(groupOpen(none, 'pm', 'command'), false);
  assert.equal(groupOpen(none, 'repo', 'model'), true);
  // By hand, both ways.
  const closed = toggleGroup(none, 'general', 'command');
  assert.equal(groupOpen(closed, 'general', 'command'), false);
  const opened = toggleGroup(closed, 'pm', 'command');
  assert.equal(groupOpen(opened, 'pm', 'command'), true);
  // Going to a page (a ?tab= link, say) in a group closed by hand opens it, so the picked item shows.
  assert.equal(groupOpen(revealGroup(closed, 'org'), 'general', 'org'), true);
  assert.equal(revealGroup(none, 'board'), none, 'nothing to change, the same state back');
  assert.equal(revealGroup(closed, 'settings'), closed, 'Settings is in no group');
});

test('a flyout shows on the rail always, on the open pane only for a closed group', () => {
  assert.equal(showsFlyout(true, true), true);
  assert.equal(showsFlyout(true, false), true);
  assert.equal(showsFlyout(false, false), true);
  assert.equal(showsFlyout(false, true), false);
});

test('the items mirror the tabs’ badges, and a closed group adds them up', () => {
  assert.deepEqual(readBadge('3', false, false), { text: '3', kind: 'count' });
  assert.deepEqual(readBadge(' ', true, false), { text: '', kind: 'dot' });
  assert.deepEqual(readBadge('!', false, true), { text: '!', kind: 'bang' });
  assert.equal(readBadge('', false, false), null);
  assert.equal(readBadge('0', false, false), null);
  assert.deepEqual(groupBadge([{ text: '8', kind: 'count' }, null, { text: '6', kind: 'count' }]), { text: '14', kind: 'count' });
  assert.deepEqual(groupBadge([{ text: '9+', kind: 'count' }, { text: '2', kind: 'count' }]), { text: '11+', kind: 'count' });
  assert.deepEqual(groupBadge([{ text: '', kind: 'dot' }, { text: '2', kind: 'count' }]), { text: '2', kind: 'count' });
  assert.deepEqual(groupBadge([{ text: '', kind: 'dot' }]), { text: '', kind: 'dot' });
  assert.deepEqual(groupBadge([{ text: '3', kind: 'count' }, { text: '!', kind: 'bang' }]), { text: '!', kind: 'bang' });
  assert.equal(groupBadge([null, null]), null);
  // The navigation reads them from the tab row's own .ro-tab-n (ui/badge.ts), watched, never polled.
  const nav = read('src/client/ui/portal/nav.ts');
  assert.match(nav, /getElementById\(`tab-\$\{id\}`\)\?\.querySelector<HTMLElement>\('\.ro-tab-n'\)/);
  assert.match(nav, /new MutationObserver/);
  assert.doesNotMatch(nav, /setInterval/);
});

test('deep links: showTab tells the navigation, ?tab= ids are unchanged and ?tab=agents means the Agents page', () => {
  const lite = read('src/client/lite.ts');
  assert.match(lite, /function showTab\(t: Tab\) \{[\s\S]*?portal\?\.selected\(t\);\n\}/);
  assert.match(lite, /t === 'agents' \? 'workers'/);
  assert.match(lite, /setAddress\(\{ tab: t,/);
  assert.match(lite, /portalLayout\(\{\n  show: showTab,/);
});

test('the Overview’s Team card puts who needs someone first, then who’s working, and counts the rest', () => {
  const w = (id: string, status: string, kind = 'agent') => ({ id, name: id.toUpperCase(), color: '#123456', status, kind });
  const t = teamFaces([w('a', 'idle'), w('b', 'working'), w('c', 'needs_input'), w('s', 'working', 'shell'), w('d', 'done'), w('e', 'working')], 3);
  assert.deepEqual(t.faces.map((f) => f.id), ['c', 'b', 'e']);
  assert.deepEqual(t.faces.map((f) => f.dot), ['needs', 'working', 'working']);
  assert.equal(t.more, 2);
  assert.equal(t.total, 5, 'shells are not agents');
  assert.match(t.faces[0].title, /C: needs you/);
  assert.equal(faceDot('starting'), 'working');
  assert.equal(teamFaces([]).total, 0);
});

test('the Technical contact is the Project Coordinator, or the Solo Lead', () => {
  const m = (role: string, name: string) => ({ role, name, title: role });
  assert.equal(technicalContact([m('lead-developer', 'Linus'), m('pm', 'Ada')])?.name, 'Ada');
  assert.equal(technicalContact([m('solo-lead', 'Sol')])?.name, 'Sol');
  assert.equal(technicalContact([m('lead-tester', 'Tess')]), undefined);
  assert.equal(technicalContact(undefined), undefined);
});

test('the Details card lists what the office knows, in the portal’s order, and leaves out what it doesn’t', () => {
  const rows = detailRows({
    repo: 'acme/travel',
    branch: 'main',
    mendix: '11.6.4',
    toolkit: { sha: 'abcdef1234567', date: '2026-10-01', state: 'pinned' },
    lastCommit: { sha: '0123456789', branch: 'delivery' },
    budget: { spent: 1608, total: 2000, text: budgetText(1608, 2000) },
    live: { status: 'running', url: 'http://office:5001/' },
  });
  assert.deepEqual(rows.map((r) => r.label), ['Repository', 'Branch', 'Mendix version', 'Toolkit', 'Last commit', 'Budget', 'Live app']);
  assert.equal(rows[0].href, 'https://github.com/acme/travel');
  assert.equal(rows[3].value, 'Pinned at abcdef1 · 2026-10-01');
  assert.equal(rows[4].value, '0123456 on delivery');
  assert.equal(rows[5].value, '$1,608 of $2,000 spent (80 %)');
  assert.deepEqual([rows[6].value, rows[6].href], ['office:5001', 'http://office:5001/']);
  const few = detailRows({ dir: 'C:\\work\\app', live: { status: 'stopped' } });
  assert.deepEqual(few.map((r) => [r.label, r.value, r.tab]), [['Folder', 'C:\\work\\app', undefined], ['Live app', 'stopped', 'live']]);
  assert.equal(budgetText(42.4), '$42 spent');
  assert.equal(alertKey('f', ' 3  incidents\n1 escalation '), 'f|3 incidents 1 escalation');
});

const it = (kind: (typeof KIND_ORDER)[number], label: string, also?: string) => ({ kind, label, also, go() {} });

test('the search groups its results by kind, the group with the best match first, a few of each', () => {
  const items = [
    it('project', 'Travel Approval'),
    it('tab', 'Board', 'The pipeline'),
    it('tab', 'Budget'),
    it('agent', 'Ada'),
    it('agent', 'Bea'),
    it('issue', '#204 Wire up the order import job', '204'),
    it('issue', '#209 Harden the session security role', '209'),
    it('pr', '#526 Test the shipment page', '526 feature/shipment'),
    it('page', 'Settings'),
    it('doc', 'Budgets and spend', 'Daily cap · Forecast'),
  ];
  const g = searchGroups(items, 'b');
  // The issue only has a b inside a word ('job'): a lower match, its group last.
  assert.deepEqual(g.map((x) => x.kind), ['tab', 'agent', 'doc', 'issue']);
  assert.deepEqual(g[0].items.map((i) => i.label), ['Board', 'Budget']);
  // A number finds its issue; words inside find it too, a lower match than a name that starts with it.
  assert.deepEqual(searchGroups(items, '209').map((x) => x.items.map((i) => i.label)), [['#209 Harden the session security role']]);
  const s = searchGroups(items, 'se');
  assert.deepEqual(s.map((x) => x.kind), ['page', 'issue']);
  // What else an item answers to: a branch, a docs page's headings.
  assert.deepEqual(searchGroups(items, 'forecast').map((x) => x.kind), ['doc']);
  assert.deepEqual(searchGroups(items, 'shipment').map((x) => x.kind), ['pr']);
  // Nothing typed: this project's pages and the projects only.
  assert.deepEqual(searchGroups(items, '').map((x) => x.kind), ['project', 'tab']);
  // At most a few of each.
  assert.equal(searchGroups(Array.from({ length: 12 }, (_, i) => it('agent', `Agent ${i}`)), 'agent', 5)[0].items.length, 5);
});

test('the docs come once, on the search’s first focus, and nothing polls', () => {
  const search = read('src/client/ui/portal/search.ts');
  assert.match(search, /addEventListener\('focus', \(\) => \{\n\s+\/\/[^\n]*\n\s+loadDocs\(/);
  const docs = read('src/client/ui/portal/docs-index.ts');
  assert.match(docs, /if \(pages \|\| asked\) return;/);
  for (const f of ['search.ts', 'docs-index.ts', 'layout.ts', 'overview.ts', 'pagehead.ts']) assert.doesNotMatch(read(`src/client/ui/portal/${f}`), /setInterval/, f);
  // The search's groups walk with the arrows over the headings (only options carry data-i).
  assert.match(search, /'li\.pt-result-group', \{ role: 'presentation'/);
});

test('it is all Portal-only: the other themes keep the tab row, the bottom bar and the floor picker in the bar', () => {
  assert.match(read('src/client/ui/portal/nav.ts'), /'nav\.pt-nav\.pt-only'/);
  assert.match(read('src/client/ui/portal/nav.ts'), /'div\.pt-flyout\.pt-only/);
  assert.match(read('src/client/ui/portal/pagehead.ts'), /'header\.pt-head\.pt-only'/);
  assert.match(read('src/client/ui/portal/overview.ts'), /'aside\.pt-ov-side\.pt-only'/);
  assert.match(read('src/client/ui/portal/overview.ts'), /icon\('info', 'pt-ny-ico pt-only'\)/, 'the alert icon added to the Needs-you row is Portal-only too');
  assert.match(read('src/client/ui/portal/layout.ts'), /'span\.pt-section\.pt-only\.pt-page-name'/);
  // What's moved is moved back the moment another theme is picked.
  const slot = read('src/client/ui/portal/slot.ts');
  assert.match(slot, /onThemeChange\(apply\)/);
  assert.match(slot, /home\.after\(el\)/);
  // The tab row and the bottom bar are only hidden under a Portal theme.
  assert.match(read('src/client/ui/portal/layout.css'), /html\[data-theme\^='portal'\] body\.lite\.pt-has-nav :is\(\.lite-tabs, \.lite-nav\) \{ display: none; \}/);
  // Every rule in the new sheets is under a Portal selector.
  for (const f of ['nav.css', 'pagehead.css', 'overview.css', 'layout.css']) {
    const plain = read(`src/client/ui/portal/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const m of plain.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = m[1].trim();
      if (!sel) continue;
      for (const one of sel.split(/,(?![^(]*\))/)) assert.match(one.trim(), /^html\[data-theme(\^='portal'|='portal-(light|dark)')\]/, `${f}: ${one.trim()}`);
    }
  }
  // The tabs and the bottom bar's buttons are still in the page for every theme.
  const html = read('src/client/lite.html');
  for (const id of ['tab-command', 'tab-workers', 'btn-issues', 'btn-pulls', 'btn-queue', 'btn-new', 'floor']) assert.ok(html.includes(`id="${id}"`), id);
});

test('Agents, not Workers, where a person reads it; the ids stay', () => {
  const html = read('src/client/lite.html');
  assert.match(html, /id="tab-workers"[^>]*>🤖 Agents</);
  assert.match(html, /<h2 class="lite-h">Agents /);
  assert.match(read('src/shared/settings-sections.ts'), /\{ id: 'workers', icon: '🤖', label: 'Agents'/);
  assert.match(read('src/shared/audit.ts'), /workers: \{ label: 'Agents'/);
});

test('Go to Office in place of the view dropdown on the flat views', () => {
  const lite = read('src/client/lite.ts');
  const pixel = read('src/client/pixel.ts');
  assert.doesNotMatch(lite, /viewPicker/);
  assert.doesNotMatch(pixel, /viewPicker/);
  assert.match(lite, /replaceWith\(viewButton\('1d'\)\)/);
  assert.match(pixel, /replaceWith\(viewButton\('2d'\)\)/);
  const vp = read('src/client/ui/viewpick.ts');
  assert.match(vp, /to === '2d' \? 'Go to Office' : 'Go to Board'/);
});

test('the docs are MxOffice Docs', () => {
  const html = read('src/client/docs.html');
  assert.match(html, /<span class="dx-brand-name">MxOffice <b>Docs<\/b><\/span>/);
  assert.match(html, /aria-label="MxOffice docs: home"/);
  assert.doesNotMatch(html, /App Factory/);
});

/** A 6-digit colour's relative luminance (WCAG). */
function lum(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `a 6-digit hex colour, not ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('the floor’s line and the progress bar are one mid dark grey band under the header, readable at 4.5:1', () => {
  const css = read('src/client/ui/portal/pagehead.css');
  const body = (sel: string) => {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i >= 0, `no ${sel} rule`);
    return css.slice(i, css.indexOf('}', i));
  };
  const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const light = vars(body("html[data-theme^='portal'] body.lite .pt-band"));
  const dark = { ...light, ...vars(body("html[data-theme='portal-dark'] body.lite .pt-band")) };
  assert.equal(light['pt-band-top'], '#3a4150');
  assert.equal(light['pt-band-bottom'], '#2f3542');
  for (const [name, v] of [['Portal (Light)', light], ['Portal (Dark)', dark]] as const)
    for (const fg of ['ink', 'ink-2', 'muted', 'link', 'good-ink', 'warn-ink', 'bad-ink'])
      for (const bg of ['pt-band-top', 'pt-band-bottom']) assert.ok(ratio(v[fg], v[bg]) >= 4.5, `${name}: --${fg} ${v[fg]} on --${bg} ${v[bg]} is ${ratio(v[fg], v[bg]).toFixed(2)}:1`);
  // A shade from top to bottom and a shadow under it.
  assert.match(body("html[data-theme^='portal'] body.lite .pt-band"), /linear-gradient\(180deg, var\(--pt-band-top\) 0%, var\(--pt-band-bottom\) 100%\)/);
  assert.match(body("html[data-theme^='portal'] body.lite .pt-band"), /box-shadow: 0 2px 6px/);
  // The page's own floor line and progress bar go into it, in Portal only.
  const head = read('src/client/ui/portal/pagehead.ts');
  assert.match(head, /portalSlot\(document\.querySelector\('\.bud-meta-row'\) \?\? document\.getElementById\('floor-meta'\), band\);/);
  assert.match(head, /portalSlot\(document\.getElementById\('progress-bar'\), band\);/);
  assert.match(head, /h\('div\.pt-band\.pt-only'\)/);
});

test('Call an audit and The Firm → are on the Audit log page, not the Overview’s header', () => {
  const css = read('src/client/ui/portal/pagehead.css');
  assert.match(css, /\.pt-head:not\(\[data-page='audit'\]\) #firm-banner \{ display: none; \}/);
  assert.doesNotMatch(css, /\.firm-strip-link \{ display: none; \}/, 'The Firm → shows beside Call an audit');
  assert.match(css, /\.pt-head:not\(\.pt-head-ov\) \.pt-head-pin \{ display: none; \}/);
});

test('entering a project opens its Command Center; a link that names a tab opens it, a reload keeps this browser tab’s', async () => {
  const { startTab, floorSwitched, TAB_SESSION_KEY } = await import('../src/client/shared/start-tab.js');
  assert.equal(startTab(undefined, false, 'board', 'command'), 'command', 'from Home, the switcher, the launcher, Go to Board, /lite fresh');
  assert.equal(startTab('model', false, 'board', 'command'), 'model', 'a ?tab= link');
  assert.equal(startTab('model', true, 'board', 'command'), 'model', 'the link wins on a reload too');
  assert.equal(startTab(undefined, true, 'board', 'command'), 'board', 'a reload keeps the tab');
  assert.equal(startTab(undefined, true, undefined, 'command'), 'command');
  assert.equal(floorSwitched(null, 'a'), false, 'the page arriving on its first project');
  assert.equal(floorSwitched('a', 'a'), false);
  assert.equal(floorSwitched('a', 'b'), true);
  assert.match(TAB_SESSION_KEY, /session/);
  const lite = read('src/client/lite.ts');
  assert.match(lite, /let tab: Tab = startTab\(asTab\(askedTab\), isReload\(\), asTab\(sessionTab\(\)\), 'command'\);/);
  assert.match(lite, /if \(floorSwitched\(floorWas, store\.floor\) && tab !== 'command'\) showTab\('command'\);/);
  assert.doesNotMatch(lite, /localStorage\.(get|set)Item\(TAB_KEY/, 'no "last tab ever" any more');
  assert.match(read('src/client/shared/start-tab.ts'), /sessionStorage\.setItem\(TAB_SESSION_KEY, t\)/);
});

test('the Details card’s last commit says when and what, from the Git tab’s graph, asked now and then, never on a timer', async () => {
  const { clipSubject, commitWhen, detailRows: rows } = await import('../src/client/ui/portal/overview-logic.js');
  const r = rows({ lastCommit: { sha: 'abcdef1234', branch: 'main', when: commitWhen('2026-10-09T14:05:00', 'en-US'), subject: 'Fix the order form\n\nLonger body' } });
  assert.equal(r[0].value, 'abcdef1 on main');
  assert.match(r[0].sub ?? '', /^Oct 9, 2026, 14:05 · Fix the order form$/);
  assert.equal(rows({ lastCommit: { sha: 'abcdef1234' } })[0].sub, undefined);
  assert.equal(commitWhen('not a date'), '');
  assert.equal(clipSubject('x'.repeat(80)).length, 72);
  const ov = read('src/client/ui/portal/overview.ts');
  assert.match(ov, /fetch\(`\/api\/git\?floor=\$\{encodeURIComponent\(floor\)\}`/);
  assert.match(ov, /COMMIT_EVERY_MS = 120_000/);
  assert.doesNotMatch(ov, /setInterval|setTimeout/);
});

test('in Portal the pages don’t repeat the header’s title in a heading of their own', () => {
  const css = read('src/client/ui/portal/layout.css');
  for (const sel of ['#settings-view .fs-title', '#budget-view .bud > h2.lite-h', '#audit-view .au-head > h2.lite-h', '#tests-view .tl-page > h2.lite-h']) assert.ok(css.includes(sel), sel);
  assert.match(css, /#workers-view > \.lite-h \{ margin: 0; font-size: 0; \}/);
  assert.match(css, /#waiting-now:not\(:empty\) \{ display: block;/, 'the waiting count stays');
});

test('a window’s ✕ is one × in Portal: the line icon alone, its text sized away like Clean does', () => {
  // Every window's ✕ is a .btn.close (ui/dom.ts); Clean marks it data-ao-icon="close" and draws the icon. Portal's
  // 14px buttons once outranked Clean's font-size: 0 and brought the ✕ back beside it.
  assert.match(read('src/client/ui/dom.ts'), /h\('button\.btn\.close', \{ type: 'button', 'aria-label': 'Close'/);
  const parts = read('src/client/styles/theme-portal-parts.css');
  assert.match(parts, /html\[data-theme\^='portal'\] body\.lite\.lite :is\(\.btn\.btn, \.close\.close\)\[data-ao-icon\]:not\(\[data-ao-icon='none'\]\) \{ font-size: 0; \}/);
  assert.match(read('src/client/styles/theme-clean.css'), /\[data-ao-icon\]:not\(\[data-ao-icon='none'\]\) \{ font-size: 0; \}/);
});

test('the New task window and the rest say agent, not worker, where a person reads it', () => {
  const ask = read('src/client/ui/ask.ts');
  assert.match(ask, /'What should the agent do\?'/);
  assert.match(ask, /`✨ New agent · \$\{opts\.newDesk\}`/);
  assert.doesNotMatch(ask, /'What should the worker do\?'|New worker ·/);
  assert.match(read('src/client/ui/palette.ts'), /Find an agent, issue, PR/);
  assert.match(read('src/client/ui/menuitems.ts'), /label: 'Next agent that needs you'/);
  // Ids, message types and data keys keep the old name.
  assert.match(read('src/client/lite.html'), /id="tab-workers"/);
  assert.match(read('src/client/ui/ranking/view.ts'), /r\.roleLabel !== 'Worker'/);
});
