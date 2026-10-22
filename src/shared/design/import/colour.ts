// Colours as a design folder writes them (#rgb, #rrggbb(aa), rgb()/rgba(), hsl()/hsla(), a few names),
// made into the #rrggbb the Branded Atlas form takes, plus the hue and saturation the mapping uses to
// guess a status colour from literals. Pure: the scanner, the mapping and the tests import it.

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  orange: '#ffa500',
  purple: '#800080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  yellow: '#ffff00',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  dimgray: '#696969',
  dimgrey: '#696969',
  crimson: '#dc143c',
  tomato: '#ff6347',
  gold: '#ffd700',
  royalblue: '#4169e1',
  dodgerblue: '#1e90ff',
  steelblue: '#4682b4',
  slategray: '#708090',
  slategrey: '#708090',
  seagreen: '#2e8b57',
  forestgreen: '#228b22',
  darkorange: '#ff8c00',
  firebrick: '#b22222',
  indigo: '#4b0082',
  ivory: '#fffff0',
  snow: '#fffafa',
  ghostwhite: '#f8f8ff',
  aliceblue: '#f0f8ff',
};

const clamp = (v: number, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const hex2 = (v: number) => Math.round(clamp(v)).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A number or a percentage of `full`. */
const num = (s: string, full: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * full : parseFloat(s));

/**
 * One colour value as #rrggbb, or undefined when it isn't a single plain colour (a gradient, a function the
 * office can't work out, a mostly transparent colour). Alpha below 0.5 counts as not a colour.
 */
export function toHexColour(raw: string): string | undefined {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const d = m[1];
    if (d.length === 3 || d.length === 4) {
      if (d.length === 4 && parseInt(d[3] + d[3], 16) < 128) return undefined;
      return `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}`;
    }
    if (d.length === 6) return `#${d}`;
    if (d.length === 8) return parseInt(d.slice(6), 16) < 128 ? undefined : `#${d.slice(0, 6)}`;
    return undefined;
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return undefined;
    const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
    if (!(alpha >= 0.5)) return undefined;
    if (m[1].startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
      return [r, g, b].every(Number.isFinite) ? toHex(r, g, b) : undefined;
    }
    const h = parseFloat(parts[0].replace(/deg$/, ''));
    const s = num(parts[1].endsWith('%') ? parts[1] : `${parts[1]}%`, 1);
    const l = num(parts[2].endsWith('%') ? parts[2] : `${parts[2]}%`, 1);
    if (![h, s, l].every(Number.isFinite)) return undefined;
    return toHex(...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)));
  }
  return NAMED[v];
}

/** Every plain colour written in a value (`1px solid #ddd`, `linear-gradient(#fff, rgb(0 0 0))`), as #rrggbb. */
export function coloursIn(value: string): string[] {
  const out: string[] = [];
  const re = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-zA-Z]+\b/g;
  for (const m of value.matchAll(re)) {
    const w = m[0];
    if (/^[a-zA-Z]+$/.test(w) && !NAMED[w.toLowerCase()]) continue;
    const h = toHexColour(w);
    if (h) out.push(h);
  }
  return out;
}

/** Hue (0..360), saturation and lightness (0..1) of a #rrggbb. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/** Saturated enough to be a brand or status colour, not a grey. */
export const isChromatic = (hex: string) => {
  const c = hsl(hex);
  return c.s >= 0.3 && c.l > 0.12 && c.l < 0.9;
};

/** Which status a hue reads as (red, amber, green, blue), if it's saturated enough. */
export function hueFamily(hex: string): 'danger' | 'warning' | 'success' | 'info' | undefined {
  if (!isChromatic(hex)) return undefined;
  const { h } = hsl(hex);
  if (h >= 345 || h < 15) return 'danger';
  if (h >= 25 && h < 60) return 'warning';
  if (h >= 85 && h < 165) return 'success';
  if (h >= 185 && h < 235) return 'info';
  return undefined;
}
