// Small pieces the New project flow draws in several places: its line icons, the Chief Analyst's avatar,
// the tags (a word as well as a colour), the drafting card with its illustration and skeleton lines.
import type { BriefTag } from '../../../../shared/brief';
import { h } from '../../dom';

const NS = 'http://www.w3.org/2000/svg';
const PATHS: Record<string, string> = {
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chev: 'M9 6l6 6-6 6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  cloud: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z',
  send: 'M12 19V5M6 11l6-6 6 6',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v5M12 8h.01',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3',
  doc: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  user: 'M12 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7M5 20a7 7 0 0 1 14 0',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  chat: 'M4 5h16v11H9l-5 4z',
  q: 'M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 15.5h.01M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
  half: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M12 3.5v17',
  team: 'M9 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6',
  box: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M15.5 8.5l-2 5-5 2 2-5z',
};

/** A line icon (aria-hidden), drawn with the text colour. */
export function icon(name: keyof typeof PATHS | string, cls = 'nw-ico'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name] ?? PATHS.info);
  svg.append(p);
  return svg;
}

/** The Chief Analyst: a compass in a blue-to-purple circle. */
export const caAvatar = (small = false) => h(small ? 'span.nw-ca.nw-ca-sm' : 'span.nw-ca', { 'aria-hidden': 'true' }, icon('compass'));

const TAG_TEXT: Record<BriefTag, [string, string]> = { answered: ['check', 'Answered'], assumed: ['half', 'Assumed'], unverified: ['q', 'Unverified'] };
export const tagPill = (t: BriefTag) => h(`span.nw-tag.t-${t}`, {}, icon(TAG_TEXT[t][0]), TAG_TEXT[t][1]);

/** The drafting card: an illustration, what's being drafted, a tip and three shimmering lines. */
export function draftingCard(status: string, tip: string): HTMLElement {
  const illus = document.createElementNS(NS, 'svg');
  illus.setAttribute('viewBox', '0 0 96 72');
  illus.setAttribute('class', 'nw-illus');
  illus.setAttribute('aria-hidden', 'true');
  illus.innerHTML =
    '<g class="fl"><rect x="18" y="10" width="46" height="54" rx="4" class="pg"/><rect x="25" y="19" width="26" height="4" rx="2" class="ac"/><rect x="25" y="28" width="32" height="3" rx="1.5" class="ln"/><rect x="25" y="35" width="28" height="3" rx="1.5" class="ln"/><rect x="25" y="42" width="30" height="3" rx="1.5" class="ln"/><rect x="44" y="30" width="34" height="34" rx="4" class="pg2"/><circle cx="55" cy="42" r="4" class="pu"/><rect x="50" y="50" width="22" height="3" rx="1.5" class="ln2"/><rect x="50" y="56" width="15" height="3" rx="1.5" class="ln2"/></g><path class="sp" d="M82 12l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/><path class="sp sp2" d="M10 46l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/>';
  return h('div.nw-drafting', { role: 'status' }, illus, h('div', {}, h('div.nw-st', {}, status), h('div.nw-tip', {}, tip), skeleton()));
}

export const skeleton = () => h('div.nw-skel', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));

/** "10:42" from an ISO time. */
export const hhmm = (iso: string) => /T(\d\d:\d\d)/.exec(iso)?.[1] ?? '';
