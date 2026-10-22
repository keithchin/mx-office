// From the mapping review's choices to what the existing derivation takes (shared/design/tokens.ts): the
// Branded Atlas form (DesignInput) plus the few token values the import takes as they were (the folder's own
// --mxt-* tokens, its dark colours, its border colour), laid over the derived 40. Also: dropping an override a
// later hand edit changed, the token diff a re-import shows, and reading a package's tokens.css back. Pure:
// the page runs it live as choices change, and the server runs the same on save (from its own scan).

import { cleanInput, DEFAULT_INPUT, deriveTokens, isHex, MXT_TOKENS, type MxtToken, type TokenMap, type TokenOverrides } from '../tokens.js';
import type { DesignInput } from '../types.js';
import { toHexColour } from './colour.js';
import { FIELD_TOKENS, safeValue } from './suggest.js';
import { FIELDS, type FieldChoice, type FieldId, type ImportSuggestion, type Scheme, type TokenChange } from './types.js';

export type Choices = Partial<Record<FieldId, FieldChoice>>;

/** The suggestion as chosen: each field's best candidate, or the office's default when it has none. */
export function defaultChoices(s: ImportSuggestion): Choices {
  const out: Choices = {};
  for (const f of FIELDS) {
    const c = s.fields[f].find((x) => !x.filler);
    out[f] = c
      ? {
          value: c.value,
          how: 'suggested',
          candidate: c.id,
          confidence: c.confidence,
          ...(c.loc ? { from: { ...c.loc, name: c.label } } : {}),
        }
      : { value: defaultOf(f), how: 'default' };
  }
  return out;
}

function defaultOf(f: FieldId): string {
  if (f === 'border') return '';
  if (f === 'font') return '';
  if (f === 'corners') return DEFAULT_INPUT.corners;
  if (f === 'density') return DEFAULT_INPUT.density;
  return DEFAULT_INPUT[f];
}

/** A font stack split into the family and its fallback (`"Inter", system-ui, sans-serif` → Inter + the rest). */
export function splitFont(stack: string): { font: string; fallback: string } {
  const parts = stack
    .split(',')
    .map((p) => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|inherit|initial)$/i;
  if (!parts.length || generic.test(parts[0]))
    return {
      font: '',
      fallback: parts.length ? stack : DEFAULT_INPUT.fallback,
    };
  const rest = stack.split(',').slice(1).join(',').trim();
  return { font: parts[0], fallback: rest || DEFAULT_INPUT.fallback };
}

/** The form the choices make (cleaned the same way the form's own input is). */
export function inputOf(choices: Choices, name: string): DesignInput {
  const v = (f: FieldId) => choices[f]?.value ?? '';
  const font = v('font') ? splitFont(v('font')) : { font: '', fallback: DEFAULT_INPUT.fallback };
  return cleanInput({
    ...DEFAULT_INPUT,
    name,
    primary: v('primary'),
    success: v('success'),
    warning: v('warning'),
    danger: v('danger'),
    info: v('info'),
    background: v('background'),
    surface: v('surface'),
    text: v('text'),
    font: font.font,
    fallback: font.fallback,
    corners: v('corners'),
    density: v('density'),
  });
}

export interface OverrideOpts {
  /** Take the folder's --mxt-* tokens as they are (when it has them). */
  passthrough: boolean;
  /** Take the folder's dark colours for the page, cards, text and brand (when it has them). */
  dark: boolean;
}

/**
 * The token values taken as they were. A --mxt-* token whose field was changed to something else goes (the
 * person's choice wins); a chosen border colour sets --mxt-line; a chosen candidate's dark value sets its
 * dark token. Values only ever come from the suggestion or are #rrggbb.
 */
