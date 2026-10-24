// The bounded Model preview's rules (page-preview.ts uses them), kept apart so they can be read and tested on
// their own. Pure: no DOM.
//
//   sample rows       a list's template is drawn once per sample row: 3 at the top level, 2 inside a list,
//                     1 deeper; what isn't drawn is said ("… 2 more rows (sample)"). A widget budget per page
//                     stops a page from exploding (the 91,000 px case): past it, what's left is one labelled
//                     box with its count, never dropped silently.
//   conditions        `Visible:` is read, never worked out. A conditional block gets a small "Shown when …"
//                     tag; siblings that pick between cases of one value (Status = Draft / Submitted / …) are
//                     drawn once, the first case, with the others named. Empty-state blocks say so.
//   element labels    the plain words for a widget ("Save button", "Filter card"), for picking and requests.

import type { MdlItem } from './mdl-tree';

/** Kinds that show text (a heading, a paragraph, a label). */
export const TEXTS = /^(dynamictext|statictext|text|title|pagetitle|label)$/;
/** Sample rows drawn for a list at this nesting depth (0: not inside another list). */
export const sampleRows = (depth: number): number => (depth <= 0 ? 3 : depth === 1 ? 2 : 1);
/** What every list nominally holds in the sample: the rows not drawn are said. */
export const SAMPLE_ROWS = 3;
/** Widgets written per page before the rest is cut (with a labelled box saying how many). */
export const WIDGET_BUDGET = 2500;

/** "… 2 more rows (sample)". */
export const moreRows = (n: number) => `… ${n} more row${n === 1 ? '' : 's'} (sample)`;

/** How many widgets an item holds, itself included (for the "N more widgets" box). */
export function countWidgets(items: readonly MdlItem[]): number {
  let n = 0;
  const walk = (xs: readonly MdlItem[]) => {
    for (const x of xs) {
      n++;
      walk(x.children);
    }
  };
  walk(items);
  return n;
}

