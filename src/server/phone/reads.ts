// What each person has read on the team phone, so its unread counts survive a reload and follow them
// to another browser: <data>/phone/reads.json, per person (their account, or on the shared password
// their browser's own key) the time of the newest message read in each channel. Written atomically, a
// moment after a change; never throws on a bad or missing file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanReads, mergeReads, type PhoneReads } from '../../shared/phone.js';

/** People kept; past it the ones who read nothing for longest go. */
const PEOPLE_MAX = 200;
const SAVE_MS = 1500;

export class PhoneReadStore {
  private all?: Record<string, { at: number; reads: PhoneReads }>;
  private timer?: NodeJS.Timeout;

  constructor(private dataDir: string) {}

  private get file() {
    return path.join(this.dataDir, 'phone', 'reads.json');
  }

  private load() {
    if (this.all) return this.all;
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // first time
    }
    const out: Record<string, { at: number; reads: PhoneReads }> = {};
    for (const [who, v] of Object.entries((raw && typeof raw === 'object' ? raw : {}) as Record<string, any>)) {
      if (typeof who === 'string' && who.length <= 80 && v && typeof v.at === 'number') out[who] = { at: v.at, reads: cleanReads(v.reads) };
    }
    this.all = out;
    return out;
  }

  get(who: string): PhoneReads {
    return { ...(this.load()[who]?.reads ?? {}) };
  }

  /** Marks what `who` has read (later reads win); what they've read now. */
  mark(who: string, reads: PhoneReads, now = Date.now()): PhoneReads {
    const all = this.load();
    const merged = cleanReads(mergeReads(all[who]?.reads ?? {}, cleanReads(reads)));
    all[who] = { at: now, reads: merged };
    const people = Object.entries(all);
    if (people.length > PEOPLE_MAX) for (const [k] of people.sort((a, b) => a[1].at - b[1].at).slice(0, people.length - PEOPLE_MAX)) delete all[k];
    this.later();
    return { ...merged };
  }

  private later() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_MS);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.all) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.all));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save the team phone's read state: ${(err as Error).message}`);
    }
  }
}
