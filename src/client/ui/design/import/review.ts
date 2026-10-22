// The mapping review of an import (server/design/import/): per form field, what the import suggests, with its
// swatch, source (file:line, the name it had), confidence and a dropdown of the other candidates found (or the
// office's default, or your own value). Beside it, live: the preview (light and dark) and the contrast check
// drawn by the existing derivation (shared/design/tokens.ts) with the import's taken values laid over, and for a
// re-import the tokens that change against the version before. Nothing here calls the office.

import { defaultChoices, diffTokens, inputOf, overridesOf, type Choices } from '../../../../shared/design/import/apply';
import { COLOUR_FIELDS, FIELD_LABELS, FIELDS, type Candidate, type FieldId, type ImportScanView } from '../../../../shared/design/import/types';
import { contrastChecks, DEFAULT_INPUT, deriveTokens, isHex, type TokenMap } from '../../../../shared/design/tokens';
import { BRANDED_SCOPE } from '../../../../shared/design/types';
import { h } from '../../dom';
import { checksList, preview } from '../form';

const CONF: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const isColour = (f: FieldId) => (COLOUR_FIELDS as readonly string[]).includes(f);
const where = (c: { loc?: { file: string; line: number } }) => (c.loc ? `${c.loc.file}:${c.loc.line}` : '');
const DEFAULTS: Partial<Record<FieldId, string>> = {
  primary: DEFAULT_INPUT.primary,
  success: DEFAULT_INPUT.success,
  warning: DEFAULT_INPUT.warning,
  danger: DEFAULT_INPUT.danger,
  info: DEFAULT_INPUT.info,
  background: DEFAULT_INPUT.background,
  surface: DEFAULT_INPUT.surface,
  text: DEFAULT_INPUT.text,
  corners: DEFAULT_INPUT.corners,
  density: DEFAULT_INPUT.density,
};

export interface MappingReview {
  el: HTMLElement;
  /** What Save as draft sends. */
  body(): Record<string, unknown>;
}

function swatch(f: FieldId, value: string): HTMLElement {
  if (isColour(f))
    return h('span.di-swatch', {
      style: value ? `background:${value}` : '',
      'data-empty': String(!value),
      title: value || 'derived',
    });
  if (f === 'font') return h('span.di-swatch.di-font', { style: value ? `font-family:${value.replace(/[;{}<>]/g, '')}` : '' }, 'Aa');
  if (f === 'corners')
    return h('span.di-swatch.di-corner', {
      style: `border-radius:${value === 'square' ? 2 : value === 'round' ? 10 : 6}px`,
    });
  return h('span.di-swatch.di-density', {}, value === 'compact' ? '28' : value === 'spacious' ? '44' : '32');
}

