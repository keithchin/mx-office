// ⚙️ Settings in the flat views (src/client/ui/settings/page.ts, the 1D view's ⚙️ Settings tab): every
// settings link (the ☰ on the 1D, 2D and home pages, Needs you, the team phone, the phone version, Teams
// cards, the budget's insights) goes to a flat Settings address, never the 3D office; every section has a
// stable anchor and a builder, and is documented; and the 3D office's own ⚙️ window still builds its panes
// from the same section builders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SETTINGS_SECTIONS, SETTINGS_SECTION_IDS, isSettingsSection, settingsHref, settingsPath } from '../src/shared/settings-sections.js';
import { collectNeeds, type NeedsInput } from '../src/client/ui/needsyou/logic.js';
import type { RosterView } from '../src/shared/roster/types.js';
import { notesOf } from '../src/client/ui/phone/notes.js';
import { pathOf } from '../src/server/notify-teams/gather.js';

const root = path.join(import.meta.dirname, '..');
const src = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

/** A flat Settings address: the 1D view's settings tab, never `/` (the 3D office) or a 3D view. */
function assertFlat(href: string, section?: string) {
  const u = new URL(href, 'http://office.test');
  assert.equal(u.pathname, '/lite', `${href} is on the 1D view`);
  assert.equal(u.searchParams.get('tab'), 'settings', `${href} opens the Settings tab`);
  if (section) assert.equal(u.searchParams.get('section'), section, `${href} opens ${section}`);
  assert.doesNotMatch(href, /view=3d|view=retro|^\/(\?|$)/, `${href} isn't the 3D office`);
}

// The sections the docs and the links name, in the order of the page's list.
const DOCUMENTED = ['you', 'workers', 'team', 'jeff', 'notify', 'budget', 'connections', 'deliverables', 'incidents', 'studio', 'appearance', 'advanced', 'testing', 'danger'];

