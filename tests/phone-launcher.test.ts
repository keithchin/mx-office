// The team phone's launcher icon in every theme (ui/phone/phone.css, frame.ts): its messages icon is
// stroked with the launcher's own foreground (--tp-fg), never currentColor, because the Clean themes give
// every button their ink (styles/theme-clean.css), which once made the icon the launcher's own colour and
// so invisible. Checked from the sheets themselves: the rule that wins in Clean, and that the icon's
// stroke and the disc it sits on differ enough to see, in Default, Dark, Terminal and both Cleans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const phone = read('src/client/ui/phone/phone.css');
const frame = read('src/client/ui/phone/frame.ts');
const sheets = { base: read('src/client/styles/base.css'), themes: read('src/client/styles/themes.css'), clean: read('src/client/styles/theme-clean.css'), portal: read('src/client/styles/theme-portal.css') };
/** The Clean family's selector: the Clean pair and the Portal pair, which wears Clean's shapes. */
const FAMILY = "html:is([data-theme^='clean'], [data-theme^='portal'])";

/** The custom properties set in the first block whose selector is exactly `sel`. */
function tokens(css: string, sel: string): Record<string, string> {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, `no ${sel} block`);
  const body = css.slice(at, css.indexOf('\n}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const THEMES: Record<string, Record<string, string>> = {
  default: tokens(sheets.base, ':root'),
  dark: { ...tokens(sheets.base, ':root'), ...tokens(sheets.themes, "html[data-theme='dark']") },
  terminal: { ...tokens(sheets.base, ':root'), ...tokens(sheets.themes, "html[data-theme='terminal']") },
  'clean-light': { ...tokens(sheets.base, ':root'), ...tokens(sheets.clean, FAMILY), ...tokens(sheets.clean, "html[data-theme='clean-light']") },
  'clean-dark': { ...tokens(sheets.base, ':root'), ...tokens(sheets.clean, FAMILY), ...tokens(sheets.clean, "html[data-theme='clean-dark']") },
  'portal-light': { ...tokens(sheets.base, ':root'), ...tokens(sheets.clean, FAMILY), ...tokens(sheets.portal, "html[data-theme^='portal']"), ...tokens(sheets.portal, "html[data-theme='portal-light'],\nhtml[data-theme='portal-light'] :is(.pt-pagecolors, .lite-bar .vp-list, .dx-bar .dx-results)") },
  'portal-dark': { ...tokens(sheets.base, ':root'), ...tokens(sheets.clean, FAMILY), ...tokens(sheets.portal, "html[data-theme^='portal']"), ...tokens(sheets.portal, "html[data-theme='portal-dark'],\nhtml[data-theme='portal-dark'] :is(.pt-pagecolors, .lite-bar .vp-list, .dx-bar .dx-results)") },
};

/** A value with its var()s looked up, down to a colour. */
function resolve(v: string, t: Record<string, string>, depth = 0): string {
  const m = /^var\(--([\w-]+)(?:,\s*([^)]+))?\)$/.exec(v.trim());
  if (!m || depth > 8) return v.trim();
  return resolve(t[m[1]] ?? m[2] ?? '', t, depth + 1);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `a hex colour, not ${hex}`);
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** The value of `prop` for the rules of `css` whose selector is exactly `sel`, the last one setting it winning. */
function prop(css: string, sel: string, name: string): string | undefined {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel);
  const re = new RegExp(`(?:^|;|\\s)${name.replace(/[-]/g, '\\-')}:\\s*([^;]+)`);
  let out: string | undefined;
  for (const r of rules) out = re.exec(r[2])?.[1].trim() ?? out;
  return out;
}

test('the launcher has its line icon, stroked with its own foreground rather than the button colour', () => {
  assert.match(frame, /h\('span\.tp-ico-line', \{\}, svg\('0 0 22 20', 'tp-line-icon', LINE_ICON\)\)/);
  assert.match(frame, /const LINE_ICON = '<path d="M3 4\.5h12/);
  assert.equal(prop(phone, '.tp-line-icon', 'stroke'), 'var(--tp-fg)');
  assert.equal(prop(phone, '.tp-line-icon', 'fill'), 'none');
  // Shown everywhere but the Default theme (which shows the pixel phone).
  assert.equal(prop(phone, '.tp-ico-line', 'display'), 'grid');
});

test('in each theme the icon stands out from the disc it sits on', () => {
  const cleanRule = `${FAMILY} body.lite button.tp-launch`;
  for (const [name, t] of Object.entries(THEMES)) {
    const clean = name.startsWith('clean') || name.startsWith('portal');
    const bg = resolve(clean ? prop(phone, cleanRule, '--tp-bg')! : prop(phone, '.tp-launch', '--tp-bg')!, t);
    const fg = resolve(clean ? prop(phone, cleanRule, '--tp-fg')! : prop(phone, '.tp-launch', '--tp-fg')!, t);
    assert.ok(fg !== 'transparent' && fg !== 'currentColor', `${name}: a real stroke colour`);
    assert.ok(contrast(fg, bg) >= 3, `${name}: icon ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});

test('in Clean the launcher’s own rule outranks the theme’s rule for every button', () => {
  // theme-clean.css: html[data-theme^='clean'] :is(input, textarea, select, button) { color: var(--ink) } is
  // (0,2,1); the launcher's Clean rule is (0,3,3), and it sets the icon colour itself anyway.
  assert.match(sheets.clean, /html:is\(\[data-theme\^='clean'\], \[data-theme\^='portal'\]\) :is\(input, textarea, select, button\) \{[^}]*color: var\(--ink\)/);
  const rule = `${FAMILY} body.lite button.tp-launch`;
  assert.ok(prop(phone, rule, '--tp-fg'), 'Clean sets the icon colour');
  assert.equal(prop(phone, rule, 'color'), 'var(--tp-fg)');
  // The emoji-blanking font never touches it: the icon is SVG, not a character.
  assert.doesNotMatch(frame.slice(frame.indexOf('const LINE_ICON'), frame.indexOf('const BATTERY')), /[\u{1F300}-\u{1FAFF}☀-➿]/u);
});
