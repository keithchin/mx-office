// The Preview of a page, snippet or layout: its widget tree (page-model.ts) written out as HTML that looks
// like the running Mendix app would, with an Atlas-like stylesheet of our own (preview-css.ts): the layout
// grid, form groups with a label and an input, select, checkbox or date picker per attribute, data grids as
// tables with a header and three sample rows, list views as cards, buttons in their styles, headings, group
// boxes and tab containers, snippets inlined when their MDL is known, image placeholders, and the page
// inside its layout (top bar, sidebar, menu) when the layout's MDL is known. Sample values come from the
// attributes' names. It is shown in a sandboxed frame with no network (`previewDocument`, doc-views.ts).
//
// Bounded (preview-parts.ts): sample rows by list depth with the rest said, a widget budget per page, conditional
// blocks tagged "Shown when …" (never worked out), cases of one value drawn once, empty states labelled, and
// widgets it can't draw as labelled boxes with their type. With `marks`, every named widget of the page and its
// snippets carries its document, name and plain label (data-mx-*), for Select element (preview-pick.ts).
// Pure: strings in, a string out (tested in node).

import type { MdlItem } from './mdl-tree';
import type { PageModel } from './page-model';
import { textOf } from './page-model';
import { PREVIEW_CSS } from './preview-css';
import { conditionWords, countWidgets, elementLabel, TEXTS, groupCases, isEmptyState, moreRows, SAMPLE_ROWS, sampleRows, WIDGET_BUDGET } from './preview-parts';

export interface PreviewContext {
  /** Snippets and layouts already read, by qualified name (null: asked for, not there). */
  docs: Map<string, PageModel | null>;
  /** The navigation menu's captions, for menu bars. */
  menu?: string[];
  now?: Date;
  /** Mark the page's and its snippets' widgets for picking (data-mx-el, -w, -doc, -label). */
  marks?: boolean;
  /** Layout CSS read from the project's theme (server/app-explorer/theme.ts), added after ours. */
  theme?: string;
  /** Widgets per page before the rest is cut (tests). */
  budget?: number;
}

/** A widget the preview drew and marked: what Select element picks. */
export interface PreviewElement {
  /** Its index in data-mx-el. */
  el: number;
  docType: 'page' | 'snippet';
  docQn: string;
  name: string;
  /** Its MDL keyword (actionbutton, textbox, …). */
  kind: string;
  label: string;
  /** The snippet call it came through, when it's in a snippet. */
  via?: string;
}

/** What the drawing left out or labelled, so the pane can say it (nothing disappears silently). */
export interface PreviewReport {
  elements: PreviewElement[];
  /** Widget types drawn as labelled boxes, with how many. */
  placeholders: { kind: string; count: number }[];
  /** Conditional blocks tagged, and cases of a value not drawn. */
  conditions: number;
  casesNotDrawn: number;
  /** List rows not drawn (nested lists show fewer), and widgets cut by the budget. */
  rowsNotDrawn: number;
  cut: number;
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

/** Kinds that only hold others (drawn as their contents, never as a "not drawn" box). */
const HOLDERS = new Set(['template', 'tabpage', 'region', 'contents', 'widgets']);
/** Kinds never offered for picking (they're the grid, not something on the page). */
const UNPICKED = new Set(['row', 'column', 'layoutgrid', 'template', 'tabpage', 'footer', 'header', 'controlbar', 'placeholder', 'mx-page-slot']);

/** The state shared by the page's writer and its layout's (one budget, one report). */
interface Shared {
  used: number;
  budget: number;
  report: PreviewReport;
  byKey: Map<string, number>;
  /** Widget types not drawn → the widgets (by document and name, so sample rows count once). */
  placeholders: Map<string, Set<string>>;
}

class Writer {
  /** Snippets being written (a snippet that calls itself stops there). */
  private open: string[] = [];
  /** Lists we're inside of. */
  private depth = 0;
  /** The widget being written follows a text (its label, as the app draws it). */
  protected afterText = false;
  /** The document whose widgets are being written (null: the layout's own, not marked). */
  protected owner: { type: 'page' | 'snippet'; qn: string; via?: string } | null;
  constructor(
    protected ctx: PreviewContext,
    protected now: Date,
    protected s: Shared,
    page: string | null,
  ) {
    this.owner = page ? { type: 'page', qn: page } : null;
  }

