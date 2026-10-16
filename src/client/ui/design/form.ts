// The Branded Atlas short form (shared/design/tokens.ts): name, primary and the four status colours, background,
// cards and text, the font with its fallback, density and corner style. The other ~30 tokens are derived from
// these. Beside it, as you type: a small preview drawn with the derived tokens, and the WCAG contrast check of
// the pairs that carry text. Nothing here calls the office.

import { contrastChecks, deriveTokens, type TokenMap } from '../../../shared/design/tokens';
import type { DesignInput } from '../../../shared/design/types';
import { BRANDED_SCOPE } from '../../../shared/design/types';
import { h } from '../dom';

const COLOURS: [keyof DesignInput, string][] = [
  ['primary', 'Primary'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['danger', 'Danger'],
  ['info', 'Info'],
  ['background', 'Background'],
  ['surface', 'Cards'],
  ['text', 'Text'],
];

/** A mini page in the derived tokens: a header, a card with a label, an input and the buttons. */
function preview(t: TokenMap): HTMLElement {
  const v = (k: keyof TokenMap) => t[k];
  return h(
    'div.ds-preview',
    { style: `background:${v('ground')};color:${v('ink')};font-family:${v('font')};font-size:${v('font-size')};border-radius:${v('radius-lg')}`, 'aria-label': 'Preview with these tokens (an approximation, not the app)' },
    h('div.ds-pv-bar', { style: `background:${v('rail')};color:${v('rail-ink')}` }, 'App'),
    h(
      'div.ds-pv-card',
      { style: `background:${v('surface')};border:1px solid ${v('line')};border-radius:${v('radius')}` },
      h('strong', {}, 'Visitor registration'),
      h('span.ds-pv-label', { style: `background:${v('tint-ok')};color:${v('tone-ok')};border-radius:${v('radius')}` }, 'Approved'),
      h('span.ds-pv-input', { style: `height:${v('control-height')};border:1px solid ${v('line')};border-radius:${v('radius')};color:${v('ink-muted')}` }, 'Name'),
      h('span.ds-pv-btns', {}, h('span.ds-pv-btn', { style: `background:${v('brand')};color:${v('brand-ink')};border-radius:${v('radius')};height:${v('control-height')}` }, 'Save'), h('span.ds-pv-btn', { style: `background:${v('danger')};color:#fff;border-radius:${v('radius')};height:${v('control-height')}` }, 'Reject')),
    ),
  );
}

export interface BrandForm {
  el: HTMLElement;
  value(): DesignInput;
}

export function brandForm(start: DesignInput, onChange: () => void, readOnly = false): BrandForm {
  const d: DesignInput = { ...start };
  const side = h('div.ds-side');
  const draw = () => {
    const checks = contrastChecks(d);
    side.replaceChildren(
      preview(deriveTokens(d).light),
      h('p.pf-hint', {}, 'Preview: an approximation drawn from the tokens, not the app. Runtime screenshots are in each project’s Design gallery.'),
      h('ul.ds-checks', { 'aria-label': 'Contrast check (WCAG 2.2 AA, 4.5:1 for text)' }, ...checks.map((c) => h('li', { 'data-ok': String(c.ok) }, `${c.ok ? '✓' : '⚠️'} ${c.label}: ${c.ratio}:1`))),
    );
  };
  const field = (label: string, input: HTMLElement) => h('label.ds-field', {}, h('span', {}, label), input);
  const text = (k: 'name' | 'font' | 'fallback', label: string, ph: string) => {
    const i = h('input', { type: 'text', value: d[k], placeholder: ph, maxlength: k === 'fallback' ? 200 : 80, disabled: readOnly, 'data-k': k }) as HTMLInputElement;
    i.addEventListener('input', () => ((d[k] = i.value), draw(), onChange()));
    return field(label, i);
  };
  const colour = (k: keyof DesignInput, label: string) => {
    const pick = h('input', { type: 'color', value: String(d[k]), disabled: readOnly, 'aria-label': `${label} colour`, 'data-k': k }) as HTMLInputElement;
    const hex = h('input.ds-hex', { type: 'text', value: String(d[k]), maxlength: 7, disabled: readOnly, 'aria-label': `${label} hex` }) as HTMLInputElement;
    const set = (v: string) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
      (d as unknown as Record<string, string>)[k] = v.toLowerCase();
      pick.value = v;
      hex.value = v.toLowerCase();
      draw();
      onChange();
    };
    pick.addEventListener('input', () => set(pick.value));
    hex.addEventListener('input', () => set(hex.value.trim()));
    return h('label.ds-field.ds-colour', {}, h('span', {}, label), h('span.ds-colour-in', {}, pick, hex));
  };
  const select = <K extends 'density' | 'corners'>(k: K, label: string, opts: [DesignInput[K], string][]) => {
    const s = h('select', { disabled: readOnly, 'data-k': k }, ...opts.map(([v, t]) => h('option', { value: v, selected: d[k] === v }, t))) as HTMLSelectElement;
    s.addEventListener('change', () => ((d[k] = s.value as DesignInput[K]), draw(), onChange()));
    return field(label, s);
  };
  draw();
  const el = h(
    'div.ds-form',
    {},
    h(
      'div.ds-fields',
      {},
      text('name', 'Name', 'Acme Design System'),
      h('div.ds-colours', {}, ...COLOURS.map(([k, l]) => colour(k, l))),
      text('font', 'Font family', 'Inter (leave empty for the fallback)'),
      text('fallback', 'Fallback when the font isn’t installed', 'system-ui, sans-serif'),
      h('div.ds-row2', {}, select('density', 'Density', [['compact', 'Compact (28 px rows)'], ['comfortable', 'Comfortable (32 px rows)'], ['spacious', 'Spacious (44 px rows)']]), select('corners', 'Corners', [['square', 'Square (2 px)'], ['soft', 'Soft (6 px)'], ['round', 'Round (10 px)']])),
      h('p.pf-hint', {}, `${BRANDED_SCOPE} All 40 theme tokens are set from these, light and dark.`),
    ),
    side,
  );
  return { el, value: () => ({ ...d }) };
}
