// What the office knows about each message to a team member, per recipient (release 82, team flow #1): the
// Project Manager's own messages from the docked chat (to the Coordinator or straight to a Lead) and the
// Coordinator's relays to the Leads (`office-workers tell`). On the real build the Coordinator logged a message as
// delivered to the Lead Developer when it wasn't, and ten minutes went by; now the chat shows, beside each
// message, what the office itself did with it: typed into the session, held for after its turn (then typed), or
// not delivered and why. Typed is not read: the office says only what it has evidence for. Pure: the browser
// imports it, the tests too.

export type DeliveryState = 'typed' | 'woke' | 'held' | 'refused';

export interface DeliveryRecord {
  id: string;
  at: number;
  /** Who sent it: the person's name, or the agent's (a relay). */
  from: string;
  via: 'person' | 'relay';
  to: { name: string; role?: string; workerId?: string };
  state: DeliveryState;
  /** Why it wasn't delivered (refused). */
  why?: string;
  /** When it was typed (a held one, once its turn ended). */
  typedAt?: number;
  /** The first words, for the chat's line. */
  excerpt: string;
}

/** The chat's words for one record: "✓ Typed to Blake (Lead Developer) 14:02", "⏳ Held for after Blake's turn", "✗ Not delivered to Blake: …". */
export function deliveryWords(r: DeliveryRecord, time: (ms: number) => string = (ms) => new Date(ms).toTimeString().slice(0, 5)): string {
  const who = `${r.to.name}${r.to.role ? ` (${r.to.role})` : ''}`;
  const from = r.via === 'relay' ? `${r.from} → ` : '';
  switch (r.state) {
    case 'typed':
      return `✓ ${from}Typed to ${who} at ${time(r.typedAt ?? r.at)}`;
    case 'woke':
      return `✓ ${from}Woke ${who} with it at ${time(r.typedAt ?? r.at)}`;
    case 'held':
      return `⏳ ${from}Held for after ${r.to.name}'s turn (not typed yet)`;
    default:
      return `✗ ${from}Not delivered to ${who}: ${r.why ?? 'refused'}`;
  }
}

/** The newest record per recipient, newest first: the chat's "Delivery" strip. */
export function latestPerRecipient(list: readonly DeliveryRecord[] | undefined, max = 6): DeliveryRecord[] {
  const seen = new Set<string>();
  const out: DeliveryRecord[] = [];
  for (const r of [...(list ?? [])].sort((a, b) => b.at - a.at)) {
    const k = r.to.workerId ?? r.to.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Who the docked chat can address: the Coordinator (whoever covers Management) first, then each Lead at work. */
export interface Recipient {
  role: string;
  name: string;
  title: string;
  /** It can take a message now (hired and at a desk). */
  ok: boolean;
  lead: boolean;
}

/** The recipients from the roster's members: the lead first, then the others that are hired, not benched. */
export function recipientsOf(members: readonly { role: string; name: string; title: string; status: string; workerId?: string }[], leadRole: string): Recipient[] {
  const out: Recipient[] = [];
  for (const m of members) {
    if (m.status === 'not-hired' || m.status === 'benched') continue;
    out.push({ role: m.role, name: m.name, title: m.title, ok: !!m.workerId && m.status !== 'benching', lead: m.role === leadRole });
  }
  return out.sort((a, b) => Number(b.lead) - Number(a.lead));
}

/** "@Blake …" or "@lead-developer …" at the start of a message: the role it addresses and the rest; undefined when none. */
export function atRecipient(text: string, recipients: readonly Recipient[]): { role: string; rest: string } | undefined {
  const m = /^\s*@([\p{L}\p{N}_-]+)[\s,:]+([\s\S]*)$/u.exec(text);
  if (!m) return undefined;
  const key = m[1].toLowerCase();
  const r = recipients.find((x) => x.name.toLowerCase() === key || x.role === key || x.title.toLowerCase().replace(/\s+/g, '-') === key);
  return r ? { role: r.role, rest: m[2].trim() } : undefined;
}
