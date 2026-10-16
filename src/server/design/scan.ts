// What a project's styling is before a design system touches it (0a MUST-add b): the mxcli themes whose
// fenced blocks are there, Atlas variables set outside the fences to something other than Atlas's own
// default (they would stop applying: main.scss imports the theme last, 0a finding 7b), files with rules of
// their own, and themesource modules that aren't Atlas's or the Marketplace's stock ones. Read-only, with
// fs/promises (never on the event loop's critical path), and small: theme/web's top-level .scss files only.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StartPoint, ThemeScan } from '../../shared/design/types.js';

const BEGIN = /^\s*\/\/\s*mxcli:theme:begin\s+(\S+)/;
const END = /^\s*\/\/\s*mxcli:theme:end\s+(\S+)(?:\s+([0-9a-f]{8,64}))?/;

/** The Atlas variables mxcli's atlas map sets (its _mxcli-atlas-map.scss, 0a): one set outside the fences is shadowed. */
export const MAPPED_ATLAS = new Set(
  'bg-color bg-color-secondary border-color-default border-radius-default border-radius-l border-radius-m border-radius-s brand-danger brand-default brand-info brand-primary brand-primary-hover brand-success brand-warning btn-border-radius btn-danger-color btn-default-bg btn-default-border-color btn-default-color btn-font-size btn-primary-bg btn-primary-bg-hover btn-primary-color card-bg card-border card-border-radius color-base color-contrast font-color-default font-color-detail font-color-header font-family-base font-size-default font-size-h1 font-size-h2 font-size-h3 font-size-large font-size-small font-weight-header form-input-bg form-input-border-color form-input-border-radius form-input-color form-input-font-size form-input-height grid-bg grid-bg-header grid-bg-hover grid-bg-selected grid-border-color header-bg-color header-text-color line-height-base link-color link-hover-color navigation-bg navigation-bg-active navigation-bg-hover navigation-color navigation-color-active gray'.split(' '),
);

/** What a blank Studio Pro 11.12.4 app (plain Atlas) has outside any fence: Atlas's own defaults, not a client's override. */
const STOCK = new Set(
  [
    '$brand-logo: false;',
    '$font-family-import: false;',
    '$form-input-style: default;',
    '$btn-bordered: false;',
    ':root {',
    '}',
    '--brand-primary: #264ae5;',
    '--brand-success: #16aa16;',
    '--brand-warning: #cd8501;',
    '--brand-danger: #ea3337;',
    '--brand-default: color-mix(in srgb, var(--brand-primary) 10%, #e7e7e9);',
    '--gray: #b8babf;',
    '$use-css-variables: true;',
    '@import "../../themesource/atlas_core/web/variables";',
    '@import "custom-variables";',
    '@import "theme-dark";',
    '@import "theme-neutral";',
  ].map((l) => l.toLowerCase()),
);
const STOCK_FILES = new Set(['custom-variables.scss', 'main.scss', '_theme-dark.scss', '_theme-neutral.scss', 'exclusion-variables.scss']);
/** themesource modules a blank app or the usual Marketplace modules bring. */
const STOCK_MODULES = new Set(['administration', 'atlas_core', 'atlas_web_content', 'datawidgets', 'feedbackmodule', 'myfirstmodule', 'nanoflowcommons', 'webactions', 'mxcli']);

/** A line without its comment, trimmed (block comments on one line too). */
const code = (l: string) => l.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '').trim();

export interface FileScan {
  fenced: string[];
  fences: Record<string, string>;
  overrides: { line: number; name: string }[];
  custom: boolean;
}

