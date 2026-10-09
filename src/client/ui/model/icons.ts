// The Model tab's icons, drawn here as original SVG in the spirit of Studio Pro's (no Mendix artwork):
// the App Explorer's per-type icons (16×16) and the activity icons drawn at the left of a microflow's
// activity boxes (a ring with a glyph, and a dark badge for what the action does).

const svg = (body: string, vb = 16) => `<svg class="mx-ico" viewBox="0 0 ${vb} ${vb}" width="16" height="16" aria-hidden="true">${body}</svg>`;

const BLUE = '#2f8fe0';
const AMBER = '#e8a92e';
const GREEN = '#3aa655';
const PURPLE = '#8a63d2';
const GREY = '#6b7280';
const ORANGE = '#e0752d';

/** App Explorer icons by mxcli's tree type. */
const TREE: Record<string, string> = {
  app: svg(`<rect x="2" y="2" width="12" height="12" rx="2.5" fill="${BLUE}"/><path d="M5 11V5l3 3 3-3v6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`),
  module: svg(`<path d="M8 1.8l5.6 3v6.4L8 14.2l-5.6-3V4.8z" fill="#d8e6f5" stroke="${BLUE}" stroke-width="1.1" stroke-linejoin="round"/><path d="M2.6 4.9L8 7.8l5.4-2.9M8 7.8v6.2" fill="none" stroke="${BLUE}" stroke-width="1.1"/>`),
  folder: svg(`<path d="M1.5 4.2c0-.6.4-1 1-1h3.4l1.4 1.5h6.2c.6 0 1 .4 1 1v6.9c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z" fill="#f6cf6a" stroke="${AMBER}" stroke-width="1"/>`),
  domainmodel: svg(`<rect x="1.5" y="2" width="6" height="5" rx="1" fill="#cfe6ff" stroke="${BLUE}"/><rect x="8.5" y="9" width="6" height="5" rx="1" fill="#cfe6ff" stroke="${BLUE}"/><path d="M4.5 7v4.5h4" fill="none" stroke="${GREY}" stroke-width="1"/>`),
  entity: svg(`<rect x="2" y="3" width="12" height="10" rx="1.5" fill="#cfe6ff" stroke="${BLUE}"/><path d="M2 6.2h12" stroke="${BLUE}"/><path d="M4 8.5h6M4 10.5h4" stroke="${GREY}"/>`),
  association: svg(`<circle cx="3.5" cy="12.5" r="2" fill="none" stroke="${GREY}"/><circle cx="12.5" cy="3.5" r="2" fill="${GREY}"/><path d="M5 11L11 5" stroke="${GREY}" stroke-width="1.2"/>`),
  microflow: svg(`<circle cx="2.8" cy="8" r="1.9" fill="#a7d86d" stroke="#5fae1c" stroke-width=".9"/><rect x="5.6" y="5.2" width="5" height="5.6" rx="1.3" fill="#d6ecfb" stroke="${BLUE}" stroke-width="1"/><circle cx="13.3" cy="8" r="1.9" fill="#f59a9d" stroke="#e0353c" stroke-width=".9"/><path d="M4.7 8h.9M10.6 8h.8" stroke="#333" stroke-width=".9"/>`),
  nanoflow: svg(`<circle cx="2.8" cy="8" r="1.9" fill="#a7d86d" stroke="#5fae1c" stroke-width=".9"/><rect x="5.6" y="5.2" width="5" height="5.6" rx="1.3" fill="#e8defa" stroke="${PURPLE}" stroke-width="1"/><circle cx="13.3" cy="8" r="1.9" fill="#f59a9d" stroke="#e0353c" stroke-width=".9"/><path d="M4.7 8h.9M10.6 8h.8" stroke="#333" stroke-width=".9"/><path d="M8.4 6.2l-1.2 2h1.6l-1 1.8" fill="none" stroke="${PURPLE}" stroke-width=".9"/>`),
  rule: svg(`<path d="M8 2l6 6-6 6-6-6z" fill="#fde6c4" stroke="${AMBER}"/><path d="M6 8h4" stroke="${AMBER}"/>`),
  page: svg(`<rect x="2" y="1.8" width="12" height="12.4" rx="1.3" fill="#fff" stroke="${BLUE}"/><path d="M2 5h12" stroke="${BLUE}"/><path d="M4.2 7.5h7.6M4.2 9.6h7.6M4.2 11.7h4.6" stroke="#9cc6ec"/>`),
  snippet: svg(`<rect x="2" y="3" width="12" height="10" rx="1.3" fill="#fff" stroke="${BLUE}" stroke-dasharray="2 1.4"/><path d="M4.5 6.5h7M4.5 9.5h5" stroke="#9cc6ec"/>`),
  layout: svg(`<rect x="2" y="2" width="12" height="12" rx="1.3" fill="#fff" stroke="${BLUE}"/><path d="M2 5.2h12M6 5.2V14" stroke="${BLUE}"/>`),
  pagetemplate: svg(`<rect x="3.5" y="1.8" width="10.5" height="11" rx="1.2" fill="#eef5fd" stroke="#8db8e4"/><rect x="2" y="3.4" width="10.5" height="11" rx="1.2" fill="#fff" stroke="${BLUE}"/><path d="M2 6.3h10.5" stroke="${BLUE}"/>`),
  buildingblock: svg(`<rect x="2" y="2" width="5.4" height="5.4" rx="1" fill="#d6ecfb" stroke="${BLUE}"/><rect x="8.6" y="2" width="5.4" height="5.4" rx="1" fill="#fff" stroke="${BLUE}"/><rect x="2" y="8.6" width="12" height="5.4" rx="1" fill="#fff" stroke="${BLUE}"/>`),
  enumeration: svg(`<circle cx="3.5" cy="4" r="1.3" fill="${GREEN}"/><circle cx="3.5" cy="8" r="1.3" fill="${GREEN}"/><circle cx="3.5" cy="12" r="1.3" fill="${GREEN}"/><path d="M6.5 4h7M6.5 8h7M6.5 12h7" stroke="${GREY}" stroke-width="1.3"/>`),
  constant: svg(`<rect x="2" y="2" width="12" height="12" rx="2" fill="#eaf6ea" stroke="${GREEN}"/><path d="M10.5 5.6a3 3 0 1 0 0 4.8" fill="none" stroke="${GREEN}" stroke-width="1.5"/>`),
  javaaction: svg(`<path d="M3 7h8v3.2a3.2 3.2 0 0 1-3.2 3.2H6.2A3.2 3.2 0 0 1 3 10.2z" fill="#fde2cc" stroke="${ORANGE}"/><path d="M11 8h1a1.5 1.5 0 0 1 0 3h-1.1" fill="none" stroke="${ORANGE}"/><path d="M5.5 5.2c0-1 1-1 1-2M8 5.2c0-1 1-1 1-2" fill="none" stroke="${ORANGE}" stroke-linecap="round"/>`),
  javascriptaction: svg(`<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.5" fill="#f7df4c" stroke="#c9a80e"/><text x="8.3" y="12.3" font-size="7.2" font-family="Segoe UI,Arial,sans-serif" font-weight="700" text-anchor="middle" fill="#333">JS</text>`),
  imagecollection: svg(`<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.3" fill="#fff" stroke="${GREEN}"/><circle cx="5.5" cy="6" r="1.4" fill="${AMBER}"/><path d="M2.5 12.5l3.8-4 2.6 2.6 1.8-1.8 3 3.2" fill="none" stroke="${GREEN}" stroke-width="1.1"/>`),
  jsonstructure: svg(`<path d="M6 2.5c-1.6 0-1.8.8-1.8 2v1.4c0 1-.6 1.6-1.6 1.6v1c1 0 1.6.6 1.6 1.6v1.4c0 1.2.2 2 1.8 2M10 2.5c1.6 0 1.8.8 1.8 2v1.4c0 1 .6 1.6 1.6 1.6v1c-1 0-1.6.6-1.6 1.6v1.4c0 1.2-.2 2-1.8 2" fill="none" stroke="${PURPLE}" stroke-width="1.2"/>`),
  importmapping: svg(`<rect x="7" y="2.5" width="7" height="11" rx="1.2" fill="#fff" stroke="${PURPLE}"/><path d="M1.5 8h7.5M6.5 5.5L9 8l-2.5 2.5" fill="none" stroke="${PURPLE}" stroke-width="1.3"/>`),
  exportmapping: svg(`<rect x="2" y="2.5" width="7" height="11" rx="1.2" fill="#fff" stroke="${PURPLE}"/><path d="M7 8h7.5M12 5.5L14.5 8 12 10.5" fill="none" stroke="${PURPLE}" stroke-width="1.3"/>`),
  workflow: svg(`<rect x="1.5" y="2" width="5" height="4" rx="1" fill="#dff3e4" stroke="${GREEN}"/><rect x="9.5" y="10" width="5" height="4" rx="1" fill="#dff3e4" stroke="${GREEN}"/><path d="M4 6v6h5.5" fill="none" stroke="${GREEN}" stroke-width="1.1"/>`),
  scheduledevent: svg(`<circle cx="8" cy="8" r="6" fill="#fff" stroke="${BLUE}"/><path d="M8 4.5V8l2.5 1.6" fill="none" stroke="${BLUE}" stroke-width="1.3" stroke-linecap="round"/>`),
  security: svg(`<path d="M8 1.8l5.2 1.9v4c0 3.2-2.3 5.4-5.2 6.5C5.1 13.1 2.8 10.9 2.8 7.7v-4z" fill="#e3effa" stroke="${BLUE}" stroke-width="1.1"/><path d="M5.6 8l1.7 1.7L10.6 6.4" fill="none" stroke="${GREEN}" stroke-width="1.3"/>`),
  projectsecurity: '',
  modulerole: svg(`<circle cx="8" cy="5.3" r="2.6" fill="#fff" stroke="${GREY}" stroke-width="1.1"/><path d="M3 14c.5-3 2.6-4.4 5-4.4S12.5 11 13 14" fill="#fff" stroke="${GREY}" stroke-width="1.1"/>`),
  userrole: '',
  demouser: '',
  settings: svg(`<circle cx="8" cy="8" r="2.2" fill="none" stroke="${GREY}" stroke-width="1.3"/><path d="M8 1.8v2.1M8 12.1v2.1M1.8 8h2.1M12.1 8h2.1M3.6 3.6l1.5 1.5M10.9 10.9l1.5 1.5M3.6 12.4l1.5-1.5M10.9 5.1l1.5-1.5" stroke="${GREY}" stroke-width="1.4" stroke-linecap="round"/>`),
  navigation: svg(`<circle cx="8" cy="8" r="6.2" fill="#fff" stroke="${BLUE}"/><path d="M10.8 5.2L9 9 5.2 10.8 7 7z" fill="${BLUE}"/>`),
  systemoverview: svg(`<circle cx="8" cy="3.5" r="2" fill="#cfe6ff" stroke="${BLUE}"/><circle cx="3.2" cy="12" r="2" fill="#cfe6ff" stroke="${BLUE}"/><circle cx="12.8" cy="12" r="2" fill="#cfe6ff" stroke="${BLUE}"/><path d="M7 5.3l-2.8 5M9 5.3l2.8 5M5.2 12h5.6" stroke="${GREY}"/>`),
  menu: svg(`<path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="${GREY}" stroke-width="1.5" stroke-linecap="round"/>`),
  regularexpression: svg(`<text x="8" y="12" font-size="9" font-family="Consolas,monospace" text-anchor="middle" fill="${PURPLE}">.*</text>`),
  restclient: svg(`<path d="M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-1 2.8 2.8 0 0 1 .3 5.6z" fill="#e8f1fb" stroke="${BLUE}"/><path d="M6 9.5h4" stroke="${BLUE}"/>`),
};
TREE.projectsecurity = TREE.security;
TREE.userrole = TREE.modulerole;
TREE.demouser = TREE.modulerole;
TREE.navprofile = TREE.navigation;
TREE.navmenu = TREE.menu;
TREE.settingscategory = TREE.settings;
TREE.category = TREE.folder;
for (const k of ['odataclient', 'odataservice', 'publishedrestservice', 'consumedmcpservice', 'businesseventservice']) TREE[k] = TREE.restclient;

