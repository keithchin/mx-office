// The Teams notifications' settings, in .agent-office/notify-teams.json (mode 0600): which floors post,
// the level, quiet hours, a pause, the office's public address, and (until Connections keeps it) the
// webhook URL. Changed by admins from ⚙️ Settings → Notifications (http/routes/notify-teams.ts).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../flow/store.js';
import { isHhmm, type QuietHours, type TeamsLevel, type TeamsSettingsPatch } from '../../shared/notify-teams.js';
import { checkWebhookUrl, secretSlot, webhookHint, type SecretSlot } from './secret.js';

export interface TeamsSaved {
  /** Only while the settings file is where the secret lives (see secret.ts). */
  url?: string;
  floors: 'all' | string[];
  level: TeamsLevel;
  quiet?: QuietHours;
  pausedUntil?: number;
  publicUrl?: string;
  by?: string;
  at?: number;
}

const DEFAULTS: TeamsSaved = { floors: 'all', level: 'needs' };

/** The longest pause: a week. */
const MAX_PAUSE_MIN = 7 * 24 * 60;

function cleanFloors(v: unknown): 'all' | string[] | undefined {
  if (v === 'all') return 'all';
  if (!Array.isArray(v)) return undefined;
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 100);
}

export function cleanQuiet(v: unknown): QuietHours | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const q = v as Record<string, unknown>;
  return isHhmm(q.start) && isHhmm(q.end) && q.start !== q.end ? { start: q.start, end: q.end } : undefined;
}

export class TeamsSettings {
  private saved: TeamsSaved = { ...DEFAULTS };
  private readonly slot: SecretSlot;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.restore();
    // The settings file's own slot, unless Connections handed over a credential store.
    this.slot = secretSlot({
      where: 'settings-file',
      get: () => this.saved.url,
      set: (v) => {
        this.saved.url = v;
      },
    });
  }

  static in(dataDir: string, now?: () => number) {
    return new TeamsSettings(path.join(dataDir, 'notify-teams.json'), now);
  }

  get(): Readonly<Omit<TeamsSaved, 'url'>> {
    const { url: _secret, ...rest } = this.saved;
    return rest;
  }

  /** The webhook URL: for posting only, never for a browser or a log. */
  url(): string | undefined {
    return this.slot.get() || undefined;
  }

  hint(): string | undefined {
    const u = this.url();
    return u ? webhookHint(u) : undefined;
  }

  where(): SecretSlot['where'] {
    return this.slot.where;
  }

  /** Whether `floor` posts. */
  posts(floor: string): boolean {
    const f = this.saved.floors;
    return f === 'all' || f.includes(floor);
  }

  paused(now = this.now()): boolean {
    return this.saved.pausedUntil !== undefined && now < this.saved.pausedUntil;
  }

  /** Applies what an admin changed; returns why it can't, if it can't (and then nothing changed). */
  patch(p: TeamsSettingsPatch, by: string): string | undefined {
    const next: TeamsSaved = { ...this.saved };
    let url: string | undefined | null = null;
    if (p.url !== undefined) {
      const raw = String(p.url).trim();
      if (raw) {
        const bad = checkWebhookUrl(raw);
        if (bad) return bad;
        url = new URL(raw).toString();
      } else url = undefined;
    }
    if (p.floors !== undefined) {
      const f = cleanFloors(p.floors);
      if (!f) return 'Pick all floors or a list of them';
      next.floors = f;
    }
    if (p.level !== undefined) {
      if (p.level !== 'needs' && p.level !== 'digest') return 'The level is "needs" or "digest"';
      next.level = p.level;
    }
    if (p.quiet !== undefined) {
      if (p.quiet === null) delete next.quiet;
      else {
        const q = cleanQuiet(p.quiet);
        if (!q) return 'Quiet hours are two different times, HH:MM';
        next.quiet = q;
      }
    }
    if (p.pauseMinutes !== undefined) {
      const m = Number(p.pauseMinutes);
      if (!Number.isFinite(m) || m < 0 || m > MAX_PAUSE_MIN) return 'Pause for 0 minutes to a week';
      if (m === 0) delete next.pausedUntil;
      else next.pausedUntil = this.now() + Math.round(m) * 60_000;
    }
    if (p.publicUrl !== undefined) {
      const raw = String(p.publicUrl).trim();
      if (raw) {
        try {
          const u = new URL(raw);
          if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'The office address is an http(s) link';
          next.publicUrl = u.toString().replace(/\/+$/, '');
        } catch {
          return 'The office address is a link, like https://office.example.com';
        }
      } else delete next.publicUrl;
    }
    next.by = by;
    next.at = this.now();
    this.saved = next;
    if (url !== null) this.slot.set(url);
    this.persist();
    return undefined;
  }

  private persist() {
    try {
      writeJsonAtomic(this.file, this.saved);
    } catch (err) {
      console.error(`agent-office: notify-teams: couldn't save its settings: ${(err as Error).message}`);
    }
  }

  private restore() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<TeamsSaved>;
      this.saved = {
        ...DEFAULTS,
        ...(typeof s.url === 'string' && !checkWebhookUrl(s.url) ? { url: s.url } : {}),
        floors: cleanFloors(s.floors) ?? 'all',
        level: s.level === 'digest' ? 'digest' : 'needs',
        ...(cleanQuiet(s.quiet) ? { quiet: cleanQuiet(s.quiet) } : {}),
        ...(typeof s.pausedUntil === 'number' ? { pausedUntil: s.pausedUntil } : {}),
        ...(typeof s.publicUrl === 'string' && s.publicUrl ? { publicUrl: s.publicUrl } : {}),
        ...(typeof s.by === 'string' ? { by: s.by } : {}),
        ...(typeof s.at === 'number' ? { at: s.at } : {}),
      };
    } catch {
      // a broken file is the defaults
    }
  }
}