/** One SCSS file's text: its fences, and what's outside them. */
export function scanScss(text: string): FileScan {
  const fenced: string[] = [];
  const fences: Record<string, string> = {};
  const overrides: { line: number; name: string }[] = [];
  let custom = false;
  let inside: string | undefined;
  const lines = text.replace(/\r/g, '').split('\n');
  lines.forEach((raw, i) => {
    const b = BEGIN.exec(raw);
    if (b) {
      inside = b[1];
      if (!fenced.includes(b[1])) fenced.push(b[1]);
      return;
    }
    const e = END.exec(raw);
    if (e) {
      if (e[2]) fences[e[1]] = e[2];
      inside = undefined;
      return;
    }
    if (inside) return;
    const c = code(raw);
    if (!c) return;
    if (STOCK.has(c.toLowerCase().replace(/\s+/g, ' '))) return;
    const v = /^(?:--|\$)([a-z][a-z0-9-]*)\s*:/i.exec(c);
    if (v && MAPPED_ATLAS.has(v[1].toLowerCase())) overrides.push({ line: i + 1, name: `${c.startsWith('$') ? '$' : '--'}${v[1]}` });
    else custom = true;
  });
  return { fenced, fences, overrides, custom };
}

/** Where the theme folder of the app in `appDir` (the folder with the .mpr) is. */
export const themeWebOf = (appDir: string) => path.join(appDir, 'theme', 'web');

/** The whole scan of an app folder. */
export async function scanTheme(appDir: string): Promise<ThemeScan & { fences: Record<string, Record<string, string>> }> {
  const web = themeWebOf(appDir);
  let names: string[];
  try {
    names = (await readdir(web)).filter((f) => f.endsWith('.scss'));
  } catch {
    return { start: 'unknown', fenced: [], overrides: [], custom: [], modules: [], noTheme: true, fences: {} };
  }
  const fenced = new Set<string>();
  const overrides: ThemeScan['overrides'] = [];
  const custom: string[] = [];
  const fences: Record<string, Record<string, string>> = {};
  for (const f of names.sort()) {
    if (/^_mxcli-/.test(f)) continue;
    if (!STOCK_FILES.has(f)) {
      custom.push(`theme/web/${f}`);
      continue;
    }
    const s = scanScss(await readFile(path.join(web, f), 'utf8').catch(() => ''));
    s.fenced.forEach((x) => fenced.add(x));
    for (const [name, digest] of Object.entries(s.fences)) (fences[name] ??= {})[`theme/web/${f}`] = digest;
    overrides.push(...s.overrides.map((o) => ({ file: `theme/web/${f}`, ...o })));
    // Atlas's own partials are compared by their fences only: their stock text is long and version-specific.
    if (s.custom && (f === 'custom-variables.scss' || f === 'main.scss')) custom.push(`theme/web/${f}`);
  }
  const modules: string[] = [];
  for (const m of await readdir(path.join(appDir, 'themesource')).catch(() => [] as string[])) {
    if (STOCK_MODULES.has(m.toLowerCase())) continue;
    const main = await readFile(path.join(appDir, 'themesource', m, 'web', 'main.scss'), 'utf8').catch(() => '');
    if (main.split('\n').some((l) => code(l))) modules.push(`themesource/${m}`);
  }
  const start: StartPoint = custom.length || overrides.length || modules.length ? 'custom' : fenced.size ? `mxcli:${[...fenced][0]}` : 'atlas';
  return { start, fenced: [...fenced], overrides, custom, modules, fences };
}

/** In words, for a card or a log line. */
export function scanWords(s: ThemeScan): string {
  if (s.noTheme) return 'no theme/web folder';
  const parts = [s.start === 'atlas' ? 'plain Atlas' : s.start.startsWith('mxcli:') ? `mxcli theme ${s.start.slice(6)}` : 'its own styling'];
  if (s.overrides.length) parts.push(`${s.overrides.length} Atlas variable${s.overrides.length === 1 ? '' : 's'} set outside the theme (${s.overrides.slice(0, 3).map((o) => o.name).join(', ')}${s.overrides.length > 3 ? '…' : ''}) that the design system would override`);
  if (s.custom.length) parts.push(`custom rules in ${s.custom.join(', ')}`);
  if (s.modules.length) parts.push(`theme modules ${s.modules.join(', ')}`);
  return parts.join('; ');
}
