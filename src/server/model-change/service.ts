// The Model tab's change requests (shared/model-change.ts): what the person asked, kept per floor in the
// office's own data (<data>/model-change/<floor>.json), handed to the team member as a task through the
// office's one way into an agent (the roster's delivery, held for the turn under way unless they said
// now), recorded as `model.change-requested`, and read back with each request's PR from the floor's PR
// list the office already polls. The office never touches the model or the repository here: no .mpr
// write, no mxcli, no git, no gh. The member does the change on a branch and opens the PR.
//
// The seams (deps) are what index.ts wires to the real office, so the tests drive it with fakes.

import { parseStoreSync } from '../durable/read.js';
import { writeTextDurableSync } from '../durable/write.js';
import path from 'node:path';
import { changeTaskText, cleanWhen, isChangeKind, requestView, type ChangeElement, type ChangePull, type ChangeRequest, type ChangeRequestView, type ChangeWhen, type ChangeWorker } from '../../shared/model-change.js';
import { isRoleId, type RoleId } from '../../shared/roster/roles.js';
import type { AuditInput } from '../../shared/audit.js';
import type { SendOpts } from '../roster/deliver.js';

/** A team member the change can go to. */
export interface ChangeMember {
  role: RoleId;
  name: string;
  workerId?: string;
  /** At work (hired, not benched or sent home). */
  atWork: boolean;
}

export type Delivered = ({ status: 'sent' | 'held' | 'woke' } | { status: 'refused'; why: string }) & { dispatchId?: string };

export interface ChangeDeps {
  dataDir: string;
  now(): number;
  members(floorId: string): ChangeMember[];
  /** Types the task to the member (the roster's delivery, as a person): held for after its turn with `when: 'after'`. `onSent` once it's typed. */
  deliver(floorId: string, m: ChangeMember, text: string, o: { by: string; when: ChangeWhen; id: string; onSent: () => void }): Delivered | Promise<Delivered>;
  pulls(floorId: string): readonly ChangePull[];
  worker(floorId: string, id: string): ChangeWorker | undefined;
  record(e: AuditInput): void;
}

export interface ChangeAsk {
  elements: unknown;
  ref: unknown;
  sha?: unknown;
  request: unknown;
  role: unknown;
  when?: unknown;
  by: string;
  owner?: string;
}

interface Book {
  version: 1;
  next: number;
  items: ChangeRequest[];
}

const MAX_ELEMENTS = 20;
/** A merged request is forgotten this long after it was made (the audit log keeps the history). */
const KEEP_MS = 30 * 24 * 3_600_000;
const num = (id: string) => Number(id.slice(id.indexOf('-') + 1)) || 0;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

/** The elements from a request body, or why not. */
export function cleanElements(raw: unknown): ChangeElement[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'Pick an element to change';
  const out: ChangeElement[] = [];
  for (const e of raw.slice(0, MAX_ELEMENTS)) {
    const kind = (e as { kind?: unknown })?.kind;
    const qn = str((e as { qn?: unknown })?.qn, 300);
    if (!isChangeKind(kind) || !/^[\w.]{1,300}$/.test(qn) || !qn.includes('.')) return 'That element has no qualified name the office knows';
    if (!out.some((x) => x.qn === qn)) out.push({ kind, qn });
  }
  return out;
}

export class ChangeRequests {
  private books = new Map<string, Book>();

  constructor(private deps: ChangeDeps) {}

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'model-change', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  private book(floorId: string): Book {
    let b = this.books.get(floorId);
    if (b) return b;
    try {
      const v = parseStoreSync(this.file(floorId)) as Partial<Book>;
      b = v?.version === 1 && Array.isArray(v.items) && typeof v.next === 'number' ? { version: 1, next: v.next, items: v.items } : undefined;
    } catch {
      b = undefined;
    }
    b ??= { version: 1, next: 1, items: [] };
    this.books.set(floorId, b);
    return b;
  }

  private save(floorId: string) {
    const f = this.file(floorId);
    try {
      writeTextDurableSync(f, JSON.stringify(this.book(floorId)));
    } catch (err) {
      console.error(`agent-office: model change requests: couldn't save ${floorId}: ${(err as Error).message}`);
    }
  }

