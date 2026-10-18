// The working copies of a project's walkthroughs, in the office's data folder: <data>/walkthroughs/<floor>/
// with settings.json (the per-project switch and demo user) and one folder per recording (manifest.json,
// the video, captions.vtt, chapters.vtt, steps/NN.png). Their home is the project's private repo (Save to
// repo, ./save.ts); these are the cache before that and while recording. Cleanup keeps the newest few
// auto-recordings per workflow and drops old ones; a person's own recordings go only when they delete them.
// Over the office's quota, the oldest auto-recordings go first.

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SETTINGS, isRecId, type WalkManifest, type WalkSettings } from '../../shared/walkthroughs/types.js';

/** Auto-recordings kept per workflow, and for how long. */
export const KEEP_AUTO = 3;
export const AUTO_MAX_AGE_MS = 14 * 24 * 3_600_000;
export const DEFAULT_QUOTA = 2 * 1024 ** 3;

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_-]/g, '_');

export class WalkStore {
  constructor(
    readonly root: string,
    readonly quota = DEFAULT_QUOTA,
  ) {}

  floorDir(floor: string) {
    return path.join(this.root, safe(floor));
  }

  recDir(floor: string, id: string) {
    if (!isRecId(id)) throw new Error('not a recording id');
    return path.join(this.floorDir(floor), id);
  }

  async settings(floor: string): Promise<WalkSettings> {
    try {
      const j = JSON.parse(await readFile(path.join(this.floorDir(floor), 'settings.json'), 'utf8')) as Partial<WalkSettings>;
      return {
        autoRecord: typeof j.autoRecord === 'boolean' ? j.autoRecord : DEFAULT_SETTINGS.autoRecord,
        narrate: typeof j.narrate === 'boolean' ? j.narrate : DEFAULT_SETTINGS.narrate,
        demoUser: typeof j.demoUser === 'string' && j.demoUser.trim() ? j.demoUser.trim().slice(0, 80) : DEFAULT_SETTINGS.demoUser,
        demoPassword: typeof j.demoPassword === 'string' ? j.demoPassword.slice(0, 200) : DEFAULT_SETTINGS.demoPassword,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async setSettings(floor: string, s: WalkSettings) {
    await mkdir(this.floorDir(floor), { recursive: true });
    await writeFile(path.join(this.floorDir(floor), 'settings.json'), JSON.stringify(s, null, 2));
  }

  async write(m: WalkManifest) {
    const dir = this.recDir(m.floor, m.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  }

  async read(floor: string, id: string): Promise<WalkManifest | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.recDir(floor, id), 'manifest.json'), 'utf8')) as WalkManifest;
    } catch {
      return undefined;
    }
  }

  /** Every recording of the floor, newest first. */
  async list(floor: string): Promise<WalkManifest[]> {
    const ids = (await readdir(this.floorDir(floor)).catch(() => [] as string[])).filter(isRecId);
    const all = await Promise.all(ids.map((id) => this.read(floor, id)));
    return all.filter((m): m is WalkManifest => !!m).sort((a, b) => b.startedAt - a.startedAt);
  }

  /** A file of a recording, only from inside its folder (the manifest's own names). */
  file(floor: string, id: string, name: string): string | undefined {
    if (!/^(walkthrough\.(mp4|webm)|tour\.mp4|captions\.vtt|chapters\.vtt|manifest\.json|steps\/\d{2}\.png|cards\/[a-z0-9-]+\.png)$/.test(name)) return undefined;
    return path.join(this.recDir(floor, id), ...name.split('/'));
  }

  async remove(floor: string, id: string) {
    await rm(this.recDir(floor, id), { recursive: true, force: true });
  }

  async bytes(dir: string): Promise<number> {
    let n = 0;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      n += e.isDirectory() ? await this.bytes(p) : ((await stat(p).catch(() => undefined))?.size ?? 0);
    }
    return n;
  }

  /** What every floor's working copies take. */
  async used(): Promise<number> {
    return this.bytes(this.root);
  }

  /**
   * Drops old auto-recordings: past the newest KEEP_AUTO per workflow, older than AUTO_MAX_AGE_MS, and then the
   * oldest ones while the office is over its quota. A person's own recordings and one being made stay.
   */
  async cleanup(now = Date.now()): Promise<string[]> {
    const gone: string[] = [];
    const floors = await readdir(this.root).catch(() => [] as string[]);
    const autos: WalkManifest[] = [];
    for (const f of floors) {
      const list = await this.list(f);
      const seen = new Map<string, number>();
      for (const m of list) {
        if (m.trigger !== 'auto' || m.status === 'recording' || m.status === 'queued') continue;
        const k = `${m.kind}|${m.journey.id}`;
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        if (n > KEEP_AUTO || now - m.startedAt > AUTO_MAX_AGE_MS) {
          await this.remove(m.floor, m.id);
          gone.push(m.id);
        } else autos.push(m);
      }
    }
    let used = await this.used();
    for (const m of autos.sort((a, b) => a.startedAt - b.startedAt)) {
      if (used <= this.quota) break;
      const dir = this.recDir(m.floor, m.id);
      const size = await this.bytes(dir);
      await this.remove(m.floor, m.id);
      gone.push(m.id);
      used -= size;
    }
    return gone;
  }
}
