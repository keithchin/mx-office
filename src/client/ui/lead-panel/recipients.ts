// The docked chat's recipient picker and delivery lines (release 82, team flow #1). The chat used to reach only
// the Project Coordinator; relays to the other Leads went through her, and once she logged a message as delivered
// to the Lead Developer when it wasn't. Now the Project Manager picks who a message is for (To: the Coordinator by
// default, or any Lead at work; "@Name …" at the start of a message picks it too), a message to a Lead goes to it
// directly through the team's tell (server/roster/interrupts.ts, `to`), and under the conversation the newest
// delivery per recipient says what the office itself did: typed, held for after its turn, or not delivered and
// why, including the Coordinator's own relays (shared/roster/delivery.ts). From the page's one roster: nothing
// fetched here.

import { h } from '../dom';
import type { RosterView } from '../../../shared/roster/types';
import { deliveryWords, latestPerRecipient, recipientsOf, type Recipient } from '../../../shared/roster/delivery';

export class RecipientPicker {
  readonly el: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly strip: HTMLElement;
  private list: Recipient[] = [];
  /** The role picked; undefined: whoever leads (the default). */
  private picked: string | undefined;
  private key = '';
  private stripKey = '';

  constructor(private readonly changed: () => void) {
    this.select = h('select.lp-to-sel', { 'aria-label': 'Send to' }) as HTMLSelectElement;
    this.select.addEventListener('change', () => {
      const r = this.list.find((x) => x.role === this.select.value);
      this.picked = r && !r.lead ? r.role : undefined;
      this.changed();
    });
    this.strip = h('ul.lp-deliv', { 'aria-label': 'Delivery of your messages', role: 'status', 'aria-live': 'polite', hidden: true });
    this.el = h('div.lp-to', {}, h('label.lp-to-row', {}, h('span.lp-to-l', {}, 'To'), this.select), this.strip);
  }

  /** The roster changed: who can be picked, and the delivery lines. */
  update(r: RosterView | undefined, leadRole: string | undefined) {
    this.list = r && leadRole ? recipientsOf(r.members, leadRole) : [];
    if (this.picked && !this.list.some((x) => x.role === this.picked)) this.picked = undefined;
    const key = JSON.stringify([this.list, this.picked]);
    if (key !== this.key) {
      this.key = key;
      this.select.replaceChildren(...this.list.map((x) => h('option', { value: x.role, disabled: !x.ok && !x.lead, selected: x.role === (this.picked ?? leadRole) }, `${x.name} · ${x.title}${x.lead ? ' (default)' : ''}${x.ok ? '' : ' (not at a desk)'}`)));
      this.el.hidden = this.list.filter((x) => !x.lead).length === 0;
    }
    const recs = latestPerRecipient(r?.deliveries);
    const sk = JSON.stringify(recs.map((x) => [x.id, x.state, x.typedAt]));
    if (sk === this.stripKey) return;
    this.stripKey = sk;
    this.strip.hidden = !recs.length;
    this.strip.replaceChildren(...recs.map((x) => h('li.lp-deliv-i', { 'data-state': x.state, title: `“${x.excerpt}”` }, deliveryWords(x))));
  }

  /** Who the next message goes to: a Lead picked, or undefined for the lead (the Coordinator). */
  get current(): Recipient | undefined {
    return this.picked ? this.list.find((x) => x.role === this.picked) : undefined;
  }

  get recipients(): readonly Recipient[] {
    return this.list;
  }

  /** Picks a recipient by role (an "@Name" message), or the lead with undefined. */
  pick(role: string | undefined) {
    const r = this.list.find((x) => x.role === role);
    this.picked = r && !r.lead ? r.role : undefined;
    this.select.value = r?.role ?? this.list.find((x) => x.lead)?.role ?? '';
    this.changed();
  }
}
