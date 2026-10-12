// The team-lead panel's small doors for the rest of the page (./index.ts opens them when it mounts):
// "Ask <lead>" from the Overview's Needs you, and turning the panel on or off from ⚙️ Settings. Kept apart
// from the panel itself so a settings page or a card can use them without loading the panel (and its
// terminal) where there is none.

import { PANEL_SHOW_KEY } from './logic';

/** The event the panel listens for when "Show the team-lead panel" changes on this page. */
export const SHOW_EVENT = 'agent-office:lead-panel-show';

let ask: ((text: string) => void) | undefined;

/** The panel's: how "Ask <lead>" reaches its box. */
export function setLeadAsk(fn: (text: string) => void) {
  ask = fn;
}

/** Opens the panel's chat with `text` in the box; false when there's no panel on this page. */
export function askLead(text: string): boolean {
  if (!ask) return false;
  ask(text);
  return true;
}

/** Turns the panel on or off in this browser (⚙️ Settings › You). */
export function setPanelShown(on: boolean) {
  try {
    localStorage.setItem(PANEL_SHOW_KEY, on ? '1' : '0');
  } catch {
    // Only this visit.
  }
  if (typeof dispatchEvent === 'function') dispatchEvent(new Event(SHOW_EVENT));
}
