// The Developer change queue (shared/dev-changes.ts): intake, one active change per project (the engineering
// slot), the next one started when the active one is implemented, cancelled or settled, and the lifecycle's
// person actions: cancel (before it starts, or while the team has it), supersede by a correction, retry.
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
//   cancel    a queued (or flagged) change; or an active one, whose worker is stopped or isolated first (held
//             prompts for it taken back, its terminal stopped if it's mid-turn), its task marked cancelled, its
//             open PR flagged (never closed or deleted), and only then the slot released. Anything that shows up
//             for it afterwards is folded as late: shown, never counted. By whoever asked it or an admin; audited.
//   supersede a correction (linked with `of:`) marks its parent superseded, explicitly, by a person; an active
//             parent's worker is stopped first, as for cancel.
//   retry     an active change that needs attention (its worker gone, no PR) is put back at the front and handed
//             to the lead again; the old task is marked superseded.
//
// Order: a change handed again first, then corrections (the project's policy, default on), then the oldest.
// A merged change that the data-impact guard holds keeps the slot until approved (queue why: held). A queued
// change that overlaps an earlier one nobody has tried proceeds with the note, unless the policy says wait.
//
// It never merges, rebases or pushes, and holds back no other work: only Developer-view changes queue here.
// The seams (deps) are what index.ts wires to the real office, so the tests drive it with fakes.

import { activeOf, CHANGE_ID, cleanRef, cleanSha, cleanVia, DEFAULT_CHANGE_POLICY, KEY_RE, queuedOf, settledWhy, type ChangeFacts, type DevChange, type DevChangeEvent, type DevChangeNew, type DevChangePolicy, type ElementRef, type QueueWhy, type StopResult } from '../../shared/dev-changes.js';
import { cleanPage, REQUEST_MAX } from '../../shared/change-requests.js';
import type { AuditInput } from '../../shared/audit.js';
import type { ChangeStore } from './store.js';

export type Activated = Omit<Extract<DevChangeEvent, { type: 'activated' }>, 'type' | 'at' | 'main'>;

export interface ChangeDeps {
  store: ChangeStore;
  now(): number;
  /** Why the team can't take a change now, checked in this order: no lead at work, paused, spend cap, lead asleep. */
  blocked(floorId: string): Exclude<QueueWhy, 'behind' | 'refused' | 'held' | 'depends'> | undefined;
  /** Main's head in the project folder, when it can be read. */
  mainHead(floorId: string): Promise<string | undefined>;
  /** Why what the change points at is gone at `sha` (the page, or the widget on it); undefined when it's there or couldn't be told. */
  recheck(floorId: string, sha: string, ref: ElementRef): Promise<string | undefined>;
  /** Hands the change to the lead through the C4 path: the request and task it became, or why not. */
  hand(floorId: string, c: DevChange): Promise<Activated | string>;
  /** What the office knows of an active change now (task, PR, preview): for settling it. */
  facts(floorId: string, c: DevChange): Promise<ChangeFacts>;
  record(e: AuditInput): void;
  /** The project's queue policy (default: corrections first, overlapping work proceeds with the note). */
  policy?(floorId: string): DevChangePolicy;
  /**
   * Stops or isolates the worker an active change was handed to, before its slot is released: takes back held
   * prompts for it, stops its terminal when it's mid-turn. How it went, or why it couldn't (then nothing changes).
   */
  stop?(floorId: string, c: DevChange, by: string): Promise<StopResult | string>;
  /** Marks the change's task as ended on the task record (cancelled, or superseded when handed again). */
  endTask?(floorId: string, taskId: string, how: 'cancelled' | 'superseded', why: string): void;
  /** Flags an open PR of a cancelled change (a comment; never closed or deleted). */
  flagPr?(floorId: string, pr: number, text: string): Promise<void>;
  /** The data-impact guard on a merged change (server/data-impact/seams.ts checkCandidate): true while it's held. */
  held?(floorId: string, c: DevChange, f: ChangeFacts): Promise<boolean>;
  /** Earlier changes nobody has tried yet whose model units overlap this one's. */
  depends?(floorId: string, c: DevChange, all: readonly DevChange[]): Promise<{ id: string; docs: string[] }[]>;
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
  /** The change this one corrects (DC-<n> of the same project), when it's a correction. */
  of?: unknown;
  /** Which entry point asked (chat, dialog, validation, try). */
  via?: unknown;
  by: string;
  owner?: string;
}

