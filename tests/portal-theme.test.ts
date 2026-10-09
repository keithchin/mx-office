// The Portal themes (ui/colortheme.ts, styles/theme-portal*.css, ui/portal/, home/portal*.ts): the
// default for a browser that never picked a theme, their place and names in the 🎨 list, every page's
// early script and loading screen knowing them, their text readable on their surfaces, the top bar's
// pieces shown only in Portal, its search, and the Projects page's filter, sort and pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLOR_THEMES, DARK_TWIN, isDarkTheme, isTheme, THEME_LABEL } from '../src/client/ui/colortheme.js';
import { MAX_RESULTS, searchItems, tabLabel } from '../src/client/ui/portal/search-logic.js';
import { initials } from '../src/client/ui/portal/topbar.js';
import { activityScore, statusOf, tileLetters, visibleProjects, type ProjectFloor } from '../src/client/home/portal-logic.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('Portal (Light) and Portal (Dark) come first in the 🎨 list, then Clean, Fun, Fun (Dark) and Terminal', () => {
  assert.deepEqual([...COLOR_THEMES], ['portal-light', 'portal-dark', 'clean-light', 'clean-dark', 'default', 'dark', 'terminal']);
  assert.equal(THEME_LABEL['portal-light'], 'Portal (Light)');
  assert.equal(THEME_LABEL['portal-dark'], 'Portal (Dark)');
  assert.ok(isTheme('portal-light') && isTheme('portal-dark'));
  assert.ok(!isTheme('portal'));
});

test('the dark-mode switch flips each theme to its twin, and knows which are dark', () => {
  for (const t of COLOR_THEMES) assert.equal(DARK_TWIN[DARK_TWIN[t]], t, t);
  assert.equal(DARK_TWIN['portal-light'], 'portal-dark');
  assert.equal(DARK_TWIN.default, 'dark');
  assert.ok(isDarkTheme('portal-dark') && isDarkTheme('clean-dark') && isDarkTheme('dark') && isDarkTheme('terminal'));
  assert.ok(!isDarkTheme('portal-light') && !isDarkTheme('clean-light') && !isDarkTheme('default'));
});

