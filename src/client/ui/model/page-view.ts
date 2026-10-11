// The Page view of a page, snippet or layout: a read-only wireframe of its structure, as Studio Pro's page
// editor lays it out in structure mode: layout grids in rows and columns, containers, data views, list
// views and data grids (with their columns), text, buttons, inputs labelled with their attribute, snippets
// as labelled boxes and the layout's placeholders. Widgets it doesn't know get a labelled box. (The Preview,
// page-frame.ts, shows the page as the running app would; the Live app shows it running.)
//
// It's drawn from the page's MDL (page-model.ts), only while the view is on screen; clicking a widget
// shows its properties and MDL beside it (details via `on.select`).

import { h } from '../dom';
import type { MdlItem } from './mdl-tree';
import { pageModel, sourceOf, textOf, type PageModel } from './page-model';

export interface PageView {
  readonly el: HTMLElement;
  /** Draws the page in `mdl`; false when the text isn't a page (the MDL is shown instead). */
  show(mdl: string): boolean;
  clear(): void;
  zoom(f: number): void;
  fit(): void;
  /** The zoom, in percent. */
  readonly percent: number;
}

export interface PageEvents {
  select(item: MdlItem | null): void;
}

const INPUTS = new Set(['textbox', 'textarea', 'datepicker', 'combobox', 'dropdown', 'checkbox', 'radiobuttons', 'referenceselector', 'referencesetselector', 'inputreferencesetselector', 'switch', 'rating', 'slider', 'colorpicker', 'richtext', 'passwordbox', 'fileuploader', 'imageuploader']);
const FILTERS = new Set(['textfilter', 'numberfilter', 'datefilter', 'dropdownfilter', 'searchfield']);
const TEXTS = new Set(['dynamictext', 'statictext', 'text', 'label', 'title', 'pagetitle']);
const BUTTONS = new Set(['actionbutton', 'linkbutton', 'button']);
const BOXES: Record<string, string> = { container: 'Container', scrollcontainer: 'Scroll container', region: 'Region', footer: 'Footer', header: 'Header', controlbar: 'Control bar', groupbox: 'Group box', tabpage: 'Tab page', tabcontainer: 'Tab container', navigationlist: 'Navigation list', item: 'Item', template: 'Template' };
const MENUS: Record<string, string> = { menubar: 'Menu bar', simplemenubar: 'Simple menu bar', navigationtree: 'Navigation tree', languageselector: 'Language selector' };
const IMAGES = new Set(['image', 'staticimage', 'dynamicimage']);

const short = (qn: string) => qn.slice(qn.lastIndexOf('.') + 1);
const attrOf = (it: MdlItem) => it.props.Attribute ?? it.props.AttributePath ?? '';

