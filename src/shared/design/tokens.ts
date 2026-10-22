// Branded Atlas's tokens: the short form (DesignInput) becomes all 40 of mxcli's `--mxt-*` tokens, light and
// dark. All 40, never a subset: a token left out keeps the scaffold theme's value (signal's teal tints, 0a
// finding 3), so the package sets every one. Deterministic: the same form always gives the same file (and so
// the same digest). Plus the WCAG contrast check the form shows as you type. Pure.

import type { Corners, Density, DesignInput } from './types.js';

/** mxcli's token vocabulary (`mxcli theme show signal`, 40 tokens). */
export const MXT_TOKENS = [
  'brand', 'brand-hover', 'brand-ink', 'success', 'warning', 'danger', 'info',
  'ground', 'surface', 'surface-alt', 'surface-hover', 'surface-selected', 'ink', 'ink-muted', 'ink-faint', 'line',
  'rail', 'rail-line', 'rail-ink', 'rail-ink-active',
  'tint-ok', 'tone-ok', 'tint-warn', 'tone-warn', 'tint-risk', 'tone-risk', 'tint-info', 'tone-info', 'tint-neutral',
  'radius', 'radius-lg', 'row-height', 'control-height', 'shadow', 'focus-halo',
  'font', 'font-heading', 'font-mono', 'font-size', 'line-height',
] as const;
export type MxtToken = (typeof MXT_TOKENS)[number];
export type TokenMap = Record<MxtToken, string>;

/** Tokens the dark palette sets (the rest carry over from light). */
export const DARK_TOKENS: readonly MxtToken[] = ['brand', 'brand-hover', 'brand-ink', 'ground', 'surface', 'surface-alt', 'surface-hover', 'surface-selected', 'ink', 'ink-muted', 'ink-faint', 'line', 'rail', 'rail-line', 'tint-neutral', 'shadow'];

/** A sensible start: Atlas-like blue, neutral greys, the system font. */
export const DEFAULT_INPUT: DesignInput = {
  name: '',
  primary: '#264ae5',
  success: '#3cb33d',
  warning: '#eca51c',
  danger: '#e33f4e',
  info: '#0595db',
  background: '#f8f8f8',
  surface: '#ffffff',
  text: '#0a1325',
  font: '',
  fallback: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  density: 'comfortable',
  corners: 'soft',
};

const DENSITY: Record<Density, { control: number; row: number; size: number }> = {
  compact: { control: 32, row: 28, size: 13 },
  comfortable: { control: 36, row: 32, size: 14 },
  spacious: { control: 40, row: 44, size: 15 },
};
const CORNERS: Record<Corners, [number, number]> = { square: [2, 4], soft: [6, 10], round: [10, 16] };

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** `a` moved towards `b` by `t` (0..1). */
export const mix = (a: string, b: string, t: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t) as Rgb);
const rgba = (c: string, a: number) => `rgba(${rgb(c).join(', ')}, ${a})`;

