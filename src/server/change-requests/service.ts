// Change requests from the App Workspace (shared/change-requests.ts): the person's words with the page and the
// version they were looking at, kept per project in the office's own data (<data>/change-requests/<project>.json:
// only the link from a request to its task and what it was about; the task's state stays in the task record,
// the roster and the PR list), handed to the team's lead as a task through the roster (the task id minted and on
// disk before anything is typed, the roster's delivery held for the lead's turn under way), and recorded in the
// audit log as `change-request.created` with the task's id. A request the office couldn't make a task for is
// refused: every request has a task id.
//
// Who it goes to is existing intake's rule: whoever covers management on the team's shape (the lead panel's lead:
// an Enterprise team's Project Coordinator, a Startup's Chief Analyst, a Solo Lead), else whoever covers analysis.
//
// The seams (deps) are what index.ts wires to the real office, so the tests drive it with fakes.

import path from 'node:path';
import { parseStoreSync } from '../durable/read.js';
import { writeTextDurableSync } from '../durable/write.js';
import { cleanPage, REQUEST_MAX, requestTaskText, type ChangeRequestRecord } from '../../shared/change-requests.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { AuditInput } from '../../shared/audit.js';
import type { DevChangeNew } from '../../shared/dev-changes.js';

/** A team member a request can go to. */
export interface RequestMember {
  role: RoleId;
  name: string;
  workerId?: string;
  /** At work (hired, not benched or sent home). */
  atWork: boolean;
}

/** What the roster said when the task was handed over: its ids, and whether it was typed or held. */
export type Handed = { status: 'sent' | 'held' | 'woke'; taskId: string; executionId?: string; dispatchId?: string } | { status: 'refused'; why: string };

export interface RequestDeps {
  dataDir: string;
  now(): number;
  /** The members a request may go to, in order: the lead (management's cover), then analysis's cover. */
  intake(floorId: string): RequestMember[];
  /** Mints the task and types it to the member (held for after its turn): its ids, or why not. `onSent` once typed. */
  hand(floorId: string, m: RequestMember, text: string, o: { by: string; id: string; onSent: () => void }): Handed | Promise<Handed>;
  record(e: AuditInput): void;
}

export interface RequestAsk {
  text: unknown;
  page?: unknown;
  pageMoved?: unknown;
  revision?: unknown;
  by: string;
  owner?: string;
  /** The Developer change it carries out (server/dev-changes/): its id, source revision and element, put in the task. */
  change?: Pick<DevChangeNew, 'id' | 'source' | 'ref'>;
}

interface Book {
  version: 1;
  next: number;
  items: ChangeRequestRecord[];
}

/** How many requests a project keeps (the audit log and the task record keep the history). */
const KEPT = 500;

export class RequestBook {
  private books = new Map<string, Book>();

  constructor(private deps: RequestDeps) {}

  private file(floorId: string) {
    return path.join(this.deps.dataDir, 'change-requests', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  private book(floorId: string): Book {
    let b = this.books.get(floorId);
    if (b) return b;
    try {
      const v = parseStoreSync(this.file(floorId)) as Partial<Book>;
      b = v?.version === 1 && Array.isArray(v.items) && typeof v.next === 'number' ? { version: 1, next: v.next, items: v.items.filter((x) => x && typeof x.taskId === 'string') } : undefined;
    } catch {
      b = undefined;
    }
    b ??= { version: 1, next: 1, items: [] };
    this.books.set(floorId, b);
    return b;
  }

  private save(floorId: string) {
    try {
      writeTextDurableSync(this.file(floorId), JSON.stringify(this.book(floorId)));
    } catch (err) {
      console.error(`agent-office: change requests: couldn't save ${floorId}: ${(err as Error).message}`);
    }
  }

  /** Makes the request and hands it to the lead as a task: the request as kept (with its task id), or why not. */
  async request(floorId: string, ask: RequestAsk): Promise<ChangeRequestRecord | string> {
    const text = typeof ask.text === 'string' ? ask.text.replace(/\r\n?/g, '\n').trim().slice(0, REQUEST_MAX) : '';
    if (!text) return 'Say what should change';
    if (text.length < 8) return 'Say a little more about what should change';
    const page = cleanPage(ask.page);
    const revision = typeof ask.revision === 'string' && /^[0-9a-f]{7,64}$/i.test(ask.revision) ? ask.revision.toLowerCase() : undefined;
    const m = this.deps.intake(floorId).find((x) => x.atWork && x.workerId);
    if (!m) return 'No team lead is at work on this project yet, so nobody can take the request. Start the team in Project Management, then ask again.';
    const b = this.book(floorId);
    // The number is taken before the awaits, so two requests at once never share one.
    const id = `CR-${b.next++}`;
    const by = ask.by || 'The Project Manager';
    const r: Omit<ChangeRequestRecord, 'taskId' | 'delivery'> = { id, text, ...(page ? { page } : {}), ...(page && ask.pageMoved === true ? { pageMoved: true } : {}), ...(revision ? { revision } : {}), by, ...(ask.owner ? { owner: ask.owner } : {}), at: this.deps.now(), role: m.role, member: m.name, ...(m.workerId ? { workerId: m.workerId } : {}), ...(ask.change ? { changeId: ask.change.id, source: { ...(ask.change.source.sha ? { sha: ask.change.source.sha } : {}), ...(ask.change.ref ? { ref: ask.change.ref } : {}) } } : {}) };
    const handed = await this.deps.hand(floorId, m, requestTaskText({ ...r, ...(ask.change ? { change: ask.change } : {}) }), {
      by,
      id: `change-request:${floorId}:${id}`,
      onSent: () => {
        const kept = this.book(floorId).items.find((x) => x.id === id);
        if (kept && kept.delivery === 'held') {
          kept.delivery = 'sent';
          this.save(floorId);
        }
      },
    });
    if (handed.status === 'refused') return handed.why;
    if (!handed.taskId) return 'The office couldn’t make a task for this request, so nothing was sent. Try again.';
    const rec: ChangeRequestRecord = { ...r, taskId: handed.taskId, ...(handed.executionId ? { executionId: handed.executionId } : {}), delivery: handed.status, ...(handed.dispatchId ? { dispatchId: handed.dispatchId } : {}) };
    b.items.push(rec);
    b.items = b.items.slice(-KEPT);
    this.save(floorId);
    this.deps.record({
      floor: floorId,
      actor: { kind: 'human', name: by, ...(ask.owner ? { id: ask.owner } : {}) },
      action: 'change-request.created',
      target: { kind: 'worker', id: m.workerId ?? m.role, label: m.name },
      summary: `Asked for a change (${id}) from the Developer view, handed to ${m.name}${handed.status === 'held' ? ' after their current turn' : ''}`,
      details: { id, ...(ask.change ? { changeId: ask.change.id } : {}), page, revision, delivery: handed.status, length: text.length },
      ids: { taskId: handed.taskId, ...(handed.executionId ? { executionId: handed.executionId } : {}), roleId: m.role, ...(m.workerId ? { agentInstanceId: m.workerId } : {}) },
    });
    return rec;
  }

  /** The project's requests, newest first. */
  list(floorId: string): ChangeRequestRecord[] {
    return [...this.book(floorId).items].sort((a, b) => b.at - a.at);
  }
}
