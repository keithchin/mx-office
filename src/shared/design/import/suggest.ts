// The mapping from what a folder defines to the Branded Atlas form (shared/design/import/types.ts). The folder's
// own --mxt-* tokens are taken as they are (checked against mxcli's vocabulary); otherwise each form field gets
// candidates from names (`--primary`, `--color-bg`, `$text`, `color.danger`) and, failing those, from how often
// a colour is written and where (page background, text, borders, saturated colours by hue). Best first, each
// with its source and a confidence. Pure: the server suggests, the page re-ranks nothing.

import { MXT_TOKENS, type MxtToken, type TokenMap } from '../tokens.js';
import type { Corners, Density } from '../types.js';
import { hsl, hueFamily, isChromatic, toHexColour } from './colour.js';
import { COLOUR_FIELDS, FIELDS, UNMAPPED_MAX, type Candidate, type ColourField, type Confidence, type FieldId, type FoundVar, type ImportScan, type ImportSuggestion, type SrcLoc } from './types.js';

/** A name's words: `--colorTextPrimary` → color, text, primary. */
export const wordsOf = (name: string) =>
  name
    .replace(/^(--|\$|meta:)/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** The words that say a colour's job (property words) and the ones that say which one (role words). */
const PROP: Record<'background' | 'surface' | 'text' | 'border', string[]> = {
  background: ['background', 'bg', 'ground', 'canvas', 'page', 'backdrop'],
  surface: ['surface', 'card', 'panel', 'paper', 'container', 'elevated', 'raised', 'sheet'],
  text: ['text', 'ink', 'foreground', 'fg', 'copy', 'body-color'],
  border: ['border', 'line', 'divider', 'outline', 'stroke', 'separator'],
};
const ROLE: Record<'primary' | 'success' | 'warning' | 'danger' | 'info', { strong: string[]; weak: string[]; hue: string[] }> = {
  primary: {
    strong: ['primary', 'brand'],
    weak: ['accent', 'main', 'theme', 'cta', 'link'],
    hue: [],
  },
  success: {
    strong: ['success', 'positive'],
    weak: ['ok', 'valid', 'done'],
    hue: ['green'],
  },
  warning: {
    strong: ['warning', 'warn', 'caution'],
    weak: ['attention', 'pending'],
    hue: ['amber', 'yellow', 'orange'],
  },
  danger: {
    strong: ['danger', 'error', 'negative', 'destructive', 'critical'],
    weak: ['alert', 'invalid'],
    hue: ['red'],
  },
  info: {
    strong: ['info', 'informative', 'notice', 'information'],
    weak: ['help'],
    hue: ['blue', 'cyan'],
  },
};
const STATUS_WORDS = new Set([...ROLE.success.strong, ...ROLE.warning.strong, ...ROLE.danger.strong, ...ROLE.info.strong]);
/** Words that make a value a variant, not the one: hover states, tints, secondary greys. */
const VARIANT = new Set(['hover', 'active', 'focus', 'pressed', 'disabled', 'light', 'lighter', 'lightest', 'darker', 'darkest', 'subtle', 'muted', 'soft', 'tint', 'emphasis', 'contrast', 'secondary', 'tertiary', 'alt', 'inverse', 'inverted', 'weak', 'strong', 'placeholder', 'shadow', 'overlay', 'selected', 'highlight', 'faint']);
const MAIN = new Set(['500', '600', 'default', 'base', 'main', 'primary']);
const SHADE = /^(50|[1-9]00|950|[1-9]0)$/;

interface Scored {
  v: FoundVar;
  score: number;
  why: string;
}

function propScore(field: keyof typeof PROP, w: string[], v: FoundVar): Scored | undefined {
  const name = w.join('-');
  if (w[0] === 'on') return field === 'text' && w.some((x) => x === 'background' || x === 'surface' || x === 'bg') ? { v, score: 2, why: `named ${v.name} (text on the page)` } : undefined;
  const hit = PROP[field].some((p) => (p.includes('-') ? name.includes(p) : w.includes(p)));
  if (!hit) return undefined;
  if (w.some((x) => STATUS_WORDS.has(x))) return undefined;
  // `--text` and `--bg` are colours of their own; a background that's also called text is neither.
  for (const [other, words] of Object.entries(PROP)) if (other !== field && !(field === 'surface' && other === 'background') && words.some((p) => w.includes(p))) return undefined;
  let score = 3;
  const variants = w.filter((x) => VARIANT.has(x) || (SHADE.test(x) && !MAIN.has(x)) || x === 'dark');
  score -= Math.min(2, variants.length * 1.5);
  if (w.some((x) => x === 'brand' || x === 'accent')) score -= 1.5;
  const uses = v.uses ?? {};
  const want = field === 'border' ? 'border' : field === 'text' ? 'text' : 'background';
  if ((uses[want] ?? 0) > 0) score += 0.5;
  return {
    v,
    score,
    why: `named ${v.name}${variants.length ? ` (a variant: ${variants.join(', ')})` : ''}`,
  };
}

function roleScore(field: keyof typeof ROLE, w: string[], v: FoundVar): Scored | undefined {
  const r = ROLE[field];
  let score = w.some((x) => r.strong.includes(x)) ? 3 : w.some((x) => r.weak.includes(x)) ? 2 : w.some((x) => r.hue.includes(x)) && (!v.hex || hueFamily(v.hex) === field) ? 1 : 0;
  if (!score) return undefined;
  // `--text-danger`, `--bg-success`: a status's text or tint, not the status colour itself.
  const prop = Object.values(PROP).some((p) => p.some((x) => w.includes(x)));
  if (prop) score = Math.min(score, 1);
  if (field === 'primary' && w.some((x) => STATUS_WORDS.has(x))) return undefined;
  const variants = w.filter((x) => VARIANT.has(x) || (SHADE.test(x) && !MAIN.has(x)) || x === 'dark' || x === 'on');
  score -= Math.min(2, variants.length);
  if (w.some((x) => MAIN.has(x) && x !== 'primary')) score += 0.5;
  if (field === 'primary' && (v.uses?.background ?? 0) > 0) score += 0.5;
  return {
    v,
    score,
    why: `named ${v.name}${prop ? ' (the status’s text or tint)' : ''}${variants.length ? ` (a variant: ${variants.join(', ')})` : ''}`,
  };
}

const confOf = (score: number): Confidence => (score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low');
const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const usesText = (u: Partial<Record<string, number>>) =>
  Object.entries(u)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');

/** The field a --mxt-* token feeds, and the tokens each form field feeds (an import override goes when the field is changed). */
export const FIELD_TOKENS: Record<FieldId, MxtToken[]> = {
  primary: ['brand'],
  success: ['success'],
  warning: ['warning'],
  danger: ['danger'],
  info: ['info'],
  background: ['ground'],
  surface: ['surface'],
  text: ['ink'],
  border: ['line'],
  font: ['font', 'font-heading'],
  corners: ['radius', 'radius-lg'],
  density: ['row-height', 'control-height', 'font-size'],
};

/** A px size from `6px`, `0.375rem`, `.5em` (16 px to the rem), or undefined. */
export function px(v: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(v.trim().split(/\s+/)[0] ?? '');
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : m[2] === 'px' || n === 0 ? n : undefined;
}
export const cornersOf = (r: number): Corners => (r <= 3 ? 'square' : r <= 8 ? 'soft' : 'round');
export const densityOf = (h: number, row = false): Density => (row ? (h <= 30 ? 'compact' : h <= 36 ? 'comfortable' : 'spacious') : h <= 33 ? 'compact' : h <= 38 ? 'comfortable' : 'spacious');

/** A safe token value for tokens.css (no way out of the declaration). */
export const safeValue = (v: string) => (/^[^;{}<>\\@`]{1,200}$/.test(v) && (v.match(/"/g) ?? []).length % 2 === 0 && !/url\s*\(|expression\s*\(|var\s*\(/i.test(v) ? v.trim() : undefined);

export function suggestMapping(scan: ImportScan): {
  suggestion: ImportSuggestion;
  unmapped: { name: string; value: string; loc: SrcLoc }[];
} {
  let next = 0;
  const id = () => `c${++next}`;
  const fields = Object.fromEntries(FIELDS.map((f) => [f, [] as Candidate[]])) as Record<FieldId, Candidate[]>;
  const used = new Set<string>();
  const add = (f: FieldId, c: Omit<Candidate, 'id'>) => {
    const list = fields[f];
    const same = list.find((x) => x.value === c.value);
    if (same) {
      if (RANK[c.confidence] > RANK[same.confidence]) Object.assign(same, c);
      return;
    }
    list.push({ id: id(), ...c });
  };
  const light = scan.vars.filter((v) => v.scheme === 'light');
  const darkOf = (name: string) => scan.vars.find((d) => d.scheme === 'dark' && d.name === name && d.hex);

  // 1. The folder's own --mxt-* tokens: mxcli's vocabulary only.
  const ignored: ImportSuggestion['ignored'] = [];
  const pt = {
    light: {} as Partial<TokenMap>,
    dark: {} as Partial<TokenMap>,
    locs: {} as Record<string, SrcLoc>,
  };
  for (const v of scan.vars) {
    const m = /^--mxt-([a-z0-9-]+)$/.exec(v.name);
    if (!m) continue;
    used.add(v.name);
    const t = m[1] as MxtToken;
    if (!(MXT_TOKENS as readonly string[]).includes(t)) {
      ignored.push({
        name: v.name,
        loc: v.loc,
        reason: 'not in mxcli’s vocabulary (mxcli theme show signal): mxcli would refuse the file',
      });
      continue;
    }
    const val = v.hex ?? safeValue(v.value);
    if (!val) {
      ignored.push({
        name: v.name,
        loc: v.loc,
        reason: /var\s*\(/.test(v.value) ? 'refers to a value that isn’t in the folder' : 'its value can’t go in a token file',
      });
      continue;
    }
    pt[v.scheme][t] = val;
    pt.locs[`${v.scheme}:${t}`] = v.loc;
  }
  const hasPt = Object.keys(pt.light).length + Object.keys(pt.dark).length > 0;
  if (hasPt) {
    for (const f of COLOUR_FIELDS) {
      const t = FIELD_TOKENS[f][0];
      const hex = pt.light[t] && toHexColour(pt.light[t]!);
      const dk = pt.dark[t] && toHexColour(pt.dark[t]!);
      if (hex)
        add(f, {
          value: hex,
          label: `--mxt-${t}`,
          loc: pt.locs[`light:${t}`],
          confidence: 'high',
          why: `the folder’s own --mxt-${t}`,
          ...(dk && ['primary', 'background', 'surface', 'text'].includes(f) ? { dark: dk, darkLoc: pt.locs[`dark:${t}`] } : {}),
        });
    }
    if (pt.light.font)
      add('font', {
        value: pt.light.font,
        label: '--mxt-font',
        loc: pt.locs['light:font'],
        confidence: 'high',
        why: 'the folder’s own --mxt-font',
      });
    const r = pt.light.radius && px(pt.light.radius);
    if (typeof r === 'number')
      add('corners', {
        value: cornersOf(r),
        label: `--mxt-radius: ${pt.light.radius}`,
        loc: pt.locs['light:radius'],
        confidence: 'high',
        why: 'the folder’s own --mxt-radius',
      });
    const ch = pt.light['control-height'] && px(pt.light['control-height']);
    if (typeof ch === 'number')
      add('density', {
        value: densityOf(ch),
        label: `--mxt-control-height: ${pt.light['control-height']}`,
        loc: pt.locs['light:control-height'],
        confidence: 'high',
        why: 'the folder’s own --mxt-control-height',
      });
  }

  // 2. Named colours.
  const named = light.filter((v) => v.hex && !v.name.startsWith('--mxt-') && (v.origin !== 'json' || !v.type || v.type === 'color'));
  for (const f of COLOUR_FIELDS) {
    const scored: Scored[] = [];
    for (const v of named) {
      const w = wordsOf(v.name);
      const s = f in PROP ? propScore(f as keyof typeof PROP, w, v) : roleScore(f as keyof typeof ROLE, w, v);
      if (s && s.score > 0) scored.push(s);
    }
    if (f === 'primary') for (const v of named.filter((x) => x.name === 'meta:theme-color')) scored.push({ v, score: 2, why: 'the page’s theme-color' });
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, 8)) {
      used.add(s.v.name);
      const dk = ['primary', 'background', 'surface', 'text'].includes(f) ? darkOf(s.v.name) : undefined;
      add(f, {
        value: s.v.hex!,
        label: s.v.name,
        loc: s.v.loc,
        text: s.v.text,
        confidence: confOf(s.score),
        why: `${s.why}${s.v.uses && usesText(s.v.uses) ? `; used as ${usesText(s.v.uses)}` : ''}`,
        ...(dk ? { dark: dk.hex, darkLoc: dk.loc } : {}),
      });
    }
  }

  // 3. Colour literals: where and how often they're written.
  const lits = scan.colours.filter((c) => c.scheme === 'light');
  const darkLits = scan.colours.filter((c) => c.scheme === 'dark');
  const lit = (f: ColourField, c: (typeof lits)[number], confidence: Confidence, why: string, dark?: (typeof lits)[number]) =>
    add(f, {
      value: c.hex,
      label: 'colour literal',
      loc: c.loc,
      text: c.text,
      confidence,
      why: `${why}: written ${c.count}× (${usesText(c.uses)})`,
      ...(dark ? { dark: dark.hex, darkLoc: dark.loc } : {}),
    });
  const byUse = (k: 'background' | 'text' | 'border', list = lits) => list.filter((c) => c.uses[k] > 0).sort((a, b) => (b.page?.[k] ?? 0) - (a.page?.[k] ?? 0) || b.uses[k] - a.uses[k]);
  const pageBg = byUse('background').find((c) => c.page?.background);
  const darkPageBg = byUse('background', darkLits).find((c) => c.page?.background);
  if (pageBg) lit('background', pageBg, 'medium', 'the page’s background', darkPageBg);
  for (const c of byUse('background')
    .filter((x) => hsl(x.hex).l > 0.85 || hsl(x.hex).l < 0.15)
    .slice(0, 4))
    lit('background', c, 'low', 'a light or dark background');
  const bg = fields.background[0]?.value ?? pageBg?.hex;
  const whites = byUse('background')
    .filter((x) => x.hex !== bg && hsl(x.hex).l > 0.9)
    .sort((a, b) => hsl(a.hex).s - hsl(b.hex).s || b.count - a.count);
  for (const [i, c] of whites.slice(0, 3).entries()) lit('surface', c, i === 0 && bg && bg !== '#ffffff' && c.hex === '#ffffff' ? 'medium' : 'low', 'a light background besides the page’s');
  const pageText = byUse('text').find((c) => c.page?.text);
  const darkPageText = byUse('text', darkLits).find((c) => c.page?.text);
  if (pageText) lit('text', pageText, 'medium', 'the page’s text colour', darkPageText);
  for (const c of byUse('text')
    .filter((x) => !isChromatic(x.hex))
    .slice(0, 4))
    lit('text', c, 'low', 'a text colour');
  for (const c of byUse('border').slice(0, 4)) lit('border', c, c.count >= 3 ? 'medium' : 'low', 'a border colour');
  const chroma = lits.filter((c) => isChromatic(c.hex)).sort((a, b) => b.count + b.uses.background - (a.count + a.uses.background));
  for (const [i, c] of chroma.slice(0, 5).entries()) lit('primary', c, i === 0 && c.uses.background > 0 && c.count >= 3 ? 'medium' : 'low', 'a saturated colour');
  for (const c of chroma) {
    const fam = c.hex === fields.primary[0]?.value ? undefined : hueFamily(c.hex);
    if (fam) lit(fam, c, 'low', `reads as ${fam} by its hue`);
  }

  // Every other named colour is an alternative for every colour field (lowest), so the dropdown has them all.
  for (const f of COLOUR_FIELDS)
    for (const v of named.slice(0, 40))
      if (fields[f].length < 14 && !fields[f].some((c) => c.value === v.hex))
        add(f, {
          value: v.hex!,
          label: v.name,
          loc: v.loc,
          text: v.text,
          confidence: 'low',
          why: `another colour the folder names (${v.name})`,
          filler: true,
        });

  // 4. Font, corners, density.
  for (const f of [...scan.fonts].sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.count - a.count).slice(0, 8))
    add('font', {
      value: f.value,
      label: f.name ?? 'font-family',
      loc: f.loc,
      text: f.text,
      confidence: f.strong ? 'high' : f.count >= 3 ? 'medium' : 'low',
      why: f.strong ? `${f.name ? `named ${f.name}` : 'the page’s font'}` : `written ${f.count}×`,
    });
  for (const r of [...scan.radii].sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.count - a.count)) {
    const n = px(r.value);
    if (n === undefined || n > 40) continue;
    add('corners', {
      value: cornersOf(n),
      label: `${r.name ?? 'border-radius'}: ${r.value}`,
      loc: r.loc,
      text: r.text,
      confidence: r.strong ? 'high' : r.count >= 3 ? 'medium' : 'low',
      why: r.strong ? `named ${r.name}` : `written ${r.count}×`,
    });
  }
  for (const hgt of [...scan.heights].sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.count - a.count)) {
    const n = px(hgt.value);
    if (n === undefined || n < 16 || n > 80) continue;
    const row = /row/.test(hgt.name ?? '');
    add('density', {
      value: densityOf(n, row),
      label: `${hgt.name ?? 'height'}: ${hgt.value}`,
      loc: hgt.loc,
      text: hgt.text,
      confidence: hgt.strong ? 'high' : 'low',
      why: hgt.strong ? `named ${hgt.name}` : `a control’s height, written ${hgt.count}×`,
    });
  }

  for (const f of FIELDS) fields[f].sort((a, b) => Number(!!a.filler) - Number(!!b.filler) || RANK[b.confidence] - RANK[a.confidence]);
  for (const f of FIELDS) for (const c of fields[f]) if (c.label.startsWith('--') || c.label.startsWith('$')) used.add(c.label);
  const taken = new Set(FIELDS.map((f) => fields[f][0]?.label));
  const unmapped = light
    .filter((v) => !taken.has(v.name) && !v.name.startsWith('--mxt-'))
    .slice(0, UNMAPPED_MAX)
    .map((v) => ({ name: v.name, value: v.value.slice(0, 120), loc: v.loc }));
  return {
    suggestion: { fields, ...(hasPt ? { passthrough: pt } : {}), ignored },
    unmapped,
  };
}
