// The registered project tabs (./registry.ts) on the 1D view's page: at start, each gets an empty view
// container (#<id>-view, hidden, in the page where lite.html's views are) and, with `tabRow`, a button
// in the classic themes' tab row (#tab-<id>); nothing else runs until a tab is first shown, when it's
// mounted into its container. lite.ts's showTab hands every tab change to show(), which shows the one
// asked for (and calls its show hook) and hides the others (calling the hide hook of each one mounted).
// What isn't a tab but follows them (the team-lead panel docked beside every tab, ui/lead-panel/) hears
// each change with onProjectTab, so it never needs a line in showTab.

import './index';
import { store } from '../state';
import { h } from '../ui/dom';
import { registeredTabs, type TabDef, type TabHooks } from './registry';

const tabListeners = new Set<(id: string) => void>();
let opener: ((id: string) => void) | undefined;

/** Shows tab `id` the way the page does (its showTab: the address, the navigation, the tab's hooks). False before the page set up its tabs. */
export function openProjectTab(id: string): boolean {
  if (!opener) return false;
  opener(id);
  return true;
}
let shownTab: string | undefined;

/** Hears every tab the page shows (built-in or registered), and the one showing now, if it has shown one. */
export function onProjectTab(fn: (id: string) => void): () => void {
  tabListeners.add(fn);
  if (shownTab !== undefined) fn(shownTab);
  return () => tabListeners.delete(fn);
}

/** The tab the page is showing, once it has shown one. */
export const currentProjectTab = (): string | undefined => shownTab;

export interface ProjectTabs {
  /** The page is showing tab `id` (any tab, built-in or registered). */
  show(id: string): void;
}

/**
 * Puts every registered tab's container before `before` (and its tab-row button, if it has one, at the
 * end of `row`); `open` is the page's showTab, for those buttons.
 */
export function projectTabs(before: Element, row: Element | null, open: (id: string) => void): ProjectTabs {
  opener = open;
  const slots = registeredTabs().map((def: TabDef) => {
    const view = h('div.hidden', { id: `${def.id}-view` });
    before.before(view);
    let button: HTMLElement | undefined;
    if (def.tabRow && row) {
      button = h('button.btn', { id: `tab-${def.id}`, type: 'button', role: 'tab', title: def.tooltip }, `${def.icon ? `${def.icon} ` : ''}${def.label}`);
      button.addEventListener('click', () => open(def.id));
      row.append(button);
    }
    return { def, view, button, hooks: undefined as TabHooks | undefined };
  });
  let current: string | undefined;
  store.on('floor', () => slots.find((s) => s.def.id === current)?.hooks?.refresh?.());
  return {
    show(id) {
      current = id;
      for (const s of slots) {
        const on = s.def.id === id;
        s.view.classList.toggle('hidden', !on);
        s.button?.classList.toggle('on', on);
        if (on) (s.hooks ??= s.def.mount(s.view)).show?.();
        else s.hooks?.hide?.();
      }
      shownTab = id;
      for (const fn of tabListeners) fn(id);
    },
  };
}
