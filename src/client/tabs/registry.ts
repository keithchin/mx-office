// The project tabs a feature adds to the 1D view (/lite) without touching lite.ts, lite.html or the
// navigation's own list: one registerTab call in the feature's own tab module, and that module's line in
// ./index.ts. The left navigation (ui/portal/nav-logic.ts) lists each in its group, after the built-in
// items unless its `order` says otherwise; the page (./host.ts) gives each an empty view container at
// start, mounts it the first time it's shown and calls its hooks as tabs change. ?tab=<id>, the page
// header, the search and the remembered navigation all know it by its id. Pure (no DOM), so the
// navigation's tests run it.

import type { GroupId } from '../ui/portal/nav-logic';

/** What a mounted tab does as the page changes tab. Every hook is optional. */
export interface TabHooks {
  /** The tab is showing (again): called on every showTab to it. */
  show?(): void;
  /** Another tab is showing: called on every showTab to another one, once it's mounted. */
  hide?(): void;
  /** The floor changed while the tab is showing. */
  refresh?(): void;
}

export interface TabDef {
  /** Its id: ?tab=<id>, its view container's id (<id>-view) and its tab-row button's (tab-<id>). Lower case. */
  id: string;
  /** The navigation group it's in. */
  group: GroupId;
  /** Its name in the navigation and the page header's title. */
  label: string;
  /** The page header's line under the title, and the item's tooltip. */
  tooltip: string;
  /** An emoji for its button in the classic themes' tab row (only with `tabRow`). */
  icon?: string;
  /** Only admins see it in the navigation. */
  admin?: boolean;
  /**
   * Where it goes in its group: the built-in items are 10, 20, 30… in their order, so 15 puts it after the
   * first. Without one it goes after the built-in items, registered tabs in the order they registered.
   */
  order?: number;
  /** A button in the classic themes' tab row too (Portal has the navigation). Off: links, the ☰ or Portal reach it. */
  tabRow?: boolean;
  /** Draws the tab into its (empty) container, the first time it's shown, and gives back its hooks. */
  mount(container: HTMLElement): TabHooks;
}

const TABS: TabDef[] = [];
let version = 0;

/** Adds a project tab. Throws for a bad or repeated id (a built-in tab's included). */
export function registerTab(def: TabDef): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id)) throw new Error(`registerTab: "${def.id}" is not a tab id (lower case letters, digits and -)`);
  if (TABS.some((t) => t.id === def.id) || reserved.has(def.id)) throw new Error(`registerTab: there is already a tab "${def.id}"`);
  TABS.push(def);
  version++;
}

/** The registered tabs, in the order they registered. */
export const registeredTabs = (): readonly TabDef[] => TABS;

/** The registered tab with this id. */
export const registeredTab = (id: unknown): TabDef | undefined => TABS.find((t) => t.id === id);

/** Goes up with every registration (the navigation's derived groups are cached against it). */
export const tabsVersion = (): number => version;

/** The built-in tabs' ids and actions' ids, which a registered tab can't take (nav-logic.ts sets them). */
const reserved = new Set<string>();
export function reserveTabIds(ids: Iterable<string>): void {
  for (const id of ids) reserved.add(id);
}

/** Tests only: forgets every registered tab. */
export function clearTabsForTests(): void {
  TABS.length = 0;
  version++;
}
