// What the Project Manager chose in the check before their words reach agents mid-turn (shared/roster/
// interrupt.ts): a question for the Coordinator now or after its turn, and how the Coordinator's relays
// of it to the Leads go. The Coordinator fans a team question out with `office-workers tell`, which goes
// in at once; for the Leads the Project Manager said "after their current turn", a tell from the
// Coordinator within FANOUT_MS is held for that turn's end instead (deliver.ts holds it, as it holds an
// office message). Kept in memory only: a restart forgets the choice, and tells go in as before.

import type { InterruptChoice } from '../../shared/roster/interrupt.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { audit, byWhom, promptDetails } from '../audit/index.js';
import { managerRole } from './coverage.js';
import type { Roster } from './index.js';
import type { SendOpts } from './deliver.js';
import type { TeamFloor } from './types.js';

/** How long after the Project Manager's question the Coordinator's relays of it follow their choices. */
export const FANOUT_MS = 30 * 60_000;

export class Interrupts {
  private fanout = new Map<string, { until: number; choices: Partial<Record<RoleId, InterruptChoice>> }>();

  constructor(private roster: Roster) {}

  /**
   * The Project Manager's prompt to whoever covers Management: typed now (`now`; held only if a
   * question is open in its terminal) or after its turn (`after`). `leads`: how its relays to busy Leads go.
   */
  tell(floor: TeamFloor, text: string, by: string, when: 'now' | 'after', leads: Partial<Record<RoleId, InterruptChoice>> = {}, owner?: string): string | undefined {
    const prompt = text.replace(/\r\n?/g, '\n').trim().slice(0, 20_000);
    if (!prompt) return 'Say what to ask';
    const d = this.roster.data(floor.id);
    const m = d.members[managerRole(d)];
    const w = this.roster.workerOf(floor, m);
    if (!w || m.phase !== 'active') return `${m.name} isn't at work`;
    const r = this.roster.delivery.send(floor, w, prompt, { origin: 'person', by, wake: true, hold: true, ...(when === 'after' ? { between: true } : {}) });
    if (r.status === 'refused') return r.why;
    if (Object.keys(leads).length) this.fanout.set(floor.id, { until: this.roster.deps.now() + FANOUT_MS, choices: leads });
    else this.fanout.delete(floor.id);
    // The same record a prompt typed on the console makes (ws/handlers/workers.ts).
    audit.record({ floor: floor.id, actor: byWhom(by, owner), action: 'worker.prompt', target: { kind: 'worker', id: w.id, label: m.name }, summary: `Prompted ${m.name}${r.status === 'held' ? ' (after its current turn)' : ''}`, details: { ...promptDetails(prompt), when, ...(Object.keys(leads).length ? { leads } : {}) } });
    return undefined;
  }

  /** What an agent's `office-workers tell` adds to its delivery: held for the turn's end when the Project Manager asked that of its relay. */
  tellOpts(floor: TeamFloor, fromId: string, toId: string): Partial<SendOpts> {
    const f = this.fanout.get(floor.id);
    if (!f || this.roster.deps.now() > f.until) return {};
    const d = this.roster.data(floor.id);
    if (d.members[managerRole(d)].workerId !== fromId) return {};
    const role = this.roster.roleOf(floor, toId);
    return role && f.choices[role] === 'after' ? { hold: true, between: true } : {};
  }
}
