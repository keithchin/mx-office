// The Developer change queue (shared/dev-changes.ts): intake, one active change per project, the next one
// started when the active one is merged, cancelled or set aside, and cancel before it starts.
//
//   intake    the person's words (and the page/element, the revision on screen) become DC-<n>, on disk before
//             the answer; a retry with the same idempotency key gives back the change already made. Then the
//             queue moves (advance): queue instead of refuse.
//   advance   per project, one at a time: the active change is checked against what the office knows (its PR
//             merged, its task cancelled or set aside, finished with nothing on its branch) and settled; then,
//             while nothing is active and the team can take one (a lead at work, not paused, under the spend
//             cap, the lead awake), the next queued change's context is checked again at main's head (the page
//             or element it points at still there, else Needs clarification) and handed to the lead through the
//             C4 path (server/change-requests/: task id first, then the roster's delivery), naming dev/DC-<n>.
//   cancel    a queued (or flagged) change, by whoever asked it or an admin; audited.
//
// It never merges, rebases or pushes, and holds back no other work: only Developer-view changes queue here.
// The seams (deps) are what index.ts wires to the real office, so the tests drive it with fakes.

import { activeOf, cleanRef, cleanSha, KEY_RE, queuedOf, settledWhy, type ChangeFacts, type DevChange, type DevChangeEvent, type ElementRef, type QueueWhy } from '../../shared/dev-changes.js';
import { cleanPage, REQUEST_MAX } from '../../shared/change-requests.js';
import type { AuditInput } from '../../shared/audit.js';
import type { ChangeStore } from './store.js';

export type Activated = Omit<Extract<DevChangeEvent, { type: 'activated' }>, 'type' | 'at' | 'main'>;

export interface ChangeDeps {
  store: ChangeStore;
  now(): number;
  /** Why the team can't take a change now, checked in this order: no lead at work, paused, spend cap, lead asleep. */
  blocked(floorId: string): Exclude<QueueWhy, 'behind' | 'refused'> | undefined;
  /** Main's head in the project folder, when it can be read. */
  mainHead(floorId: string): Promise<string | undefined>;
  /** Why what the change points at is gone at `sha` (the page, or the widget on it); undefined when it's there or couldn't be told. */
  recheck(floorId: string, sha: string, ref: ElementRef): Promise<string | undefined>;
  /** Hands the change to the lead through the C4 path: the request and task it became, or why not. */
  hand(floorId: string, c: DevChange): Promise<Activated | string>;
  /** What the office knows of an active change now (task, PR, preview): for settling it. */
  facts(floorId: string, c: DevChange): Promise<ChangeFacts>;
  record(e: AuditInput): void;
}

export interface ChangeAsk {
  text: unknown;
  page?: unknown;
  pageMoved?: unknown;
  revision?: unknown;
  /** The revision on screen the request is about (else main's head is taken). */
  source?: unknown;
  ref?: unknown;
  key?: unknown;
  by: string;
  owner?: string;
}

export interface Who {
  name: string;
  id?: string;
  admin: boolean;
}

export class DevChanges {
  private serial = new Map<string, Promise<unknown>>();
  /** The last refusal from the hand-over, per project (in memory: shown as the queue's why until the next try). */
  private refused = new Map<string, string>();

  constructor(private deps: ChangeDeps) {}

  /** Runs `fn` after the project's earlier queue work (one at a time per project). */
  private one<T>(floorId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.serial.get(floorId) ?? Promise.resolve();
    const p = prev.catch(() => undefined).then(fn);
    this.serial.set(floorId, p.catch(() => undefined));
    return p;
  }

  /** A new change, queued and on disk, then the queue moved: the change (as it stands after), or why not. */
  async intake(floorId: string, ask: ChangeAsk): Promise<{ change: DevChange; again: boolean } | string> {
    const text = typeof ask.text === 'string' ? ask.text.replace(/\r\n?/g, '\n').trim().slice(0, REQUEST_MAX) : '';
    if (!text) return 'Say what should change';
    if (text.length < 8) return 'Say a little more about what should change';
    const key = typeof ask.key === 'string' && KEY_RE.test(ask.key) ? ask.key : undefined;
    const made = await this.one(floorId, async () => {
      if (key) {
        const had = await this.deps.store.byKey(floorId, key);
        if (had) return { change: had, again: true };
      }
      const viewed = cleanSha(ask.source);
      const main = viewed ? undefined : await this.deps.mainHead(floorId).catch(() => undefined);
      const page = cleanPage(ask.page);
      const revision = cleanSha(ask.revision);
      const ref = cleanRef(ask.ref);
      const id = await this.deps.store.nextId(floorId);
      const by = ask.by || 'The Project Manager';
      const change = await this.deps.store.create(floorId, {
        id,
        ...(key ? { key } : {}),
        text,
        by,
        ...(ask.owner ? { owner: ask.owner } : {}),
        at: this.deps.now(),
        source: viewed ? { sha: viewed, kind: 'viewed' } : main ? { sha: main, kind: 'main' } : { kind: 'unknown' },
        ...(page ? { page } : {}),
        ...(page && ask.pageMoved === true ? { pageMoved: true } : {}),
        ...(revision ? { revision } : {}),
        ...(ref ? { ref } : {}),
      });
      this.deps.record({
        floor: floorId,
        actor: { kind: 'human', name: by, ...(ask.owner ? { id: ask.owner } : {}) },
        action: 'dev-change.queued',
        target: { kind: 'project', id: floorId, label: id },
        summary: `Asked for a change (${id}) from the Developer view`,
        details: { id, source: change.source.sha, page, ref: ref ? `${ref.docQn}${ref.widgetName ? `/${ref.widgetName}` : ''}` : undefined, length: text.length },
      });
      return { change, again: false };
    });
    if (typeof made === 'string') return made;
    await this.advance(floorId);
    return { change: (await this.deps.store.get(floorId, made.change.id)) ?? made.change, again: made.again };
  }

