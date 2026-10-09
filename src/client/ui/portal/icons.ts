// The Portal top bar's and Projects page's own line icons (16 × 16, a 1.5 stroke in currentColor), drawn
// for this office: the launcher's grid of dots, the search glass, a bell, a question mark, a moon, a sun,
// an eye, a pin, the ⋯, a cube for a project, the sort arrows and a funnel. Inline SVG, so they show
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
