// Import a design system from a folder (server/design/import/, shared/design/import/): each format the scanner
// reads (CSS variables, SCSS, HTML <style> and inline colours, DTCG / Style Dictionary / Tokens Studio JSON, a
// Tailwind config's literal objects), var() resolution, dark variants, the mapping's suggestions and confidence,
// --mxt-* passthrough checked against mxcli's vocabulary, provenance in the package and its digest, the
// re-import diff, and the safety cases (links, secrets, binaries, caps, web imports, paths). Neutral fixtures in
// tests/fixtures/design-import; temporary folders for the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkImportPath, scanDesignSource, IMPORT_CAPS } from '../src/server/design/import/scan.js';
import { readCss } from '../src/server/design/import/css.js';
import { readTokensJson } from '../src/server/design/import/tokens-json.js';
import { readTailwind } from '../src/server/design/import/tailwind.js';
import { suggestMapping } from '../src/shared/design/import/suggest.js';
import { defaultChoices, diffTokens, inputOf, overridesOf, parseTokensCss, pruneOverrides, splitFont } from '../src/shared/design/import/apply.js';
import { coloursIn, toHexColour } from '../src/shared/design/import/colour.js';
import type { ImportScan } from '../src/shared/design/import/types.js';
import { DesignImports } from '../src/server/design/import/service.js';
import { contrastChecks, deriveTokens, DEFAULT_INPUT, MXT_TOKENS, tokensCss } from '../src/shared/design/tokens.js';
import { CLIENT, designWorld } from './design-helpers.js';

