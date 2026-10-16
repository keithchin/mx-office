// <data>/portfolios.json: the office's only record of portfolios, { version: 1, portfolios: Portfolio[] }.
// Membership lives here and nowhere else (not on FloorDef in floors.json): one file is the whole feature's
// state, so "one project in at most one portfolio" is checked in one place, and deleting this file is the
// rollback (no portfolios.json → the office behaves exactly as before portfolios). The file is only
// written once someone creates a portfolio. Read once (asynchronously), written with the acknowledged
// critical write (flow/critical-write.ts), changes serialised.

import { loadJson } from '../durable/read.js';
import path from 'node:path';
import { writeJsonCritical } from '../flow/critical-write.js';
import { isPortfolioId, mintPortfolioId, type Portfolio, type PortfolioBrainRef } from '../../shared/portfolios.js';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function clean(raw: unknown): Portfolio[] {
  const list = (raw as { portfolios?: unknown })?.portfolios;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Portfolio[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || !isPortfolioId((p as Portfolio).id)) continue;
    const r = p as Portfolio;
    // One project in at most one portfolio, even in a hand-edited file: the first keeps it.
    const projectIds = (Array.isArray(r.projectIds) ? r.projectIds : []).filter((x): x is string => typeof x === 'string' && !seen.has(x));
    for (const x of projectIds) seen.add(x);
    const b = r.brain;
    const brain = b && typeof b.path === 'string' && b.path ? { path: b.path, connectedAt: Number(b.connectedAt) || 0, by: str(b.by, 80) } : undefined;
    out.push({ id: r.id, label: str(r.label, 80) || r.id, projectIds, ...(brain ? { brain } : {}), ...(typeof r.createdAt === 'number' ? { createdAt: r.createdAt } : {}), ...(r.createdBy ? { createdBy: str(r.createdBy, 80) } : {}) });
  }
  return out;
}

export class PortfolioStore {
  readonly file: string;
  private loaded?: Promise<Portfolio[]>;
  private list: Portfolio[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string, private now: () => number = Date.now) {
    this.file = path.join(dataDir, 'portfolios.json');
  }

  /** Every portfolio (none, and nothing written, when portfolios.json doesn't exist). */
  load(): Promise<Portfolio[]> {
    // Only a missing file is "none"; a locked one rejects and is read again next time (durable/read.ts).
    this.loaded ??= loadJson(this.file, (v) => (this.list = v === undefined ? [] : clean(v)), () => (this.loaded = undefined));
    return this.loaded;
  }

  /** As last loaded (empty before the first load). */
  all(): readonly Portfolio[] {
    return this.list;
  }

  get(id: string): Portfolio | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** The portfolio a project is in, if any. */
  ofFloor(floorId: string): Portfolio | undefined {
    return this.list.find((p) => p.projectIds.includes(floorId));
  }

  /** Runs `fn` once the list is loaded, one change at a time (it saves, if it changes anything). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load();
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private save(): Promise<void> {
    return writeJsonCritical(this.file, { version: 1, portfolios: this.list });
  }

  /** Runs `fn` on the loaded list, then saves it, one change at a time. */
  private change<T>(fn: (list: Portfolio[]) => T): Promise<T> {
    return this.serial(async () => {
      const out = fn(this.list);
      await this.save();
      return out;
    });
  }

  /**
   * A client's name as typed, made safe, or why it can't be one: trimmed, at most 80 characters, newlines
   * folded to spaces, not empty, and no other client (`except` aside) with the same name in any case.
   */
  private nameFor(label: unknown, except?: string): string | { error: string } {
    const name = str(label, 80).replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (!name) return { error: 'Give the client a name' };
    if (this.list.some((p) => p.id !== except && p.label.toLowerCase() === name.toLowerCase())) return { error: `There is already a client called ${name}` };
    return name;
  }

  /**
   * A new client. The name is checked inside the one-at-a-time chain, so two creates sent together (a
   * double Enter) can't both pass the check and make two clients of one name; nothing is written when
   * it's refused.
   */
  async create(label: string, by: string): Promise<Portfolio | string> {
    return this.serial(async () => {
      const name = this.nameFor(label);
      if (typeof name !== 'string') return name.error;
      const p: Portfolio = { id: mintPortfolioId(this.now()), label: name, projectIds: [], createdAt: this.now(), createdBy: str(by, 80) };
      this.list.push(p);
      await this.save();
      return p;
    });
  }

  /** A new name for a client: same rules as create. Its id never changes. Gives back the old and new names. */
  async rename(id: string, label: string): Promise<{ before: string; after: string } | string> {
    return this.serial(async () => {
      const p = this.get(id);
      if (!p) return 'No such client';
      const name = this.nameFor(label, id);
      if (typeof name !== 'string') return name.error;
      const before = p.label;
      if (before === name) return { before, after: name };
      p.label = name;
      await this.save();
      return { before, after: name };
    });
  }

  /**
   * Puts an ungrouped project in a portfolio. Refused for a project already in another portfolio (S03:
   * cross-portfolio moves are unavailable in this phase); a no-op when it's already in this one.
   */
  async addProject(id: string, floorId: string): Promise<string | undefined> {
    await this.load();
    const p = this.get(id);
    if (!p) return 'No such client';
    const other = this.ofFloor(floorId);
    if (other && other.id !== id) return `This project already belongs to the client ${other.label}, and a project can belong to one client. Moving a project between clients isn't available: it may already have used that client's company brain, and moving it can't take that back.`;
    if (other) return undefined;
    await this.change(() => void p.projectIds.push(floorId));
    return undefined;
  }

  async setBrain(id: string, brain: PortfolioBrainRef | undefined): Promise<string | undefined> {
    await this.load();
    const p = this.get(id);
    if (!p) return 'No such client';
    await this.change(() => {
      if (brain) p.brain = brain;
      else delete p.brain;
    });
    return undefined;
  }
}
