// What choosing a node in the App Explorer shows. Documents open as themselves; the app-level nodes that
// are no single document open what they stand for: System Overview → the module graph, Navigation → every
// profile, a profile's home page or menu entry → its profile, a module's Security → its roles and
// security matrix, the User Roles and Demo Users folders → Project Security, a setting → Settings.
// JavaScript actions and page templates, which mxcli can't describe, show a short note. Pure (tested in node).

import type { ModelTreeNode } from '../../../shared/model';

export interface Target {
  type: string;
  qn: string;
  /** An element to pick once it's drawn (an entity or association chosen in the tree, by name). */
  pick?: string;
  /** Shown in place of asking the server: nothing more is known about this kind of node. */
  note?: string;
}

/** Documents the server shows as themselves (a diagram, its MDL, or a view drawn from its MDL). */
export const DOCS = new Set(['domainmodel', 'entity', 'association', 'microflow', 'nanoflow', 'page', 'snippet', 'layout', 'enumeration', 'constant', 'javaaction', 'workflow', 'jsonstructure', 'importmapping', 'exportmapping', 'imagecollection', 'scheduledevent', 'buildingblock', 'menu', 'restclient', 'odataclient', 'odataservice', 'regularexpression', 'queue', 'modulerole', 'userrole', 'demouser', 'projectsecurity', 'settings', 'navigation', 'navprofile', 'systemoverview']);
/** Nodes that stand for something else (by their place in the tree). */
const STAND_IN = new Set(['navhome', 'navmenu', 'navmenuitem', 'security', 'category', 'settingscategory', 'settingsitem']);
const NOTES: Record<string, string> = {
  javascriptaction: 'A JavaScript action: its code lives in the app\'s javascriptsource folder, and mxcli has no MDL description of it.',
  pagetemplate: 'A page template: the starting point Studio Pro offers for a new page. mxcli has no MDL description of it.',
};

/** Whether choosing `n` shows something (the rest only open and close). */
export const opensNode = (n: ModelTreeNode): boolean => (DOCS.has(n.type) && (!!n.qn || n.type === 'navigation' || n.type === 'systemoverview')) || STAND_IN.has(n.type) || !!NOTES[n.type];

/** What to show for `n`, given the way down to it (`path`: its ancestors, the app first). */
export function targetOf(n: ModelTreeNode, path: ModelTreeNode[]): Target | null {
  const up = (type: string) => [...path].reverse().find((p) => p.type === type);
  switch (n.type) {
    case 'entity':
    case 'association':
      return n.qn ? { type: n.type, qn: n.qn, pick: n.qn } : null;
    case 'systemoverview':
      return { type: 'systemoverview', qn: n.qn || 'SystemOverview' };
    case 'navigation':
      return { type: 'navigation', qn: n.qn || 'Navigation' };
    case 'navhome':
    case 'navmenu':
    case 'navmenuitem': {
      const p = up('navprofile');
      return p?.qn ? { type: 'navprofile', qn: p.qn } : { type: 'navigation', qn: 'Navigation' };
    }
    case 'security': {
      const m = up('module');
      const name = m?.qn ?? m?.label;
      return name ? { type: 'modulesecurity', qn: name } : null;
    }
    case 'category':
      return up('projectsecurity') ? { type: 'projectsecurity', qn: 'ProjectSecurity' } : null;
    case 'settingscategory':
    case 'settingsitem':
      return { type: 'settings', qn: 'Settings' };
  }
  if (NOTES[n.type]) return { type: n.type, qn: n.qn ?? n.label, note: NOTES[n.type] };
  return opensNode(n) && n.qn ? { type: n.type, qn: n.qn } : null;
}

/** The way down to `n` in `roots` (its ancestors, outermost first), or null when it isn't there. */
export function pathTo(roots: ModelTreeNode[], n: ModelTreeNode): ModelTreeNode[] | null {
  const way: ModelTreeNode[] = [];
  const find = (nodes: ModelTreeNode[]): boolean => {
    for (const c of nodes) {
      if (c === n) return true;
      if (c.children) {
        way.push(c);
        if (find(c.children)) return true;
        way.pop();
      }
    }
    return false;
  };
  return find(roots) ? way : null;
}
