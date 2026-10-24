// What a request from the Developer view points at (shared/dev-changes.ts ElementRef), from what's on screen:
// the page open in the Model preview, and the widget picked on it (Select element, model/page-frame.ts). The
// key is document + widget name; the widget's $Type and $ID come from the page's facts (read from the model's
// units at the same revision) when they're known, the $ID as a hint only. Also the chip's words ("My orders ›
// Save button") and the shared-element impact ("This is in snippet Header, used on 5 pages"). Pure.

import type { ElementRef } from '../../../../shared/dev-changes';
import { sharedWords, type PageFacts } from '../../../../shared/page-facts';
import type { PickedElement } from '../../model/page-frame';

/** What the request dialog shows and sends about the element. */
export interface ElementContext {
  ref: ElementRef;
  /** "My orders › Save button" (or "My orders" for the page). */
  chip: string;
  /** Where it is in the model, in words: "widget btnSave on page Shop.Order_Edit". */
  where: string;
  /** "This is in snippet Header, used on 5 pages: …", when it's shared. */
  impact?: string;
  /** Picked earlier and not on the page at this revision. */
  gone?: boolean;
}

/** The context for a request about `page` (and the widget picked on it, when one is). */
export function elementContext(page: { qn: string; title: string }, sel: PickedElement | null, facts?: PageFacts | null): ElementContext {
  const whole: ElementContext = { ref: { docType: 'page', docQn: page.qn, label: page.title }, chip: page.title, where: `page ${page.qn}` };
  if (!sel || sel.page !== page.qn) return whole;
  // A widget that's gone at this revision: the request is about the page (pointing at a missing widget would only be flagged).
  if (sel.gone) return { ...whole, gone: true };
  const known = facts?.widgets[sel.docQn]?.[sel.name];
  const ref: ElementRef = { docType: sel.docType, docQn: sel.docQn, widgetName: sel.name, widgetType: known?.[0] ?? sel.kind, label: sel.label, ...(known?.[1] ? { id: known[1] } : {}) };
  const where = sel.docType === 'snippet' ? `widget ${sel.name} in snippet ${sel.docQn}, shown on page ${page.qn}` : `widget ${sel.name} on page ${page.qn}`;
  const impact = sel.docType === 'snippet' ? sharedWords(sel.docQn, facts) : undefined;
  return { ref, chip: `${page.title} › ${sel.label}`, where, ...(impact ? { impact } : {}) };
}
