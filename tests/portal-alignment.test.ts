// The Portal pages' alignment fixes (scripts/check-alignment.mjs measures them in a browser: glyphs centred
// in their buttons and avatars, rows on one line, sibling controls one height, nothing off the window).
// Here, the rules that keep them so, and the band on the Overview only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('the avatar is a 32 px circle like the icons beside it, its initials centred (no gap for the hidden ☰)', () => {
  const css = read('src/client/ui/portal/topbar.css');
  const rule = css.match(/#menu\.pt-avatar \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /width: 32px; height: 32px; min-height: 32px/);
  assert.match(rule, /gap: 0/);
  assert.match(rule, /justify-content: center; align-items: center/);
});

test('a modal’s ✕ has no gap either: its line icon sits in the middle of the button', () => {
  assert.match(read('src/client/styles/theme-portal-parts.css'), /body\.lite\.lite \.close \{[^}]*gap: 0; justify-content: center; align-items: center;/);
  assert.match(read('src/client/styles/theme-clean-parts.css'), /body\.lite \.close \{[^}]*gap: 0; justify-content: center; align-items: center;/);
  assert.match(read('src/client/styles/theme-clean-parts.css'), /header\.lite-bar :is\(#to-home, \.lite-theme, \.lite-menu\) \{ gap: 0; \}/);
});

test('the bell is drawn in the middle of its 16 px box', () => {
  const bell = read('src/client/ui/portal/icons.ts').match(/bell: '([^']*)'/)?.[1] ?? '';
  // Its body from y 2.65 to its clapper's 14.1 (with the stroke): the middle at 8, the box's.
  assert.match(bell, /M4 10\.65V6\.65a4 4 0 0 1 8 0/);
  assert.match(bell, /M6\.6 13\.35a1\.6 1\.6 0 0 0 2\.8 0/);
});

test('Needs you is the Overview’s card in the main column; the strip steps aside there (its tab count stays)', () => {
  const css = read('src/client/ui/portal/overview.css');
  // The id twice outweighs command-layout.css's whole-width rule (two ids through :has).
  assert.match(css, /\.lite-main\.on-command > #needs-you#needs-you \{ display: none; \}/);
  assert.match(read('src/client/ui/command-layout.css'), /#needs-you:has\(\+ #setup:empty\)/, 'the strip keeps its place in the other themes');
  // The card is in the main column, beside the right-hand cards, and goes under them when the page is narrow (the panel open).
  assert.match(css, /\.lite-main\.on-command > #summary \{ grid-column: 1; grid-row: 5; min-width: 0; \}/);
  assert.match(css, /\.lite-main\.on-command > \.pt-ov-side \{ grid-column: 2; grid-row: 5; align-self: start; \}/);
  assert.match(css, /@container ov \(max-width: 680px\)/);
  assert.match(read('src/client/ui/portal/overview.ts'), /const main = h\('div\.pt-ov-main\.pt-only', \{\}, needs\.el, brief\.el\);/);
});

test('the Progress card’s stage names wrap onto a second line instead of being cut off; the whole name is in the tooltip', () => {
  const css = read('src/client/ui/portal/overview.css');
  const name = css.match(/\.pt-prog \.pg-seg-n \{([^}]*)\}/)?.[1] ?? '';
  assert.match(name, /-webkit-line-clamp: 2/);
  assert.match(name, /overflow-wrap: anywhere/);
  assert.doesNotMatch(name, /white-space: nowrap|text-overflow: ellipsis/);
  assert.match(css, /\.pt-prog \.pg-seg \{[^}]*white-space: normal;/);
  // The bar's tooltip (the segment's hover and focus) has the whole name and what was measured.
  assert.match(read('src/client/ui/progress/index.ts'), /root\.addEventListener\('focusin', enter\);/);
});

test('the band (floor line, budget, run state, progress bar) is on the Overview only; the other pages keep the gap under their header', () => {
  const ts = read('src/client/ui/portal/pagehead.ts');
  assert.match(ts, /band\.classList\.toggle\('pt-band-off', !overview\);/);
  const css = read('src/client/ui/portal/pagehead.css');
  assert.match(css, /body\.lite \.pt-band\.pt-band-off \{ display: none; \}/);
  assert.match(css, /body\.lite \.pt-head:not\(\.pt-head-ov\) \{ margin-bottom: 24px; \}/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.pt-head:not\(\.pt-head-ov\) \{ margin-bottom: 16px; \}/);
  // Only in Portal: every rule for it is under a Portal theme.
  for (const line of css.split('\n').filter((l) => l.includes('pt-band-off'))) assert.match(line, /html\[data-theme\^='portal'\]/);
});

test('the 2D Office view on a phone: the project name gives way in the bar, the zoom buttons wrap instead of running off', () => {
  const css = read('src/client/pixel.css');
  assert.match(css, /@media \(max-width: 760px\) \{ html\[data-theme\^='portal'\] body\.pixel\.lite header\.lite-bar \.lite-floor \{ flex: 1 1 auto; min-width: 64px; \} \}/);
  assert.match(css, /@media \(max-width: 640px\) \{ \.px-toolbar \{[^}]*flex-wrap: wrap; \}/);
  assert.match(css, /\.px-project :is\(\.bud-chip, \.pr-toggle\) \{ height: 28px; min-height: 28px; \}/);
});

test('the Budget page’s fields, selects and check line up', () => {
  const css = read('src/client/ui/budget/budget.css');
  assert.match(css, /\.bud-row > :is\(input, select, \.btn\) \{ align-self: stretch; \}/);
  assert.match(css, /html\[data-theme\^='portal'\] \.bud-fields > \.bud-check \{ min-height: 31px; \}/);
});
