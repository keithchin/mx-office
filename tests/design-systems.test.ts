// Design systems, Increment 1 (server/design/, shared/design/): the pure parts and the stores. Branded Atlas
// sets all 40 tokens; publishing freezes a version and its digest; editing starts a new draft; the client's
// default never moves a binding; the theme scan tells plain Atlas, an mxcli theme and a project's own styling
// apart; the pointer line is bounded and only for bound projects; the guidance file and the manifest record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanInput, contrastChecks, DARK_TOKENS, deriveTokens, DEFAULT_INPUT, MXT_TOKENS, tokensCss } from '../src/shared/design/tokens.js';
import { PATTERNS, patternMarkdown } from '../src/shared/design/patterns.js';
import { DESIGN_LINE_MAX, designLine, guidanceText, patternsForTask, taskKindOf } from '../src/shared/design/context.js';
import { DesignStore, themeNameOf } from '../src/server/design/store.js';
import { DesignProjects } from '../src/server/design/projects.js';
import { DesignLines } from '../src/server/design/line.js';
import { scanScss, scanTheme } from '../src/server/design/scan.js';
import { readApplyOutput } from '../src/server/design/apply.js';
import type { ProjectDesignBinding } from '../src/shared/design/types.js';
import { addTaskLineHook, withExtraLines } from '../src/server/tasks/lines.js';