export function pageView(on: PageEvents): PageView {
  const items = new WeakMap<HTMLElement, MdlItem>();
  let scale = 1;
  let selected: HTMLElement | null = null;
  const sheet = h('div.pg-sheet');
  const el = h('div.pgv-host', {}, sheet);
  el.hidden = true;

  el.addEventListener('click', (e) => {
    let t = e.target as HTMLElement | null;
    while (t && t !== el && !items.has(t)) t = t.parentElement;
    const item = t && t !== el ? items.get(t) ?? null : null;
    selected?.classList.remove('pg-sel');
    selected = item ? t : null;
    selected?.classList.add('pg-sel');
    on.select(item);
  });

  /** A widget's element, known for clicks, with its kind and name as a small tag. */
  const node = (it: MdlItem, cls: string, tag: string | null, ...kids: (Node | string | null)[]): HTMLElement => {
    const e = h(`div.pg-w.${cls}`, { title: `${it.kind}${it.name ? ` ${it.name}` : ''}` }, tag ? h('span.pg-tag', {}, tag) : null, ...kids);
    items.set(e, it);
    return e;
  };

  const kids = (list: MdlItem[], ctx: string): HTMLElement[] => list.map((c) => widget(c, ctx));

  function grid(it: MdlItem): HTMLElement {
    const cols = it.children.filter((c) => c.kind === 'column');
    const filters = it.children.filter((c) => c.kind !== 'column');
    const head = h('div.pg-tr.pg-th', {}, ...cols.map((c) => h('div.pg-td', {}, c.props.Caption ?? (short(attrOf(c)) || 'Column'))));
    const row = h(
      'div.pg-tr',
      {},
      ...cols.map((c) => {
        const cell = node(c, 'pg-td', null, ...(c.children.length ? kids(c.children, 'cell') : [h('span.pg-attr', {}, attrOf(c) ? `[${attrOf(c)}]` : '')]));
        return cell;
      }),
    );
    const ghost = h('div.pg-tr.pg-ghost', {}, ...cols.map(() => h('div.pg-td', {}, '')));
    const table = h('div.pg-table', { style: `--pg-cols:${Math.max(1, cols.length)}` }, head, row, ghost);
    return node(it, 'pg-data.pg-grid2', null, h('div.pg-head', {}, h('b', {}, 'Data grid'), ` · ${sourceOf(it)}`), filters.length ? h('div.pg-filters', {}, ...kids(filters, 'grid')) : null, table);
  }

  function widget(it: MdlItem, ctx = ''): HTMLElement {
    const k = it.kind;
    if (k === 'layoutgrid') return node(it, 'pg-lgrid', `Layout grid${it.name ? ` ${it.name}` : ''}`, ...kids(it.children, 'grid'));
    if (k === 'row') return node(it, 'pg-row', null, ...kids(it.children, 'row'));
    if (k === 'column' && ctx === 'row') {
      const w = Number(it.props.DesktopWidth);
      const e = node(it, 'pg-col', null, ...kids(it.children, ''));
      e.style.flex = w > 0 && w <= 12 ? `0 0 calc(${(w / 12) * 100}% - 8px)` : '1 1 0';
      return e;
    }
    if (k === 'dataview') {
      const footer = it.children.filter((c) => c.kind === 'footer');
      return node(it, 'pg-data', null, h('div.pg-head', {}, h('b', {}, 'Data view'), ` · ${sourceOf(it)}`), h('div.pg-body', {}, ...kids(it.children.filter((c) => c.kind !== 'footer'), '')), ...kids(footer, ''));
    }
    if (k === 'listview' || k === 'gallery' || k === 'templategrid') {
      const label = k === 'listview' ? 'List view' : k === 'gallery' ? 'Gallery' : 'Template grid';
      return node(it, 'pg-data.pg-list', null, h('div.pg-head', {}, h('b', {}, label), ` · ${sourceOf(it)}`), h('div.pg-body.pg-repeat', {}, ...kids(it.children, '')));
    }
    if (k === 'datagrid' || k === 'datagrid2') return grid(it);
    if (TEXTS.has(k)) {
      const mode = (it.props.RenderMode ?? '').toLowerCase();
      const hx = /^h[1-6]$/.test(mode) ? mode : '';
      const label = k === 'label' && !it.props.Content ? it.props.Caption ?? it.name ?? '' : textOf(it);
      return node(it, `pg-text${hx ? `.pg-${hx}` : ''}`, null, label || it.name || 'Text');
    }
    if (BUTTONS.has(k)) {
      const style = (it.props.ButtonStyle ?? '').toLowerCase();
      const cls = k === 'linkbutton' ? 'pg-linkbtn' : `pg-btn${style ? `.pg-btn-${style.replace(/\W/g, '')}` : ''}`;
      const e = node(it, cls, null, it.props.Caption ?? it.name ?? 'Button');
      if (it.props.Action) e.title = `${k} ${it.name ?? ''}: ${it.props.Action}`;
      return e;
    }
    if (INPUTS.has(k)) {
      const attr = attrOf(it);
      const label = it.props.Label ?? short(attr.slice(attr.lastIndexOf('/') + 1));
      if (k === 'checkbox' || k === 'switch') return node(it, 'pg-input.pg-check', null, h('span.pg-box'), h('span.pgv-label', {}, label || it.name || ''), h('span.pg-attr', {}, attr ? `[${attr}]` : ''));
      return node(it, `pg-input${k === 'textarea' || k === 'richtext' ? '.pg-tall' : ''}`, null, h('span.pgv-label', {}, label || it.name || k), h('span.pg-field', {}, attr ? `[${attr}]` : k, /combobox|dropdown|referenceselector|datepicker/.test(k) ? h('span.pg-caret', {}, k === 'datepicker' ? '▦' : '▾') : null));
    }
    if (FILTERS.has(k)) return node(it, 'pg-input.pg-filter', null, h('span.pg-field', {}, `${k.replace('filter', ' filter')}${attrOf(it) ? ` [${attrOf(it)}]` : ''}`));
    if (k === 'snippetcall') return node(it, 'pg-snippet', null, h('span.pg-tag', {}, 'Snippet'), h('b', {}, it.props.Snippet ?? it.name ?? ''));
    if (k === 'placeholder') return node(it, 'pg-ph', null, h('span.pg-tag', {}, 'Placeholder'), h('b', {}, it.name ?? 'Main'));
    if (IMAGES.has(k)) return node(it, 'pg-img', null, h('span', {}, it.props.Image ? short(it.props.Image) : 'Image'));
    if (MENUS[k]) return node(it, 'pg-menu', null, h('span.pg-tag', {}, MENUS[k]), it.props.Profile ?? it.props.Menu ?? '');
    if (k === 'tabcontainer') {
      const pages = it.children.filter((c) => c.kind === 'tabpage');
      return node(it, 'pg-box.pg-tabs', 'Tab container', h('div.pg-tabstrip', {}, ...pages.map((p) => h('span', {}, p.props.Caption ?? p.name ?? 'Tab'))), ...kids(it.children, ''));
    }
    if (BOXES[k]) {
      const cap = k === 'groupbox' || k === 'tabpage' ? it.props.Caption : k === 'region' ? it.name : undefined;
      return node(it, `pg-box.pg-${k}`, `${BOXES[k]}${cap ? ` · ${cap}` : it.name && k !== 'region' ? ` ${it.name}` : ''}`, ...kids(it.children, ''));
    }
    // Anything else: a labelled box, with what's inside it.
    return node(it, 'pg-box.pg-other', `${k}${it.name ? ` ${it.name}` : ''}`, ...kids(it.children, ''));
  }

  function header(m: PageModel): HTMLElement {
    const facts: [string, string | undefined][] = [
      ['Title', m.title],
      ['Layout', m.layout],
      ['URL', m.url ? `/${m.url.replace(/^\//, '')}` : undefined],
      ['Parameters', m.params],
      ['Type', m.layoutType],
      ['Folder', m.folder],
      ['Visible to', m.roles.length ? m.roles.map(short).join(', ') : undefined],
    ];
    return h('div.pg-meta', {}, h('b', {}, `${m.kind[0].toUpperCase()}${m.kind.slice(1)} ${m.name}`), ...facts.filter(([, v]) => v).map(([k, v]) => h('span', {}, h('i', {}, `${k} `), v ?? '')));
  }

  const apply = () => {
    sheet.style.zoom = String(scale);
  };

  return {
    el,
    get percent() {
      return Math.round(scale * 100);
    },
    show(mdl: string) {
      const m = pageModel(mdl);
      selected = null;
      if (!m) {
        sheet.replaceChildren();
        el.hidden = true;
        return false;
      }
      const content = m.widgets.map((w) => widget(w));
      // A page sits in its layout's placeholder; a layout or snippet is drawn as it is.
      const body = m.kind === 'page' && m.layout ? h('div.pg-layout', {}, h('span.pg-tag', {}, `Layout ${short(m.layout)} › Main`), ...content) : h('div.pg-layout.pg-bare', {}, ...content);
      sheet.replaceChildren(header(m), body);
      el.hidden = false;
      el.scrollTop = 0;
      apply();
      return true;
    },
    clear() {
      sheet.replaceChildren();
      el.hidden = true;
      selected = null;
    },
    zoom(f: number) {
      scale = Math.min(2, Math.max(0.4, scale * f));
      apply();
    },
    fit() {
      scale = 1;
      apply();
    },
  };
}

/** The details of a widget picked in the Page view: what it is, its properties as written, and its MDL. */
export function widgetFacts(it: MdlItem): { title: string; kind: string; props: [string, string][] } {
  const title = it.props.Caption ?? it.props.Label ?? it.name ?? it.kind;
  return { title, kind: `${it.kind}${it.name && it.name !== title ? ` · ${it.name}` : ''}`, props: Object.entries(it.props) };
}
