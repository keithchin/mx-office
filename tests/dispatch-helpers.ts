// What the durable dispatch tests share (tests/durable-dispatch*.test.ts): a fake floor whose agents keep
// Claude Code-shaped transcripts (a user entry per typed prompt, in the worker's own session file), an
// office made from a data folder, and a "crash": the office's in-memory state dropped without its saves,
// then a new office made from what is on disk.
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RosterAlert, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { DispatchRecord } from '../src/shared/dispatch.js';
import type { EscalationAsk } from '../src/shared/roster/escalation.js';
import { Roster } from '../src/server/roster/index.js';
import type { RosterDeps, TeamFloor } from '../src/server/roster/types.js';
import type { MadeIssue } from '../src/server/roster/issues.js';

export const ask = (title: string): EscalationAsk => ({ urgency: 'important', title, details: '', options: [] });

/** A JSONL line of a Claude Code transcript. */
export const userEntry = (sessionId: string, content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', sessionId, uuid: Math.random().toString(36).slice(2), message: { role: 'user', content }, ...extra });
export const assistantEntry = (sessionId: string, text: string) => JSON.stringify({ type: 'assistant', sessionId, message: { id: `m${Math.random()}`, role: 'assistant', content: [{ type: 'text', text }] } });
export const toolResultEntry = (sessionId: string, text: string) => JSON.stringify({ type: 'user', sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } });

export class FakeFloor implements TeamFloor {
  id = `dd-${Math.random().toString(36).slice(2, 8)}`;
  name = 'Probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'dd-floor-'));
  map = new Map<string, WorkerInfo>();
  files = new Map<string, string>();
  prompts: { id: string; text: string; by?: string }[] = [];
  /** Typing reaches the terminal but Claude Code never records it (the transcript stays as it was). */
  unrecorded = false;
  roster!: Roster;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(): Promise<WorkerInfo> {
    throw new Error('not here');
  }
  add(id: string, name: string, status: WorkerStatus = 'idle') {
    const sessionId = `sess-${id}-0001`;
    this.map.set(id, { id, kind: 'agent', provider: 'claude', deskId: 'd', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], sessionId } as unknown as WorkerInfo);
    const file = path.join(this.dir, `${sessionId}.jsonl`);
    writeFileSync(file, `${assistantEntry(sessionId, 'Hello, ready.')}\n`);
    this.files.set(id, file);
    return id;
  }
  private record(id: string, text: string) {
    const w = this.map.get(id) as WorkerInfo & { sessionId: string };
    if (!this.unrecorded) appendFileSync(this.files.get(id)!, `${userEntry(w.sessionId, text)}\n${assistantEntry(w.sessionId, 'On it.')}\n`);
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string, by?: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text, by });
    this.record(id, text);
    return undefined;
  }
  wake(id: string, text?: string, by?: string) {
    if (!this.map.has(id)) return 'No such worker';
    if (text) {
      this.prompts.push({ id, text, by });
      this.record(id, text);
    }
    Object.assign(this.map.get(id)!, { status: 'starting' });
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toasts: string[] = [];
  toast = (t: string) => void this.toasts.push(t);
  changed = (_alert?: RosterAlert) => {};
  activity = () => {};
  transcript = (w: WorkerInfo) => this.files.get(w.id);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

export const clock = { now: Date.UTC(2026, 9, 15, 9, 0) };

export interface Office {
  roster: Roster;
  dataDir: string;
  issues: { draft: { title: string; body: string } }[];
  find: { result: { number: number; url?: string } | null | undefined };
}

/** An office on `dataDir` (a fresh one when not given) with fake GitHub issues. */
export function office(floor: FakeFloor, dataDir = mkdtempSync(path.join(os.tmpdir(), 'dd-data-')), issues: Office['issues'] = [], find: Office['find'] = { result: null }, extra: Partial<RosterDeps> = {}): Office {
  const makeIssue = async (_dir: string, draft: { title: string; body: string }): Promise<MadeIssue> => {
    issues.push({ draft });
    return { number: 7, url: 'https://github.com/o/r/issues/7' };
  };
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue, findIssue: async () => find.result, analysis: () => '', now: () => clock.now, ...extra }, 0);
  floor.roster = roster;
  return { roster, dataDir, issues, find };
}

/** The office's process ends without its saves (pending roster writes dropped), and starts again on the same data. */
export function crashAndRestart(floor: FakeFloor, o: Office): Office {
  o.roster.file(floor.id).discard();
  return office(floor, o.dataDir, o.issues, o.find);
}

/** Makes the dispatch store's writes fail from the `n`th one on (1-based): the process "dies" there. */
export function failWritesFrom(o: Office, n: number): () => void {
  const store = o.roster.dispatch.store;
  const put = store.put;
  let calls = 0;
  store.put = (floorId: string, r: DispatchRecord) => (++calls >= n ? Promise.reject(new Error('the office stopped')) : put.call(store, floorId, r));
  return () => void (store.put = put);
}

/** Lets the async parts (marking held answers in flight, critical writes) finish. */
export const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

export const records = (o: Office, floor: FakeFloor) => o.roster.dispatch.store.list(floor.id);