const tmp = (t: { after(fn: () => void): void }) => {
  const d = mkdtempSync(path.join(tmpdir(), 'ao-design-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const COMPAT = { studioPro: '11.12.4', atlas: 'Atlas 3', mxcli: 'nightly-test', themeBase: 'signal' };
const CLIENT = 'pfl_01JA0000000000000000000000';

test('Branded Atlas: the short form gives all 40 --mxt-* tokens, light and dark, deterministically', () => {
  const i = cleanInput({ ...DEFAULT_INPUT, name: 'Acme', primary: '#7F2BD8', font: 'Inter', density: 'compact', corners: 'round' });
  const { light, dark } = deriveTokens(i);
  assert.equal(MXT_TOKENS.length, 40);
  for (const t of MXT_TOKENS) assert.ok(light[t], `light ${t} is set`);
  for (const t of DARK_TOKENS) assert.ok(dark[t], `dark ${t} is set`);
  assert.equal(light.brand, '#7f2bd8');
  assert.equal(light['row-height'], '28px');
  assert.equal(light.radius, '10px');
  assert.match(light.font, /^Inter, system-ui/);
  const css = tokensCss('Acme', i);
  assert.equal((css.match(/^ {2}--mxt-/gm) ?? []).length, 40, 'every light token in the file');
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.equal(css, tokensCss('Acme', i), 'the same form, the same file');
  // Garbage in: defaults, never an unsafe value in the CSS.
  const bad = cleanInput({ primary: 'red;}', font: 'X"; } body { color: red', density: 'huge' });
  assert.equal(bad.primary, DEFAULT_INPUT.primary);
  assert.equal(bad.density, 'comfortable');
  assert.doesNotMatch(tokensCss('x', bad), /[{}]\s*body/);
  const checks = contrastChecks(i);
  assert.ok(checks.some((c) => c.label === 'Button text on primary' && c.ok));
  assert.ok(!contrastChecks({ ...i, text: '#bbbbbb' }).find((c) => c.label === 'Text on cards')!.ok, 'light grey on white fails AA');
});

test('the five administration patterns: stable ids, versions, states, constraints and an Atlas MDL reference', () => {
  assert.deepEqual(PATTERNS.map((p) => p.id), ['admin.search-results', 'admin.details', 'forms.validated', 'admin.approval-status', 'states.empty-loading-error']);
  for (const p of PATTERNS) {
    assert.equal(p.version, 1);
    assert.ok(p.states.length >= 3 && p.constraints.length >= 3, p.id);
    assert.doesNotMatch(p.mdl, /class: '(ds-|dg-|field|input)/, `${p.id} uses Atlas classes only (a token theme can't reach ds.css)`);
    const md = patternMarkdown(p);
    assert.match(md, new RegExp(`\`${p.id.replace('.', '\\.')}@1\``));
    assert.ok(md.length < 1500 * 4, `${p.id} stays within ~1,500 tokens (estimated as chars/4)`);
  }
});

test('publishing freezes a version and its digest; editing starts a new draft; the default never moves a binding', async (t) => {
  const dir = tmp(t);
  const s = new DesignStore(dir, () => 1000);
  const made = await s.saveDraft({ client: CLIENT }, 'branded', { ...DEFAULT_INPUT, name: 'Acme Design System' }, 'Ada');
  assert.ok(typeof made !== 'string');
  const v1 = await s.publish(made.id, 'Ada', COMPAT);
  assert.ok(typeof v1 !== 'string');
  assert.equal(v1.manifest.version, 1);
  assert.equal(v1.manifest.themeName, themeNameOf('Acme Design System', v1.manifest.digest));
  assert.match(v1.manifest.themeName!, /^acme-design-system-[0-9a-f]{8}$/);
  assert.equal(v1.manifest.compat.mxcli, 'nightly-test', 'the mxcli it was made with is pinned in the package');
  const pdir = s.packageDir(made.id, 1);
  const files = readdirSync(pdir).sort();
  assert.deepEqual(files, ['input.json', 'manifest.json', 'patterns', 'summary.md', 'tokens.css']);
  assert.equal(readdirSync(path.join(pdir, 'patterns')).length, 5);
  assert.ok(await s.verify(made.id, 1), 'the files still match the digest');
  const frozen = readFileSync(path.join(pdir, 'tokens.css'), 'utf8');
  assert.equal(await s.publish(made.id, 'Ada', COMPAT), 'Nothing to publish: save a draft first');
  // Edit the published version: a new draft, v1 untouched.
  assert.ok(typeof (await s.editFrom(made.id, 1)) !== 'string');
  await s.saveDraft({ client: CLIENT }, 'branded', { ...DEFAULT_INPUT, name: 'Acme Design System', primary: '#7f2bd8' }, 'Ada');
  const v2 = await s.publish(made.id, 'Ada', COMPAT);
  assert.ok(typeof v2 !== 'string');
  assert.equal(v2.manifest.version, 2);
  assert.notEqual(v2.manifest.digest, v1.manifest.digest);
  assert.equal(readFileSync(path.join(pdir, 'tokens.css'), 'utf8'), frozen, 'v1 never changes');
  // A tampered package fails its digest.
  writeFileSync(path.join(s.packageDir(made.id, 2), 'tokens.css'), 'x');
  assert.equal(await s.verify(made.id, 2), false);
  // The default: approved versions only.
  assert.equal(await s.setDefault(CLIENT, { systemId: made.id, n: 1 }), 'Approve the version before making it the default');
  await s.approve(made.id, 1, 'Ada');
  assert.equal(await s.setDefault(CLIENT, { systemId: made.id, n: 1 }), undefined);
  // A project bound to v1; then the client's default moves to v2: the binding is byte for byte the same.
  const proj = mkdtempSync(path.join(dir, 'proj-'));
  const projects = new DesignProjects(s.root);
  const b: ProjectDesignBinding = { systemId: made.id, name: 'Acme Design System', n: 1, digest: v1.manifest.digest, kind: 'branded', themeName: v1.manifest.themeName, preset: 'administration', approval: { kind: 'wizard', by: 'Ada', at: 1 }, exceptions: [] };
  await projects.bind('floor-1', proj, b);
  const bookBefore = readFileSync(projects.file, 'utf8');
  const fileBefore = readFileSync(path.join(proj, 'agent-office.project.json'), 'utf8');
  await s.approve(made.id, 2, 'Ada');
  assert.equal(s.get(made.id)!.versions[0].status, 'superseded');
  assert.equal(await s.setDefault(CLIENT, { systemId: made.id, n: 2 }), undefined);
  assert.equal(readFileSync(projects.file, 'utf8'), bookBefore, 'the office book of bindings is untouched');
  assert.equal(readFileSync(path.join(proj, 'agent-office.project.json'), 'utf8'), fileBefore, 'the project file is untouched');
  // And after a restart, everything reads back.
  const again = new DesignStore(dir);
  await again.load();
  assert.deepEqual(again.defaultOf(CLIENT), { systemId: made.id, n: 2 });
  const p2 = new DesignProjects(again.root);
  await p2.load();
  assert.equal(p2.binding('floor-1')!.n, 1);
});

test('the theme scan: plain Atlas, an mxcli theme, overrides that would be shadowed, custom rules, theme modules', async (t) => {
  const stock = '$brand-logo: false;\n:root {\n  /* Brand Colors */\n  --brand-primary: #264ae5;\n  --gray: #B8BABF;\n}\n$use-css-variables: true;\n@import "../../themesource/atlas_core/web/variables";\n';
  const main = '@import "custom-variables";\n@import "theme-dark";\n@import "theme-neutral";\n';
  const app = (cv: string, mn: string, extra?: (d: string) => void) => {
    const d = tmp(t);
    mkdirSync(path.join(d, 'theme', 'web'), { recursive: true });
    mkdirSync(path.join(d, 'themesource', 'atlas_core', 'web'), { recursive: true });
    writeFileSync(path.join(d, 'theme', 'web', 'custom-variables.scss'), cv);
    writeFileSync(path.join(d, 'theme', 'web', 'main.scss'), mn);
    writeFileSync(path.join(d, 'theme', 'web', '_theme-dark.scss'), ':root { --bg-color: #000; }\n');
    extra?.(d);
    return d;
  };
  assert.equal((await scanTheme(app(stock, main))).start, 'atlas', "Atlas's own defaults are not an override");
  const fenced = `${stock}// mxcli:theme:begin signal v1 — generated\n:root { --mxt-brand: #0f6e6b; }\n// mxcli:theme:end signal 0123456789abcdef\n`;
  const s1 = await scanTheme(app(fenced, main));
  assert.equal(s1.start, 'mxcli:signal');
  assert.deepEqual(s1.fences.signal, { 'theme/web/custom-variables.scss': '0123456789abcdef' });
  const s2 = await scanTheme(app(stock.replace('#264ae5', '#6a1b9a'), `${main}.legacy-banner { color: red; }\n`, (d) => {
    mkdirSync(path.join(d, 'themesource', 'acmecustom', 'web'), { recursive: true });
    writeFileSync(path.join(d, 'themesource', 'acmecustom', 'web', 'main.scss'), '.x { color: red; }\n');
  }));
  assert.equal(s2.start, 'custom');
  assert.deepEqual(s2.overrides.map((o) => [o.file, o.name]), [['theme/web/custom-variables.scss', '--brand-primary']]);
  assert.deepEqual(s2.custom, ['theme/web/main.scss']);
  assert.deepEqual(s2.modules, ['themesource/acmecustom']);
  assert.equal((await scanTheme(tmp(t))).noTheme, true);
  assert.deepEqual(scanScss('// mxcli:theme:begin a v1\n--brand-primary: red;\n// mxcli:theme:end a 00ff00ff00ff00ff\n').overrides, [], 'inside a fence is the theme’s own');
});

test('mxcli’s apply output: a `skipped` block (exit 0) is a refusal; per-file lines are read', () => {
  const ok = readApplyOutput("Theme 'acme'\n  created   theme/web/_mxcli-acme.scss\n  added     theme/web/main.scss\n");
  assert.deepEqual(ok.refused, []);
  assert.equal(ok.files.length, 2);
  const no = readApplyOutput("  unchanged theme/web/main.scss\n  skipped   theme/web/custom-variables.scss\ntheme/web/custom-variables.scss: the 'acme' block has local edits, so it was left alone\n");
  assert.equal(no.refused.length, 2);
});

test('patterns for a task: its issue’s selections, else the project-wide ones; never another issue’s', () => {
  const at = 1;
  const sel = [
    { patternId: 'forms.validated', version: 1, scope: { issue: 7 }, by: 'Ada', at },
    { patternId: 'admin.details', version: 1, scope: { issue: 9 }, by: 'Ada', at },
    { patternId: 'states.empty-loading-error', version: 1, scope: { project: true as const }, by: 'Ada', at },
  ];
  assert.deepEqual(patternsForTask(sel, 7), ['forms.validated']);
  assert.deepEqual(patternsForTask(sel, 8), ['states.empty-loading-error']);
  assert.deepEqual(patternsForTask(sel, undefined), ['states.empty-loading-error']);
  assert.deepEqual(patternsForTask([], 7), []);
});

test('the Design line: at most 300 characters, never cuts the guidance path; the task kind', () => {
  const b = { name: 'Acme Design System', n: 1, digest: 'f'.repeat(64), kind: 'branded' as const };
  const line = designLine(b, ['forms.validated'], 'C:/office/data/design-systems/guidance/f/abc.md');
  assert.match(line, /^Design: Acme Design System@v1 #fffffff \(Branded Atlas, administration\)\. Patterns: forms\.validated\. Read C:\/office/);
  assert.ok(line.length <= DESIGN_LINE_MAX);
  const long = designLine({ ...b, name: 'N'.repeat(200) }, PATTERNS.map((p) => p.id), `C:/${'x'.repeat(120)}/g.md`);
  assert.ok(long.length <= DESIGN_LINE_MAX, `${long.length}`);
  assert.ok(long.includes(`C:/${'x'.repeat(120)}/g.md`), 'the path is whole');
  assert.equal(taskKindOf('Fix pass on the visitor page styling', 'lead-developer'), 'design-correction');
  assert.equal(taskKindOf('Wireframes for Stage 3', 'lead-designer'), 'design');
  assert.equal(taskKindOf('Run the tests', 'lead-developer', 'ui-ux-designer'), 'design');
  assert.equal(taskKindOf('Build the domain model', 'lead-developer'), 'other');
});

test('the line provider: only bound projects get a line; the guidance file and the manifest record what was supplied', async (t) => {
  const dir = tmp(t);
  const root = path.join(dir, 'design-systems');
  const projects = new DesignProjects(root);
  const lines = new DesignLines(root, dir, projects, (id, n) => path.join(root, 'packages', id, `v${n}`), () => 5);
  assert.equal(lines.line({ floorId: 'f1', taskId: 'tsk_X', text: 'Build', issue: 7 }), undefined, 'no binding, no line');
  const b: ProjectDesignBinding = { systemId: 'dsg_01JA0000000000000000000000', name: 'Acme', n: 1, digest: 'a'.repeat(64), kind: 'branded', themeName: 'acme-aaaaaaaa', preset: 'administration', approval: { kind: 'wizard', by: 'Ada', at: 1 }, exceptions: [] };
  await projects.bind('f1', undefined, b);
  await projects.select('f1', { patternId: 'forms.validated', version: 1, scope: { issue: 7 }, by: 'Ada', at: 2 });
  await lines.prepare('f1');
  const line = lines.line({ floorId: 'f1', taskId: 'tsk_X', text: 'Build the form', issue: 7 })!;
  assert.match(line, /Patterns: forms\.validated\./);
  assert.equal(lines.line({ floorId: 'f2', taskId: 'tsk_Y', text: 'x' }), undefined, 'another project, no line');
  await lines.settled('f1');
  const rec = readFileSync(lines.manifestFile('f1'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rec.length, 1);
  assert.deepEqual([rec[0].taskId, rec[0].n, rec[0].digest, rec[0].patternIds], ['tsk_X', 1, 'a'.repeat(64), ['forms.validated']]);
  assert.ok(!('read' in rec[0]) && !('understood' in rec[0]), 'supplied, never "read"');
  const guidance = readFileSync(rec[0].guidance, 'utf8');
  assert.match(guidance, /skip the toolkit design-artifacts token→Atlas mapping/);
  assert.match(guidance, /At most 2 automated design-correction attempts/);
  assert.match(guidance, /# List with search|# Validated form/);
  // The same inputs name the same file (deterministic); another issue gets the summary only.
  assert.equal(lines.guidance('f1', b, ['forms.validated']).file, lines.guidance('f1', b, ['forms.validated']).file);
  assert.doesNotMatch(lines.line({ floorId: 'f1', taskId: 'tsk_Z', text: 'x', issue: 8 })!, /Patterns:/);
  // Through tasks/lines.ts: the line goes under the Task line, once.
  const off = addTaskLineHook((x) => lines.line(x));
  t.after(off);
  const text = withExtraLines('Build the form.\n\nTask: tsk_X', { floorId: 'f1', taskId: 'tsk_X', text: 'Build', issue: 7 });
  assert.equal(text.split('\n').at(-1), line);
  assert.equal(withExtraLines(text, { floorId: 'f1', taskId: 'tsk_X', text: 'Build', issue: 7 }), text, 'not twice');
  assert.equal(withExtraLines('Hello', { floorId: 'nobound', taskId: 'tsk_Q', text: 'x' }), 'Hello');
  assert.ok(existsSync(path.dirname(rec[0].guidance)));
  assert.match(guidanceText(b, 'C:/p', []), /`admin\.details@1`/);
  await lines.settled('f1');
});

test('the Playbook rule: only on a bound project, for the Lead Designer, the Lead Developer and the Solo Lead', async () => {
  const { playbook } = await import('../src/server/roster/playbooks.js');
  const { ROLES } = await import('../src/shared/roster/roles.js');
  const names = Object.fromEntries(ROLES.map((r) => [r.id, r.id.toUpperCase()])) as never;
  const base = { project: 'p', name: 'Dee', level: 2 as const, lessons: 'L.md', names };
  const RULE = 'When a task has a `Design:` line';
  for (const role of ['lead-designer', 'lead-developer', 'solo-lead'] as const) {
    assert.ok(!playbook(role, base).includes(RULE), `${role}: no binding, no rule (the Playbook is as before)`);
    assert.ok(playbook(role, { ...base, designBound: true }).includes(RULE), `${role}: bound, the rule`);
  }
  assert.ok(!playbook('lead-tester', { ...base, designBound: true }).includes(RULE));
});

test('Capture now finds the newest installed Chromium when playwright-core expects a build that isn’t there', async (t) => {
  const { installedChromium } = await import('../src/server/design/capture.js');
  const root = tmp(t);
  mkdirSync(path.join(root, 'chromium_headless_shell-1243'), { recursive: true });
  mkdirSync(path.join(root, 'chromium-1248', 'chrome-win64'), { recursive: true });
  writeFileSync(path.join(root, 'chromium-1248', 'chrome-win64', 'chrome.exe'), '');
  assert.equal(await installedChromium({ PLAYWRIGHT_BROWSERS_PATH: root }), path.join(root, 'chromium-1248', 'chrome-win64', 'chrome.exe'));
  assert.equal(await installedChromium({ PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'none') }), undefined);
});