export function overridesOf(s: ImportSuggestion, choices: Choices, opts: OverrideOpts): { light: Partial<TokenMap>; dark: Partial<TokenMap> } {
  const light: Partial<TokenMap> = {};
  const dark: Partial<TokenMap> = {};
  const pt = opts.passthrough ? s.passthrough : undefined;
  if (pt) {
    Object.assign(light, pt.light);
    Object.assign(dark, pt.dark);
    for (const f of FIELDS) {
      const ch = choices[f];
      const fromPt = ch?.candidate && s.fields[f].find((c) => c.id === ch.candidate)?.label.startsWith('--mxt-');
      if (fromPt || !ch) continue;
      for (const t of FIELD_TOKENS[f]) {
        delete light[t];
        if (f !== 'font' && f !== 'corners' && f !== 'density') delete dark[t];
      }
    }
  }
  const border = choices.border;
  if (border && border.how !== 'default' && isHex(border.value) && !(pt && light.line)) light.line = border.value.toLowerCase();
  if (opts.dark) {
    const map: [FieldId, MxtToken][] = [
      ['primary', 'brand'],
      ['background', 'ground'],
      ['surface', 'surface'],
      ['text', 'ink'],
    ];
    for (const [f, t] of map) {
      const ch = choices[f];
      const c = ch?.candidate ? s.fields[f].find((x) => x.id === ch.candidate) : undefined;
      if (c?.dark && c.value === ch!.value && !dark[t]) dark[t] = c.dark;
    }
  }
  return { light, dark };
}

/** Overrides read back from disk: known tokens with safe values only. */
export function cleanOverrides(raw: unknown): {
  light: Partial<TokenMap>;
  dark: Partial<TokenMap>;
} {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const side = (x: unknown) => {
    const out: Partial<TokenMap> = {};
    if (!x || typeof x !== 'object') return out;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (!(MXT_TOKENS as readonly string[]).includes(k) || typeof v !== 'string') continue;
      const ok = toHexColour(v) ?? safeValue(v);
      if (ok) out[k as MxtToken] = isHex(v) ? v.toLowerCase() : ok;
    }
    return out;
  };
  return { light: side(r.light), dark: side(r.dark) };
}

export const overrideCount = (o: TokenOverrides) => Object.keys(o.light ?? {}).length + Object.keys(o.dark ?? {}).length;

/** An override a hand edit of the form changed the derived value of goes: the edit wins. */
export function pruneOverrides(before: DesignInput, after: DesignInput, over: { light: Partial<TokenMap>; dark: Partial<TokenMap> }) {
  const a = deriveTokens(before);
  const b = deriveTokens(after);
  const keep = (side: 'light' | 'dark') => {
    const out: Partial<TokenMap> = {};
    const x = a[side] as Partial<TokenMap>;
    const y = b[side] as Partial<TokenMap>;
    for (const [k, v] of Object.entries(over[side]) as [MxtToken, string][]) if (x[k] === y[k] && (side === 'dark' || a.light[k] === b.light[k])) out[k] = v;
    return out;
  };
  return { light: keep('light'), dark: keep('dark') };
}

/** Every token whose value differs, light then dark. */
export function diffTokens(before: { light: Partial<TokenMap>; dark: Partial<TokenMap> }, after: { light: Partial<TokenMap>; dark: Partial<TokenMap> }): TokenChange[] {
  const out: TokenChange[] = [];
  for (const scheme of ['light', 'dark'] as Scheme[])
    for (const t of MXT_TOKENS) {
      const from = before[scheme][t];
      const to = after[scheme][t];
      if (from !== to && (from !== undefined || to !== undefined))
        out.push({
          token: t,
          scheme,
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        });
    }
  return out;
}

/** A tokens.css (the office's, or any --mxt-* file) read back: light tokens, and those in a dark block. */
export function parseTokensCss(css: string): {
  light: Partial<TokenMap>;
  dark: Partial<TokenMap>;
} {
  const out = { light: {} as Partial<TokenMap>, dark: {} as Partial<TokenMap> };
  let dark = false;
  let depth = 0;
  let darkDepth = 0;
  for (const line of css.split(/\r?\n/)) {
    if (/prefers-color-scheme\s*:\s*dark|\.dark\b|data-theme=["']?dark/.test(line) && line.includes('{')) {
      dark = true;
      darkDepth = depth + 1;
    }
    const m = /--mxt-([a-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
    if (m && (MXT_TOKENS as readonly string[]).includes(m[1])) out[dark ? 'dark' : 'light'][m[1] as MxtToken] = m[2].trim();
    depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    if (dark && depth < darkDepth) dark = false;
  }
  return out;
}