const FIX = path.join(import.meta.dirname, 'fixtures', 'design-import');
const OFFICE = {
  dataDir: path.join(tmpdir(), 'ao-nowhere-data'),
  projectsDir: path.join(tmpdir(), 'ao-nowhere-projects'),
  codeDir: path.join(tmpdir(), 'ao-nowhere-code'),
};
const tmp = (t: { after(fn: () => void): void }) => {
  const d = mkdtempSync(path.join(tmpdir(), 'ao-dsimport-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

async function scanOf(dir: string, caps = IMPORT_CAPS): Promise<ImportScan> {
  const c = await checkImportPath(dir, OFFICE);
  assert.ok(!('error' in c), 'error' in c ? c.error : '');
  const s = await scanDesignSource(dir, c, caps);
  assert.ok(!('error' in s), 'error' in s ? s.error : '');
  return s;
}
test('colours: hex, rgb(), hsl(), names, alpha; colour literals in a value', () => {
  assert.equal(toHexColour('#ABC'), '#aabbcc');
  assert.equal(toHexColour('rgb(11, 95, 255)'), '#0b5fff');
  assert.equal(toHexColour('rgb(11 95 255 / 0.9)'), '#0b5fff');
  assert.equal(toHexColour('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(toHexColour('rgba(0,0,0,0.1)'), undefined, 'mostly transparent is not a colour');
  assert.equal(toHexColour('white'), '#ffffff');
  assert.equal(toHexColour('linear-gradient(red, blue)'), undefined);
  assert.deepEqual(coloursIn('1px solid #ddd'), ['#dddddd']);
});

test('CSS reader: declarations with lines and blocks, Sass maps, @import, @font-face; strings and url() don’t break it', () => {
  const decls: {
    prop: string;
    value: string;
    line: number;
    blocks: string[];
  }[] = [];
  const imports: string[] = [];
  const faces: string[] = [];
  readCss(
    `$colors: (primary: #123456, danger: #c00);\n/* a ; comment { */\n@import url("https://x.example/f.css");\n@font-face { font-family: "Brand Sans"; src: url(data:font/woff2;base64,AAA); }\n.a { background: url("a;b.png"); color: #fff }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; } }\n// a line comment ; {\n.b { &:hover { color: red; } }\n`,
    {
      decl: (d) => decls.push(d),
      imported: (t) => imports.push(t),
      fontFace: (f) => faces.push(f),
    },
    { scss: true },
  );
  assert.deepEqual(decls.find((d) => d.prop === '$colors.primary')?.value, '#123456');
  assert.equal(decls.find((d) => d.prop === 'color' && d.value === '#fff')?.line, 5);
  assert.deepEqual(decls.find((d) => d.prop === '--bg')?.blocks, ['@media (prefers-color-scheme: dark)', ':root']);
  assert.ok(decls.find((d) => d.prop === 'color' && d.value === 'red')?.blocks.includes('&:hover'));
  assert.equal(imports.length, 1);
  assert.deepEqual(faces, ['Brand Sans']);
});

test('a plain CSS-variables site: var() chains resolved, high-confidence names, usage counted, web imports listed and not fetched', async () => {
  const s = await scanOf(path.join(FIX, 'css-vars'));
  assert.deepEqual(s.files.map((f) => f.path).sort(), ['index.html', 'styles/site.css', 'styles/tokens.css']);
  assert.ok(s.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const link = s.vars.find((v) => v.name === '--link')!;
  assert.equal(link.value, '#0b5fff', 'var(--color-primary) resolved within the folder');
  assert.ok((s.vars.find((v) => v.name === '--color-primary')!.uses?.background ?? 0) > 0, 'used as a background');
  assert.deepEqual(s.remote, ['styles/site.css: https://fonts.example.com/css?family=Inter']);
  const { suggestion } = suggestMapping(s);
  const pick = (f: keyof typeof suggestion.fields) => suggestion.fields[f].find((c) => !c.filler)!;
  assert.equal(pick('primary').value, '#0b5fff');
  assert.equal(pick('primary').confidence, 'high');
  assert.equal(pick('primary').label, '--color-primary');
  assert.deepEqual(pick('primary').loc, { file: 'styles/tokens.css', line: 3 });
  assert.equal(suggestion.fields.primary[1].label, '--color-primary-hover', 'the hover variant is an alternative, lower');
  assert.equal(pick('background').value, '#f4f6f9');
  assert.equal(pick('surface').value, '#ffffff');
  assert.equal(pick('text').value, '#1b2430');
  assert.equal(pick('border').value, '#d5dbe3');
  assert.equal(pick('danger').value, '#d93025');
  assert.equal(pick('font').value, '"Inter", system-ui, sans-serif');
  assert.equal(pick('corners').value, 'soft');
  assert.equal(pick('density').value, 'comfortable');
  assert.ok(
    s.notImported.logos.some((l) => l.includes('logo.svg')),
    'the logo is found, not imported',
  );
  assert.deepEqual(s.notImported.layouts, ['index.html']);
  assert.equal(s.darkHow.length, 0);
});

test('an HTML page with <style> and a dark-mode block: dark values follow the chosen name; inline colours and theme-color count', async () => {
  const s = await scanOf(path.join(FIX, 'html-dark'));
  assert.deepEqual(s.darkHow, ['@media (prefers-color-scheme: dark)']);
  const brandDark = s.vars.find((v) => v.name === '--brand' && v.scheme === 'dark')!;
  assert.equal(brandDark.hex, '#b388eb');
  assert.equal(brandDark.loc.line, 15, 'lines inside <style> count from the top of the file');
  const { suggestion } = suggestMapping(s);
  const primary = suggestion.fields.primary[0];
  assert.equal(primary.value, '#7b2cbf');
  assert.equal(primary.dark, '#b388eb');
  assert.equal(suggestion.fields.surface[0].label, '--card-bg');
  assert.equal(suggestion.fields.surface[0].dark, '#1e1e1e');
  assert.ok(
    s.colours.some((c) => c.hex === '#e0e0e0' && c.uses.border),
    'an inline style="border: …" colour',
  );
  assert.ok(s.vars.some((v) => v.name === 'meta:theme-color'));
  const choices = defaultChoices(suggestion);
  assert.equal(choices.success!.how, 'default', 'nothing named success: the office default, not a stray alternative');
  const over = overridesOf(suggestion, choices, {
    passthrough: true,
    dark: true,
  });
  assert.deepEqual({ ground: over.dark.ground, ink: over.dark.ink, brand: over.dark.brand }, { ground: '#121212', ink: '#eeeeee', brand: '#b388eb' });
  assert.deepEqual(overridesOf(suggestion, choices, { passthrough: true, dark: false }).dark, {});
  const input = inputOf(choices, 'Sample');
  assert.equal(deriveTokens(input, over).dark.ground, '#121212');
  assert.ok(contrastChecks(input, over).find((c) => c.label === 'Dark mode: text on background')!.ok);
});

test('design-token JSON: DTCG ($type inherited, aliases), Style Dictionary and Tokens Studio sets (dark set = dark)', async () => {
  const s = await scanOf(path.join(FIX, 'dtcg'));
  assert.deepEqual(
    s.files.map((f) => f.path),
    ['tokens.json'],
    'package.json is never read as tokens',
  );
  const { suggestion } = suggestMapping(s);
  assert.equal(suggestion.fields.primary[0].value, '#00796b', '{color.base.teal} resolved');
  assert.equal(suggestion.fields.primary[0].loc!.line, 9);
  assert.equal(suggestion.fields.font[0].value, '"Source Sans 3", Arial, sans-serif');
  assert.equal(suggestion.fields.corners[0].value, 'square');
  const sd = readTokensJson(
    JSON.stringify(
      {
        color: {
          base: { blue: { value: '#0055aa' } },
          brand: { value: '{color.base.blue.value}' },
        },
      },
      null,
      2,
    ),
  )!;
  assert.equal(sd.find((t) => t.path === 'color.brand')!.value, '#0055aa');
  const ts = readTokensJson(
    JSON.stringify(
      {
        global: { primary: { value: '#112233', type: 'color' } },
        dark: { bg: { value: '#000000', type: 'color' } },
        $themes: [],
      },
      null,
      2,
    ),
  )!;
  assert.equal(ts.find((t) => t.path === 'global.primary')!.type, 'color');
  assert.equal(ts.find((t) => t.path === 'dark.bg')!.dark, true);
  assert.equal(readTokensJson('{"name": "x"}'), undefined);
  assert.equal(readTokensJson('not json'), undefined);
});

test('Tailwind: literal objects only; code is skipped, never run', () => {
  const { entries, skipped } = readTailwind(readFileSync(path.join(FIX, 'messy', 'tailwind.config.js'), 'utf8'));
  assert.deepEqual(
    entries.map((e) => [e.path, e.value]),
    [
      ['colors.accent', '#e4572e'],
      ['colors.gray.100', '#f7f7f7'],
      ['colors.gray.900', '#333333'],
      ['borderRadius.DEFAULT', '3px'],
    ],
  );
  assert.ok(skipped >= 1, 'extra.blue is skipped');
});

test('a folder that already has --mxt-*: taken as they are, checked against mxcli’s vocabulary; the rest derived', async () => {
  const s = await scanOf(path.join(FIX, 'mxt'));
  const { suggestion } = suggestMapping(s);
  assert.ok(suggestion.passthrough);
  assert.equal(suggestion.passthrough.light.brand, '#0b3d91');
  assert.equal(suggestion.passthrough.dark.ground, '#10151d');
  assert.equal(suggestion.passthrough.light.font, '"Segoe UI", system-ui, sans-serif');
  assert.deepEqual(
    suggestion.ignored.map((i) => i.name),
    ['--mxt-secondary'],
  );
  assert.match(suggestion.ignored[0].reason, /mxcli theme show signal/);
  const choices = defaultChoices(suggestion);
  assert.equal(choices.primary!.value, '#0b3d91');
  assert.equal(choices.corners!.value, 'round');
  const input = inputOf(choices, 'Sample');
  const over = overridesOf(suggestion, choices, {
    passthrough: true,
    dark: true,
  });
  const css = tokensCss('Sample', input, over);
  assert.equal((css.match(/^ {2}--mxt-/gm) ?? []).length, MXT_TOKENS.length, 'still all 40, light');
  assert.match(css, /--mxt-radius: 10px;/);
  assert.match(css, /--mxt-font: "Segoe UI", system-ui, sans-serif;/);
  assert.doesNotMatch(css, /--mxt-secondary/);
  assert.equal(parseTokensCss(css).dark.ground, '#10151d');
  // A field changed to something else: its passthrough token goes, the choice wins.
  const changed = {
    ...choices,
    primary: { value: '#aa0000', how: 'hand' as const },
  };
  const o2 = overridesOf(suggestion, changed, {
    passthrough: true,
    dark: true,
  });
  assert.equal(o2.light.brand, undefined);
  assert.equal(deriveTokens(inputOf(changed, 'S'), o2).light.brand, '#aa0000');
  assert.equal(overridesOf(suggestion, choices, { passthrough: false, dark: false }).light.brand, undefined);
  const byDefault = overridesOf(suggestion, { ...choices, primary: { value: DEFAULT_INPUT.primary, how: 'default' } }, { passthrough: true, dark: true });
  assert.equal(byDefault.light.brand, undefined, 'the office default chosen: the folder’s --mxt-brand goes too');
  assert.equal(byDefault.dark.brand, undefined);
});

test('a messy folder (literals only): the page’s colours, a saturated brand, statuses by hue — all low or medium confidence', async () => {
  const s = await scanOf(path.join(FIX, 'messy'));
  const { suggestion } = suggestMapping(s);
  const pick = (f: keyof typeof suggestion.fields) => suggestion.fields[f].find((c) => !c.filler)!;
  assert.equal(pick('background').value, '#ffffff');
  assert.equal(pick('text').value, '#333333');
  assert.equal(pick('primary').value, '#e4572e');
  assert.equal(pick('danger').value, '#d32f2f');
  assert.equal(pick('success').value, '#29a745');
  assert.equal(pick('warning').value, '#f0ad4e');
  assert.equal(pick('surface').value, '#f7f7f7', 'a grey before a status tint');
  assert.equal(pick('border').value, '#dddddd');
  assert.equal(pick('font').value, 'Verdana, sans-serif');
  assert.equal(pick('corners').value, 'square');
  assert.equal(pick('density').value, 'compact');
  for (const f of ['background', 'text', 'danger', 'success', 'warning', 'surface'] as const) assert.notEqual(pick(f).confidence, 'high', f);
});

test('mapping: font stacks split, hand edits drop the overrides they change, the re-import diff', () => {
  assert.deepEqual(splitFont('"Inter", system-ui, sans-serif'), {
    font: 'Inter',
    fallback: 'system-ui, sans-serif',
  });
  assert.equal(splitFont('system-ui, sans-serif').font, '');
  const a = { ...DEFAULT_INPUT, name: 'A' };
  const over = {
    light: { brand: '#123456', line: '#cccccc' },
    dark: { ground: '#000000' },
  };
  const keepAll = pruneOverrides(a, { ...a, name: 'B' }, over);
  assert.deepEqual(keepAll, over);
  const pruned = pruneOverrides(a, { ...a, primary: '#ff0000' }, over);
  assert.equal(pruned.light.brand, undefined, 'primary changed: brand goes');
  assert.equal(pruned.light.line, '#cccccc', 'line doesn’t depend on primary');
  assert.equal(pruned.dark.ground, undefined, 'dark ground is derived from primary');
  const changes = diffTokens(deriveTokens(a), deriveTokens({ ...a, danger: '#aa0000' }));
  assert.ok(changes.some((c) => c.token === 'danger' && c.from === DEFAULT_INPUT.danger && c.to === '#aa0000'));
  assert.ok(
    changes.every((c) => /danger|risk/.test(c.token)),
    'only the danger tokens change',
  );
});

test('safety: links never followed, secrets and binaries never read, dependencies skipped, caps, paths refused', async (t) => {
  const d = tmp(t);
  const site = path.join(d, 'site');
  mkdirSync(path.join(site, 'node_modules', 'x'), { recursive: true });
  mkdirSync(path.join(site, '.git'), { recursive: true });
  mkdirSync(path.join(d, 'outside'));
  writeFileSync(path.join(site, 'a.css'), ':root { --primary: #0b5fff; }\n@import url(http://cdn.example.com/x.css);\n');
  writeFileSync(path.join(site, 'node_modules', 'x', 'x.css'), 'body { background: #000; }');
  writeFileSync(path.join(site, '.git', 'y.css'), 'body { background: #000; }');
  writeFileSync(path.join(site, '.env'), 'TOKEN=secret');
  writeFileSync(path.join(site, 'server.key'), 'secret');
  writeFileSync(path.join(site, 'bin.css'), Buffer.from([0x61, 0, 0x62]));
  writeFileSync(path.join(d, 'outside', 'evil.css'), ':root { --primary: #ff00ff; }');
  writeFileSync(path.join(site, 'big.css'), `/* ${'x'.repeat(2 * 1024 * 1024)} */`);
  let linked = false;
  try {
    symlinkSync(path.join(d, 'outside'), path.join(site, 'linked'), 'junction');
    linked = true;
  } catch {
    // no links here
  }
  const before = readdirSync(site).sort();
  const s = await scanOf(site);
  assert.deepEqual(
    s.files.map((f) => f.path),
    ['a.css'],
  );
  assert.equal(s.skippedCounts['secrets-like (never read)'], 2);
  assert.equal(s.skippedCounts.binary, 1);
  assert.equal(s.skippedCounts['too large'], 1);
  assert.ok(s.skippedCounts['dependencies, build output or hidden folder'] >= 2);
  if (linked) assert.equal(s.skippedCounts['link (never followed)'], 1);
  assert.ok(!s.vars.some((v) => v.hex === '#ff00ff'), 'nothing from outside the folder');
  assert.deepEqual(s.remote, ['a.css: http://cdn.example.com/x.css']);
  assert.deepEqual(readdirSync(site).sort(), before, 'nothing written in the folder');
  // Caps.
  for (let i = 0; i < 5; i++) writeFileSync(path.join(site, `c${i}.css`), `.c${i} { color: #10${i}0${i}0; }`);
  const capped = await scanOf(site, { ...IMPORT_CAPS, files: 3 });
  assert.equal(capped.files.length, 3);
  assert.match(capped.truncated ?? '', /stopped/);
  // Paths.
  assert.match(((await checkImportPath('relative/path', OFFICE)) as { error: string }).error, /full path/);
  assert.match(((await checkImportPath(path.join(d, 'nope'), OFFICE)) as { error: string }).error, /nothing at/);
  assert.match(
    (
      (await checkImportPath(path.join(site, '.env'), OFFICE)) as {
        error: string;
      }
    ).error,
    /secrets/,
  );
  assert.match(
    (
      (await checkImportPath(path.join(site, 'server.key'), OFFICE)) as {
        error: string;
      }
    ).error,
    /secrets/,
  );
  assert.match(
    (
      (await checkImportPath(path.join(site, 'a.css'), {
        ...OFFICE,
        dataDir: site,
      })) as { error: string }
    ).error,
    /office’s own folders/,
  );
  assert.match(
    (
      (await checkImportPath(site, { ...OFFICE, dataDir: d })) as {
        error: string;
      }
    ).error,
    /inside/,
  );
  assert.match(
    (
      (await checkImportPath(`${site}${path.sep}..${path.sep}site`, {
        ...OFFICE,
        dataDir: d,
      })) as { error: string }
    ).error,
    /inside/,
    'a .. path is resolved before it’s checked',
  );
  const one = await checkImportPath(path.join(site, 'a.css'), OFFICE);
  assert.deepEqual('kind' in one && one.kind, 'file');
  const single = await scanDesignSource(path.join(site, 'a.css'), one as { path: string; kind: 'file' });
  assert.ok(!('error' in single) && single.files.length === 1);
});

test('the service: scan → review → Save as draft keeps import.json beside it; Publish puts it in the package under the digest; Re-import diffs', async (t) => {
  const w = designWorld(t);
  const audits: string[] = [];
  const imp = new DesignImports({
    design: w.s,
    office: () => OFFICE,
    audit: (e) => void audits.push(`${e.action}: ${e.summary}`),
    now: () => 2_000,
  });
  const v = await imp.scan(CLIENT, path.join(FIX, 'css-vars'));
  assert.ok(typeof v !== 'string', String(v));
  assert.equal(v.baseline, undefined, 'nothing to compare with yet');
  const choices = defaultChoices(v.suggestion);
  assert.equal(typeof (await imp.save(CLIENT, { scanId: 'imp_nope', choices }, 'Ada')), 'string', 'an unknown scan is refused');
  // The page can't smuggle a value in: a candidate id with another value, or a non-hex own colour, is not taken.
  const tampered = {
    ...choices,
    info: { ...choices.info!, value: 'red;}body{' },
    danger: { value: 'url(x)', how: 'hand' },
  };
  const r = await imp.save(
    CLIENT,
    {
      scanId: v.scanId,
      name: 'Acme Logistics Design System',
      choices: tampered,
      passthrough: true,
      dark: true,
    },
    'Ada',
  );
  assert.ok(typeof r !== 'string', String(r));
  assert.match(audits.at(-1)!, /^design\.import: Imported Acme Logistics Design System as a draft from the folder/);
  const s = w.s.store.ofOwner({ client: CLIENT })!;
  assert.equal(s.draft!.primary, '#0b5fff');
  assert.equal(s.draft!.danger, DEFAULT_INPUT.danger);
  assert.equal(s.draft!.info, DEFAULT_INPUT.info);
  assert.equal(s.draft!.font, 'Inter');
  const di = (await w.s.store.draftImport(s.id))!;
  assert.equal(di.record.source, path.join(FIX, 'css-vars'));
  assert.equal(di.record.files.length, 3);
  assert.equal(di.record.mappings.primary!.how, 'suggested');
  assert.deepEqual(di.record.mappings.primary!.from, {
    file: 'styles/tokens.css',
    line: 3,
    name: '--color-primary',
  });
  assert.equal(di.record.mappings.danger!.how, 'default');
  assert.equal(di.record.overrides.light.line, '#d5dbe3', 'the border colour sets --mxt-line');
  assert.match(di.excerpts, /styles\/tokens\.css:3: --color-primary: #0b5fff;/);
  assert.ok(di.record.unmapped.length >= 1);
  assert.deepEqual(di.record.remote, ['styles/site.css: https://fonts.example.com/css?family=Inter']);
  assert.equal(await imp.save(CLIENT, { scanId: v.scanId, choices }, 'Ada'), 'That scan has expired: scan the folder again', 'a scan is saved once');
  // Publish: import.json and the excerpts are package files, under the digest.
  const p = await w.s.publish(s.id, 'Ada');
  assert.ok(typeof p !== 'string');
  const dir = w.s.store.packageDir(s.id, p.n);
  assert.ok(existsSync(path.join(dir, 'import.json')) && existsSync(path.join(dir, 'import', 'excerpts.txt')));
  assert.match(readFileSync(path.join(dir, 'tokens.css'), 'utf8'), /--mxt-line: #d5dbe3;/);
  assert.ok(await w.s.store.verify(s.id, p.n));
  writeFileSync(path.join(dir, 'import.json'), readFileSync(path.join(dir, 'import.json'), 'utf8').replace('css-vars', 'elsewhere'));
  assert.equal(await w.s.store.verify(s.id, p.n), false, 'changing the provenance breaks the digest');
  assert.equal(await w.s.store.draftImport(s.id), undefined, 'the draft’s import went with the draft');
  assert.equal((await imp.summary(CLIENT))!.on, p.n);
  // Re-import from a changed folder: a new draft with the diff against v1.
  const d = tmp(t);
  writeFileSync(path.join(d, 'tokens.css'), readFileSync(path.join(FIX, 'css-vars', 'styles', 'tokens.css'), 'utf8').replace('#d93025', '#b00020'));
  const v2 = await imp.scan(CLIENT, d);
  assert.ok(typeof v2 !== 'string');
  assert.equal(v2.baseline!.label, 'v1');
  const r2 = await imp.save(CLIENT, { scanId: v2.scanId, choices: defaultChoices(v2.suggestion) }, 'Ada');
  assert.ok(typeof r2 !== 'string');
  const di2 = (await w.s.store.draftImport(s.id))!;
  assert.equal(di2.record.diff!.against, 'v1');
  const dz = di2.record.diff!.changes.find((c) => c.token === 'danger' && c.scheme === 'light')!;
  assert.deepEqual([dz.from, dz.to], [DEFAULT_INPUT.danger, '#b00020'], 'v1 kept the default (the tampered value was refused)');
  assert.ok(!di2.record.diff!.changes.some((c) => c.token === 'brand'), 'unchanged tokens aren’t in the diff');
  // A hand edit in the form after the import: the override it changes goes, and it's said so.
  assert.equal(
    await w.s.saveDraft(
      { client: CLIENT },
      'branded',
      {
        ...w.s.store.ofOwner({ client: CLIENT })!.draft!,
        background: '#000000',
      },
      'Ada',
    ),
    undefined,
  );
  const di3 = (await w.s.store.draftImport(s.id))!;
  assert.equal(di3.record.editedAfterImport, true);
  assert.equal(di3.record.overrides.light.line, undefined, '--mxt-line depends on the background');
  // Edit as new draft from an imported version carries its provenance.
  const p2 = await w.s.publish(s.id, 'Ada');
  assert.ok(typeof p2 !== 'string');
  assert.equal(await w.s.editFrom(s.id, 1, 'Ada'), undefined);
  assert.equal((await w.s.store.draftImport(s.id))!.record.carriedFrom, 1);
});