  all(items: MdlItem[], row = 0, inForm = false): string {
    let out = '';
    const parts = groupCases(items);
    for (let i = 0; i < parts.length; i++) {
      if (this.s.used >= this.s.budget) {
        const left = countWidgets(parts.slice(i).flatMap((p) => ('item' in p ? [p.item] : p.cases)));
        this.s.report.cut += left;
        out += `<div class="mx-cut">… ${left} more widget${left === 1 ? '' : 's'} not drawn (preview limit)</div>`;
        break;
      }
      const p = parts[i];
      // An input right after a text has that text as its label (the app draws its own): no second label then.
      const prev = i > 0 ? parts[i - 1] : undefined;
      this.afterText = !!prev && 'item' in prev && /^(dynamictext|statictext|text|label)$/.test(prev.item.kind);
      out += 'item' in p ? this.cond(p.item, row, inForm, []) : this.cond(p.cases[0], row, inForm, p.cases.slice(1));
    }
    return out;
  }

  /** One widget, tagged when it's shown only under a condition (with the other cases of its value named). */
  cond(it: MdlItem, row: number, inForm: boolean, others: MdlItem[]): string {
    const html = this.mark(it, this.one(it, row, inForm), row);
    const v = it.props.Visible;
    if (!v) return html;
    const r = this.s.report;
    if (row === 0) ((r.conditions += 1), (r.casesNotDrawn += others.length));
    const empty = isEmptyState(it);
    const words = `${empty ? 'Empty state · shown when' : 'Shown when'} ${conditionWords(v)}`;
    const rest = others.length ? ` · +${others.length} other case${others.length === 1 ? '' : 's'}` : '';
    const title = others.length ? `${words}. Not drawn: ${others.map((o) => `${o.name ?? o.kind} (when ${conditionWords(o.props.Visible ?? '')})`).join('; ')}` : `${words}. Not worked out: the preview has no data.`;
    const inline = TEXTS.test(it.kind) || /^(actionbutton|button|linkbutton)$/.test(it.kind);
    const tag = inline ? 'span' : 'div';
    return `<${tag} class="mx-cond${empty ? ' mx-cond-empty' : ''}${inline ? ' mx-cond-inline' : ''}" title="${esc(title)}"><span class="mx-cond-tag">${esc(words + rest)}</span>${html}</${tag}>`;
  }

  /** The widget's marks (document, name, label) on its first tag, when marking and it belongs to the page or a snippet. */
  mark(it: MdlItem, html: string, row: number): string {
    this.s.used++;
    const o = this.owner;
    if (!this.ctx.marks || !o || !it.name || UNPICKED.has(it.kind) || it.kind.startsWith('mx-') || !html.startsWith('<')) return html;
    const key = `${o.qn}\u0000${it.name}`;
    let el = this.s.byKey.get(key);
    if (el === undefined) {
      el = this.s.report.elements.length;
      this.s.byKey.set(key, el);
      const label = elementLabel(it, TEXTS.test(it.kind) ? filledText(it, row, this.now) : undefined);
      this.s.report.elements.push({ el, docType: o.type, docQn: o.qn, name: it.name, kind: it.kind, label, ...(o.via ? { via: o.via } : {}) });
    }
    const e = this.s.report.elements[el];
    const at = /^<[a-z0-9]+/i.exec(html)?.[0].length ?? 0;
    return `${html.slice(0, at)} data-mx-el="${el}" data-mx-w="${esc(e.name)}" data-mx-doc="${esc(e.docQn)}" data-mx-label="${esc(e.label)}"${html.slice(at)}`;
  }