export interface Who {
  name: string;
  id?: string;
  admin: boolean;
}

const human = (who: Who) => ({ kind: 'human' as const, name: who.name, ...(who.id ? { id: who.id } : {}) });

export class DevChanges {
  private serial = new Map<string, Promise<unknown>>();
  /** The last refusal from the hand-over, per project (in memory: shown as the queue's why until the next try). */
  private refused = new Map<string, string>();
  /** The active change the data-impact guard holds, per project (in memory: worked out again on every move). */
  private heldNow = new Map<string, string>();
  /** The earlier change the queue's head waits for by policy, per project (in memory, as above). */
  private waitsFor = new Map<string, string>();

  constructor(private deps: ChangeDeps) {}

  policy(floorId: string): DevChangePolicy {
    return this.deps.policy?.(floorId) ?? DEFAULT_CHANGE_POLICY;
  }

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
      const of = typeof ask.of === 'string' && CHANGE_ID.test(ask.of) && (await this.deps.store.get(floorId, ask.of)) ? ask.of : undefined;
      const via = cleanVia(ask.via);
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
        ...(of ? { of } : {}),
        ...(via ? { via } : {}),
      });
      this.deps.record({
        floor: floorId,
        actor: { kind: 'human', name: by, ...(ask.owner ? { id: ask.owner } : {}) },
        action: 'dev-change.queued',
        target: { kind: 'project', id: floorId, label: id },
        summary: of ? `Asked for a correction of ${of} (${id})` : `Asked for a change (${id}) from the Developer view`,
        details: { id, source: change.source.sha, page, ...(of ? { of } : {}), ...(via ? { via } : {}), ref: ref ? `${ref.docQn}${ref.widgetName ? `/${ref.widgetName}` : ref.name ? `/${ref.name}` : ''}` : undefined, length: text.length },
      });
      return { change, again: false };
    });
    if (typeof made === 'string') return made;
    await this.advance(floorId);
    return { change: (await this.deps.store.get(floorId, made.change.id)) ?? made.change, again: made.again };
  }

  /**
   * A linked record beside an older request (a Model-tab MCR-n, a C4 CR-n): append-only, never queued, its work
   * followed from its alias. The same alias again gives back the record already made.
   */
  async link(floorId: string, c: Omit<DevChangeNew, 'id'> & { linked: NonNullable<DevChangeNew['linked']> }): Promise<{ change: DevChange; again: boolean }> {
    return this.one(floorId, async () => {
      const had = (await this.deps.store.all(floorId)).find((x) => x.linked?.kind === c.linked.kind && x.linked.id === c.linked.id);
      if (had) return { change: had, again: true };
      const id = await this.deps.store.nextId(floorId);
      const change = await this.deps.store.create(floorId, { id, ...c });
      this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.linked', target: { kind: 'project', id: floorId, label: id }, summary: `${c.linked.id} is linked as ${id} (its alias; ${c.linked.id} and its history are kept as they were)`, details: { id, alias: c.linked.id, kind: c.linked.kind, via: c.via } });
      return { change, again: false };
    });
  }

  private may(c: DevChange, who: Who) {
    return who.admin || (!!c.owner && !!who.id && c.owner === who.id);
  }

  /** Stops or isolates an active change's worker; why not, when it couldn't (nothing changes then). */
  private async isolate(floorId: string, c: DevChange, by: string): Promise<StopResult | string> {
    if (!this.deps.stop) return { how: 'gone' };
    const r = await this.deps.stop(floorId, c, by).catch((err: Error) => `The office couldn’t stop the worker: ${err.message}`);
    return typeof r === 'string' ? `${r}. Nothing was changed: ${c.id} is still with the team.` : r;
  }

  /**
   * Cancels a change: one that hasn't started (queued, flagged), or an active one (its worker stopped or isolated
   * first, its task marked cancelled, an open PR flagged, then the slot released). By whoever asked it, or an admin.
   */
  async cancel(floorId: string, id: string, who: Who): Promise<DevChange | string> {
    const out = await this.one(floorId, async () => {
      const c = await this.deps.store.get(floorId, id);
      if (!c) return 'No such change';
      if (c.queue === 'cancelled') return 'It’s cancelled already';
      if (c.queue === 'linked') return `It’s followed from ${c.linked?.id}: ask the team member who has that request to stop it.`;
      if (c.queue !== 'queued' && c.queue !== 'clarify' && c.queue !== 'active') return 'It’s over already: nothing to cancel.';
      if (!this.may(c, who)) return 'Only whoever asked for it, or an admin, can cancel it';
      if (c.queue !== 'active') {
        await this.deps.store.event(floorId, id, { type: 'cancelled', at: this.deps.now(), by: who.name, ...(who.id ? { byId: who.id } : {}) });
        this.deps.record({ floor: floorId, actor: human(who), action: 'dev-change.cancelled', target: { kind: 'project', id: floorId, label: id }, summary: `Cancelled ${id} before it started`, details: { id, was: c.queue } });
        return (await this.deps.store.get(floorId, id))!;
      }
      // The team has it: stop or isolate its worker before the slot is released.
      const f = await this.deps.facts(floorId, c).catch((): ChangeFacts => ({ queue: c.queue }));
      if (f.merged) return `It was merged into main @${f.merged.sha.slice(0, 7)} already: it can’t be cancelled. Ask for a correction instead.`;
      const stop = await this.isolate(floorId, c, who.name);
      if (typeof stop === 'string') return stop;
      if (c.activated?.taskId) this.deps.endTask?.(floorId, c.activated.taskId, 'cancelled', `${id} cancelled by ${who.name} from the Developer view`);
      const pr = f.pr?.state === 'OPEN' ? f.pr.number : undefined;
      await this.deps.store.event(floorId, id, { type: 'cancelled', at: this.deps.now(), by: who.name, ...(who.id ? { byId: who.id } : {}), active: true, stop, ...(pr ? { pr } : {}) });
      if (pr) await this.deps.flagPr?.(floorId, pr, `${id} was cancelled by ${who.name} in Mx Office. This PR no longer counts for it: it won’t settle the change or move the queue. Nothing was closed or deleted.`).catch(() => undefined);
      this.heldNow.delete(floorId);
      this.deps.record({ floor: floorId, actor: human(who), action: 'dev-change.cancelled', target: { kind: 'project', id: floorId, label: id }, summary: `Cancelled ${id} while ${c.activated?.member ?? 'the team'} had it: worker ${stop.how}${pr ? `, PR #${pr} flagged` : ''}; the slot is free`, details: { id, was: 'active', stop, ...(pr ? { pr } : {}), candidates: c.candidates.length }, ...(c.activated?.taskId ? { ids: { taskId: c.activated.taskId } } : {}) });
      return (await this.deps.store.get(floorId, id))!;
    });
    if (typeof out !== 'string') await this.advance(floorId);
    return out;
  }

  /** A correction marks the change it corrects superseded, explicitly, by a person (whoever asked either, or an admin). */
  async supersede(floorId: string, followId: string, who: Who): Promise<DevChange | string> {
    const out = await this.one(floorId, async () => {
      const follow = await this.deps.store.get(floorId, followId);
      if (!follow) return 'No such change';
      if (!follow.of) return `${followId} isn’t a correction of another change`;
      const parent = await this.deps.store.get(floorId, follow.of);
      if (!parent) return `No such change ${follow.of}`;
      if (parent.queue === 'cancelled' || parent.queue === 'superseded') return `${parent.id} is ${parent.queue} already`;
      if (!this.may(follow, who) && !this.may(parent, who)) return 'Only whoever asked for either change, or an admin, can mark it superseded';
      let stop: StopResult | undefined;
      if (parent.queue === 'active') {
        const s = await this.isolate(floorId, parent, who.name);
        if (typeof s === 'string') return s;
        stop = s;
        if (parent.activated?.taskId) this.deps.endTask?.(floorId, parent.activated.taskId, 'superseded', `${parent.id} superseded by ${followId} (${who.name})`);
      }
      await this.deps.store.event(floorId, parent.id, { type: 'superseded', at: this.deps.now(), by: who.name, ...(who.id ? { byId: who.id } : {}), follow: followId, ...(stop ? { stop } : {}) });
      this.deps.record({ floor: floorId, actor: human(who), action: 'dev-change.superseded', target: { kind: 'project', id: floorId, label: parent.id }, summary: `Marked ${parent.id} superseded by ${followId}${stop ? ` (worker ${stop.how})` : ''}`, details: { id: parent.id, follow: followId, was: parent.queue, ...(stop ? { stop } : {}) } });
      return (await this.deps.store.get(floorId, parent.id))!;
    });
    if (typeof out !== 'string') await this.advance(floorId);
    return out;
  }

  /** Hands an active change that needs attention (its worker gone, no PR) to the lead again, from the front of the queue. */
  async retry(floorId: string, id: string, who: Who): Promise<DevChange | string> {
    const out = await this.one(floorId, async () => {
      const c = await this.deps.store.get(floorId, id);
      if (!c) return 'No such change';
      if (!this.may(c, who)) return 'Only whoever asked for it, or an admin, can hand it over again';
      if (c.queue !== 'active') return 'Only a change the team has can be handed over again';
      const f = await this.deps.facts(floorId, c);
      if (!f.workerGone || f.pr) return 'It doesn’t need attention: its worker is still on the project, or it has a PR';
      if (c.activated?.taskId) this.deps.endTask?.(floorId, c.activated.taskId, 'superseded', `${id} handed over again by ${who.name}`);
      await this.deps.store.event(floorId, id, { type: 'requeued', at: this.deps.now(), by: who.name, why: 'retry' });
      this.deps.record({ floor: floorId, actor: human(who), action: 'dev-change.retry', target: { kind: 'project', id: floorId, label: id }, summary: `${id} put back at the front of the queue to be handed over again (its worker had left)`, details: { id, task: c.activated?.taskId } });
      return (await this.deps.store.get(floorId, id))!;
    });
    if (typeof out !== 'string') await this.advance(floorId);
    return out;
  }

  /** Why the queue's head waits now (undefined: it doesn't, or there's none). */
  whyQueued(floorId: string, all: readonly DevChange[]): { why: QueueWhy; ahead?: string } | undefined {
    const active = activeOf(all);
    if (active) return this.heldNow.get(floorId) === active.id ? { why: 'held', ahead: active.id } : { why: 'behind', ahead: active.id };
    const b = this.deps.blocked(floorId);
    if (b) return { why: b };
    const dep = this.waitsFor.get(floorId);
    if (dep) return { why: 'depends', ahead: dep };
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
          const f = await this.deps.facts(floorId, active);
          const why = settledWhy(f);
          if (!why) return;
          // Merged, but held for possible data impact: it keeps the slot until approved (the guard's own binding).
          if (why === 'merged' && this.deps.held && (await this.deps.held(floorId, active, f).catch(() => true))) {
            this.heldNow.set(floorId, active.id);
            return;
          }
          this.heldNow.delete(floorId);
          await this.deps.store.event(floorId, active.id, { type: 'settled', at: this.deps.now(), why });
          this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.settled', target: { kind: 'project', id: floorId, label: active.id }, summary: `${active.id} is done for the queue (${why})`, details: { id: active.id, why } });
          continue;
        }
        this.heldNow.delete(floorId);
        const next = queuedOf(all, this.policy(floorId))[0];
        if (!next) return void this.waitsFor.delete(floorId);
        if (this.deps.blocked(floorId)) return;
        if (this.policy(floorId).waitForReview && this.deps.depends) {
          const dep = (await this.deps.depends(floorId, next, all).catch(() => []))[0];
          if (dep) return void this.waitsFor.set(floorId, dep.id);
        }
        this.waitsFor.delete(floorId);
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
        this.deps.record({ floor: floorId, actor: { kind: 'office', name: 'Mx Office' }, action: 'dev-change.started', target: { kind: 'worker', id: handed.workerId ?? handed.role, label: handed.member }, summary: `${next.id} handed to ${handed.member} as ${handed.requestId}, on branch dev/${next.id}`, details: { id: next.id, requestId: handed.requestId, main, ...(next.of ? { of: next.of } : {}) }, ids: { taskId: handed.taskId, ...(handed.executionId ? { executionId: handed.executionId } : {}) } });
        return;
      }
    });
  }

  /** The last hand-over refusal, while it stands. */
  refusal(floorId: string): string | undefined {
    return this.refused.get(floorId);
  }
}