// ---- Conditional visibility ------------------------------------------------------------------------------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** `$currentObject/Order_Customer/Name` → `Name`; `Module.Enum.Value` → `Value`. */
const plainTerm = (t: string) => {
  const p = t.replace(/^\$[\w]+\//, '').replace(/^\$/, '');
  const last = p.slice(p.lastIndexOf('/') + 1);
  return /^[A-Za-z_]\w*\.[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(last) ? last.slice(last.lastIndexOf('.') + 1) : last;
};

/** A `Visible:` expression in plain words, unevaluated: `$currentObject/Status = M.S.Draft` → `Status is Draft`. */
export function conditionWords(expr: string): string {
  let e = expr.trim().replace(/\s+/g, ' ');
  e = e.replace(/(\$[\w]+(?:\/[\w.]+)*|[A-Za-z_]\w*\.[A-Za-z_]\w*\.[A-Za-z_]\w*)/g, (t) => plainTerm(t));
  e = e
    .replace(/([\w']+) != empty/g, '$1 is set')
    .replace(/([\w']+) = empty/g, '$1 is empty')
    .replace(/([\w']+) = false\b/g, 'not $1')
    .replace(/([\w']+) = true\b/g, '$1')
    .replace(/ != /g, ' is not ')
    .replace(/ = /g, ' is ')
    .replace(/\bnot\(/g, 'not (');
  return clip(e, 90);
}

/** What a condition picks between: the value it tests (`$currentObject/Status = …` → `$currentObject/Status`), or undefined. */
export function conditionSubject(expr: string): string | undefined {
  const m = /^\s*(?:not\s*\(\s*)?\(?\s*(\$[\w]+(?:\/[\w.]+)*)\s*(?:(=|!=)\s*([^\s()]+))?\s*\)?\s*$/.exec(expr);
  return m ? m[1] : undefined;
}

/** An empty-state block: shown when a count is 0 or something is empty, and holding only text. */
export function isEmptyState(it: MdlItem): boolean {
  const v = it.props.Visible ?? '';
  if (!/(=\s*0\b|=\s*empty\b)/.test(v) || /!=\s*empty/.test(v)) return false;
  const texts = (xs: MdlItem[]): boolean => xs.every((x) => TEXTS.test(x.kind) || /image/.test(x.kind) || (x.kind === 'container' && texts(x.children)) || x.kind === 'actionbutton' || x.kind === 'linkbutton');
  return it.children.length > 0 ? texts(it.children) : TEXTS.test(it.kind);
}

/** One item, or a run of siblings that choose between cases of the same value (drawn once, the others named). */
export type Part = { item: MdlItem } | { cases: MdlItem[]; subject: string };

/** Siblings, with runs of two or more that test the same value grouped (other siblings as they are). */
export function groupCases(items: readonly MdlItem[]): Part[] {
  const out: Part[] = [];
  let run: MdlItem[] = [];
  let subject: string | undefined;
  const flush = () => {
    if (run.length > 1 && subject) out.push({ cases: run, subject });
    else for (const r of run) out.push({ item: r });
    run = [];
    subject = undefined;
  };
  for (const it of items) {
    const s = it.props.Visible ? conditionSubject(it.props.Visible) : undefined;
    if (s && s === subject) run.push(it);
    else {
      flush();
      if (s) ((run = [it]), (subject = s));
      else out.push({ item: it });
    }
  }
  flush();
  return out;
}

// ---- Element labels ------------------------------------------------------------------------------------

/** `TripTitle` → `Trip title`. */
function words(name: string): string {
  const w = name.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : name;
}
/** A widget name without its type prefix: `ctnFilterCard` → `Filter card`, `btnSave` → `Save`, `container1` → ''. */
export function nameWords(name: string | undefined): string {
  if (!name || /^[a-z]+\d*$/.test(name)) return '';
  const m = /^[a-z]{1,4}([A-Z].*)$/.exec(name);
  return words(m ? m[1] : name);
}

const KIND_WORDS: Record<string, string> = {
  actionbutton: 'button', button: 'button', linkbutton: 'link', textbox: 'field', textarea: 'text area', datepicker: 'date field', combobox: 'drop-down', dropdown: 'drop-down', checkbox: 'checkbox',
  radiobuttons: 'choice', referenceselector: 'drop-down', listview: 'list', gallery: 'gallery', templategrid: 'gallery', datagrid: 'table', datagrid2: 'table', dataview: 'form', image: 'image',
  staticimage: 'image', dynamicimage: 'image', snippetcall: 'snippet', groupbox: 'group', tabcontainer: 'tabs', tabpage: 'tab', layoutgrid: 'grid', fileuploader: 'file upload', navigationtree: 'menu', menubar: 'menu',
};

/** The plain words for a widget, for its outline and the request chip ("Save button", "Sheets list", "Title text"). */
export function elementLabel(it: MdlItem, text?: string): string {
  const kind = KIND_WORDS[it.kind] ?? '';
  const n = nameWords(it.name);
  const caption = it.props.Caption ?? it.props.Label ?? '';
  // A snippet call: the snippet's own name says more than the call's (snippetCall2).
  if (it.kind === 'snippetcall' && it.props.Snippet) return `${words(it.props.Snippet.slice(it.props.Snippet.lastIndexOf('.') + 1).replace(/^SNIP_/i, ''))} snippet`;
  if (/^(actionbutton|button|linkbutton)$/.test(it.kind)) return `${clip((caption || n || 'Unnamed').replace(/^[+\s]+/, ''), 40)} ${kind}`;
  if (TEXTS.test(it.kind)) {
    const t = (text ?? '').trim();
    const heading = /^h[1-6]$/i.test(it.props.RenderMode ?? '');
    if (t && !/^\{\d+\}$/.test(it.props.Content ?? '')) return `“${clip(t, 32)}” ${heading ? 'heading' : 'text'}`;
    return `${n || 'Some'} ${heading ? 'heading' : 'text'}`;
  }
  if (caption && kind) return `${clip(caption, 40)} ${kind}`;
  if (n) return kind && !n.toLowerCase().endsWith(kind) ? `${n} ${kind}` : n;
  return kind ? words(kind) : words(it.kind);
}