test('a browser that never picked a theme gets Portal (Light), or Portal (Dark) when the system is dark, on all six pages', () => {
  for (const f of ['docs', 'firm', 'home', 'lite', 'm', 'pixel']) {
    const html = read(`src/client/${f}.html`);
    const script = html.match(/<script>try\{var t=localStorage\.getItem\("agent-office\.color-theme"\);(.*?)<\/script>/)?.[1];
    assert.ok(script, `${f} has its early theme script`);
    for (const t of COLOR_THEMES) assert.ok(script.includes(`"${t}"`), `${f} lets ${t} through`);
    assert.match(script, /\?"portal-dark":"portal-light"/, `${f} defaults to Portal`);
  }
  const ct = read('src/client/ui/colortheme.ts');
  assert.match(ct, /matches \? 'portal-dark' : 'portal-light'/);
  assert.match(ct, /return isTheme\(t\) \? t : 'portal-light'/);
});

test('the loading screen has Portal colours on the four pages that have it', () => {
  for (const f of ['home', 'lite', 'm', 'pixel']) {
    const html = read(`src/client/${f}.html`);
    for (const t of ['portal-light', 'portal-dark']) assert.ok(html.includes(`html[data-theme=${t}] #ao-boot{`), `${f}: ${t}`);
  }
});

/** The custom properties of the first block whose selector starts with `sel`. */
function tokens(css: string, sel: string): Record<string, string> {
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `no ${sel} block`);
  const body = css.slice(css.indexOf('{', at), css.indexOf('\n}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `a 6-digit hex colour, not ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('every Portal text colour reads at 4.5:1 or more on the surfaces it sits on, light and dark, the bar too', () => {
  const css = read('src/client/styles/theme-portal.css');
  const shared = tokens(css, "html[data-theme^='portal'] {");
  for (const t of ['portal-light', 'portal-dark']) {
    const v = { ...shared, ...tokens(css, `html[data-theme='${t}'],`) };
    for (const fg of ['ink', 'ink-2', 'muted', 'link', 'good-ink', 'bad-ink', 'warn-ink'])
      for (const bg of ['paper', 'card']) assert.ok(contrast(v[fg], v[bg]) >= 4.5, `${t}: --${fg} ${v[fg]} on --${bg} ${v[bg]} is ${contrast(v[fg], v[bg]).toFixed(2)}:1`);
    assert.ok(contrast(v['accent-ink'], v.accent) >= 4.5, `${t}: a primary button's words`);
    assert.ok(contrast(v.ink, v.sunken) >= 4.5, `${t}: a table head`);
    assert.ok(contrast(v['pt-bar-ink'], v['pt-bar']) >= 4.5, `${t}: the bar`);
    assert.ok(contrast(v['pt-bar-field-ink'], v['pt-bar-field']) >= 4.5, `${t}: the search's placeholder`);
  }
});

test('Portal is of the Clean family: Clean’s shapes and emoji blanking apply to it, its own sheets only to it', () => {
  const clean = read('src/client/styles/theme-clean.css') + read('src/client/styles/theme-clean-parts.css');
  assert.doesNotMatch(clean, /html\[data-theme\^='clean'\]/, 'no Clean rule left out of the family selector');
  assert.match(clean, /html:is\(\[data-theme\^='clean'\], \[data-theme\^='portal'\]\) \.ao-emo:not\(\[data-ao-icon\]\) \{ display: none; \}/);
  assert.match(read('src/client/ui/clean/index.ts'), /theme\.startsWith\('clean'\) \|\| theme\.startsWith\('portal'\)/);
  // Every rule in the Portal sheets is under a Portal selector (or a part's own class only Portal draws).
  for (const f of ['src/client/styles/theme-portal-parts.css', 'src/client/ui/portal/topbar.css']) {
    const plain = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const m of plain.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = m[1].trim();
      if (!sel) continue;
      assert.match(sel, /^html(\[data-theme\^='portal'\]|\[data-theme='portal-(light|dark)'\]|:not\(\[data-theme\^='portal'\]\))/, `${f}: ${sel}`);
    }
  }
});

test('the top bar’s pieces are shown only in Portal, and the bar keeps what it had', () => {
  const css = read('src/client/ui/portal/topbar.css');
  assert.match(css, /html:not\(\[data-theme\^='portal'\]\) \.pt-only \{ display: none !important; \}/);
  const bar = read('src/client/ui/portal/topbar.ts');
  for (const cls of ['pt-launch', 'pt-brand', 'pt-sep', 'pt-section', 'pt-icons', 'pt-help', 'pt-dark']) assert.match(bar, new RegExp(`${cls}[^']*\\.pt-only|${cls}\\.pt-only`), `${cls} is Portal-only`);
  assert.match(read('src/client/ui/portal/search.ts'), /'div\.pt-search-wrap\.pt-only'/);
  // Every flat page with a .lite-bar adds it.
  for (const f of ['lite.ts', 'home.ts', 'pixel.ts', 'firm.ts']) assert.match(read(`src/client/${f}`), /portalBar\(/, f);
  // Nothing taken away: the 🏠, the floor picker, the 🎨 and the ☰ are all still in the pages.
  for (const id of ['to-home', 'theme', 'menu']) assert.ok(read('src/client/lite.html').includes(`id="${id}"`), id);
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('ada'), 'A');
  assert.equal(initials('  '), '?');
  assert.equal(initials('Émile van Dyke'), 'ÉD');
});

const item = (kind: 'project' | 'tab' | 'page', label: string, also?: string) => ({ kind, label, also, go() {} });