  /** A widget the preview can't draw: a labelled box with its type (its contents inside, when it has any). */
  unsupported(it: MdlItem, row: number, inForm: boolean): string {
    const seen = this.s.placeholders.get(it.kind) ?? this.s.placeholders.set(it.kind, new Set()).get(it.kind)!;
    seen.add(`${this.owner?.qn ?? ''}/${it.name ?? seen.size}`);
    const label = `${esc(it.kind)}${it.name ? ` · ${esc(it.name)}` : ''}`;
    if (!it.children.length) return `<div class="mx-unknown"><span class="mx-unknown-tag">Not drawn</span> ${label}</div>`;
    return `<div class="mx-unsupported${classes(it) ? ` ${esc(classes(it))}` : ''}"><span class="mx-unknown-tag">Not drawn: ${label}, its contents:</span>${this.all(it.children, row, inForm)}</div>`;
  }

  /** A list's sample rows: fewer when nested, the rest said; none past the budget. */
  rows(draw: (r: number) => string, more: (n: number) => string): string {
    const want = sampleRows(this.depth);
    this.depth++;
    let out = '';
    let drawn = 0;
    try {
      for (let r = 0; r < want && (r === 0 || this.s.used < this.s.budget); r++, drawn++) out += draw(r);
    } finally {
      this.depth--;
    }
    const left = SAMPLE_ROWS - drawn;
    if (left > 0) {
      this.s.report.rowsNotDrawn += left;
      out += more(left);
    }
    return out;
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
        const body = it.children.length === 1 && it.children[0].kind === 'template' ? it.children[0].children : it.children;
        const items = this.rows((r) => `<li class="mx-listview-item">${this.all(body, r, true)}</li>`, (n) => `<li class="mx-more">${moreRows(n)}</li>`);
        const cols = Number(it.props.DesktopColumns);
        return `<ul${cls(k === 'listview' ? 'mx-listview' : 'mx-gallery', cols > 0 && cols <= 6 && `mx-cols-${cols}`, c)}>${items}</ul>`;
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
    // Only a holder of others: its contents. Anything else is a labelled box with its type (its contents inside).
    if (HOLDERS.has(k)) return `<div${cls(c)}>${this.all(it.children, row, inForm)}</div>`;
    return this.unsupported(it, row, inForm);
  }

  input(it: MdlItem, row: number, c: string): string {
    const attr = it.props.Attribute ?? it.props.AttributePath ?? '';
    const label = it.props.Label ?? humanize(lastPart(attr || it.name || it.kind));
    const value = esc(sampleValue(attr || label, row, this.now));
    const readOnly = /never/i.test(it.props.Editable ?? '');
    const required = /\breq\b|-req\b|required/.test(c);
    const lab = it.props.Label === undefined && this.afterText ? '' : `<label class="control-label">${esc(label)}${required ? ' <span class="mx-required">*</span>' : ''}</label>`;
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
    const rows = this.rows(
      (r) => `<tr>${cols.map((col) => `<td>${col.children.length ? this.all(col.children, r, true) : esc(col.props.Attribute ? sampleValue(col.props.Attribute, r, this.now) : '')}</td>`).join('')}</tr>`,
      (n) => `<tr class="mx-more"><td colspan="${Math.max(1, cols.length)}">${moreRows(n)}</td></tr>`,
    );
    return `<div${cls('mx-datagrid', c)}>${filters.length ? `<div class="mx-datagrid-filters">${this.all(filters)}</div>` : ''}<table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><div class="mx-datagrid-paging">1 to 3 of 3</div></div>`;
  }