  /** Makes the request and hands it to the member: the request as it's kept, or why not. */
  async request(floorId: string, ask: ChangeAsk): Promise<ChangeRequestView | string> {
    const elements = cleanElements(ask.elements);
    if (typeof elements === 'string') return elements;
    const request = str(ask.request, 4000);
    if (!request) return 'Say what should change';
    const ref = str(ask.ref, 200) || 'main';
    if (!/^[\w./-]{1,200}$/.test(ref) || ref.includes('..') || ref.startsWith('-')) return 'That branch name looks wrong';
    const sha = str(ask.sha, 64);
    if (sha && !/^[0-9a-f]{7,64}$/i.test(sha)) return 'That commit looks wrong';
    if (!isRoleId(ask.role)) return 'Pick who it goes to';
    const m = this.deps.members(floorId).find((x) => x.role === ask.role);
    if (!m || !m.atWork) return `${m?.name ?? 'That member'} isn't at work: hire them on the Team tab first, or pick someone else`;
    const when = cleanWhen(ask.when);
    const b = this.book(floorId);
    // The number is taken before the dispatch's awaits, so two requests at once never share one.
    const id = `MCR-${b.next++}`;
    const by = ask.by || 'The Project Manager';
    const text = changeTaskText({ id, elements, ref, ...(sha ? { sha } : {}), request, by });
    const r: ChangeRequest = { id, elements, ref, ...(sha ? { sha } : {}), request, role: m.role, member: m.name, ...(m.workerId ? { workerId: m.workerId } : {}), when, at: this.deps.now(), by, delivery: 'held' };
    const sent = await this.deliver(floorId, m, text, r);
    if (sent.status === 'refused') return sent.why;
    r.delivery = sent.status;
    if (sent.dispatchId) r.dispatchId = sent.dispatchId;
    b.items.push(r);
    this.prune(b);
    this.save(floorId);
    this.deps.record({
      floor: floorId,
      actor: { kind: 'human', name: by, ...(ask.owner ? { id: ask.owner } : {}) },
      action: 'model.change-requested',
      target: { kind: 'worker', id: m.workerId ?? m.role, label: m.name },
      summary: `Asked ${m.name} to change ${elements.length === 1 ? elements[0].qn : `${elements.length} model elements`}${sent.status === 'held' ? ' (after their current turn)' : ''}`,
      details: { id, elements, ref, sha: sha || undefined, when, delivery: sent.status, length: request.length },
    });
    return this.view(floorId, r);
  }

  private deliver(floorId: string, m: ChangeMember, text: string, r: ChangeRequest): Delivered | Promise<Delivered> {
    return this.deps.deliver(floorId, m, text, {
      by: r.by,
      when: r.when,
      id: `model-change:${floorId}:${r.id}`,
      onSent: () => {
        const kept = this.book(floorId).items.find((x) => x.id === r.id);
        if (kept && kept.delivery === 'held') {
          kept.delivery = 'sent';
          this.save(floorId);
        }
      },
    });
  }

  private prune(b: Book) {
    const now = this.deps.now();
    b.items = b.items.filter((x) => now - x.at < KEEP_MS).slice(-500);
  }

  private view(floorId: string, r: ChangeRequest): ChangeRequestView {
    return requestView(r, this.deps.pulls(floorId), r.workerId ? this.deps.worker(floorId, r.workerId) : undefined);
  }

  /** The floor's requests with their PRs, newest first; merged ones only with `all`. */
  list(floorId: string, all = false): ChangeRequestView[] {
    const views = this.book(floorId).items.map((r) => this.view(floorId, r));
    return (all ? views : views.filter((v) => v.state !== 'merged')).sort((a, b) => b.at - a.at || num(b.id) - num(a.id));
  }
}

/**
 * How the task goes through the roster's delivery (roster/deliver.ts): as the person's words (so the
 * turn it starts is theirs), waking a sleeping member, and held while a dialog is up. "After their
 * current turn" (the default) holds it until the turn under way ends, as the lead panel and stuck
 * detection do; "now" types it into the turn.
 */
export function deliveryOpts(when: ChangeWhen, by: string, id: string, onSent: () => void): SendOpts {
  return { origin: 'person', by, wake: true, hold: true, id, onSent, ...(when === 'now' ? {} : { between: true }) };
}
