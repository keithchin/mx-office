// The incidents on disk, in the office's data dir: incidents/incidents.jsonl, append only, a line per
// change carrying the whole incident as it became, so the file is its own history and the newest line
// per id is the incident now. Every line is hash-chained like the audit log's (prev: the sha256 of the
// line before it; hash: its own without that field), so an edited or dropped line shows. The rules'
// settings are incidents/settings.json.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeSettings, type Incident, type IncidentSettings } from '../../shared/incidents.js';
import { sha256 } from '../audit/log.js';

export interface IncidentLine {
  at: number;
  op: 'create' | 'update' | 'resolve' | 'seed';
  by: string;
  incident: Incident;
  prev: string;
  hash: string;
}

export class IncidentStore {
  readonly file: string;
  private byId = new Map<string, Incident>();
  private lines: string[] = [];
  private size = -1;
  private top = 0;

  constructor(
    readonly dir: string,
    private now: () => number = Date.now,
  ) {
    this.file = path.join(dir, 'incidents.jsonl');
  }

  /** Whether there's a file yet (the seed goes in only when there isn't). */
  exists(): boolean {
    return existsSync(this.file);
  }

  private load() {
    const size = this.exists() ? statSync(this.file).size : 0;
    if (size === this.size) return;
    this.size = size;
    this.byId.clear();
    this.lines = [];
    this.top = 0;
    if (!size) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as IncidentLine;
        if (!l.incident?.id) continue;
        this.byId.set(l.incident.id, l.incident);
        this.top = Math.max(this.top, l.incident.number || 0);
        this.lines.push(line);
      } catch {
        // A torn line: verify says so; reading skips it.
      }
    }
  }

  list(): Incident[] {
    this.load();
    return [...this.byId.values()];
  }

  get(id: string): Incident | undefined {
    this.load();
    return this.byId.get(id);
  }

  /** The next INC- number. */
  nextNumber(): number {
    this.load();
    return this.top + 1;
  }

  /** Writes `incident` as it is now, chained to the line before. */
  put(incident: Incident, op: IncidentLine['op'], by: string): Incident {
    this.load();
    const prev = this.lines.length ? sha256(this.lines[this.lines.length - 1]) : '';
    const body = { at: this.now(), op, by, incident, prev };
    const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    appendFileSync(this.file, `${line}\n`, { mode: 0o600 });
    this.lines.push(line);
    this.byId.set(incident.id, incident);
    this.top = Math.max(this.top, incident.number);
    this.size = statSync(this.file).size;
    return incident;
  }

  /** Whether every line fits its own hash and points at the one before it. */
  verify(): { ok: boolean; brokenAt?: number } {
    if (!this.exists()) return { ok: true };
    let prev = '';
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: typeof l.at === 'number' ? l.at : undefined };
      prev = sha256(line);
    }
    return { ok: true };
  }

  settings(): IncidentSettings {
    try {
      return normalizeSettings(JSON.parse(readFileSync(path.join(this.dir, 'settings.json'), 'utf8')));
    } catch {
      return normalizeSettings(undefined);
    }
  }

  setSettings(s: unknown): IncidentSettings {
    const clean = normalizeSettings(s);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(this.dir, 'settings.json'), JSON.stringify(clean, null, 2), { mode: 0o600 });
    return clean;
  }
}
