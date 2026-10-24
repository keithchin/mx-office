// The project's own layout classes, for the Model preview (shared/page-facts.ts theme). Cheap on purpose: only
// the app's own modules' `themesource/<module>/web/main.scss` at the revision (Atlas and Marketplace modules
// skipped, each file capped), read as plain CSS without compiling SCSS. What's kept:
//
//   - rules at the top level, or nested in `body` / `html` / a plain class (flattened to "parent child");
//     nothing inside @media, @supports, @font-face or other @-blocks, and no `&` selectors
//   - selectors made only of classes (`.counters`, `.sheet-card .top`, `.thumbs > ul`), never the preview's own
//     grid or widget classes (row, col-*, mx-*, btn*, form-*, …)
//   - only layout and box properties: display (flex, grid, block, inline-*; never none), grid and flex placement,
//     gaps, alignment, padding, borders, min-height; `var(--x)` resolved, or dropped. Colours stay the
//     preview's own: borders in a neutral line colour, and a box with a background becomes a white card
//
// Nothing that fetches (url(), @import) or runs gets through: values are checked against a small character set.
// Pure.

const PROPS = new Set(['display', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow', 'grid-auto-columns', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap', 'justify-content', 'justify-items', 'align-items', 'align-content', 'align-self', 'place-items', 'text-align', 'padding', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-radius', 'background', 'background-color', 'min-height', 'font-weight']);
const DISPLAY = /^(flex|grid|block|inline-block|inline-flex|inline-grid|inline)$/;
/** The preview's own classes: the project's rules never change how they lay out. */
const OWN = /^\.(row|col(-[\w-]+)?|container(-fluid)?|mx-[\w-]*|btn[\w-]*|form-[\w-]*|control-label|table|card|pgp-[\w-]*)$/;
const SIMPLE_SEL = /^\.[\w-]+(\s*(>\s*)?(\.[\w-]+|ul|li))*$/;
const VALUE_OK = /^[\w\s.,%()+*/#-]+$/;
const NEUTRAL_LINE = '#e2e4e8';
export const THEME_MAX_BYTES = 200_000;
export const THEME_MAX_RULES = 400;

/** Modules whose theme isn't the app's own (Atlas, Marketplace modules). */
export const SKIP_MODULE = /^(atlas_|datawidgets$|feedbackmodule$|administration$|webactions$|nanoflowcommons$|fileuploader$|mxtest$|communitycommons$|encryption$|sso|saml|oidc)/i;

/** Custom properties (`--name: value`) declared anywhere in the text, for var() (simple values only). */
export function customProps(text: string, into = new Map<string, string>()): Map<string, string> {
  for (const m of stripComments(text).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const v = m[2].trim();
    if (VALUE_OK.test(v) && !/var\(/.test(v) && v.length < 80) into.set(m[1], v);
  }
  return into;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** One value with var() resolved; undefined when it can't be (or isn't safe). */
function value(v: string, vars: Map<string, string>): string | undefined {
  let out = v.trim().replace(/!important/g, '').trim();
  for (let i = 0; i < 4 && /var\(/.test(out); i++) out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g, (_, n: string, fb?: string) => vars.get(n) ?? fb?.trim() ?? '\u0000');
  if (out.includes('\u0000') || /var\(|url\(|expression|@|\\/i.test(out) || !VALUE_OK.test(out) || out.length > 160) return undefined;
  return out;
}

/** The layout rules of one stylesheet, as clean CSS. */
export function layoutRules(text: string, vars: Map<string, string>): string[] {
  const s = stripComments(text);
  const out: string[] = [];
  // A small brace walker: a stack of the block headers we're in.
  const stack: string[] = [];
  let buf = '';
  let boxed = false;
  for (let i = 0; i < s.length && out.length < THEME_MAX_RULES; i++) {
    const c = s[i];
    if (c === '{') {
      // The header is what follows the parent's last declaration (SCSS nests rules among declarations).
      stack.push(buf.slice(buf.lastIndexOf(';') + 1).trim());
      buf = '';
    } else if (c === '}') {
      const header = stack.pop() ?? '';
      const decls = buf;
      buf = '';
      const rule = flatten(stack, header);
      if (!rule) continue;
      const kept: string[] = [];
      for (const d of decls.split(';')) {
        const at = d.indexOf(':');
        if (at < 0) continue;
        const p = d.slice(0, at).trim().toLowerCase();
        if (!PROPS.has(p)) continue;
        const v = value(d.slice(at + 1), vars);
        if (v === undefined || (p === 'display' && !DISPLAY.test(v))) continue;
        // Colours stay the preview's own (a dark app's surfaces would sit on our light page): a box keeps its
        // shape, drawn as a neutral card.
        if (p.startsWith('background')) {
          boxed = true;
          continue;
        }
        if (p.startsWith('border') && p !== 'border-radius') {
          boxed = true;
          kept.push(`${p}:${v.replace(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\([^)]*\)/gi, NEUTRAL_LINE)}`);
          continue;
        }
        kept.push(`${p}:${v}`);
      }
      if (boxed) kept.push('background:#fff');
      boxed = false;
      if (kept.length) out.push(`${rule}{${kept.join(';')}}`);
    } else if (c === ';' && !stack.length) buf = '';
    else buf += c;
  }
  return out;
}

/** The full selector list for a rule nested in `stack`, when every part is a simple class selector; else undefined. */
function flatten(stack: string[], header: string): string | undefined {
  if (!header || header.startsWith('@') || header.includes('&') || stack.some((h) => h.startsWith('@'))) return undefined;
  const parents = stack.filter((h) => !/^(body|html|:root)$/.test(h));
  if (parents.some((h) => !SIMPLE_SEL.test(h))) return undefined;
  const prefix = parents.join(' ');
  const sels = header.split(',').map((x) => x.trim().replace(/\s+/g, ' '));
  if (!sels.every((x) => SIMPLE_SEL.test(x))) return undefined;
  const ok = sels.filter((x) => !x.split(/[\s>]+/).some((part) => OWN.test(part)));
  if (!ok.length) return undefined;
  return ok.map((x) => (prefix ? `${prefix} ${x}` : x)).join(',');
}

/** The cleaned CSS for the preview from the theme files' texts (with the files holding custom properties). */
export function themeCss(files: { path: string; text: string }[], tokens: string[] = []): string {
  const vars = new Map<string, string>();
  for (const t of tokens) customProps(t, vars);
  for (const f of files) customProps(f.text, vars);
  const rules: string[] = [];
  for (const f of files) if (f.text.length <= THEME_MAX_BYTES) rules.push(...layoutRules(f.text, vars));
  return rules.slice(0, THEME_MAX_RULES).join('\n');
}
