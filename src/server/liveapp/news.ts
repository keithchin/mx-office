// "Live app ready: <milestone>", once per milestone: which milestones the office already told people
// were ready in the running app, kept in <data>/live/<floor>.ready.json so a restart of the office
// doesn't tell them again, and the news of the last day, which Needs you shows as FYI rows and the
// notification channels (Teams, phone push, desktop alerts) send once each by key. A milestone told
// ready that the running app no longer has (a rollback) is news too, and may be told ready again later.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readinessNews, type LiveReadiness, type ReadinessNews } from '../../shared/liveapp/readiness.js';
import { writeJsonAtomic } from '../flow/store.js';

/** News shows in Needs you for a day. */
export const NEWS_MS = 24 * 3_600_000;
const MAX_NEWS = 20;

interface Kept {
  notified: Record<string, { at: number; sha: string }>;
  news: ReadinessNews[];
}

export class ReadyNews {
  private kept: Kept;
  private readonly file: string;

  constructor(liveDir: string, floorId: string) {
    this.file = path.join(liveDir, `${floorId}.ready.json`);
    this.kept = { notified: {}, news: [] };
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Kept>;
      this.kept = { notified: j.notified && typeof j.notified === 'object' ? j.notified : {}, news: Array.isArray(j.news) ? j.news : [] };
    } catch {
      // Nothing told yet.
    }
  }

  /** Takes a new reading of the running app: what's news now (to toast), and the day's news on the reading. */
  take(r: LiveReadiness, running: boolean, now = Date.now()): ReadinessNews[] {
    let fresh: ReadinessNews[] = [];
    if (running && r.sha) {
      const n = readinessNews(r, this.kept.notified, now);
      fresh = n.news;
      if (fresh.length) {
        this.kept = { notified: n.notified, news: [...this.kept.news, ...fresh].slice(-MAX_NEWS) };
        try {
          writeJsonAtomic(this.file, this.kept);
        } catch {
          // Told again after a restart, at worst.
        }
      }
    }
    r.news = this.kept.news.filter((x) => now - x.at < NEWS_MS);
    return fresh;
  }
}
