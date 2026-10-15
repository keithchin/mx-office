// The person's Dismiss choices on brain cards: <data>/context-manifests/dismissed.json → { "<floor>": ["<key>", …] }.
// A change is dismissed per brain snapshot (its HEAD, or a content key when unversioned), so the next change
// raises a card again; a wiring problem per its list of problems. Read once, written atomically.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonCritical } from '../flow/critical-write.js';

const KEPT = 50;

export class DismissStore {
  readonly file: string;
  private data?: Record<string, string[]>;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'context-manifests', 'dismissed.json');
  }

  private load(): Record<string, string[]> {
    if (!this.data) {
      try {
        const v = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
        this.data = v && typeof v === 'object' ? (v as Record<string, string[]>) : {};
      } catch {
        this.data = {};
      }
    }
    return this.data;
  }

  has(floor: string, key: string): boolean {
    const list = this.load()[floor];
    return Array.isArray(list) && list.includes(key);
  }

  async add(floor: string, key: string): Promise<void> {
    const d = this.load();
    const list = (d[floor] ??= []);
    if (!list.includes(key)) list.push(key);
    while (list.length > KEPT) list.shift();
    await writeJsonCritical(this.file, d);
  }
}
