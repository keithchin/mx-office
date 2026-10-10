// The Navigation view: the app's navigation profiles (Responsive, Phone, Tablet and their offline kinds),
// each with its home page, the home pages per user role, its login and not-found pages, and its menu as
// a tree, read from the profiles' MDL (`describe navigation <profile>`, mdl-tree.ts). Pages named in it
// open in the Model tab. `navProfiles` is pure (tested in node); `navView` draws.

import { h } from '../dom';
import { parseMdl, type MdlItem } from './mdl-tree';

export interface NavMenuItem {
  caption: string;
  /** What clicking it does, as written: `show page M.P`, `call microflow M.F`, `sign out`, … */
  action?: string;
  /** The page or flow it opens, when it opens one. */
  target?: { type: 'page' | 'microflow' | 'nanoflow'; qn: string };
  children: NavMenuItem[];
}

export interface NavProfile {
  name: string;
  home?: string;
  /** Home pages per user role. */
  roleHomes: { role: string; page: string }[];
  login?: string;
  notFound?: string;
  menu: NavMenuItem[];
  /** The profile's lines in the MDL (0-based, inclusive). */
  lines: [number, number];
}

function menuOf(items: MdlItem[]): NavMenuItem[] {
  return items
    .filter((i) => i.kind === 'menu item' || i.kind === 'menu')
    .map((i) => {
      const action = i.props.OnClick ?? i.props.Action;
      const out: NavMenuItem = { caption: i.name ?? '', children: menuOf(i.children) };
      if (action) {
        out.action = action;
        const m = /^(?:show\s+page|call\s+(microflow|nanoflow))\s+([\w]+\.[\w]+)/i.exec(action);
        if (m) out.target = { type: m[1] ? (m[1].toLowerCase() as 'microflow' | 'nanoflow') : 'page', qn: m[2] };
      }
      return out;
    });
}

/** The profiles in the MDL of one or more `describe navigation` answers. */
export function navProfiles(mdl: string): NavProfile[] {
  const out: NavProfile[] = [];
  for (const s of parseMdl(mdl)) {
    const w = s.words.map((x) => x.toLowerCase());
    const at = w.indexOf('navigation');
    if (w[0] !== 'create' || at < 0 || !s.words[at + 1]) continue;
    const p: NavProfile = { name: s.words[at + 1], roleHomes: [], menu: menuOf(s.children), lines: s.lines };
    for (let i = at + 2; i < w.length; i++) {
      if (w[i] === 'home' && w[i + 1] === 'page' && s.words[i + 2]) {
        const page = s.words[i + 2];
        if (w[i + 3] === 'for' && s.words[i + 4]) {
          p.roleHomes.push({ role: s.words[i + 4], page });
          i += 4;
        } else {
          p.home = page;
          i += 2;
        }
      } else if (w[i] === 'login' && w[i + 1] === 'page' && s.words[i + 2]) {
        p.login = s.words[i + 2];
        i += 2;
      } else if (w[i] === 'not' && w[i + 1] === 'found' && w[i + 2] === 'page' && s.words[i + 3]) {
        p.notFound = s.words[i + 3];
        i += 3;
      }
    }
    out.push(p);
  }
  return out;
}

export interface NavEvents {
  open(type: string, qn: string): void;
}

/** The profiles drawn as cards: pages and flows named in them are buttons that open them. */
export function navView(profiles: NavProfile[], on: NavEvents): HTMLElement {
  const link = (type: string, qn: string) => h('button.mx-link.nv-link', { type: 'button', title: `Open ${qn}`, onclick: () => on.open(type, qn) }, qn);
  const menu = (items: NavMenuItem[]): HTMLElement =>
    h(
      'ul.nv-menu',
      {},
      ...items.map((m) =>
        h(
          'li',
          {},
          h('span.nv-cap', {}, m.caption || '(no caption)'),
          m.target ? h('span.nv-to', {}, ' → ', link(m.target.type, m.target.qn)) : m.action ? h('span.nv-to', {}, ` → ${m.action}`) : null,
          m.children.length ? menu(m.children) : null,
        ),
      ),
    );
  const cards = profiles.map((p) =>
    h(
      'section.nv-card',
      {},
      h('h3', {}, p.name),
      h(
        'dl.mx-kv',
        {},
        h('dt', {}, 'Home page'),
        h('dd', {}, p.home ? link('page', p.home) : '—'),
        ...p.roleHomes.flatMap((r) => [h('dt', {}, `Home · ${r.role}`), h('dd', {}, link('page', r.page))]),
        ...(p.login ? [h('dt', {}, 'Login page'), h('dd', {}, link('page', p.login))] : []),
        ...(p.notFound ? [h('dt', {}, 'Not found page'), h('dd', {}, link('page', p.notFound))] : []),
      ),
      h('h4', {}, `Menu (${p.menu.length})`),
      p.menu.length ? menu(p.menu) : h('p.mx-kind', {}, 'No menu items.'),
    ),
  );
  return h('div.nv', {}, ...(cards.length ? cards : [h('p.mx-kind', {}, 'This app has no navigation profiles.')]));
}
