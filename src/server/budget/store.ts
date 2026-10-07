// Where the budget lives on disk: in the office's data folder, budget/<floor>.json per project (its
// ledger, its budget settings, its plan and the alerts it has raised) and budget/office.json for the
// office's own (the currency, the default alert threshold, and the background calls that served no floor).
// Written a second after a change, through a temporary file, so a crash never leaves half a file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BudgetAlert, BudgetPlan, BudgetSettings, FxSettings } from '../../shared/budget/types.js';
import { DEFAULT_FX, type FxLast } from './fx.js';
import { emptyLedger, type LedgerData } from './ledger.js';

export const DEFAULT_THRESHOLD = 80;

export interface FloorFile {
  ledger: LedgerData;
  settings: BudgetSettings;
  plan?: BudgetPlan;
  /** The alerts raised against the current budget (one per level; cleared when the budget is raised). */
  alerts: BudgetAlert[];
  /** Paused by the budget, and when. */
  pausedAt?: number;
}

export interface OfficeFile {
  fx: FxSettings;
  fxLast?: FxLast;
  /** The office default alert threshold, %. */
  threshold: number;
  /** Background calls that served no floor. */
  ledger: LedgerData;
}

const SAFE = /^[\w.-]{1,120}$/;

export class BudgetStore {
  readonly dir: string;
  private floors = new Map<string, FloorFile>();
  private officeFile?: OfficeFile;
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** The background write going now (see flushSoon): the next one waits for it, so they land in order. */
  private writing: Promise<void> = Promise.resolve();
  /** What that write has yet to land: flush() at exit writes it too. */
  private inFlight = new Set<string>();
  /** Bumped by flush(): a background write that started before it doesn't land over what it wrote. */
  private syncs = 0;

  constructor(
    dataDir: string,
    private now: () => number = Date.now,
  ) {
    this.dir = path.join(dataDir, 'budget');
  }

  /** Whether a floor has a budget file yet (one that doesn't is back-filled when it's made). */
  has(floor: string): boolean {
    return this.floors.has(floor) || (SAFE.test(floor) && existsSync(path.join(this.dir, `${floor}.json`)));
  }

  floor(id: string): FloorFile {
    let f = this.floors.get(id);
    if (f) return f;
    const saved = SAFE.test(id) ? this.read(`${id}.json`) : undefined;
    f = {
      ledger: { ...emptyLedger(this.now()), ...(saved?.ledger ?? {}) },
      settings: { autoPause: true, ...(saved?.settings ?? {}) },
      ...(saved?.plan ? { plan: saved.plan } : {}),
      alerts: Array.isArray(saved?.alerts) ? saved.alerts : [],
      ...(typeof saved?.pausedAt === 'number' ? { pausedAt: saved.pausedAt } : {}),
    };
    this.floors.set(id, f);
    return f;
  }

  office(): OfficeFile {
    if (this.officeFile) return this.officeFile;
    const saved = this.read('office.json');
    this.officeFile = {
      fx: { ...DEFAULT_FX, ...(saved?.fx ?? {}) },
      ...(saved?.fxLast ? { fxLast: saved.fxLast } : {}),
      threshold: typeof saved?.threshold === 'number' && saved.threshold > 0 && saved.threshold < 100 ? saved.threshold : DEFAULT_THRESHOLD,
      ledger: { ...emptyLedger(this.now()), ...(saved?.ledger ?? {}) },
    };
    return this.officeFile;
  }

  /** Every floor with a file, open or not. */
  loaded(): string[] {
    return [...this.floors.keys()];
  }

  changed(id: string | 'office') {
    this.dirty.add(id);
    this.timer ??= setTimeout(() => void this.flushSoon(), 1000);
    this.timer.unref?.();
  }

  /**
   * Writes what changed without blocking the event loop (each file to a temporary one, then renamed):
   * the ledger's files are big on a busy project, and a rename on Windows can take a few hundred ms
   * (it held the server for 870 ms after a budget look on the big test office). flush() is the same,
   * at once, for the office's exit and the tests.
   */
  flushSoon(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) this.inFlight.add(id);
    const job = this.writing.then(async () => {
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
      } catch {
        for (const id of ids) this.dirty.add(id), this.inFlight.delete(id);
        return;
      }
      for (const id of ids) {
        const data = id === 'office' ? this.officeFile : this.floors.get(id);
        if (!data || (id !== 'office' && !SAFE.test(id))) continue;
        const file = path.join(this.dir, `${id}.json`);
        try {
          const gen = this.syncs;
          await writeFile(`${file}.tmp-bg`, JSON.stringify(data), { mode: 0o600 });
          if (gen === this.syncs) await rename(`${file}.tmp-bg`, file);
        } catch {
          // disk trouble shouldn't take the office down; tried again on the next change
          this.dirty.add(id);
        }
        this.inFlight.delete(id);
      }
    });
    this.writing = job;
    return job;
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ids = new Set([...this.dirty, ...this.inFlight]);
    if (!ids.size) return;
    this.syncs++;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch {
      return;
    }
    for (const id of ids) {
      const data = id === 'office' ? this.officeFile : this.floors.get(id);
      if (!data || (id !== 'office' && !SAFE.test(id))) continue;
      const file = path.join(this.dir, `${id}.json`);
      try {
        writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      } catch {
        // disk trouble shouldn't take the office down; tried again on the next change
        continue;
      }
    }
    this.dirty.clear();
  }

  private read(name: string): any {
    try {
      const v = JSON.parse(readFileSync(path.join(this.dir, name), 'utf8'));
      return v && typeof v === 'object' ? v : undefined;
    } catch {
      return undefined;
    }
  }
}