const DOT = svg(`<circle cx="8" cy="8" r="2.2" fill="${GREY}"/>`);

export function treeIcon(type: string): string {
  return TREE[type] || DOT;
}

// ---- Activity icons -------------------------------------------------------------------------------

/** The glyph inside the activity's ring, by category. Drawn on a 20×20 grid centred on (10,10). */
function glyph(action: string, category: string, ring: string): string {
  if (category === 'object') return `<text x="10" y="14.2" font-size="11.5" font-family="Segoe UI,Arial,sans-serif" font-weight="700" text-anchor="middle" fill="${ring}">E</text>`;
  if (category === 'list') return `<path d="M6.5 7h7M6.5 10h7M6.5 13h7" stroke="${ring}" stroke-width="1.6" stroke-linecap="round"/>`;
  if (action === 'call-java') return `<path d="M6 9h6.5v2.2a2.6 2.6 0 0 1-2.6 2.6H8.6A2.6 2.6 0 0 1 6 11.2z" fill="none" stroke="${ring}" stroke-width="1.4"/><path d="M12.5 9.8h.6a1.2 1.2 0 0 1 0 2.4h-.8" fill="none" stroke="${ring}" stroke-width="1.2"/>`;
  if (action === 'call-js') return `<text x="10" y="13.4" font-size="7.4" font-family="Segoe UI,Arial,sans-serif" font-weight="700" text-anchor="middle" fill="${ring}">JS</text>`;
  if (action === 'call-microflow' || action === 'call-nanoflow') return `<circle cx="6.3" cy="10" r="1.5" fill="${ring}"/><rect x="8.6" y="7.8" width="3.6" height="4.4" rx="1" fill="none" stroke="${ring}" stroke-width="1.3"/><circle cx="14" cy="10" r="1.5" fill="${ring}"/>`;
  if (category === 'integration') return `<path d="M7 13.5a2.4 2.4 0 0 1-.3-4.8 3.3 3.3 0 0 1 6.4-.7 2.3 2.3 0 0 1 .2 4.6z" fill="none" stroke="${ring}" stroke-width="1.4"/>`;
  if (action.startsWith('show-message') || action === 'validation') return `<path d="M5.6 6.5h8.8v5.4H9.2l-2.4 2v-2H5.6z" fill="none" stroke="${ring}" stroke-width="1.4" stroke-linejoin="round"/>`;
  if (category === 'client') return `<rect x="5.8" y="5.6" width="8.4" height="8.8" rx="1" fill="none" stroke="${ring}" stroke-width="1.4"/><path d="M5.8 8.2h8.4" stroke="${ring}" stroke-width="1.2"/>`;
  if (category === 'variable') return `<text x="10" y="13.6" font-size="9.5" font-family="Consolas,Segoe UI,monospace" font-weight="700" text-anchor="middle" fill="${ring}">$</text>`;
  if (category === 'log') return `<path d="M6.5 5.5h5l2 2v7h-7z" fill="none" stroke="${ring}" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 10h4M8 12.2h4" stroke="${ring}" stroke-width="1.1"/>`;
  return `<circle cx="10" cy="10" r="2" fill="${ring}"/>`;
}

