// The 2D Office view after the 3D office went: old 3D links redirect to the 1D view, the 2D Office view is
// reached from Go to Office and left by Return to Project, and its top bar holds only where you are and the
// way back, with the office's own controls on a toolbar over the canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { legacyOfficeUrl } from '../src/shared/home.js';
import { officeUrl, projectUrl } from '../src/client/ui/viewpick.js';
import { pageRoutes } from '../src/server/http/routes/pages.js';
import { startTab } from '../src/client/shared/start-tab.js';

const root = path.join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

test('every old address of the 3D office opens the 1D view, of the floor the link named', () => {
  for (const q of ['', '?view=3d', '?view=retro', '?3d=1&view=3d', '?3d=1&view=retro', '?gfx=low', '?view=2d']) assert.equal(legacyOfficeUrl(q), '/lite', q || '(nothing)');
  assert.equal(legacyOfficeUrl('?floor=mx-spike'), '/lite?floor=mx-spike');
  assert.equal(legacyOfficeUrl('?3d=1&view=retro&floor=travel%20app'), '/lite?floor=travel%20app');
  assert.equal(legacyOfficeUrl('?floor='), '/lite');
});

test('/ and /index.html answer with a redirect, signed in or not, never a 404 or the old page', async () => {
  const route = pageRoutes.office;
  assert.deepEqual(route.path, ['/', '/index.html']);
  assert.equal(route.auth, 'public', 'the 1D view asks for the sign-in itself, so the redirect needs none');
  for (const [search, location] of [['', '/lite'], ['?view=3d&floor=f1', '/lite?floor=f1'], ['?3d=1&view=retro', '/lite']] as const) {
    let status = 0;
    let headers: Record<string, string> = {};
    const res = { writeHead: (s: number, h: Record<string, string>) => ((status = s), (headers = h), res), end: () => res };
    await route.handle({} as never, { req: {} as never, res: res as never, url: new URL(`http://x/${search}`), path: '/' });
    assert.equal(status, 302);
    assert.equal(headers.location, location);
  }
  // The bundle still carries a stub index.html (an older office checks for it before it upgrades), but it only sends you on.
  assert.match(read('src/client/public/index.html'), /location\.replace\('\/lite'/);
  assert.match(read('src/server/upgrade.ts'), /'dist\/public\/lite\.html'/);
  assert.match(read('src/server/http/static.ts'), /'lite\.html'/);
});

test("Return to Project goes to the 1D view of the same project, which opens on the Command Center", () => {
  assert.equal(projectUrl('mx-spike'), '/lite?floor=mx-spike');
  assert.equal(projectUrl('a b'), '/lite?floor=a%20b');
  assert.equal(projectUrl(null), '/home', 'no project: Home');
  assert.equal(officeUrl('mx-spike'), '/pixel?floor=mx-spike');
  // No ?tab= in the address, not a reload: the start-tab rule lands on the Command Center.
  assert.equal(startTab(undefined, false, 'board', 'command'), 'command');
  const vp = read('src/client/ui/viewpick.ts');
  assert.match(vp, /'button\.btn\.primary\.vp-go\.vp-return'/);
  assert.match(vp, /onclick: \(\) => location\.assign\(projectUrl\(floor\(\)\)\)/);
  assert.match(vp, /onclick: \(\) => location\.assign\(officeUrl\(floor\(\)\)\)/);
});

test('the 2D Office view is reached only from Go to Office: Home, the launcher and the menus open the 1D view', () => {
  const offerers = ['src/client/home/projects.ts', 'src/client/home/portal.ts', 'src/client/home/overview.ts', 'src/client/home/stats.ts', 'src/client/home.ts', 'src/client/ui/portal/topbar.ts', 'src/client/shared/flatmenu.ts', 'src/client/ui/menuitems.ts'];
  for (const f of offerers) assert.doesNotMatch(read(f), /['`]\/pixel|officeUrl|FlatView|, '2d'/, `${f} doesn't open the 2D Office view`);
  assert.match(read('src/client/lite.ts'), /goToOfficeButton\(\(\) => store\.floor\)/);
  // Nothing remembers a view any more, so nothing can send you to the 2D Office view by itself.
  for (const f of ['src/client/lite.ts', 'src/client/pixel.ts', 'src/client/home.ts']) assert.doesNotMatch(read(f), /rememberView|switchView|graphics/, f);
});

test("the 2D Office view's top bar: where you are and Return to Project, nothing else of the office's", () => {
  const html = read('src/client/pixel.html');
  const bar = html.slice(html.indexOf('<header class="lite-bar px-bar">'), html.indexOf('</header>'));
  assert.ok(bar.length > 0, 'the bar is there');
  for (const id of ['to-home', 'floor', 'px-floor-label', 'view-pick', 'theme', 'menu']) assert.match(bar, new RegExp(`id="${id}"`), `the bar has #${id}`);
  assert.match(bar, /<span id="px-floor-label" class="lite-floor-label">Office<\/span>/);
  for (const id of ['px-summary', 'floor-meta', 'px-zoom-in', 'px-zoom-out', 'px-zoom-fit', 'px-more', 'px-project']) assert.doesNotMatch(bar, new RegExp(`id="${id}"`), `#${id} isn't on the bar`);
  // The office's toolbar, over the canvas: the status line, the project group, the zoom and ⋯.
  const stage = html.slice(html.indexOf('<main id="stage"'), html.indexOf('</main>'));
  const toolbar = stage.slice(stage.indexOf('<div class="px-toolbar"'));
  for (const id of ['px-summary', 'floor-meta', 'px-project', 'px-zoom-out', 'px-zoom-fit', 'px-zoom-in', 'px-more']) assert.match(toolbar, new RegExp(`id="${id}"`), `the toolbar has #${id}`);
  assert.doesNotMatch(html, /class="px-keys"/, 'the keys are in ⋯, not the footer');
  const pixel = read('src/client/pixel.ts');
  // The budget chips and Pause / Resume land beside the floor's line and are moved onto the toolbar.
  assert.match(pixel, /document\.getElementById\('budget-chip'\), document\.querySelector\('\.bud-meta-row \.pr-toggle'\), document\.getElementById\('budget-office'\)\]\) if \(el\) \$\('px-project'\)\.append\(el\)/);
  assert.match(pixel, /replaceWith\(returnToProjectButton\(\(\) => store\.floor\)\)/);
  assert.match(pixel, /'div\.hud-menu\.flat-menu\.px-more-menu'/);
  // In Portal: OFFICE · the project as the section, Return to Project in the accent.
  const css = read('src/client/pixel.css');
  assert.match(css, /#px-floor-label::after \{ content: ' ·'; \}/);
  assert.match(css, /header\.lite-bar \.vp-return \{[^}]*background: var\(--accent\)/);
  // The Portal bar keeps 🏠 then the picker in the other themes, and puts the search after the section.
  const top = read('src/client/ui/portal/topbar.ts');
  assert.match(top, /\(bar\.querySelector<HTMLElement>\('#to-home'\) \?\? sep\)\.after\(floor\)/);
});

test("the 3D view's docs page is gone, and an old link to it lands on The two views", () => {
  assert.match(read('docs/site/concepts/views.md'), /^aliases:\r?\n {2}- using-the-office\/3d-view\r?$/m);
  assert.doesNotMatch(read('docs/site/concepts/views.md'), /\?gfx=low`, `\?gfx=medium`/, 'no graphics presets any more');
});

test('nothing on the pages offers the 3D office any more', () => {
  const pages = ['src/client/pixel.ts', 'src/client/lite.ts', 'src/client/home.ts', 'src/client/shared/flatmenu.ts', 'src/client/ui/menuitems.ts', 'src/client/ui/viewpick.ts'];
  for (const f of [...pages, 'src/client/pixel.html', 'src/client/lite.html', 'src/client/home.html']) {
    assert.doesNotMatch(read(f), /3D office|'3d'|'retro'|runIn3d|3D ↗/, `${f} names no 3D office`);
  }
});
