// Each message to a team member and what the office did with it, per recipient (shared/roster/delivery.ts): the
// Project Manager's from the docked chat (interrupts.ts) and the agents' relays (`office-workers tell`). In memory,
// the last DELIVERY_KEPT per project: the chat shows the newest per recipient, and a held one turns to typed when
// its turn ends (Delivery's onSent). Every change refreshes the roster for the project's browsers.

import { randomBytes } from 'node:crypto';
import type { DeliveryRecord, DeliveryState } from '../../shared/roster/delivery.js';
import type { Sent } from './deliver.js';

export const DELIVERY_KEPT = 40;

const logs = new Map<string, DeliveryRecord[]>();

/** The state a delivery's answer means. */
export const stateOf = (s: Sent): DeliveryState => (s.status === 'sent' ? 'typed' : s.status === 'woke' ? 'woke' : s.status === 'held' ? 'held' : 'refused');

/** Records one message; returns the record and what to call when a held one is typed. */
export function noteDelivery(floorId: string, r: Omit<DeliveryRecord, 'id' | 'state'>, changed?: () => void): { record: DeliveryRecord; settle(s: Sent | undefined, why?: string): void; typed(): void } {
  const record: DeliveryRecord = { ...r, id: randomBytes(5).toString('hex'), state: 'held', excerpt: r.excerpt.replace(/\s+/g, ' ').trim().slice(0, 120) };
  const list = logs.get(floorId) ?? [];
  list.push(record);
  logs.set(floorId, list.slice(-DELIVERY_KEPT));
  return {
    record,
    settle(s, why) {
      record.state = s ? stateOf(s) : 'refused';
      if (s?.status === 'refused') record.why = s.why;
      else if (!s) record.why = why ?? 'not sent';
      if (record.state === 'typed' || record.state === 'woke') record.typedAt ??= r.at;
      changed?.();
    },
    typed() {
      if (record.state !== 'held') return;
      record.state = 'typed';
      record.typedAt = Date.now();
      changed?.();
    },
  };
}

/** The project's records, oldest first. */
export const deliveriesOf = (floorId: string): readonly DeliveryRecord[] => logs.get(floorId) ?? [];

/** Tests: forgotten. */
export const forgetDeliveries = () => logs.clear();
