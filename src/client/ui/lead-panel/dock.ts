// The team-lead panel's dock: how a view that docks the panel beside its own canvas (the Developer view,
// ui/app-workspace/dock/) adds to it without a second chat. While a view holds the dock, the panel shows on that
// view too (even where the person turned it off for Project Management's pages), with:
//
//   header    the view's compact header above the conversation (status, revisions, the session's changes)
//   extras    cards merged into the same conversation by time (a change's receipt, a decision, Please try this)
//   context   chips in the composer for what's selected on the view ("📄 My orders › Save button"), with
//             "+ Context" to add the current selection again, and Ask | Request a change: a change goes to the
//             view's `request` (one record, DC-n), a question to the lead as every message does
//
// The panel keeps the conversation, its history and the lead; the view only lends these. Kept apart from the
// panel so the view can set them without loading the panel (or its terminal) where there is none. Pure state.

/** A card in the conversation, at a time: drawn again only when its `sig` changes. */
export interface ChatExtra {
  id: string;
  at: number;
  sig: string;
  draw(): HTMLElement;
}

/** What the composer shows for a piece of context. */
export interface ContextChip {
  /** Tells one context from another (the same key is the same chip). */
  key: string;
  label: string;
  /** Where it is, in words (the tooltip). */
  title?: string;
  kind?: 'page' | 'widget' | 'item';
}

/** What sending a change gave: the receipt's words, and a note for the lead when the change waits in the queue. */
export type DockSent = { ok: true; note?: string } | { ok: false; error: string };

export interface PanelDock {
  header?: HTMLElement;
  extras(): ChatExtra[];
  /** The view's current selection, for "+ Context" (undefined: nothing selected). */
  context(): ContextChip | undefined;
  /** A request for a change, with the chip attached (or none). */
  request(text: string, chip: ContextChip | undefined): Promise<DockSent>;
  /** What a question with a chip attached tells the lead it's about ("About: page Shop.Order_Edit, widget btnSave at main @abc1234"). */
  about(chip: ContextChip): string;
  /** The composer's line under the box in Request a change ("Changes go to the team through …"). */
  footer?: string;
}

let dock: PanelDock | null = null;
const subs = new Set<() => void>();
let focusFn: ((chip?: ContextChip, mode?: 'ask' | 'change') => void) | undefined;
let chipFn: ((chip: ContextChip | undefined) => void) | undefined;

/** The view takes the dock (or lets it go with null). */
export function setPanelDock(d: PanelDock | null) {
  if (d === dock) return;
  dock = d;
  subs.forEach((fn) => fn());
}

export const panelDock = () => dock;

/** Calls `fn` when the dock is taken or let go, or what it shows changed. */
export function onPanelDock(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

/** The view's header or extras changed: the panel draws them again. */
export function dockChanged() {
  if (dock) subs.forEach((fn) => fn());
}

/** The panel's: how the view focuses its composer. */
export function setDockFocus(fn: typeof focusFn, chip: typeof chipFn) {
  focusFn = fn;
  chipFn = chip;
}

/** Opens the docked chat (the sheet on a phone, the panel if collapsed) with `chip` attached, in Request a change. False: no panel. */
export function focusDock(chip?: ContextChip, mode: 'ask' | 'change' = 'change'): boolean {
  if (!focusFn || !dock) return false;
  focusFn(chip, mode);
  return true;
}

/** The selection on the view changed: the composer's chip follows (undefined: nothing selected now). */
export function dockSelection(chip: ContextChip | undefined) {
  if (dock) chipFn?.(chip);
}
