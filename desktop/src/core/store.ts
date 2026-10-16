// The app's own small file (<userData>/desktop.json): the office checkout it last ran, the window's place,
// mute, and the notifications already shown, per office (home and port). Written atomically.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SeenState } from './needs.js';
import type { SavedWindow } from './window.js';

export interface DesktopFile {
  officeDir?: string;
  muted?: boolean;
  window?: SavedWindow;
  seen?: Record<string, SeenState>;
}

/** Which office the seen notifications belong to. */
export const officeKey = (home: string, port: number) => `${path.resolve(home).toLowerCase()}|${port}`;

export class DesktopStore {
  data: DesktopFile;
  constructor(private readonly file: string) {
    this.data = DesktopStore.read(file);
  }

  static read(file: string): DesktopFile {
    try {
      const v = JSON.parse(readFileSync(file, 'utf8'));
      return v && typeof v === 'object' ? (v as DesktopFile) : {};
    } catch {
      return {};
    }
  }

  update(fn: (d: DesktopFile) => void) {
    fn(this.data);
    this.save();
  }

  save() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.file);
    } catch {
      // the next save tries again
    }
  }
}