  /** Cancels a change that hasn't started (queued, or flagged for clarification): by whoever asked it, or an admin. */
  async cancel(floorId: string, id: string, who: Who): Promise<DevChange | string> {
    const out = await this.one(floorId, async () => {
      const c = await this.deps.store.get(floorId, id);
      if (!c) return 'No such change';
      if (c.queue !== 'queued' && c.queue !== 'clarify') return c.queue === 'cancelled' ? 'It’s cancelled already' : 'It has started: the team has it now. Ask the team lead to stop it.';
      if (!who.admin && !(c.owner && who.id && c.owner === who.id)) return 'Only whoever asked for it, or an admin, can cancel it';
      await this.deps.store.event(floorId, id, { type: 'cancelled', at: this.deps.now(), by: who.name });
      this.deps.record({ floor: floorId, actor: { kind: 'human', name: who.name, ...(who.id ? { id: who.id } : {}) }, action: 'dev-change.cancelled', target: { kind: 'project', id: floorId, label: id }, summary: `Cancelled ${id} before it started`, details: { id, was: c.queue } });
      return (await this.deps.store.get(floorId, id))!;
    });
    if (typeof out !== 'string') await this.advance(floorId);
    return out;
  }

  /** Why the queue's head waits now (undefined: it doesn't, or there's none). */
  whyQueued(floorId: string, all: readonly DevChange[]): { why: QueueWhy; ahead?: string } | undefined {
    const active = activeOf(all);
    if (active) return { why: 'behind', ahead: active.id };
    const b = this.deps.blocked(floorId);
    if (b) return { why: b };
    if (this.refused.has(floorId)) return { why: 'refused' };
    return undefined;
  }

  /** Moves the project's queue: settles the active change when its turn is over, starts the next when it can. */
  advance(floorId: string): Promise<void> {
    return this.one(floorId, async () => {
      for (let guard = 0; guard < 50; guard++) {
        const all = await this.deps.store.all(floorId);
        const active = activeOf(all);
        if (active) {
          const why = settledWhy(await this.deps.facts(floorId, active));
          if (!why) return;
          await this.deps.store.event(floorId, active.id, { type: 'settled', at: this.deps.now(), why });
          this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.settled', target: { kind: 'project', id: floorId, label: active.id }, summary: `${active.id} is done for the queue (${why})`, details: { id: active.id, why } });
          continue;
        }
        const next = queuedOf(all)[0];
        if (!next) return;
        if (this.deps.blocked(floorId)) return;
        const main = await this.deps.mainHead(floorId).catch(() => undefined);
        if (next.ref && main) {
          const gone = await this.deps.recheck(floorId, main, next.ref).catch(() => undefined);
          if (gone) {
            await this.deps.store.event(floorId, next.id, { type: 'clarify', at: this.deps.now(), why: gone, main });
            this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.clarify', target: { kind: 'project', id: floorId, label: next.id }, summary: `${next.id} needs clarification: ${gone}`, details: { id: next.id, main } });
            continue;
          }
        }
        const handed = await this.deps.hand(floorId, next);
        if (typeof handed === 'string') {
          this.refused.set(floorId, handed);
          return;
        }
        this.refused.delete(floorId);
        await this.deps.store.event(floorId, next.id, { type: 'activated', at: this.deps.now(), ...handed, ...(main ? { main } : {}) });
        this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.started', target: { kind: 'worker', id: handed.workerId ?? handed.role, label: handed.member }, summary: `${next.id} handed to ${handed.member} as ${handed.requestId}, on branch dev/${next.id}`, details: { id: next.id, requestId: handed.requestId, main }, ids: { taskId: handed.taskId, ...(handed.executionId ? { executionId: handed.executionId } : {}) } });
        return;
      }
    });
  }

  /** The last hand-over refusal, while it stands. */
  refusal(floorId: string): string | undefined {
    return this.refused.get(floorId);
  }
}
