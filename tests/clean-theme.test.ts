import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLOR_THEMES, isTheme, THEME_LABEL } from '../src/client/ui/colortheme.js';
import { blankFont, EMOJI_RANGES, EMOJI_WITH_SELECTOR, isEmoji, leadingEmoji, onlyEmoji, stripEmoji, unicodeRange } from '../src/client/ui/clean/emoji.js';
import { ICONS, iconFor, iconSheet } from '../src/client/ui/clean/icons.js';

const root = path.join(import.meta.dirname, '..');

test('the themes are the three old ones, then the two Clean ones, in the 🎨 list’s order', () => {
  assert.deepEqual([...COLOR_THEMES], ['default', 'dark', 'terminal', 'clean-light', 'clean-dark']);
  assert.equal(THEME_LABEL['clean-light'], 'Clean (Light)');
  assert.equal(THEME_LABEL['clean-dark'], 'Clean (Dark)');
  assert.ok(isTheme('clean-dark'));
  assert.ok(!isTheme('clean'));
  assert.ok(!isTheme(null));
});

test('every page that sets the theme before it draws knows every theme', () => {
  for (const page of ['lite.html', 'pixel.html', 'home.html']) {
    const html = readFileSync(path.join(root, 'src/client', page), 'utf8');
    const script = html.match(/<script>try\{var t=localStorage\.getItem\("agent-office\.color-theme"\);(.*?)<\/script>/)?.[1];
    assert.ok(script, `${page} has its early theme script`);
    for (const t of COLOR_THEMES) assert.ok(script.includes(`"${t}"`), `${page} lets ${t} through`);
  }
});

test('the blanked ranges never take the arrows, marks, carets, box drawing or key caps the UI draws as text', () => {
  const kept = '←↑→↓↔↗↘↩↪↵↺↻⇥⇧·•…–—✓✔✕✖✗✘➤▾▸▴▲▼▶◀●○■▪─│├┤┌┐└┘═╔╗█⌘⌥⌫⌦⎋⏎⎇⟳⟵⟶−≥₂‹›';
  for (const ch of kept) assert.ok(!isEmoji(ch.codePointAt(0)!), `${ch} (U+${ch.codePointAt(0)!.toString(16)}) stays`);
  for (const c of 'abcXYZ019 #*') assert.ok(!isEmoji(c.codePointAt(0)!));
  for (const ch of ['🎛', '🤖', '✅', '⚙', '☰', '✨', '❌', '⏳', '⬆', '⭐', '🇸', '🏽', '‍', '️']) assert.ok(isEmoji(ch.codePointAt(0)!), `${ch} is blanked`);
  // The ranges are in order and don't overlap.
  for (let i = 1; i < EMOJI_RANGES.length; i++) assert.ok(EMOJI_RANGES[i][0] > EMOJI_RANGES[i - 1][1]);
  // The ones only blanked before the emoji selector are kept on their own.
  for (const c of EMOJI_WITH_SELECTOR) assert.ok(!isEmoji(c));
  assert.match(unicodeRange(), /^U\+200D, .*U\+1F000-1FAFF, .*U\+25B6/);
});

test('an emoji leading a label is found with its space, joiners, selectors and skin tones', () => {
  assert.equal(leadingEmoji('🎛️ Command Center'), 4);
  assert.equal(leadingEmoji('👩‍💻 Dev'), 6);
  assert.equal(leadingEmoji('👋🏽  hi'), 6);
  assert.equal(leadingEmoji('▶️ Run'), 3);
  assert.equal(leadingEmoji('▶ Run'), 0);
  assert.equal(leadingEmoji('→ next'), 0);
  assert.equal(leadingEmoji('Board'), 0);
  assert.equal(leadingEmoji('️ x'), 0);
  assert.ok(onlyEmoji(' 🔔 '));
  assert.ok(!onlyEmoji('🔔 3 new'));
  assert.ok(!onlyEmoji(''));
  assert.equal(stripEmoji('⚖️ Router · Jeff'), 'Router · Jeff');
  assert.equal(stripEmoji("I'm stuck 🤔 which → ✓ ▶️ ▶"), "I'm stuck which → ✓ ▶");
});

test('the blank font is a TrueType font with a format 13 and a format 14 cmap over the ranges', () => {
  const b = blankFont();
  const v = new DataView(b.buffer);
  assert.equal(v.getUint32(0), 0x00010000);
  const n = v.getUint16(4);
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...b.slice(at, at + 4)), { off: v.getUint32(at + 8), len: v.getUint32(at + 12) });
  }
  assert.deepEqual([...tables.keys()], ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
  for (const { off, len } of tables.values()) assert.ok(off % 4 === 0 && off + len <= b.length);
  // The whole font sums to the magic number once head's adjustment is in.
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  const cmap = tables.get('cmap')!.off;
  assert.equal(v.getUint16(cmap + 2), 2);
  const sub14 = cmap + v.getUint32(cmap + 8);
  const sub13 = cmap + v.getUint32(cmap + 16);
  assert.equal(v.getUint16(sub14), 14);
  assert.equal(v.getUint16(sub13), 13);
  assert.equal(v.getUint32(sub13 + 12), EMOJI_RANGES.length);
  EMOJI_RANGES.forEach(([a, z], i) => {
    assert.equal(v.getUint32(sub13 + 16 + i * 12), a);
    assert.equal(v.getUint32(sub13 + 20 + i * 12), z);
    assert.equal(v.getUint32(sub13 + 24 + i * 12), 1);
  });
  // Every glyph is 0 wide.
  const hmtx = tables.get('hmtx')!.off;
  assert.equal(v.getUint16(hmtx), 0);
  assert.equal(v.getUint16(hmtx + 4), 0);
});

test('an emoji-only button gets a line icon, whatever selector or skin tone it has', () => {
  assert.equal(iconFor('🔔'), 'bell');
  assert.equal(iconFor(' 🏠 '), 'home');
  assert.equal(iconFor('🎨'), 'palette');
  assert.equal(iconFor('☰'), 'menu');
  assert.equal(iconFor('⚙️'), 'gear');
  assert.equal(iconFor('✋🏽'), 'hand');
  assert.equal(iconFor('✕'), 'close');
  assert.equal(iconFor('Board'), undefined);
  for (const [name, body] of Object.entries(ICONS)) assert.match(body, /^<(path|circle) /, `${name} is SVG shapes`);
  const sheet = iconSheet();
  assert.match(sheet, /html\[data-theme\^='clean'\] \[data-ao-icon='bell'\]::before \{ -webkit-mask-image: url\("data:image\/svg\+xml,/);
});
