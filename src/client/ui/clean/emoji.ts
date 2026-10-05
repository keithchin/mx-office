// The Clean themes show no emoji. Rather than touch every string that has one, the Clean font stacks
// start with "AO Blank": a font made here, at load, whose every character is one empty glyph that
// takes no room, registered for the emoji ranges below only (unicode-range). Whatever text an emoji
// is in, the browser draws it with this font, so it comes out as nothing; every other character
// falls through to the next font in the stack as usual.
//
// The ranges are picked character by character where the UI also uses symbols as text: the arrows
// (← ↑ → ↓ ↔ ↗ ↩ ↵ ↺ ↻ ⇥ ⇧), the marks (✓ ✔ ✕ ✖ ✗ ✘ ➤), the carets and shapes (▾ ▸ ▴ ▲ ▼ ▶ ◀ ● ○ ■ ▪),
// box drawing, the key caps (⌘ ⌥ ⌫ ⌦ ⎋ ⏎ ⎇) and the punctuation (· • … – — ″) are never in them
// (tests/clean-theme.test.ts checks).

/** The ranges blanked, as [first, last] code points. */
export const EMOJI_RANGES: readonly (readonly [number, number])[] = [
  [0x200d, 0x200d], // zero width joiner, which glues 👩‍💻 together
  [0x203c, 0x203c], // ‼
  [0x2049, 0x2049], // ⁉
  [0x20e3, 0x20e3], // the keycap's combining square
  [0x2139, 0x2139], // ℹ
  [0x231a, 0x231b], // ⌚ ⌛
  [0x2328, 0x2328], // ⌨
  [0x23cf, 0x23cf], // ⏏
  [0x23e9, 0x23f3], // ⏩ … ⏳
  [0x23f8, 0x23fa], // ⏸ ⏹ ⏺
  [0x24c2, 0x24c2], // Ⓜ
  [0x25fb, 0x25fe], // ◻ ◼ ◽ ◾
  [0x2600, 0x26ff], // the miscellaneous symbols: ☀ ☕ ☰ ⚙ ⚠ ⚡ ⛔ ♪ …
  [0x2700, 0x2712], // ✂ ✅ ✈ ✉ ✊ ✋ ✌ ✍ ✎ ✏ … (✓ ✔ ✕ ✖ ✗ ✘ after it stay)
  [0x2719, 0x2775], // ✨ ✳ ❌ ❓ ❗ ❤ … (the circled numbers after it stay)
  [0x2795, 0x2797], // ➕ ➖ ➗
  [0x27a1, 0x27a1], // ➡
  [0x27b0, 0x27b0], // ➰
  [0x27bf, 0x27bf], // ➿
  [0x2934, 0x2935], // ⤴ ⤵
  [0x2b05, 0x2b07], // ⬅ ⬆ ⬇
  [0x2b1b, 0x2b1c], // ⬛ ⬜
  [0x2b50, 0x2b50], // ⭐
  [0x2b55, 0x2b55], // ⭕
  [0x3030, 0x3030], // 〰
  [0x303d, 0x303d], // 〽
  [0x3297, 0x3297], // ㊗
  [0x3299, 0x3299], // ㊙
  [0xfe0f, 0xfe0f], // the "as an emoji" selector after a symbol
  [0x1f000, 0x1faff], // every pictograph, flag letter, skin tone and emoji block
  [0xe0020, 0xe007f], // the tag letters in a subdivision flag
];

/**
 * Symbols the UI uses as text that are only blanked when U+FE0F follows them, asking for the emoji:
 * ▶ stays a ▶, "▶️" draws as nothing. They're in the font's unicode-range, but only as that pair.
 */
export const EMOJI_WITH_SELECTOR: readonly number[] = [0x2194, 0x2195, 0x2196, 0x2197, 0x2198, 0x2199, 0x21a9, 0x21aa, 0x25aa, 0x25ab, 0x25b6, 0x25c0, 0x2714, 0x2716];