  snippet(it: MdlItem, row: number, inForm: boolean): string {
    const qn = it.props.Snippet ?? '';
    const s = this.ctx.docs.get(qn);
    if (s && !this.open.includes(qn) && this.open.length < 4) {
      this.open.push(qn);
      const owner = this.owner;
      // Its widgets belong to the snippet (a request about one points at the snippet, and so at every page using it).
      this.owner = this.ctx.marks ? { type: 'snippet', qn, via: owner?.via ?? owner?.qn ?? qn } : owner;
      try {
        return `<div class="mx-snippet">${this.all(s.widgets, row, inForm)}</div>`;
      } finally {
        this.open.pop();
        this.owner = owner;
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

/** The page drawn, and what the drawing left out or labelled. */
export function previewRender(m: PageModel, ctx: PreviewContext): { html: string; report: PreviewReport } {
  const now = ctx.now ?? new Date();
  const report: PreviewReport = { elements: [], placeholders: [], conditions: 0, casesNotDrawn: 0, rowsNotDrawn: 0, cut: 0 };
  const s: Shared = { used: 0, budget: ctx.budget ?? WIDGET_BUDGET, report, byKey: new Map(), placeholders: new Map() };
  const html = render(m, ctx, now, s);
  report.placeholders = [...s.placeholders].map(([kind, set]) => ({ kind, count: set.size })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { html, report };
}

/** The page as the app's HTML body: inside its layout (its Main placeholder) when the layout is known. */
export function previewBody(m: PageModel, ctx: PreviewContext): string {
  return previewRender(m, ctx).html;
}

/** A pop-up page: its layout says so (type or name), and it's drawn as a dialog over a dimmed page. */
const isPopup = (m: PageModel, layout: PageModel | null | undefined) => /popup|modal/i.test(`${layout?.layoutType ?? ''} ${m.layout ?? ''}`);

function render(m: PageModel, ctx: PreviewContext, now: Date, s: Shared): string {
  const w = new Writer(ctx, now, s, m.kind === 'page' || m.kind === 'snippet' ? m.name : null);
  const content = `<div class="mx-page">${m.title ? `<div class="mx-page-title-sr">${esc(m.title)}</div>` : ''}${w.all(m.widgets)}</div>`;
  const layout = m.kind === 'page' && m.layout ? ctx.docs.get(m.layout) : null;
  if (m.kind === 'page' && isPopup(m, layout)) {
    // A dialog: its title bar and the page, over a dimmed backdrop (the page it opens from isn't known here).
    return `<div class="mx-layout mx-popup-backdrop"><div class="mx-dialog" role="dialog" aria-label="${esc(m.title ?? 'Dialog')}"><div class="mx-dialog-header"><span class="mx-dialog-title">${esc(m.title ?? short(m.name))}</span><span class="mx-dialog-close" aria-hidden="true">✕</span></div><div class="mx-dialog-body">${content}</div></div></div>`;
  }
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
  })(ctx, now, s, null);
  const html = lw.all(filled);
  return `<div class="mx-layout mx-layout-${esc((layout.layoutType ?? 'responsive').toLowerCase())}">${html.includes(MARK) ? html.replace(MARK, content) : html + content}</div>`;
}

/**
 * The whole document for the frame: nothing fetched (a CSP that allows only inline styles and data: images). The
 * project's layout CSS (`theme`, cleaned on the server: server/app-explorer/theme.ts) goes after ours. A script
 * runs only when one is given (Select element, preview-pick.ts), allowed by a nonce made for this document:
 * nothing in a page's text can carry it, as everything written is escaped.
 */
export function previewDocument(body: string, title = 'Preview', o: { theme?: string; script?: string; nonce?: string } = {}): string {
  const run = !!(o.script && o.nonce && /^[A-Za-z0-9]{16,64}$/.test(o.nonce));
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:${run ? `; script-src 'nonce-${o.nonce}'` : ''}`;
  const theme = o.theme ? `<style>${o.theme.replace(/</g, '')}</style>` : '';
  const script = run ? `<script nonce="${o.nonce}">${(o.script as string).replace(/<\/(script)/gi, '<\\/$1')}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PREVIEW_CSS}</style>${theme}</head><body>${body}${script}</body></html>`;
}

export { TODAY_TEXT };
