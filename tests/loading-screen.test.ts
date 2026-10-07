// Mx Office's loading screen (#ao-boot): drawn by each flat page's HTML itself, before its code, so it
// shows at once, the same block in all four, in every theme, quiet for reduced motion and spoken as a
// status; and the code (ui/loading/boot.ts, through shared/session.ts) moves it on through the steps the
// inline script lists. The floor overlay's pieces stay three.js-free (tests/client-structure.test.ts
// follows the entries' imports).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const client = path.join(import.meta.dirname, '../src/client');
const read = (f: string) => readFileSync(path.join(client, f), 'utf8').replace(/\r\n/g, '\n');
const PAGES = ['lite.html', 'pixel.html', 'home.html', 'm.html'];

/** The block's two parts: its style (in <head>) and its markup and script (first in <body>). */
function block(html: string) {
  const style = html.slice(html.indexOf("<!-- Mx Office's loading screen"), html.indexOf('</style>') + '</style>'.length);
  const start = html.indexOf('<div id="ao-boot"');
  const body = html.slice(start, html.indexOf('</script>', start) + '</script>'.length);
  return { style, body };
}

for (const page of PAGES) {
  test(`${page} draws Mx Office's loading screen itself, before its code loads`, () => {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    const bundle = html.indexOf('<script type="module"');
    const boot = html.indexOf('<div id="ao-boot"');
    assert.ok(bundle > 0, 'the page has its module script');
    assert.ok(boot > 0 && boot < bundle, 'the screen comes before the bundle');
    assert.ok(boot < html.indexOf('<', html.indexOf('<body') + 1) + 5, 'it is the first thing in <body>');
    assert.ok(head.includes('#ao-boot{'), 'its style is in <head>, so it paints styled at once');
    assert.ok(head.indexOf('#ao-boot{') > head.indexOf('agent-office.color-theme'), 'after the theme is set');
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /role="progressbar" aria-label="Loading Mx Office"/);
    assert.match(html, /Loading Mx Office… <span class="aob-pct">0<\/span> %/);
    assert.match(html, /Mx Office is restarting… reconnecting/);
    for (const theme of ['dark', 'terminal', 'clean-light', 'clean-dark']) assert.ok(head.includes(`html[data-theme=${theme}] #ao-boot{`), `${theme} has its colors`);
    assert.match(head, /@media \(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(block(html).body, /\p{Extended_Pictographic}/u, 'no emoji (the Clean themes have none)');
  });
}

test('the four pages carry the same block', () => {
  const [first, ...rest] = PAGES.map((p) => block(read(p)));
  for (const b of rest) assert.deepEqual(b, first);
});

test("the code moves the screen through the inline script's steps", () => {
  const inline = block(read('lite.html')).body;
  const steps = JSON.parse(/var S=(\[[^\]]+\])/.exec(inline)![1]) as string[];
  assert.deepEqual(steps, ['bundle', 'session', 'socket', 'data', 'view']);
  const boot = read('ui/loading/boot.ts');
  assert.match(boot, /export type BootStep = 'bundle' \| 'session' \| 'socket' \| 'data' \| 'view';/);
  assert.match(boot, /^bootStep\('bundle'\);$/m);
  const session = read('shared/session.ts');
  assert.match(session, /from '\.\.\/ui\/loading\/boot'/);
  for (const s of ['session', 'data']) assert.match(session, new RegExp(`bootStep\\('${s}'\\)`));
  assert.match(session, /up \? bootStep\('socket'\) : bootDown\(\)/);
  assert.match(session, /bootDrawn\(\)/);
  // A failed bundle (the office went down mid-load) polls the health check and reloads.
  assert.match(inline, /fetch\("\/api\/health"/);
});

test('the 1D and 2D views track their floor loads; Home shows the overlay as it opens one', () => {
  for (const f of ['lite.ts', 'pixel.ts']) {
    const s = read(f);
    assert.match(s, /floorLoading\(net, /, `${f} has the floor overlay`);
    for (const step of ['roster', 'summary', 'budget']) assert.match(s, new RegExp(`loading\\.done\\('${step}'`), `${f} marks ${step}`);
  }
  assert.match(read('lite.ts'), /loading\.done\('setup'/);
  assert.match(read('lite.ts'), /onLoaded: \(f\) => loading\.done\('convo', f\)/);
  assert.match(read('home/projects.ts'), /showOverlay\(\{ title: `Loading project \$\{name\}… 0 %`/);
});