/** The badge's glyph (white on a dark disc, bottom right), for what the action does. */
function badge(action: string): { fill: string; path: string } | null {
  const W = 'stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"';
  const dark = '#555';
  switch (action) {
    case 'retrieve':
      return { fill: dark, path: `<path d="M0 -2.6v4.6M-2 0.4l2 2 2-2" ${W}/>` };
    case 'create':
    case 'create-list':
    case 'create-var':
      return { fill: dark, path: `<path d="M0 -2.6v5.2M-2.6 0h5.2" ${W}/>` };
    case 'change':
    case 'change-list':
    case 'change-var':
      return { fill: dark, path: `<path d="M-2.2 2.2l3.6-3.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` };
    case 'commit':
      return { fill: dark, path: `<path d="M0 2.6V-2M-2 -0.2l2-2 2 2" ${W}/>` };
    case 'delete':
      return { fill: dark, path: `<path d="M-2 -2l4 4M2 -2l-4 4" ${W}/>` };
    case 'rollback':
      return { fill: dark, path: `<path d="M2.2 1.6A2.6 2.6 0 1 1 1.8-1.9M1.8-1.9v-1.3M1.8-1.9h-1.3" ${W}/>` };
    case 'cast':
      return { fill: dark, path: `<path d="M-2.4 -1h4.4M1 -2.4l1.2 1.4M2.4 1h-4.4M-1 2.4l-1.2-1.4" ${W}/>` };
    case 'aggregate':
      return { fill: dark, path: `<path d="M2 -2.4h-4l2.2 2.4-2.2 2.4h4" ${W}/>` };
    case 'show-message-error':
    case 'validation':
      return { fill: '#e91927', path: `<path d="M-1.8 -1.8l3.6 3.6M1.8 -1.8l-3.6 3.6" ${W}/>` };
    case 'show-message-warning':
      return { fill: '#f0a020', path: `<path d="M0 -2.4v2.6" ${W}/><circle cx="0" cy="2.1" r=".75" fill="#fff"/>` };
    case 'show-message-information':
      return { fill: '#2f8fe0', path: `<circle cx="0" cy="-2" r=".75" fill="#fff"/><path d="M0 -.4v2.8" ${W}/>` };
    case 'close-page':
      return { fill: dark, path: `<path d="M-1.8 -1.8l3.6 3.6M1.8 -1.8l-3.6 3.6" ${W}/>` };
    case 'show-page':
      return { fill: dark, path: `<path d="M-2.4 0h4.4M0.4 -2l2 2-2 2" ${W}/>` };
    case 'call-nanoflow':
      return { fill: '#8a63d2', path: `<path d="M0.6 -2.6l-1.8 2.8h2.4l-1.8 2.6" ${W}/>` };
    default:
      return null;
  }
}