test('every documented section has one stable anchor, in order, and a flat address', () => {
  assert.deepEqual([...SETTINGS_SECTION_IDS], DOCUMENTED);
  assert.equal(new Set(SETTINGS_SECTION_IDS).size, SETTINGS_SECTION_IDS.length, 'no section twice');
  for (const s of SETTINGS_SECTIONS) {
    assert.match(s.id, /^[a-z]+$/, `${s.id} is a plain word, fit for ?section=`);
    assert.ok(s.label && s.blurb && s.icon, `${s.id} has its words`);
    assertFlat(settingsHref(s.id), s.id);
    assertFlat(settingsHref(s.id, 'my floor'), s.id);
    assert.equal(new URL(settingsHref(s.id, 'my floor'), 'http://x').searchParams.get('floor'), 'my floor');
    assert.ok(isSettingsSection(s.id));
    assert.match(settingsPath(s.id), new RegExp(`^⚙️ Settings › .* ${s.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  }
  assertFlat(settingsHref());
  assert.ok(!isSettingsSection('building') && !isSettingsSection(''), 'only real sections');
  // Connections stays admins-only, as in the 3D window; the floor's own sections say they need one.
  assert.deepEqual(SETTINGS_SECTIONS.filter((s) => 'admin' in s).map((s) => s.id), ['connections', 'testing', 'danger']);
  assert.deepEqual(SETTINGS_SECTIONS.filter((s) => 'floor' in s).map((s) => s.id), ['team', 'jeff', 'budget', 'deliverables', 'studio', 'danger']);
});

test('the flat page has a builder for every section and anchors each one (page.ts)', () => {
  const page = src('src/client/ui/settings/page.ts');
  const block = page.slice(page.indexOf('export const SECTION_BUILDERS'), page.indexOf('};', page.indexOf('export const SECTION_BUILDERS')));
  for (const id of SETTINGS_SECTION_IDS) assert.match(block, new RegExp(`^\\s+${id}: `, 'm'), `page.ts builds ${id}`);
  assert.match(page, /id: `settings-\$\{section\}`/, 'the section showing has its anchor (#settings-<id>)');
  assert.match(page, /'data-section': s\.id/, 'each item in the list names its section');
  // The 1D view puts the section in its address and opens on the one a link asked for.
  const lite = src('src/client/lite.ts');
  assert.match(lite, /setAddress\(\{ tab: t, section: t === 'settings' \? settingsPage\.current\(\) : null \}\)/);
  assert.match(lite, /isSettingsSection\(askedSection\)/);
  assert.match(src('src/client/lite.html'), /id="settings-view"/);
});

test('Needs you, the team phone and Teams cards send a spend cap to Settings › Team, on the 1D view', () => {
  const roster = { floor: 'f1', approvals: [], escalations: [], admin: true, paused: 'Daily cap of $5 reached' } as unknown as RosterView;
  const input: NeedsInput = { floor: 'f1', workers: [], pulls: [], floors: [], roster };
  const items = collectNeeds(input);
  const settings = items.filter((n) => n.target.to === 'settings' || n.alt?.target.to === 'settings');
  assert.ok(settings.length, 'a settings item');
  for (const n of settings) {
    const t = n.target.to === 'settings' ? n.target : n.alt!.target;
    assert.ok(t.to === 'settings' && t.section && isSettingsSection(t.section), 'it names its section');
    assertFlat(settingsHref(t.section, 'f1'), t.section);
    // A Teams card's Open button: the same section on the floor's 1D view.
    assertFlat(`/${pathOf({ target: t }, 'f1')}`, t.section);
  }
  // The team phone's notes carry the same target to the page's goToNeed.
  const notes = notesOf(items, true);
  const goes = notes.flatMap((n) => n.actions).filter((a) => a.do === 'go' && a.target.to === 'settings');
  assert.ok(goes.length && goes.every((a) => a.do === 'go' && a.target.to === 'settings' && a.target.section === 'team'));
});

test('no page sends a settings link to the 3D office', () => {
  // The ☰ on the 1D, 2D and home pages: Settings is a flat item, not a "3D ↗" one.
  const menu = src('src/client/shared/flatmenu.ts');
  assert.doesNotMatch(menu, /in3d\('settings'/, 'the ☰ never opens Settings in 3D');
  assert.doesNotMatch(menu.match(/const elsewhere = new Set<string>\(\[[^\]]*\]\)/)![0], /'settings'/, "Settings isn't marked 3D ↗");
  assert.match(menu, /\.\.\.MENU\.settings, .*run: \(\) => \(d\.settings \? d\.settings\(\) : location\.assign\(settingsHref\(/);
  // Each page hands the ☰ its way to Settings.
  assert.match(src('src/client/lite.ts'), /settings: \(\) => showSettings\(\)/);
  assert.match(src('src/client/pixel.ts'), /settings: \(\) => goToSettings\(session\)/);
  assert.match(src('src/client/home.ts'), /settings: \(\) => goToSettings\(session\)/);
  // A Needs-you / phone target: the 1D view opens its section, the 2D view goes there, the phone version says where.
  assert.match(src('src/client/lite.ts'), /if \(t\.to === 'settings'\) return showSettings\(t\.section \?\? 'team'\)/);
  assert.match(src('src/client/pixel.ts'), /if \(t\.to === 'settings'\) return goToSettings\(session, t\.section \?\? 'team'\)/);
  assert.match(src('src/client/mobile/needs.ts'), /if \(t\.to === 'settings'\) return void toast\(`That one is on a computer: \$\{settingsHref\(/);
  // The budget's insights ("Team settings") and the team's Autonomy chip open Settings › Team.
  assert.match(src('src/client/lite.ts'), /go: \(to\) => \(to === 'settings' \? showSettings\('team'\) : showTab\(to\)\)/);
  assert.match(src('src/client/lite.ts'), /select: \(p\) => \(p === 'settings' \? showSettings\('team'\) : showTab\(p\)\)/);
  // Where there's no Settings tab, a link goes to the 1D view's (flat.ts), never switchView('3d') or runIn3d.
  const flat = src('src/client/ui/settings/flat.ts');
  assert.match(flat, /location\.assign\(settingsHref\(section, floor\)\)/);
  for (const f of ['src/client/ui/settings/flat.ts', 'src/client/ui/settings/page.ts', 'src/client/shared/flatmenu.ts', 'src/client/pixel.ts', 'src/client/home.ts', 'src/client/lite.ts']) {
    assert.doesNotMatch(src(f), /runIn3d\('settings'\)|showSettings\(.*switchView\('3d'\)/, `${f} never opens Settings in 3D`);
  }
});

test("the 3D office's ⚙️ window still builds every pane, from the shared section builders", () => {
  const win = src('src/client/ui/settings/index.ts');
  const panes = [...win.slice(win.indexOf('export const PANES'), win.indexOf('];', win.indexOf('export const PANES'))).matchAll(/\{ id: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(panes, ['you', 'sound', 'notify', 'building', 'workers', 'connections']);
  const builders = win.slice(win.indexOf('export const PANE_BUILDERS'), win.indexOf('};', win.indexOf('export const PANE_BUILDERS')));
  for (const p of panes) assert.match(builders, new RegExp(`^\\s+${p}: `, 'm'), `the 3D window builds ${p}`);
  // The same builders as the flat page: Workers, Notifications, sound and the building's settings.
  for (const name of ['workersSettings', 'notifySettings', 'soundSettings', 'mapSetting', 'holidaySetting', 'workspaceSetting', 'dogSettingBuilt', 'skySetting', 'consoleSetting', 'signedInSetting']) {
    assert.match(builders, new RegExp(`\\b${name}\\(`), `the 3D window uses ${name}`);
  }
  // Connections only for admins; the window keeps its ✕, and links to the full page.
  assert.match(win, /if \(p\.admin && !store\.me\.admin\) continue;/);
  assert.match(win, /h\('button\.btn\.close', \{ 'aria-label': 'Close' \}, '✕'\)/);
  assert.match(win, /settingsHref\(undefined, store\.floor/);
  // Every section module is the shared one the flat page loads too, not a copy.
  const page = src('src/client/ui/settings/page.ts');
  for (const m of ['./you', './notify', './workers']) {
    assert.match(win, new RegExp(`from '${m}'`), `the 3D window imports ${m}`);
    assert.match(page, new RegExp(`from '${m}'`), `the flat page imports ${m}`);
  }
});

test('the docs name the flat Settings page, and every section in it', () => {
  const doc = src('docs/site/using-the-office/settings.md');
  for (const s of SETTINGS_SECTIONS) assert.ok(doc.includes(`section=${s.id}`), `settings.md links to section=${s.id}`);
  // No docs page sends anyone to the 3D view for a setting.
  for (const f of ['docs/site/using-the-office/settings.md', 'docs/site/using-the-office/top-bar-and-menu.md', 'docs/site/integrations/teams-notifications.md', 'docs/site/reference/settings-reference.md']) {
    assert.doesNotMatch(src(f), /In the 3D office, open \*\*☰ → ⚙️ Settings|3D office's \*\*☰ → ⚙️ Settings\*\* window rather than|⚙️ Settings \(3D ↗\)/, `${f} doesn't send settings to 3D`);
  }
});