test('the search ranks a name that starts with the words first, then a word that does, then anywhere', () => {
  const items = [item('page', 'Settings'), item('tab', 'Team boards'), item('project', 'Travel Approval', 'acme/travel'), item('project', 'Big Spike', 'acme/spike'), item('tab', 'Budget'), item('project', 'Shopfloor Ops Manager')];
  assert.deepEqual(searchItems(items, 't').map((i) => i.label), ['Travel Approval', 'Team boards', 'Budget', 'Settings']);
  assert.deepEqual(searchItems(items, 'tr').map((i) => i.label), ['Travel Approval']);
  assert.deepEqual(searchItems(items, 'ops').map((i) => i.label), ['Shopfloor Ops Manager']);
  assert.deepEqual(searchItems(items, 'acme').map((i) => i.label), ['Travel Approval', 'Big Spike']);
  assert.deepEqual(searchItems(items, 'b').map((i) => i.label), ['Big Spike', 'Budget', 'Team boards']);
  assert.deepEqual(searchItems(items, 'zzz'), []);
  assert.equal(searchItems(Array.from({ length: 20 }, (_, i) => item('project', `P${i}`)), '').length, MAX_RESULTS);
  assert.equal(tabLabel('🎛️ Command Center 6'), 'Command Center');
  assert.equal(tabLabel('✅ Approvals '), 'Approvals');
  assert.equal(tabLabel('🗂 Board'), 'Board');
});

const floor = (id: string, name: string, extra: Partial<ProjectFloor> = {}): ProjectFloor => ({ id, name, waiting: 0, busy: 0, addedAt: 0, ...extra });

test('the Projects page filters by name and status, sorts by pinned, recent activity or name, and turns round', () => {
  const floors = [floor('a', 'Travel Approval', { addedAt: 3 }), floor('b', 'big spike', { waiting: 2, addedAt: 1 }), floor('c', 'Claims Portal', { addedAt: 2 }), floor('d', 'Being cloned', { cloning: true })];
  const pins = new Set(['c']);
  const pausedSet = new Set(['a']);
  const facts = { paused: (id: string) => pausedSet.has(id), pinned: (id: string) => pins.has(id), activity: (id: string) => ({ a: 1, b: 5, c: 3, d: 0 })[id] ?? 0 };
  const ids = (q: Parameters<typeof visibleProjects>[1]) => visibleProjects(floors, q, facts).map((f) => f.id);
  assert.deepEqual(ids({ text: '', status: 'all', sort: 'pinned' }), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids({ text: '', status: 'all', sort: 'pinned', desc: true }), ['d', 'b', 'a', 'c']);
  assert.deepEqual(ids({ text: '', status: 'all', sort: 'name' }), ['d', 'b', 'c', 'a']);
  assert.deepEqual(ids({ text: '', status: 'all', sort: 'recent' }), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids({ text: 'PORT', status: 'all', sort: 'name' }), ['c']);
  assert.deepEqual(ids({ text: '', status: 'paused', sort: 'name' }), ['a']);
  assert.deepEqual(ids({ text: '', status: 'needs-you', sort: 'name' }), ['b']);
  assert.deepEqual(ids({ text: '', status: 'running', sort: 'name' }), ['c']);
  assert.deepEqual(ids({ text: '', status: 'adding', sort: 'name' }), ['d']);
  assert.equal(statusOf(floor('x', 'X', { waiting: 1, cloning: true }), facts), 'adding');
  assert.equal(statusOf(floor('a', 'X', { waiting: 1 }), facts), 'needs-you');
});

test('a card’s tile letters and its activity score', () => {
  assert.equal(tileLetters('Travel Approval'), 'TA');
  assert.equal(tileLetters('big-spike'), 'BS');
  assert.equal(tileLetters('mx'), 'MX');
  assert.equal(tileLetters('***'), '?');
  // A day with spend more recently beats any amount of busy on an older one.
  assert.ok(activityScore([0, 0, 5, 0], 0, 0) > activityScore([9, 0, 0, 0], 50, 50));
  assert.ok(activityScore([0, 1], 3, 0) > activityScore([0, 1], 0, 0));
  assert.equal(activityScore(undefined, 0, 0), 0);
});

test('the pins and watches are kept per viewer, in this browser, and an unwatched project doesn’t call you over', () => {
  const prefs = read('src/client/shared/project-prefs.ts');
  assert.match(prefs, /localStorage\.setItem/);
  assert.match(prefs, /try \{/);
  assert.match(read('src/client/shared/floors.ts'), /isWatched\(o\.id\)/);
  assert.match(read('src/client/shared/title.ts'), /!isWatched\(f\.id\)/);
});
