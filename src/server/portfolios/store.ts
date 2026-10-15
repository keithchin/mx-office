// <data>/portfolios.json: the office's only record of portfolios, { version: 1, portfolios: Portfolio[] }.
// Membership lives here and nowhere else (not on FloorDef in floors.json): one file is the whole feature's
// state, so "one project in at most one portfolio" is checked in one place, and deleting this file is the
// rollback (no portfolios.json → the office behaves exactly as before portfolios). The file is only
// written once someone creates a portfolio. Read once (asynchronously), written with the acknowledged
// critical write (flow/critical-write.ts), changes serialised.

import { readFile } from 'node:fs/promises';
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
    this.loaded ??= readFile(this.file, 'utf8').then(
      (t) => (this.list = clean(JSON.parse(t))),
      () => (this.list = []),
    );
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

  /** Runs `fn` on the loaded list, then saves it, one change at a time. */
  private change<T>(fn: (list: Portfolio[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load();
      const out = fn(this.list);
      await writeJsonCritical(this.file, { version: 1, portfolios: this.list });
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async create(label: string, by: string): Promise<Portfolio | string> {
    const name = str(label, 80).replace(/[\r\n]+/g, ' ');
    if (!name) return 'Give the client a name';
    await this.load();
    if (this.list.some((p) => p.label.toLowerCase() === name.toLowerCase())) return `There is already a client called ${name}`;
    return this.change((list) => {
      const p: Portfolio = { id: mintPortfolioId(this.now()), label: name, projectIds: [], createdAt: this.now(), createdBy: str(by, 80) };
      list.push(p);
      return p;
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
