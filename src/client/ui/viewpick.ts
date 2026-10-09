// The two ways to see a project, and the buttons between them. Every project opens on its 1D view
// (/lite: the Command Center, the board, the agents and the tabs); the 2D Office view (/pixel: the floor
// from above, every agent at a desk) is reached only by the 1D view's Go to Office, and its Return to
// Project goes back to the 1D view of the same project, landing on the Command Center
// (shared/start-tab.ts: a link with no ?tab= opens it).

import './flatchrome.css';
import { h } from './dom';
import { icon } from './portal/icons';

/** The 1D view of `floor`, opening on its Command Center; Home when there's no floor to open. */
export const projectUrl = (floor: string | null | undefined): string => (floor ? `/lite?floor=${encodeURIComponent(floor)}` : '/home');

/** The 2D Office view of `floor`. */
export const officeUrl = (floor: string | null | undefined): string => (floor ? `/pixel?floor=${encodeURIComponent(floor)}` : '/home');

/** The 1D view's top-bar button to the 2D Office view of the project you're on (`floor()` asked at the click). */
export function goToOfficeButton(floor: () => string | null | undefined): HTMLElement {
  return h(
    'button.btn.vp-go',
    { type: 'button', title: "Go to Office: the project's office from above, its agents at their desks", 'aria-label': 'Go to Office', onclick: () => location.assign(officeUrl(floor())) },
    h('span.ao-emo.vp-ico', { 'aria-hidden': 'true' }, '🗺️'),
    h('span.vp-label', {}, 'Go to Office'),
    h('span.vp-short', { 'aria-hidden': 'true' }, 'Office'),
  );
}

/** The 2D Office view's way back: the 1D view of the same project, on its Command Center. */
export function returnToProjectButton(floor: () => string | null | undefined): HTMLElement {
  return h(
    'button.btn.primary.vp-go.vp-return',
    { type: 'button', title: "Return to Project: the project's Command Center, board and tabs", 'aria-label': 'Return to Project', onclick: () => location.assign(projectUrl(floor())) },
    icon('back', 'vp-ico vp-back'),
    h('span.vp-label', {}, 'Return to Project'),
    h('span.vp-short', { 'aria-hidden': 'true' }, 'Project'),
  );
}