/** WCAG relative luminance and contrast ratio. */
export function luminance(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
/** White or near-black, whichever reads better on `bg`. */
export const inkOn = (bg: string) => (contrast('#ffffff', bg) >= contrast('#111418', bg) ? '#ffffff' : '#111418');

const quoteFont = (f: string) => (/^[A-Za-z0-9 -]+$/.test(f) && !/\s/.test(f) ? f : `"${f.replace(/["\\;{}]/g, '')}"`);
/** The font token: the chosen family first, then the fallback stack (only safe characters kept). */
export function fontStack(font: string, fallback: string): string {
  const fb = fallback.replace(/[;{}\\<>]/g, '').trim() || DEFAULT_INPUT.fallback;
  const f = font.replace(/[;{}\\<>"]/g, '').trim();
  return f ? `${quoteFont(f)}, ${fb}` : fb;
}

/** The form, made safe: anything missing or malformed takes the default. */
export function cleanInput(raw: unknown): DesignInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const col = (k: keyof DesignInput) => (isHex(r[k]) ? (r[k] as string).toLowerCase() : (DEFAULT_INPUT[k] as string));
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
  return {
    name: str(r.name, 80),
    primary: col('primary'),
    success: col('success'),
    warning: col('warning'),
    danger: col('danger'),
    info: col('info'),
    background: col('background'),
    surface: col('surface'),
    text: col('text'),
    font: str(r.font, 60).replace(/[;{}\\<>"]/g, ''),
    fallback: str(r.fallback, 200).replace(/[;{}\\<>]/g, '') || DEFAULT_INPUT.fallback,
    density: r.density === 'compact' || r.density === 'spacious' ? r.density : 'comfortable',
    corners: r.corners === 'square' || r.corners === 'round' ? r.corners : 'soft',
  };
}

/**
 * Token values an import took from the client's own files (shared/design/import/): laid over what the form
 * derives, never instead of the derivation. A brand colour taken as is keeps its button text readable.
 */
export interface TokenOverrides {
  light?: Partial<TokenMap>;
  dark?: Partial<TokenMap>;
}

function overlay<T extends Partial<TokenMap>>(base: T, over: Partial<TokenMap> | undefined): T {
  if (!over) return base;
  const out = { ...base, ...over };
  if (over.brand && !over['brand-ink'] && isHex(over.brand)) out['brand-ink'] = inkOn(over.brand);
  return out;
}

/** All 40 tokens, light and dark, from the form (and what an import took as it was, laid over them). */
export function deriveTokens(i: DesignInput, over?: TokenOverrides): { light: TokenMap; dark: Partial<TokenMap> } {
  const base = derive(i);
  return over ? { light: overlay(base.light, over.light), dark: overlay(base.dark, over.dark) } : base;
}

function derive(i: DesignInput): { light: TokenMap; dark: Partial<TokenMap> } {
  const d = DENSITY[i.density];
  const [r, rl] = CORNERS[i.corners];
  const font = fontStack(i.font, i.fallback);
  const tone = (c: string) => mix(c, '#000000', 0.25);
  const light: TokenMap = {
    brand: i.primary,
    'brand-hover': mix(i.primary, '#000000', 0.15),
    'brand-ink': inkOn(i.primary),
    success: i.success,
    warning: i.warning,
    danger: i.danger,
    info: i.info,
    ground: i.background,
    surface: i.surface,
    'surface-alt': mix(i.surface, i.text, 0.025),
    'surface-hover': mix(i.surface, i.primary, 0.06),
    'surface-selected': mix(i.surface, i.primary, 0.12),
    ink: i.text,
    'ink-muted': mix(i.text, i.surface, 0.35),
    'ink-faint': mix(i.text, i.surface, 0.55),
    line: mix(i.background, i.text, 0.15),
    rail: mix(i.primary, '#000000', 0.55),
    'rail-line': mix(i.primary, '#000000', 0.7),
    'rail-ink': mix('#ffffff', i.primary, 0.15),
    'rail-ink-active': '#ffffff',
    'tint-ok': rgba(i.success, 0.12),
    'tone-ok': tone(i.success),
    'tint-warn': rgba(i.warning, 0.12),
    'tone-warn': tone(i.warning),
    'tint-risk': rgba(i.danger, 0.12),
    'tone-risk': tone(i.danger),
    'tint-info': rgba(i.info, 0.12),
    'tone-info': tone(i.info),
    'tint-neutral': mix(i.surface, i.text, 0.06),
    radius: `${r}px`,
    'radius-lg': `${rl}px`,
    'row-height': `${d.row}px`,
    'control-height': `${d.control}px`,
    shadow: '0 1px 2px 0 rgba(20, 24, 31, 0.08)',
    'focus-halo': `0 0 0 3px ${rgba(i.primary, 0.18)}`,
    font,
    'font-heading': font,
    'font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'font-size': `${d.size}px`,
    'line-height': '1.45',
  };
  const ground = mix('#0f1318', i.primary, 0.06);
  const surface = mix('#171c23', i.primary, 0.06);
  const brand = mix(i.primary, '#ffffff', 0.35);
  const dark: Partial<TokenMap> = {
    brand,
    'brand-hover': mix(i.primary, '#ffffff', 0.45),
    'brand-ink': inkOn(brand),
    ground,
    surface,
    'surface-alt': mix(surface, '#ffffff', 0.03),
    'surface-hover': mix(surface, brand, 0.1),
    'surface-selected': mix(surface, brand, 0.18),
    ink: '#e8ecf2',
    'ink-muted': '#a9b2bd',
    'ink-faint': '#6f7a87',
    line: mix(surface, '#ffffff', 0.12),
    rail: mix('#0a0e13', i.primary, 0.15),
    'rail-line': mix('#0a0e13', i.primary, 0.25),
    'tint-neutral': mix(surface, '#ffffff', 0.06),
    shadow: '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
  };
  return { light, dark };
}

/** The tokens.css `mxcli theme create --from` reads: every light token, then the dark block. */
export function tokensCss(name: string, i: DesignInput, over?: TokenOverrides): string {
  const { light, dark } = deriveTokens(i, over);
  const lines = [`/* ${name.replace(/\*\//g, '')}: Branded Atlas tokens (Mx Office). All ${MXT_TOKENS.length} --mxt-* tokens are set so none falls back to the scaffold theme. */`, ':root {'];
  for (const t of MXT_TOKENS) lines.push(`  --mxt-${t}: ${light[t]};`);
  lines.push('}', '@media (prefers-color-scheme: dark) {', '  :root {');
  for (const t of MXT_TOKENS) if (dark[t] && (DARK_TOKENS.includes(t) || over?.dark?.[t])) lines.push(`    --mxt-${t}: ${dark[t]};`);
  lines.push('  }', '}', '');
  return lines.join('\n');
}

export interface ContrastCheck {
  label: string;
  ratio: number;
  ok: boolean;
}

/** The pairs that carry text (WCAG 2.2 AA: 4.5 for body text). */
export function contrastChecks(i: DesignInput, over?: TokenOverrides): ContrastCheck[] {
  const { light, dark } = deriveTokens(i, over);
  const pairs: [string, string, string][] = [
    ['Text on background', light.ink, light.ground],
    ['Text on cards', light.ink, light.surface],
    ['Muted text on cards', light['ink-muted'], light.surface],
    ['Button text on primary', light['brand-ink'], light.brand],
    ['Dark mode: text on background', dark.ink!, dark.ground!],
    ['Dark mode: button text on primary', dark['brand-ink']!, dark.brand!],
  ];
  return pairs.map(([label, a, b]) => {
    // A colour an import took as it was can be rgb()/hsl(): the check needs #rrggbb (shared/design/import/colour.ts made them so).
    const ratio = isHex(a) && isHex(b) ? contrast(a, b) : 0;
    return { label, ratio, ok: ratio >= 4.5 };
  });
}
