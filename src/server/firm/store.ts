// The Firm's files, in the office's data dir: firm/firm.json (each reviewer's model, the default
// engagement settings), firm/engagements/<id>/engagement.json (one audit, its reviewers' folders
// beside it) and firm/reports/<id>.json and .md (the delivered reports).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Engagement } from '../../shared/firm/engagement.js';
import { reportMarkdown } from '../../shared/firm/report-md.js';
import type { Report } from '../../shared/firm/report.js';
import { firmModelId, REVIEWERS, type ReviewerId } from '../../shared/firm/roles.js';

export interface FirmSettings {
  /** The model each reviewer runs on unless an engagement says otherwise. */
  models: Record<ReviewerId, string>;
  /** The defaults the Call-an-audit wizard opens with. */
  budget: number;
  maxMinutes: number;
}

export const defaultSettings = (): FirmSettings => ({ models: Object.fromEntries(REVIEWERS.map((r) => [r.id, firmModelId(undefined)])) as Record<ReviewerId, string>, budget: 60, maxMinutes: 120 });

/** Writes through a temporary file, so a crash mid-write never leaves half a JSON file. */
function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export class FirmStore {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'firm');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  engagementDir(id: string): string {
    return path.join(this.root, 'engagements', id);
  }

  settings(): FirmSettings {
    const saved = readJson<Partial<FirmSettings>>(path.join(this.root, 'firm.json'));
    const d = defaultSettings();
    if (!saved) return d;
    for (const r of REVIEWERS) d.models[r.id] = firmModelId(saved.models?.[r.id] ?? d.models[r.id]);
    if (typeof saved.budget === 'number' && saved.budget > 0) d.budget = saved.budget;
    if (typeof saved.maxMinutes === 'number' && saved.maxMinutes > 0) d.maxMinutes = saved.maxMinutes;
    return d;
  }

  saveSettings(s: FirmSettings) {
    writeJson(path.join(this.root, 'firm.json'), s);
  }

  /** Every engagement on disk, newest first. */
  engagements(): Engagement[] {
    const dir = path.join(this.root, 'engagements');
    if (!existsSync(dir)) return [];
    const out: Engagement[] = [];
    for (const id of readdirSync(dir)) {
      const e = readJson<Engagement>(path.join(dir, id, 'engagement.json'));
      if (e && e.id === id) out.push(e);
    }
    return out.sort((a, b) => b.requestedAt - a.requestedAt);
  }

  saveEngagement(e: Engagement) {
    writeJson(path.join(this.engagementDir(e.id), 'engagement.json'), e);
  }

  report(id: string): Report | undefined {
    if (!/^[\w-]{1,64}$/.test(id)) return undefined;
    return readJson<Report>(path.join(this.root, 'reports', `${id}.json`));
  }

  saveReport(r: Report) {
    writeJson(path.join(this.root, 'reports', `${r.id}.json`), r);
    writeFileSync(path.join(this.root, 'reports', `${r.id}.md`), reportMarkdown(r), { mode: 0o600 });
  }
}
