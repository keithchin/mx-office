// <data>/profile-notes.json: the Project Manager's own notes about each agent profile, { version: 1, notes }.
// Owner-facing only (S02): a separate file that only the profiles route reads. No prompt builder imports
// this module, and tests/profiles.test.ts checks that a planted note never reaches a hire's first message.
// Read once (asynchronously), written with the acknowledged critical write, changes serialised.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonCritical } from '../flow/critical-write.js';
import { isProfileId } from '../../shared/profiles.js';

export interface ProfileNote {
  text: string;
  at: number;
  by: string;
}

export const NOTE_MAX = 2000;

export class ProfileNotes {
  readonly file: string;
  private loaded?: Promise<Record<string, ProfileNote>>;
  private notes: Record<string, ProfileNote> = {};
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'profile-notes.json');
  }

  load(): Promise<Record<string, ProfileNote>> {
    this.loaded ??= readFile(this.file, 'utf8').then(
      (t) => {
        const raw = (JSON.parse(t) as { notes?: Record<string, ProfileNote> })?.notes ?? {};
        for (const [k, v] of Object.entries(raw)) if (isProfileId(k) && v && typeof v.text === 'string') this.notes[k] = { text: v.text.slice(0, NOTE_MAX), at: Number(v.at) || 0, by: String(v.by ?? '').slice(0, 80) };
        return this.notes;
      },
      () => this.notes,
    );
    return this.loaded;
  }

  /** Sets (or, with empty text, removes) a profile's note. */
  set(id: string, text: string, by: string, at: number): Promise<void> {
    const run = this.chain.then(async () => {
      await this.load();
      const t = text.replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
      if (t) this.notes[id] = { text: t, at, by: by.slice(0, 80) };
      else delete this.notes[id];
      await writeJsonCritical(this.file, { version: 1, notes: this.notes });
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