/**
 * An activity's icon as SVG elements, its ring centred on (cx, cy): a 17-unit ring with the
 * category's glyph and, bottom right, the action's badge.
 */
export function activityIcon(action: string, category: string, cx: number, cy: number, ring: string, fill: string): string {
  const b = badge(action);
  const s = 1;
  return (
    `<g transform="translate(${cx - 10 * s} ${cy - 10 * s}) scale(${s})">` +
    `<circle cx="10" cy="10" r="8.6" fill="${fill}" stroke="${ring}" stroke-width="1.9"/>${glyph(action, category, ring)}` +
    (b ? `<g transform="translate(15.3 15.2)"><circle r="6.2" fill="${b.fill}"/>${b.path}</g>` : '') +
    `</g>`
  );
}

/** The commit (green, up arrow) and refresh (blue, circling arrows) markers at a box's top right. */
export function commitMarker(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})"><circle r="5.4" fill="#e8f8d4" stroke="#bfe39a" stroke-width=".8"/><path d="M0 3V-2.6M-2.3 -0.4L0 -2.8l2.3 2.4" fill="none" stroke="#5fb800" stroke-width="1.5" stroke-linecap="round"/></g>`;
}
export function refreshMarker(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="#3aa0ef" stroke-width="1.3" stroke-linecap="round"><path d="M-4 -.5A4 4 0 0 1 3.2 -2.4"/><path d="M4 .5A4 4 0 0 1 -3.2 2.4"/><path d="M3.4 -4.4v2.1h-2.1M-3.4 4.4v-2.1h2.1"/></g>`;
}