/** Whether code point `c` is blanked. */
export function isEmoji(c: number): boolean {
  for (const [a, b] of EMOJI_RANGES) if (c >= a && c <= b) return true;
  return false;
}

/** The ranges as a CSS unicode-range value. */
export function unicodeRange(): string {
  const hex = (n: number) => n.toString(16).toUpperCase();
  const all = [...EMOJI_RANGES, ...EMOJI_WITH_SELECTOR.map((c) => [c, c] as const)];
  return all.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(', ');
}

/** How many UTF-16 units at `i` in `s` are one blanked character (a pair for one of EMOJI_WITH_SELECTOR), or 0. */
function emojiAt(s: string, i: number): number {
  const c = s.codePointAt(i)!;
  const n = c > 0xffff ? 2 : 1;
  if (isEmoji(c)) return n;
  return EMOJI_WITH_SELECTOR.includes(c) && s.charCodeAt(i + n) === 0xfe0f ? n + 1 : 0;
}

/**
 * How many UTF-16 units of `s` from the start are emoji (and the joiners, selectors and skin tones
 * between them), then any spaces after them: what Clean hides at the front of a label.
 */
export function leadingEmoji(s: string): number {
  let i = 0;
  let any = false;
  while (i < s.length) {
    const n = emojiAt(s, i);
    if (!n) break;
    const c = s.charCodeAt(i);
    if (c !== 0xfe0f && c !== 0x200d) any = true;
    i += n;
  }
  if (!any) return 0;
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** `s` without its emoji, and the spaces round them tidied: for the words a canvas draws. */
export function stripEmoji(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const n = emojiAt(s, i);
    if (n) {
      i += n;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    out += ch;
    i += ch.length;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Whether `s` is only emoji and spaces (and has at least one emoji). */
export function onlyEmoji(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && leadingEmoji(t) === t.length;
}

// ---- The font ------------------------------------------------------------------------------------
// A TrueType font of two empty glyphs (.notdef and the blank), both 0 wide. Its cmap is format 13,
// which maps whole ranges to one glyph, so it stays a few hundred bytes whatever the ranges cover.

const be = (n: number, bytes: number) => {
  const out: number[] = [];
  for (let i = bytes - 1; i >= 0; i--) out.push((n / 2 ** (8 * i)) & 0xff);
  return out;
};
const u16 = (n: number) => be(n & 0xffff, 2);
const u32 = (n: number) => be(n >>> 0, 4);

function utf16be(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(...u16(s.charCodeAt(i)));
  return out;
}

function nameTable(family: string): number[] {
  const names: [number, string][] = [[1, family], [2, 'Regular'], [3, `${family} Regular`], [4, family], [5, 'Version 1.000'], [6, family.replace(/\s+/g, '')]];
  const strings = names.map(([, s]) => utf16be(s));
  const head = [...u16(0), ...u16(names.length), ...u16(6 + 12 * names.length)];
  let off = 0;
  const records: number[] = [];
  names.forEach(([id], i) => {
    records.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strings[i].length), ...u16(off));
    off += strings[i].length;
  });
  return [...head, ...records, ...strings.flat()];
}

const u24 = (n: number) => be(n, 3);

/**
 * The cmap: format 13 maps every range to the blank glyph, and format 14 says the same glyph stands
 * for each of them followed by U+FE0F (the "as an emoji" selector), and for the EMOJI_WITH_SELECTOR
 * symbols only when it follows them. Without that, a browser takes
 * "⚙️" to a font that knows the pair: the color emoji one.
 */
function cmapTable(): number[] {
  const groups = EMOJI_RANGES.flatMap(([a, b]) => [...u32(a), ...u32(b), ...u32(1)]);
  const sub13 = [...u16(13), ...u16(0), ...u32(16 + groups.length), ...u32(0), ...u32(EMOJI_RANGES.length), ...groups];
  // Format 14's default ranges hold at most 256 code points each.
  const runs: number[][] = [];
  for (const [a, b] of EMOJI_RANGES) for (let s = a; s <= b; s += 256) runs.push([...u24(s), Math.min(255, b - s)]);
  const defaults = [...u32(runs.length), ...runs.flat()];
  const others = [...u32(EMOJI_WITH_SELECTOR.length), ...EMOJI_WITH_SELECTOR.flatMap((c) => [...u24(c), ...u16(1)])];
  const sub14Head = 10 + 11;
  const sub14 = [...u16(14), ...u32(sub14Head + defaults.length + others.length), ...u32(1), ...u24(0xfe0f), ...u32(sub14Head), ...u32(sub14Head + defaults.length), ...defaults, ...others];
  const at14 = 4 + 8 * 2;
  const at13 = at14 + sub14.length;
  return [...u16(0), ...u16(2), ...u16(0), ...u16(5), ...u32(at14), ...u16(3), ...u16(10), ...u32(at13), ...sub14, ...sub13];
}

function os2Table(): number[] {
  const first = Math.min(EMOJI_RANGES[0][0], 0xffff);
  return [
    ...u16(4), ...u16(0), ...u16(400), ...u16(5), ...u16(0),
    ...u16(650), ...u16(600), ...u16(0), ...u16(75), ...u16(650), ...u16(600), ...u16(0), ...u16(350), // sub and superscripts
    ...u16(50), ...u16(250), ...u16(0), // strikeout, family class
    ...new Array(10).fill(0), // panose
    ...u32(0), ...u32(0), ...u32(0), ...u32(0), // unicode ranges
    ...[0x4e, 0x4f, 0x4e, 0x45], // vendor "NONE"
    ...u16(0x40), ...u16(first), ...u16(0xffff), // regular, first and last character
    ...u16(800), ...u16(-200), ...u16(0), ...u16(800), ...u16(200), // typo and win metrics
    ...u32(1), ...u32(0), ...u16(500), ...u16(700), ...u16(0), ...u16(32), ...u16(0),
  ];
}

function checksum(b: number[]): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + (((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0)) >>> 0;
  return sum;
}

/** The blank font's bytes, under `family`. */
export function blankFont(family = 'AO Blank'): Uint8Array {
  const head = [
    ...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0x000b), ...u16(1000),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0), // created, modified
    ...u16(0), ...u16(0), ...u16(0), ...u16(0), // the bounding box
    ...u16(0), ...u16(8), ...u16(2), ...u16(0), ...u16(0),
  ];
  const hhea = [...u32(0x00010000), ...u16(800), ...u16(-200), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(1), ...u16(0), ...u16(0), ...new Array(8).fill(0), ...u16(0), ...u16(2)];
  const maxp = [...u32(0x00010000), ...u16(2), ...new Array(26).fill(0)];
  maxp[14 + 1] = 2; // maxZones
  const post = [...u32(0x00030000), ...u32(0), ...u16(-100), ...u16(50), ...new Array(20).fill(0)];
  const tables: [string, number[]][] = [
    ['OS/2', os2Table()],
    ['cmap', cmapTable()],
    ['glyf', [0, 0, 0, 0]],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', new Array(8).fill(0)],
    ['loca', [...u16(0), ...u16(0), ...u16(0)]],
    ['maxp', maxp],
    ['name', nameTable(family)],
    ['post', post],
  ];
  const n = tables.length;
  const dirLen = 12 + 16 * n;
  const out: number[] = [...u32(0x00010000), ...u16(n), ...u16(128), ...u16(3), ...u16(n * 16 - 128)];
  let off = dirLen;
  const body: number[] = [];
  let headAt = 0;
  for (const [tag, data] of tables) {
    const padded = [...data, ...new Array((4 - (data.length % 4)) % 4).fill(0)];
    if (tag === 'head') headAt = off;
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(checksum(padded)), ...u32(off), ...u32(data.length));
    body.push(...padded);
    off += padded.length;
  }
  const all = [...out, ...body];
  const adjust = (0xb1b0afba - checksum(all)) >>> 0;
  all.splice(headAt + 8, 4, ...u32(adjust));
  return Uint8Array.from(all);
}
