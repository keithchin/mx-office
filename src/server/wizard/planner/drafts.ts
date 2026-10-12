// The wizard drafts: a New project brief in progress, kept in the office's data (<data>/wizard-drafts/<id>/:
// draft.json and the attached files in files/), so a reload, another tab or an office restart loses
// nothing. A draft goes when its project's setup finishes, when it's discarded, or after two weeks unused;
// its attached files go with it.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { DraftView } from '../../../shared/brief.js';

export interface DraftState extends DraftView {
  /** Whose it is: the account id, or "shared" on the shared password. */
  owner: string;
  ownerName: string;
  createdAt: number;
}

const ID = /^d-[a-z0-9]{6,20}-[a-f0-9]{6}$/;
export const MAX_AGE_MS = 14 * 24 * 3_600_000;

export class DraftStore {
  private cache = new Map<string, DraftState>();

  constructor(readonly dir: string) {}

  private file = (id: string) => path.join(this.dir, id, 'draft.json');
  filesDir = (id: string) => path.join(this.dir, id, 'files');

  get(id: string): DraftState | undefined {
    if (!ID.test(id)) return undefined;
    const hit = this.cache.get(id);
    if (hit) return hit;
    try {
      const d = JSON.parse(readFileSync(this.file(id), 'utf8')) as DraftState;
      // A draft that was drafting when the office stopped has nothing working on it now.
      if (d.status === 'drafting') Object.assign(d, { status: d.brief ? 'ready' : 'failed', message: 'The office restarted while the Chief Analyst was drafting: draft again, or fill it in yourself' });
      if (d.busy) delete d.busy;
      if (d.domainsStatus === 'mapping') d.domainsStatus = 'failed';
      this.cache.set(id, d);
      return d;
    } catch {
      return undefined;
    }
  }

  /** Every draft on disk. */
  all(): DraftState[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => ID.test(n))
      .map((n) => this.get(n))
      .filter((d): d is DraftState => !!d);
  }

  /** The owner's newest draft that hasn't become a project yet. */
  latest(owner: string): DraftState | undefined {
    return this.all()
      .filter((d) => d.owner === owner && !d.job)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  create(init: Omit<DraftState, 'id' | 'createdAt' | 'updatedAt'>): DraftState {
    const id = `d-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const d: DraftState = { ...init, id, createdAt: Date.now(), updatedAt: Date.now() };
    this.save(d);
    return d;
  }

  save(d: DraftState) {
    d.updatedAt = Date.now();
    this.cache.set(d.id, d);
    mkdirSync(path.dirname(this.file(d.id)), { recursive: true });
    const tmp = `${this.file(d.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(d));
    renameSync(tmp, this.file(d.id));
  }

  /** The draft and its files, gone. */
  remove(id: string) {
    if (!ID.test(id)) return;
    this.cache.delete(id);
    rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }

  writeFile(id: string, name: string, bytes: Buffer): string {
    const dir = this.filesDir(id);
    mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    writeFileSync(p, bytes);
    return p;
  }

  removeFile(id: string, name: string) {
    rmSync(path.join(this.filesDir(id), name), { force: true });
  }

  /** Drafts unused for longer than `maxAgeMs`, removed. */
  prune(now = Date.now(), maxAgeMs = MAX_AGE_MS) {
    if (!existsSync(this.dir)) return;
    for (const n of readdirSync(this.dir)) {
      if (!ID.test(n)) continue;
      try {
        if (now - statSync(path.join(this.dir, n)).mtimeMs > maxAgeMs && now - (this.get(n)?.updatedAt ?? 0) > maxAgeMs) this.remove(n);
      } catch {
        // gone already
      }
    }
  }
}

/** The page's view of a draft: everything but whose it is. */
export function draftView(d: DraftState): DraftView {
  const { owner: _o, ownerName: _n, createdAt: _c, ...view } = d;
  return view;
}
