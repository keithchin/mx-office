import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const client = path.join(import.meta.dirname, '../src/client');
const read = (file: string) => readFileSync(file, 'utf8');

/**
 * The relative imports of a client module, resolved to files (`./foo` is foo.ts, or foo/index.ts).
 * With `types`, type-only ones too; without, what's loaded at run time.
 */
function importsOf(file: string, types = true): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/^\s*(import|export)\s(type\s)?[^'"]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
    if (m[2] && !types) continue;
    const spec = m[3] ?? m[4];
    // A stylesheet, or an asset's URL (a model, a sound).
    if (spec.endsWith('.css') || spec.includes('?')) continue;
    // The shared code (src/shared) names its imports as the server does, with .js for .ts.
    const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ''));
    const found = [`${base}.ts`, path.join(base, 'index.ts'), base].find((f) => existsSync(f) && statSync(f).isFile());
    assert.ok(found, `${path.relative(client, file)} imports ${spec}, which is not there`);
    out.push(found);
  }
  return out;
}

/** Every module `entry` loads at run time, itself included. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...importsOf(f, false));
  }
  return seen;
}

// The pages the browser loads (each an entry in vite.config.ts) and what they load. The 3D office (its
// page at /, main.ts, three.js and the core/, features/, input/, world/, player/ and models/ folders) is
// gone: / opens the 1D view now (server/http/routes/pages.ts), so nothing here may bring it back.
const ENTRIES = ['lite.ts', 'pixel.ts', 'home.ts', 'firm.ts', 'docs.ts', 'm.ts', 'setup.ts', 'login.ts', 'claim.ts', 'join.ts'];

test('the 3D office is gone: no page, no three.js, none of its folders', () => {
  for (const f of ['main.ts', 'index.html', 'style.css', 'graphics.ts', 'core', 'features', 'input', 'world', 'player', 'models', 'lab', 'sound']) assert.ok(!existsSync(path.join(client, f)), `src/client/${f} is gone`);
  const pkg = JSON.parse(read(path.join(client, '../../package.json')));
  for (const dep of ['three', '@types/three']) assert.ok(!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep], `package.json has no ${dep}`);
  const vite = read(path.join(client, '../../vite.config.ts'));
  assert.doesNotMatch(vite, /src\/client\/index\.html/, 'vite builds no 3D page');
  for (const rel of readdirSync(client, { recursive: true }) as string[]) {
    if (!/\.(ts|html)$/.test(rel)) continue;
    assert.doesNotMatch(read(path.join(client, rel)), /from 'three(?:\/[^']*)?'/, `${rel} imports three.js`);
  }
});

test('every client module is loaded by one of the pages: nothing is left over', () => {
  const loaded = new Set<string>();
  const todo = ENTRIES.map((e) => path.join(client, e));
  while (todo.length) {
    const f = todo.pop()!;
    if (loaded.has(f)) continue;
    loaded.add(f);
    todo.push(...importsOf(f, true));
  }
  const left = (readdirSync(client, { recursive: true }) as string[])
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.d.ts'))
    .filter((rel) => !loaded.has(path.join(client, rel)))
    .map((rel) => rel.split(path.sep).join('/'));
  assert.deepEqual(left, [], 'modules no page loads');
});

// The 1D view (lite.ts, at /lite), the 2D Office view (pixel.ts, at /pixel), the home page (home.ts, at
// /home), The Firm (firm.ts, at /firm), the docs (docs.ts, at /docs) and the phone version (m.ts, at /m).
for (const entry of ['lite.ts', 'pixel.ts', 'home.ts', 'firm.ts', 'docs.ts', 'm.ts']) {
  test(`${entry} loads only modules that are there`, () => {
    const page = graph(path.join(client, entry));
    assert.ok(page.size > 1, `${entry} loads something`);
    if (entry !== 'lite.ts' && entry !== 'pixel.ts') return;
    // What both views of a project share: the tab title's count and hiring.
    for (const shared of ['shared/title.ts', 'shared/hiring.ts']) assert.ok(page.has(path.join(client, shared)), `${entry} uses ${shared}`);
  });
}

// ⚙️ Settings (ui/settings/): the full page is the 1D view's Settings tab; the 2D view and the home page
// (whose links go there) reach it through ui/settings/flat.ts.
test('the Settings page loads on /lite, and /pixel and /home reach it', () => {
  const at = (f: string) => path.join(client, f);
  const lite = graph(at('lite.ts'));
  for (const f of ['ui/settings/page.ts', 'ui/settings/flat.ts', 'ui/settings/you.ts', 'ui/settings/notify.ts', 'ui/settings/workers.ts', 'ui/settings/building.ts', 'ui/settings/project.ts', 'ui/settings/office.ts']) assert.ok(lite.has(at(f)), `lite.ts loads ${f}`);
  for (const entry of ['pixel.ts', 'home.ts']) assert.ok(graph(at(entry)).has(at('ui/settings/flat.ts')), `${entry} reaches Settings through ui/settings/flat.ts`);
});

test('the loading screen and the floor overlay load on the flat pages; the run toggle on /lite and /pixel', () => {
  const at = (f: string) => path.join(client, f);
  for (const entry of ['lite.ts', 'pixel.ts', 'home.ts', 'm.ts']) assert.ok(graph(at(entry)).has(at('ui/loading/boot.ts')), `${entry} moves Mx Office's loading screen on`);
  for (const entry of ['lite.ts', 'pixel.ts']) {
    const g = graph(at(entry));
    for (const f of ['ui/loading/floor.ts', 'ui/loading/progress.ts', 'ui/project-run/toggle.ts', 'home/run-state-logic.ts']) assert.ok(g.has(at(f)), `${entry} loads ${f}`);
  }
});
