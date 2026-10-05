// The audit log in the real office: kept in the office's data dir (audit/), every new event sent to
// the browsers ({t:'audit.new'}) for the Audit log tabs that are open, and the floors' GitHub boards
// watched for pull requests and issues changing (github.ts).

import path from 'node:path';
import { OFFICE_FLOOR } from '../../shared/audit.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { agent, audit, useAudit } from './index.js';
import { AuditLog } from './log.js';
import { GitHubWatch, SAME_AS_HUMAN_MS } from './github.js';

const watch = new GitHubWatch();

export function installAudit(ctx: Ctx) {
  useAudit(new AuditLog(path.join(ctx.cfg.dataDir, 'audit')), (event) => ctx.broadcast({ t: 'audit.new', floor: event.floor ?? OFFICE_FLOOR, event }, undefined, true));
}

/** A floor's boards came back from GitHub: what changed since the last look goes in the log. */
export function auditGitHub(floor: Floor, which: 'pulls' | 'issues') {
  const now = Date.now();
  const events =
    which === 'pulls'
      ? watch.onPulls(floor.id, floor.github.pulls.items, now, (branch) => {
          const w = floor.workers.list().find((x) => x.worktree?.branch === branch);
          return w ? agent(w.name, w.id) : undefined;
        })
      : watch.onIssues(floor.id, floor.github.issues.items, now);
  for (const e of events) if (!audit.recently(e.floor, e.action, e.target?.id, SAME_AS_HUMAN_MS)) audit.record(e);
}
