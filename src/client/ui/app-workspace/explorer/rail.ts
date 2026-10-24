// The explorer's collapsed rail (index.ts): » to expand, then one icon per section the tree has, the search
// and Show all files. A button opens the explorer at that place; nothing is read again.

import { h } from '../../dom';
import { icon, type PortalIcon } from '../../portal/icons';

/** The collapsed rail's buttons: the search, the business tree's sections (by their root's id), all files. */
export type RailTarget = 'find' | 'all' | 'pages' | 'data' | 'logic' | 'docs:documents' | 'docs:processmap' | 'docs:design';
const RAIL: { at: RailTarget; label: string; icon: PortalIcon; sep?: boolean }[] = [
  { at: 'find', label: 'Find', icon: 'search' },
  { at: 'pages', label: 'Pages', icon: 'page', sep: true },
  { at: 'data', label: 'Data', icon: 'database' },
  { at: 'logic', label: 'Logic', icon: 'flow' },
  { at: 'docs:documents', label: 'Documents', icon: 'doc' },
  { at: 'docs:processmap', label: 'Process map', icon: 'map' },
  { at: 'docs:design', label: 'Design', icon: 'palette' },
  { at: 'all', label: 'Show all files', icon: 'folder', sep: true },
];
/** Process map and Design are only there when the project has some (as in the tree). */
const SOMETIMES = new Set<RailTarget>(['docs:processmap', 'docs:design']);

export function explorerRail(expandBtn: HTMLElement, openAt: (at: RailTarget) => void) {
  const btns = new Map<RailTarget, HTMLButtonElement>();
  const el = h(
    'div.ax-rail',
    { role: 'toolbar', 'aria-label': 'Explorer sections', 'aria-orientation': 'vertical' },
    expandBtn,
    ...RAIL.flatMap((r) => {
      const b = h('button.ax-icon.ax-rail-btn', { type: 'button', 'data-ax-rail': r.at, title: r.label, 'aria-label': r.label }, icon(r.icon, 'ax-rail-ico')) as HTMLButtonElement;
      b.addEventListener('click', () => openAt(r.at));
      btns.set(r.at, b);
      return r.sep ? [h('span.ax-rail-sep', { 'aria-hidden': 'true' }), b] : [b];
    }),
  );
  /** Show all files pressed in all files; a section only when the tree has it (before the tree is read: the
   *  sections every project has; after, the ones its tree has, so none of Pages, Data, Logic when the model can't be read). */
  function paint(all: boolean, roots: readonly { id: string }[]) {
    btns.get('all')!.setAttribute('aria-pressed', String(all));
    for (const [at, b] of btns) if (at !== 'find' && at !== 'all') b.hidden = roots.length ? !roots.some((n) => n.id === at) : SOMETIMES.has(at);
  }
  return { el, paint };
}
