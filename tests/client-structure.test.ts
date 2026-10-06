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

test('main.ts installs every feature, each with one install line', () => {
  const main = read(path.join(client, 'main.ts'));
  const features = readdirSync(path.join(client, 'features')).filter((d) => statSync(path.join(client, 'features', d)).isDirectory());
  assert.ok(features.length >= 30, `found ${features.length} features`);
  for (const f of features) {
    const dir = path.join(client, 'features', f);
    const installs = readdirSync(dir)
      .filter((x) => x.endsWith('.ts'))
      .flatMap((x) => [...read(path.join(dir, x)).matchAll(/^export function (install\w+)\(/gm)].map((m) => m[1]));
    assert.ok(installs.length, `features/${f} has an install function`);
    for (const name of installs) assert.equal(main.split(`${name}(ctx`).length - 1, 1, `main.ts calls ${name} once`);
  }
});

test('no part of the office imports main.ts: it only puts them together', () => {
  for (const dir of ['core', 'features', 'input', 'shared']) {
    for (const rel of readdirSync(path.join(client, dir), { recursive: true }) as string[]) {
      if (!rel.endsWith('.ts')) continue;
      const file = path.join(client, dir, rel);
      for (const dep of importsOf(file)) assert.notEqual(path.relative(client, dep), 'main.ts', `${dir}/${rel} imports main.ts`);
    }
  }
});

// The 1D view (lite.ts, the board at /lite), the 2D view (pixel.ts, the pixel office at /pixel) and
// the home page (home.ts, at /home: every project's card and the office's statistics), The Firm
// (firm.ts, at /firm: the Reviewer Agents, their engagements and reports) and the docs (docs.ts, at
// /docs: the office's documentation site) and the phone version (m.ts, at /m).
for (const entry of ['lite.ts', 'pixel.ts', 'home.ts', 'firm.ts', 'docs.ts', 'm.ts']) {
  test(`${entry} loads no three.js, and none of the 3D office: what it shares with it is three.js-free`, () => {
    const page = graph(path.join(client, entry));
    for (const f of page) {
      // With forward slashes, so the folder check below holds on Windows too.
      const rel = path.relative(client, f).split(path.sep).join('/');
      assert.doesNotMatch(read(f), /from 'three(?:\/[^']*)?'/, `${rel} (loaded by ${entry}) imports three.js`);
      assert.ok(!/^(core|features|input|world|player)\//.test(rel), `${entry} loads ${rel}, part of the 3D office`);
    }
    // What the flat views and the 3D office share (the home page, the Firm and the docs have no title count or hiring).
    if (entry === 'home.ts' || entry === 'firm.ts' || entry === 'docs.ts' || entry === 'm.ts') return;
    for (const shared of ['shared/title.ts', 'shared/hiring.ts']) {
      assert.ok(page.has(path.join(client, shared)), `${entry} uses ${shared}`);
      assert.ok(graph(path.join(client, 'main.ts')).has(path.join(client, shared)), `the 3D office uses ${shared}`);
    }
  });
}

// ⚙️ Settings (ui/settings/): the flat views' full page and the 3D office's window share the section
// builders, which are three.js-free, so the 1D view (its Settings tab), the 2D view and the home page
// (whose links go there) load them without the 3D office, and the 3D office still has its window.
test('the flat Settings page loads on /lite, /pixel and /home without three.js; the 3D office keeps its window', () => {
  const at = (f: string) => path.join(client, f);
  const lite = graph(at('lite.ts'));
  for (const f of ['ui/settings/page.ts', 'ui/settings/flat.ts', 'ui/settings/you.ts', 'ui/settings/notify.ts', 'ui/settings/workers.ts', 'ui/settings/building.ts', 'ui/settings/project.ts', 'ui/settings/office.ts']) assert.ok(lite.has(at(f)), `lite.ts loads ${f}`);
  for (const entry of ['pixel.ts', 'home.ts']) assert.ok(graph(at(entry)).has(at('ui/settings/flat.ts')), `${entry} reaches Settings through ui/settings/flat.ts`);
  const office = graph(at('main.ts'));
  for (const f of ['ui/settings/index.ts', 'ui/settings/you.ts', 'ui/settings/notify.ts', 'ui/settings/workers.ts', 'ui/settings/building.ts']) assert.ok(office.has(at(f)), `the 3D office loads ${f}`);
  // The sky's words came out of the 3D sky so the flat page can say them.
  assert.ok(!lite.has(at('world/sky.ts')), "the flat page doesn't load the 3D sky");
});
