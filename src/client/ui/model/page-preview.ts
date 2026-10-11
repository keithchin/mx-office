// The Preview of a page, snippet or layout: its widget tree (page-model.ts) written out as HTML that looks
// like the running Mendix app would, with an Atlas-like stylesheet of our own (preview-css.ts): the layout
// grid, form groups with a label and an input, select, checkbox or date picker per attribute, data grids as
// tables with a header and three sample rows, list views as cards, buttons in their styles, headings, group
// boxes and tab containers, snippets inlined when their MDL is known, image placeholders, and the page
// inside its layout (top bar, sidebar, menu) when the layout's MDL is known. Sample values come from the
// attributes' names. It is shown in a sandboxed frame with no scripts and no network (`previewDocument`,
// doc-views.ts). Pure: strings in, a string out (tested in node).

import type { MdlItem } from './mdl-tree';
import type { PageModel } from './page-model';
import { textOf } from './page-model';
import { PREVIEW_CSS } from './preview-css';

export interface PreviewContext {
  /** Snippets and layouts already read, by qualified name (null: asked for, not there). */
  docs: Map<string, PageModel | null>;
  /** The navigation menu's captions, for menu bars. */
  menu?: string[];
  now?: Date;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
/** A developer's class names, kept to what's safe in an attribute. */
const classes = (it: MdlItem): string => (it.props.Class ?? '').replace(/[^\w\s-]/g, ' ').trim();
const cls = (...c: (string | false | undefined)[]) => {
  const v = c.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return v ? ` class="${esc(v)}"` : '';
};
const short = (qn: string) => qn.slice(qn.lastIndexOf('.') + 1);
const lastPart = (attr: string) => short(attr.slice(attr.lastIndexOf('/') + 1));

/** `TripTitle` → `Trip title`, `TravelRequest_DestinationCountry` → `Destination country`. */
export function humanize(name: string): string {
  const n = name.includes('_') ? name.slice(name.lastIndexOf('_') + 1) : name;
  const words = n.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : name;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NAMES = ['Jane Doe', 'Ravi Patel', 'Mia Jansen'];
const COUNTRIES = ['Netherlands', 'Germany', 'Singapore'];
const STATUSES = ['Pending approval', 'Approved', 'Draft'];

/** A believable value for an attribute, from its name (row: which sample row, for variety). */
export function sampleValue(attr: string, row = 0, now = new Date()): string {
  // Over an association (Order_Country/Name): a generic attribute takes its meaning from the association.
  const steps = attr.split('/');
  const generic = steps.length > 1 && /^(name|title|caption|code|displayname)$/i.test(short(steps[steps.length - 1]));
  const full = generic ? short(steps[steps.length - 2]) : lastPart(attr);
  // An association's name: what it leads to (Order_Country → Country).
  const n = full.includes('_') ? full.slice(full.lastIndexOf('_') + 1) || full : full;
  const l = n.toLowerCase();
  const d = new Date(now.getTime() + (row * 3 + (/end|until|to$/i.test(full) ? 4 : 0)) * 86_400_000);
  if ((/date|time/.test(l) || /(On|Since|At)$/.test(n)) && !/status|count|update/.test(l)) return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (/cost|amount|price|total|budget|sum|fee|salary/.test(l)) return ['1,250.00', '480.50', '2,075.00'][row % 3];
  if (/count(?!ry)|level|qty|quantity|sequence|attempts|^age$/.test(l)) return String([3, 1, 2][row % 3]);
  if (/number|code|^id$|key/.test(l)) return ['NLD-26-0042', 'DEU-26-0117', 'SGP-26-0009'][row % 3];
  if (/^is|^has|enabled|active|escalated/.test(l)) return row % 2 ? 'No' : 'Yes';
  if (/email/.test(l)) return ['jane.doe@example.com', 'ravi.patel@example.com', 'mia.jansen@example.com'][row % 3];
  if (/country|destination|origin/.test(l)) return COUNTRIES[row % 3];
  if (/status|state|decision/.test(l)) return STATUSES[row % 3];
  if (/name|requester|requestor|approver|actor|user|customer|person|employee|owner|manager|account/.test(l)) return NAMES[row % 3];
  if (/comment|justification|description|note|reason|message|body/.test(l)) return 'Customer workshop and quarterly planning with the regional team.';
  if (/title|subject/.test(l)) return ['Customer workshop in Rotterdam', 'Partner summit Berlin', 'APAC kick-off'][row % 3];
  if (/purpose|type|category|kind/.test(l)) return ['Customer visit', 'Conference', 'Training'][row % 3];
  return humanize(n);
}

const TODAY_TEXT = (now: Date) => sampleValue('Date', 0, now);

/** `Content: '{1} - {2}'` filled in with sample values of its parameters. */
function filledText(it: MdlItem, row: number, now: Date): string {
  const params = new Map<string, string>();
  for (const m of (it.props.ContentParams ?? it.props.CaptionParams ?? '').matchAll(/\{(\d+)\}\s*=\s*([$\w./]+)/g)) params.set(m[1], m[2]);
  const content = it.props.Content ?? it.props.Caption ?? '';
  if (!params.size) return content || textOf(it);
  return content.replace(/\{(\d+)\}/g, (all, k: string) => (params.has(k) ? sampleValue(params.get(k) as string, row, now) : all));
}

const BTN: Record<string, string> = { primary: 'btn-primary', success: 'btn-success', info: 'btn-info', warning: 'btn-warning', danger: 'btn-danger', inverse: 'btn-inverse', link: 'btn-link' };

class Writer {
  /** Snippets being written (a snippet that calls itself stops there). */
  private open: string[] = [];
  constructor(private ctx: PreviewContext, private now: Date) {}

  all(items: MdlItem[], row = 0, inForm = false): string {
    return items.map((i) => this.one(i, row, inForm)).join('');
  }

  one(it: MdlItem, row: number, inForm: boolean): string {
    const k = it.kind;
    const c = classes(it);
    switch (k) {
      case 'layoutgrid':
        return `<div${cls('mx-layoutgrid container-fluid', c)}>${this.all(it.children, row, inForm)}</div>`;
      case 'row':
        return `<div${cls('row', c)}>${this.all(it.children, row, inForm)}</div>`;
      case 'column': {
        const w = Number(it.props.DesktopWidth);
        const t = Number(it.props.TabletWidth);
        const p = Number(it.props.PhoneWidth);
        const colCls = [w > 0 && w <= 12 ? `col-lg-${w}` : 'col-lg', t > 0 && t <= 12 ? `col-md-${t}` : '', p > 0 && p <= 12 ? `col-${p}` : 'col-12'].filter(Boolean).join(' ');
        return `<div${cls(colCls, c)}>${this.all(it.children, row, inForm)}</div>`;
      }
      case 'container':
      case 'scrollcontainer':
        return `<div${cls('mx-container', c)}>${this.all(it.children, row, inForm)}</div>`;
      case 'groupbox':
        return `<div${cls('mx-groupbox', c)}><div class="mx-groupbox-header">${esc(it.props.Caption ?? 'Group box')}</div><div class="mx-groupbox-body">${this.all(it.children, row, inForm)}</div></div>`;
      case 'tabcontainer': {
        const pages = it.children.filter((p) => p.kind === 'tabpage');
        const tabs = pages.map((p, i) => `<li${cls(i === 0 && 'active')}><span>${esc(p.props.Caption ?? p.name ?? `Tab ${i + 1}`)}</span></li>`).join('');
        return `<div${cls('mx-tabcontainer', c)}><ul class="mx-tabcontainer-tabs">${tabs}</ul><div class="mx-tabcontainer-pane">${pages[0] ? this.all(pages[0].children, row, inForm) : ''}</div></div>`;
      }
      case 'dataview': {
        const footer = it.children.filter((x) => x.kind === 'footer');
        const body = it.children.filter((x) => x.kind !== 'footer');
        const horizontal = /horizontal/i.test(it.props.FormOrientation ?? '');
        return `<div${cls('mx-dataview', horizontal && 'form-horizontal', c)}><div class="mx-dataview-content">${this.all(body, row, true)}</div>${footer.length ? `<div class="mx-dataview-controls">${footer.map((f) => this.all(f.children, row, true)).join('')}</div>` : ''}</div>`;
      }
      case 'footer':
      case 'header':
      case 'controlbar':
        return `<div${cls(`mx-${k}`, c)}>${this.all(it.children, row, inForm)}</div>`;
      case 'listview':
      case 'gallery':
      case 'templategrid': {
        const items = [0, 1, 2].map((r) => `<li class="mx-listview-item">${this.all(it.children, r, true)}</li>`).join('');
        return `<ul${cls(k === 'listview' ? 'mx-listview' : 'mx-gallery', c)}>${items}</ul>`;
      }
      case 'datagrid':
      case 'datagrid2':
        return this.grid(it, c);
      case 'dynamictext':
      case 'statictext':
      case 'text':
      case 'title':
      case 'pagetitle':
      case 'label': {
        const mode = (it.props.RenderMode ?? '').toLowerCase();
        const text = esc(filledText(it, row, this.now));
        if (/^h[1-6]$/.test(mode)) return `<${mode}${cls(c)}>${text}</${mode}>`;
        if (mode === 'paragraph') return `<p${cls(c)}>${text}</p>`;
        return `<span${cls('mx-text', c)}>${text}</span>`;
      }
      case 'actionbutton':
      case 'button': {
        const style = BTN[(it.props.ButtonStyle ?? '').toLowerCase()] ?? 'btn-default';
        return `<button type="button"${cls('btn mx-button', style, c.replace(/\bbtn(-(primary|default|success|info|warning|danger|inverse|link))?(?![\w-])/g, ''))}>${esc(filledText(it, row, this.now) || it.name || 'Button')}</button>`;
      }
      case 'linkbutton':
        return `<a${cls('mx-link', c)}>${esc(filledText(it, row, this.now) || it.name || 'Link')}</a>`;
      case 'snippetcall':
        return this.snippet(it, row, inForm);
      case 'placeholder':
        return `<div class="mx-placeholder">${esc(it.name ?? 'Main')}</div>`;
      case 'image':
      case 'staticimage':
      case 'dynamicimage':
        return `<div${cls('mx-image', c)} role="img" aria-label="Image"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 16l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="9" r="1.6" fill="currentColor"/></svg></div>`;
      case 'menubar':
      case 'simplemenubar':
      case 'navigationtree':
        return this.menu(k, c);
      case 'languageselector':
        return `<select class="form-control mx-language" disabled><option>English</option></select>`;
      case 'textfilter':
      case 'numberfilter':
      case 'datefilter':
      case 'dropdownfilter':
      case 'searchfield':
        return `<input class="form-control mx-filter" disabled placeholder="${esc(k === 'dropdownfilter' ? 'Select…' : k === 'datefilter' ? 'dd mmm yyyy' : 'Search')}">`;
    }
    if (INPUTS.has(k)) return this.input(it, row, c);
    // Anything else: its contents, or a labelled box when it has none.
    return it.children.length ? `<div${cls(c)}>${this.all(it.children, row, inForm)}</div>` : `<div class="mx-unknown">${esc(k)}${it.name ? ` ${esc(it.name)}` : ''}</div>`;
  }

  input(it: MdlItem, row: number, c: string): string {
    const attr = it.props.Attribute ?? it.props.AttributePath ?? '';
    const label = it.props.Label ?? humanize(lastPart(attr || it.name || it.kind));
    const value = esc(sampleValue(attr || label, row, this.now));
    const readOnly = /never/i.test(it.props.Editable ?? '');
    const required = /\breq\b|-req\b|required/.test(c);
    const lab = `<label class="control-label">${esc(label)}${required ? ' <span class="mx-required">*</span>' : ''}</label>`;
    let control: string;
    if (readOnly) control = `<div class="form-control-static">${value}</div>`;
    else if (it.kind === 'checkbox' || it.kind === 'switch')
      return `<div${cls('form-group mx-checkbox', c)}><label class="mx-check"><input type="checkbox" disabled${row % 2 ? '' : ' checked'}> ${esc(label)}</label></div>`;
    else if (it.kind === 'radiobuttons') control = `<div class="mx-radios"><label><input type="radio" disabled checked> ${value}</label><label><input type="radio" disabled> Other</label></div>`;
    else if (/combobox|dropdown|referenceselector|referencesetselector|inputreferencesetselector/.test(it.kind)) control = `<div class="form-control mx-select"><span>${value}</span><span class="mx-caret" aria-hidden="true"></span></div>`;
    else if (it.kind === 'datepicker') control = `<div class="mx-dateinput"><div class="form-control">${esc(sampleValue('Date', row, this.now))}</div><span class="mx-dateinput-button" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 4h12v10H2zM2 7h12M5 2v3M11 2v3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></span></div>`;
    else if (it.kind === 'textarea' || it.kind === 'richtext') control = `<div class="form-control mx-textarea">${value}</div>`;
    else control = `<div class="form-control">${value}</div>`;
    return `<div${cls('form-group', c)}>${lab}<div class="mx-control">${control}</div></div>`;
  }

  grid(it: MdlItem, c: string): string {
    const cols = it.children.filter((x) => x.kind === 'column');
    const filters = it.children.filter((x) => x.kind !== 'column');
    const head = cols.map((col) => `<th>${esc(col.props.Caption ?? humanize(lastPart(col.props.Attribute ?? '')))}</th>`).join('');
    const rows = [0, 1, 2]
      .map((r) => `<tr>${cols.map((col) => `<td>${col.children.length ? this.all(col.children, r, true) : esc(col.props.Attribute ? sampleValue(col.props.Attribute, r, this.now) : '')}</td>`).join('')}</tr>`)
      .join('');
    return `<div${cls('mx-datagrid', c)}>${filters.length ? `<div class="mx-datagrid-filters">${this.all(filters)}</div>` : ''}<table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><div class="mx-datagrid-paging">1 to 3 of 3</div></div>`;
  }

  snippet(it: MdlItem, row: number, inForm: boolean): string {
    const qn = it.props.Snippet ?? '';
    const s = this.ctx.docs.get(qn);
    if (s && !this.open.includes(qn) && this.open.length < 4) {
      this.open.push(qn);
      try {
        return `<div class="mx-snippet">${this.all(s.widgets, row, inForm)}</div>`;
      } finally {
        this.open.pop();
      }
    }
    return `<div class="mx-snippet-box">Snippet ${esc(short(qn) || it.name || '')}</div>`;
  }

  menu(kind: string, c: string): string {
    const items = this.ctx.menu?.length ? this.ctx.menu : ['Home'];
    const li = items.map((m, i) => `<li${cls(i === 0 && 'active')}><a>${esc(m)}</a></li>`).join('');
    return `<ul${cls(kind === 'navigationtree' ? 'mx-navigationtree' : 'mx-navbar', c)}>${li}</ul>`;
  }
}

const INPUTS = new Set(['textbox', 'textarea', 'datepicker', 'combobox', 'dropdown', 'checkbox', 'radiobuttons', 'referenceselector', 'referencesetselector', 'inputreferencesetselector', 'switch', 'rating', 'slider', 'colorpicker', 'richtext', 'passwordbox']);

/** The layouts and snippets a page needs read to be shown in full (its layout, its snippets, theirs). */
export function wants(m: PageModel, ctx: PreviewContext): { type: 'layout' | 'snippet'; qn: string }[] {
  const out = new Map<string, 'layout' | 'snippet'>();
  const visit = (pm: PageModel, depth: number) => {
    if (pm.kind === 'page' && pm.layout && !ctx.docs.has(pm.layout)) out.set(pm.layout, 'layout');
    const walk = (items: MdlItem[]) => {
      for (const i of items) {
        const qn = i.kind === 'snippetcall' ? i.props.Snippet : undefined;
        if (qn) {
          const s = ctx.docs.get(qn);
          if (s === undefined) out.set(qn, 'snippet');
          else if (s && depth < 3) visit(s, depth + 1);
        }
        walk(i.children);
      }
    };
    walk(pm.widgets);
    if (pm.kind === 'page' && pm.layout) {
      const l = ctx.docs.get(pm.layout);
      if (l && depth < 3) visit(l, depth + 1);
    }
  };
  visit(m, 0);
  return [...out].map(([qn, type]) => ({ type, qn }));
}

/** The page as the app's HTML body: inside its layout (its Main placeholder) when the layout is known. */
export function previewBody(m: PageModel, ctx: PreviewContext): string {
  const now = ctx.now ?? new Date();
  const w = new Writer(ctx, now);
  const content = `<div class="mx-page">${m.title ? `<div class="mx-page-title-sr">${esc(m.title)}</div>` : ''}${w.all(m.widgets)}</div>`;
  const layout = m.kind === 'page' && m.layout ? ctx.docs.get(m.layout) : null;
  if (!layout) {
    // No layout read (yet): a plain top bar with the menu, as Atlas's default layout.
    const bar = m.kind === 'page' ? `<header class="mx-region-top"><span class="mx-brand">App</span>${w.menu('menubar', '')}</header>` : '';
    return `<div class="mx-layout">${bar}<main class="mx-region-center">${content}</main></div>`;
  }
  // The layout's own widgets, with the page where its Main placeholder is.
  const filled: MdlItem[] = JSON.parse(JSON.stringify(layout.widgets));
  const MARK = '\u0000PAGE\u0000';
  const swap = (items: MdlItem[]) => {
    for (const i of items) {
      if (i.kind === 'placeholder' && (i.name ?? 'Main') === 'Main') {
        i.kind = 'mx-page-slot';
      }
      if (i.kind === 'region') i.kind = `mx-region-${(i.name ?? 'center').toLowerCase()}`;
      swap(i.children);
    }
  };
  swap(filled);
  const lw = new (class extends Writer {
    one(it: MdlItem, row: number, inForm: boolean): string {
      if (it.kind === 'mx-page-slot') return MARK;
      if (it.kind.startsWith('mx-region-')) {
        const region = it.kind.slice('mx-region-'.length);
        const tag = region === 'top' ? 'header' : region === 'center' ? 'main' : region === 'bottom' ? 'footer' : 'aside';
        return `<${tag}${cls(`mx-region-${region}`, classes(it))}>${this.all(it.children, row, inForm)}</${tag}>`;
      }
      return super.one(it, row, inForm);
    }
  })(ctx, now);
  const html = lw.all(filled);
  return `<div class="mx-layout mx-layout-${esc((layout.layoutType ?? 'responsive').toLowerCase())}">${html.includes(MARK) ? html.replace(MARK, content) : html + content}</div>`;
}

/** The whole document for the frame: no scripts and nothing fetched (a CSP that allows only inline styles and data: images). */
export function previewDocument(body: string, title = 'Preview'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PREVIEW_CSS}</style></head><body>${body}</body></html>`;
}

export { TODAY_TEXT };
