// Jev's API key: the first line of the file AGENT_OFFICE_JEV_KEY_FILE names (the launcher points it at
// ~/.agent-office-jev-key, so the key itself is never in the office's environment), else
// TYPESAFE_API_KEY. The file is looked at again at most every 30 seconds, so a key added (or removed)
// while the office runs is picked up without a restart. Neither is ever passed to a worker
// (workers/env.ts scrubs both), logged or sent anywhere but TypeSafe.

import { readFileSync, statSync } from 'node:fs';

const RECHECK_MS = 30_000;

export class JevKey {
  private cached?: string;
  private mtime = -1;
  private checkedAt = -Infinity;

  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private now: () => number = Date.now,
  ) {}

  /** The key, or undefined when there's none. */
  get(): string | undefined {
    const file = this.env.AGENT_OFFICE_JEV_KEY_FILE;
    if (file) {
      if (this.now() - this.checkedAt >= RECHECK_MS) {
        this.checkedAt = this.now();
        try {
          const m = statSync(file).mtimeMs;
          if (m !== this.mtime) {
            this.mtime = m;
            this.cached = readFileSync(file, 'utf8').split(/\r?\n/)[0]?.trim() || undefined;
          }
        } catch {
          this.mtime = -1;
          this.cached = undefined;
        }
      }
      if (this.cached) return this.cached;
    }
    return this.env.TYPESAFE_API_KEY?.trim() || undefined;
  }
}
