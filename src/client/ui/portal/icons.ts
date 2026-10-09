// The Portal top bar's and Projects page's own line icons (16 × 16, a 1.5 stroke in currentColor), drawn
// for this office: the launcher's grid of dots, the search glass, a bell, a question mark, a moon, a sun,
// an eye, a pin, the ⋯, a cube for a project, the sort arrows and a funnel; the left navigation's groups,
// chevrons and bottom rows, the alert's info mark, and the search results' kinds. Inline SVG, so they show
// in any theme the moment they're drawn (they're only on Portal's own pieces).

const SVG = 'http://www.w3.org/2000/svg';

export const PORTAL_ICONS = {
  launcher: '<circle class="f" cx="3" cy="3" r="1.3"/><circle class="f" cx="8" cy="3" r="1.3"/><circle class="f" cx="13" cy="3" r="1.3"/><circle class="f" cx="3" cy="8" r="1.3"/><circle class="f" cx="8" cy="8" r="1.3"/><circle class="f" cx="13" cy="8" r="1.3"/><circle class="f" cx="3" cy="13" r="1.3"/><circle class="f" cx="8" cy="13" r="1.3"/><circle class="f" cx="13" cy="13" r="1.3"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>',
  bell: '<path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1.2 1.2H2.8L4 11.5z"/><path d="M6.6 14.2a1.6 1.6 0 0 0 2.8 0"/>',
  help: '<circle cx="8" cy="8" r="6.3"/><path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.5c0 1.3-1.9 1.6-1.9 2.9"/><circle class="f" cx="8" cy="11.6" r=".8"/>',
  moon: '<path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/>',
  pin: '<path d="M9.8 1.8l4.4 4.4-1.6.6-2.6 2.6-.4 3.1-1.3 1.3-2.4-2.4L2.5 14l-.5-.5 2.6-3.4L2.2 7.7l1.3-1.3 3.1-.4 2.6-2.6.6-1.6z"/>',
  pinned: '<path class="f" d="M9.8 1.8l4.4 4.4-1.6.6-2.6 2.6-.4 3.1-1.3 1.3-2.4-2.4L2.5 14l-.5-.5 2.6-3.4L2.2 7.7l1.3-1.3 3.1-.4 2.6-2.6.6-1.6z"/>',
  more: '<circle class="f" cx="3" cy="8" r="1.4"/><circle class="f" cx="8" cy="8" r="1.4"/><circle class="f" cx="13" cy="8" r="1.4"/>',
  cube: '<path d="M8 1.8l5.6 3.1v6.2L8 14.2l-5.6-3.1V4.9L8 1.8z"/><path d="M2.4 4.9L8 8l5.6-3.1M8 8v6.2"/>',
  sort: '<path d="M4.5 2.5v11M2.2 11.2l2.3 2.3 2.3-2.3M9 4h5M9 7h3.8M9 10h2.4"/>',
  sortUp: '<path d="M4.5 13.5v-11M2.2 4.8l2.3-2.3 2.3 2.3M9 4h2.4M9 7h3.8M9 10h5"/>',
  filter: '<path d="M2 3h12l-4.6 5.4v4.4l-2.8 1.4V8.4L2 3z"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  chevronUp: '<path d="M4 10l4-4 4 4"/>',
  chevronRight: '<path d="M6 4l4 4-4 4"/>',
  chevronLeft: '<path d="M10 4L6 8l4 4"/>',
  menu: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  // The left navigation's groups and its bottom rows.
  home: '<path d="M2.5 7.2L8 2.5l5.5 4.7V13.5h-3.7V9.6H6.2v3.9H2.5z"/>',
  kanban: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M6 2.5v11M10 2.5v11M3.4 5h1.2M7.4 5h1.2M7.4 7.2h1.2M11.4 5h1.2"/>',
  chart: '<path d="M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V9"/>',
  branch: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3.5 2.5-6.6 4.3"/>',
  rocket: '<path d="M9.8 2.2c2.1-.3 3.7 0 4 .3.3.3.6 1.9.3 4-.4 2.2-2.5 4.4-5.6 6.1L6 10 3.6 7.5c1.7-3.1 3.9-5 6.2-5.3z"/><circle cx="10.4" cy="5.8" r="1.1"/><path d="M5.6 6.4L3 6.6 1.8 8.8l2.4.4M9.8 10.6l-.2 2.6-2.2 1.2-.4-2.4M3.7 11.1c-.9.3-1.4 1.4-1.6 2.9 1.5-.2 2.6-.7 2.9-1.6"/>',
  pulse: '<path d="M1.5 8.5h3l1.6-4 2.6 8 1.8-5.2.9 1.2h3.1"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5"/><circle cx="8" cy="8" r="4.6"/>',
  studio: '<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5"/><path d="M4.5 10.5V6.2l1.9 2.6 1.9-2.6v4.3M10 6.3l2 4.2M12 6.3l-2 4.2"/>',
  doc: '<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5M6 8h4.5M6 10.5h4.5"/>',
  info: '<circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4"/><circle class="f" cx="8" cy="4.9" r=".85"/>',
  external: '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3.8H2.7V4.5h3.8"/>',
  person: '<circle cx="8" cy="5.3" r="2.6"/><path d="M2.8 14c.5-2.9 2.6-4.4 5.2-4.4s4.7 1.5 5.2 4.4"/>',
  users: '<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13.5c.4-2.6 2.1-3.9 4.2-3.9s3.8 1.3 4.2 3.9"/><circle cx="11.3" cy="5.8" r="1.9"/><path d="M11.4 9.6c1.6.1 2.7 1.2 3 3.4"/>',
  play: '<path d="M5 3.2v9.6l7.6-4.8z"/>',
  pause: '<path d="M5.2 3v10M10.8 3v10"/>',
  audit: '<path d="M3 2.5h7.5L13 5v8.5H3z"/><path d="M5.5 7.2l1.6 1.6L10.5 5.6M5.5 11h5"/>',
  issue: '<circle cx="8" cy="8" r="6"/><circle class="f" cx="8" cy="8" r="1.4"/>',
  pr: '<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M4 5v6M12 11V6.5c0-1.4-.8-2-2-2H7.5M9 3l-1.6 1.5L9 6"/>',
  queue: '<path d="M3 4h10M3 8h10M3 12h6"/>',
  agent: '<rect x="3" y="4.5" width="10" height="8" rx="2"/><path d="M8 4.5V2.5"/><circle class="f" cx="6" cy="8.5" r=".9"/><circle class="f" cx="10" cy="8.5" r=".9"/><path d="M1.5 8v2M14.5 8v2"/>',
  tab: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M6 3v3"/>',
  // The 2D Office view: Return to Project, and its canvas toolbar.
  back: '<path d="M13.5 8h-11M6.5 4L2.5 8l4 4"/>',
  zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14M5 7h4M7 5v4"/>',
  zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14M5 7h4"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  keys: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.2"/><path d="M4.2 6.5h1M7.5 6.5h1M10.8 6.5h1M5 9.5h6"/>',
  next: '<path d="M3 8h8M8 4.5L11.5 8 8 11.5M13.5 3.5v9"/>',
  palette: '<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.8.6-1.3 1.4-1.3h1.6a2.6 2.6 0 0 0 2.6-2.6C14.3 4.1 11.5 1.8 8 1.8z"/><circle class="f" cx="4.8" cy="7.2" r=".9"/><circle class="f" cx="6.8" cy="4.6" r=".9"/><circle class="f" cx="10" cy="4.6" r=".9"/>',
} as const;

export type PortalIcon = keyof typeof PORTAL_ICONS;

/** An icon as an inline <svg>, decorative (its button carries the words). */
export function icon(name: PortalIcon, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `pt-icon${cls ? ` ${cls}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = PORTAL_ICONS[name];
  return svg;
}