export function mappingReview(view: ImportScanView, startName: string, onChange?: () => void): MappingReview {
  const sug = view.suggestion;
  const choices: Choices = defaultChoices(sug);
  let name = startName;
  let passthrough = !!sug.passthrough;
  const hasDark = !!(sug.passthrough && Object.keys(sug.passthrough.dark).length) || FIELDS.some((f) => sug.fields[f].some((c) => c.dark));
  let dark = hasDark;
  const side = h('div.di-side');
  /** A re-import's changes against the version before: full width, above the table. */
  const diffBox = h('div.di-diff-box');
  const rows = h('tbody');

  const state = () => {
    const input = inputOf(choices, name);
    const over = overridesOf(sug, choices, { passthrough, dark });
    return { input, over, tokens: deriveTokens(input, over) };
  };

  const drawSide = () => {
    const { input, over, tokens } = state();
    const darkTokens = { ...tokens.light, ...tokens.dark } as TokenMap;
    const parts: (HTMLElement | null)[] = [h('div.di-previews', {}, h('figure', {}, preview(tokens.light), h('figcaption', {}, 'Light')), h('figure', {}, preview(darkTokens), h('figcaption', {}, 'Dark'))), h('p.pf-hint', {}, 'Preview: an approximation drawn from the 40 derived tokens (with the values taken as they were laid over), not the app.'), checksList(contrastChecks(input, over))];
    const n = Object.keys(over.light).length + Object.keys(over.dark).length;
    if (n) parts.push(h('p.pf-hint.di-taken', {}, `${n} token value${n === 1 ? '' : 's'} taken as the folder has ${n === 1 ? 'it' : 'them'}: ${[...Object.keys(over.light), ...Object.keys(over.dark).map((k) => `${k} (dark)`)].join(', ')}.`));
    if (view.baseline) {
      const changes = diffTokens(view.baseline, tokens);
      diffBox.replaceChildren(
        h(
          'section.di-diff',
          { 'aria-label': `Changes against ${view.baseline.label}` },
          h('h4', {}, changes.length ? `${changes.length} token${changes.length === 1 ? '' : 's'} change against ${view.baseline.label}` : `No token changes against ${view.baseline.label}`),
          changes.length
            ? h(
                'table.di-diff-t',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Token'), h('th', {}, 'Before'), h('th', {}, 'After'))),
                h(
                  'tbody',
                  {},
                  ...changes.slice(0, 60).map((c) =>
                    h(
                      'tr',
                      { 'data-token': `${c.scheme}:${c.token}` },
                      h('td', {}, h('code', {}, `--mxt-${c.token}`), c.scheme === 'dark' ? h('small', {}, ' dark') : null),
                      h(
                        'td',
                        {},
                        isHex(c.from ?? '')
                          ? h('span.di-swatch.di-mini', {
                              style: `background:${c.from}`,
                            })
                          : null,
                        h('code', {}, c.from ?? '—'),
                      ),
                      h(
                        'td',
                        {},
                        isHex(c.to ?? '')
                          ? h('span.di-swatch.di-mini', {
                              style: `background:${c.to}`,
                            })
                          : null,
                        h('code', {}, c.to ?? '—'),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        ),
      );
    }
    side.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  const row = (f: FieldId) => {
    const list = sug.fields[f];
    const best = list.find((c) => !c.filler);
    const sel = h('select', {
      'aria-label': `${FIELD_LABELS[f]}: candidates found`,
      'data-field': f,
    }) as HTMLSelectElement;
    const opt = (value: string, label: string, selected: boolean) => h('option', { value, selected }, label);
    const label = (c: Candidate) => `${isColour(f) ? `${c.value} — ` : f === 'font' ? '' : `${c.value} — `}${f === 'font' ? c.value.slice(0, 60) : c.label}${c.loc ? ` (${where(c)})` : ''} · ${CONF[c.confidence]}${c.filler ? ' (alternative)' : ''}`;
    const def = f === 'border' ? 'Derived from background and text' : f === 'font' ? 'The fallback stack (no font)' : `Office default (${DEFAULTS[f]})`;
    const cur = choices[f]!;
    sel.append(...list.map((c) => opt(c.id, label(c), cur.candidate === c.id)), opt('__default', def, cur.how === 'default'));
    if (isColour(f) || f === 'font') sel.append(opt('__hand', 'My own value…', cur.how === 'hand'));
    if (f === 'corners' || f === 'density') for (const w of f === 'corners' ? ['square', 'soft', 'round'] : ['compact', 'comfortable', 'spacious']) sel.append(opt(`__hand:${w}`, `${w[0].toUpperCase()}${w.slice(1)} (my choice)`, cur.how === 'hand' && cur.value === w));
    const own = isColour(f)
      ? (h('input.di-own', {
          type: 'color',
          value: isHex(cur.value) ? cur.value : (DEFAULTS[f] ?? '#cccccc'),
          'aria-label': `${FIELD_LABELS[f]}: my own colour`,
          hidden: cur.how !== 'hand',
        }) as HTMLInputElement)
      : f === 'font'
        ? (h('input.di-own', {
            type: 'text',
            value: cur.value,
            placeholder: 'Inter, system-ui, sans-serif',
            'aria-label': 'My own font stack',
            hidden: cur.how !== 'hand',
            maxlength: 200,
          }) as HTMLInputElement)
        : undefined;
    const sw = h('td.di-sw');
    const src = h('td.di-src');
    const conf = h('td.di-conf');
    const show = () => {
      const ch = choices[f]!;
      const c = ch.candidate ? list.find((x) => x.id === ch.candidate) : undefined;
      sw.replaceChildren(swatch(f, ch.value || (f === 'border' ? '' : '')));
      if (c?.dark && dark)
        sw.append(
          h('span.di-swatch.di-mini.di-dark', {
            style: `background:${c.dark}`,
            title: `Dark: ${c.dark}${c.darkLoc ? ` (${where({ loc: c.darkLoc })})` : ''}`,
          }),
        );
      src.replaceChildren(...(c ? [h('code', {}, c.label), c.loc ? h('span.di-loc', {}, ` ${where(c)}`) : '', h('small', {}, c.why)] : [h('small', {}, ch.how === 'hand' ? 'Your own value' : f === 'border' ? 'Nothing found: the office derives borders' : 'Nothing found: the office’s default')]));
      conf.replaceChildren(
        c
          ? h(
              'span.pf-chip',
              {
                'data-tone': c.confidence === 'high' ? 'good' : c.confidence === 'medium' ? 'warn' : 'none',
              },
              CONF[c.confidence],
            )
          : h('span.pf-chip', { 'data-tone': 'none' }, ch.how === 'hand' ? 'Yours' : 'Default'),
      );
    };
    const changed = () => {
      show();
      drawSide();
      onChange?.();
    };
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === '__default')
        choices[f] = {
          value: f === 'border' || f === 'font' ? '' : DEFAULTS[f]!,
          how: 'default',
        };
      else if (v === '__hand') choices[f] = { value: own?.value ?? '', how: 'hand' };
      else if (v.startsWith('__hand:')) choices[f] = { value: v.slice(7), how: 'hand' };
      else {
        const c = list.find((x) => x.id === v)!;
        choices[f] = {
          value: c.value,
          how: c === best ? 'suggested' : 'alternative',
          candidate: c.id,
          confidence: c.confidence,
          ...(c.loc ? { from: { ...c.loc, name: c.label } } : {}),
        };
      }
      if (own) own.hidden = choices[f]!.how !== 'hand' || v.startsWith('__hand:');
      changed();
    });
    own?.addEventListener('input', () => {
      choices[f] = { value: own.value.trim(), how: 'hand' };
      changed();
    });
    show();
    return h('tr', { 'data-field': f }, h('th', { scope: 'row' }, FIELD_LABELS[f]), sw, h('td.di-pick', {}, sel, own ?? null), src, conf);
  };
  rows.append(...FIELDS.map(row));

  const toggle = (label: string, hint: string, on: boolean, set: (v: boolean) => void, key: string) => {
    const box = h('input', {
      type: 'checkbox',
      checked: on,
      'data-k': key,
    }) as HTMLInputElement;
    box.addEventListener('change', () => {
      set(box.checked);
      rows.querySelectorAll('select').forEach((s) => s.dispatchEvent(new Event('change')));
      drawSide();
      onChange?.();
    });
    return h('label.di-toggle', {}, box, h('span', {}, h('strong', {}, label), h('small', {}, hint)));
  };
  const nameIn = h('input', {
    type: 'text',
    value: name,
    maxlength: 80,
    'aria-label': 'Design system name',
    'data-k': 'name',
  }) as HTMLInputElement;
  nameIn.addEventListener('input', () => (name = nameIn.value));

  const counts = Object.entries(view.skippedCounts);
  const ni = view.notImported;
  const found = [ni.fonts.length ? `${ni.fonts.length} font file${ni.fonts.length === 1 ? '' : 's'} or @font-face` : '', ni.logos.length ? `${ni.logos.length} logo${ni.logos.length === 1 ? '' : 's'}` : '', ni.layouts.length ? `${ni.layouts.length} page layout${ni.layouts.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  const pt = sug.passthrough;
  const el = h(
    'div.di-review',
    {},
    h(
      'div.di-summary',
      {},
      h('p', {}, h('strong', {}, `Read ${view.files.length} file${view.files.length === 1 ? '' : 's'}`), ` from ${view.kind === 'file' ? 'the file' : 'the folder'} `, h('code', {}, view.source), view.darkHow.length ? ` · dark variant found (${view.darkHow.join(', ')})` : ' · no dark variant found (the office derives dark mode)'),
      view.truncated ? h('p.pf-warn', {}, view.truncated) : null,
      counts.length || view.remote.length
        ? h(
            'details.di-skips',
            {},
            h('summary', {}, `Left out: ${[...counts.map(([k, n]) => `${n} ${k}`), view.remote.length ? `${view.remote.length} web address${view.remote.length === 1 ? '' : 'es'} (never fetched)` : ''].filter(Boolean).join(' · ')}`),
            h('ul', {}, ...view.skipped.slice(0, 40).map((s) => h('li', {}, h('code', {}, s.path), ` — ${s.reason}`)), ...view.remote.slice(0, 20).map((r) => h('li', {}, `${r} — not fetched`))),
          )
        : null,
      found.length ? h('p.pf-hint.di-found', {}, `Found, not imported (separate work): ${found.join(', ')}. ${BRANDED_SCOPE}`) : h('p.pf-hint', {}, BRANDED_SCOPE),
      sug.ignored.length ? h('p.pf-warn.di-ignored', {}, `Not used: ${sug.ignored.map((i) => `${i.name} (${i.loc.file}:${i.loc.line}): ${i.reason}`).join('; ')}`) : null,
    ),
    h('label.ds-field.di-name', {}, h('span', {}, 'Name'), nameIn),
    h(
      'div.di-toggles',
      {},
      pt ? toggle(`Use the folder’s own --mxt-* tokens as they are (${Object.keys(pt.light).length + Object.keys(pt.dark).length})`, 'Checked against mxcli’s vocabulary; the office derives the rest of the 40.', passthrough, (v) => (passthrough = v), 'passthrough') : null,
      hasDark ? toggle('Use the folder’s dark colours', 'For the page, cards, text and brand in dark mode; otherwise the office derives them.', dark, (v) => (dark = v), 'dark') : null,
    ),
    diffBox,
    h('div.di-body', {}, h('div.di-table-wrap', {}, h('table.di-map', { 'aria-label': 'Mapping to the Branded Atlas form' }, h('thead', {}, h('tr', {}, ...['Field', '', 'Value', 'Source', 'Confidence'].map((t) => h('th', {}, t)))), rows)), side),
    view.unmapped.length ? h('details.di-unmapped', {}, h('summary', {}, `${view.unmapped.length} other named value${view.unmapped.length === 1 ? '' : 's'} found and not used`), h('ul', {}, ...view.unmapped.slice(0, 80).map((u) => h('li', {}, h('code', {}, u.name), ` ${u.value} — ${u.loc.file}:${u.loc.line}`)))) : null,
  );
  drawSide();
  return {
    el,
    body: () => ({ scanId: view.scanId, name, choices, passthrough, dark }),
  };
}
