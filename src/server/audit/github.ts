// What changed on a floor's GitHub boards since the last look, as audit events: pull requests opened,
// merged and closed, issues opened, closed and relabelled. The first look on each floor is the
// baseline, so a restart doesn't log the whole board again. What a person just did from the office
// (merging from the PR window) is already logged with their name, and isn't repeated here.

import type { GhIssue, GhPull } from '../../shared/protocol.js';
import type { AuditActor, AuditInput } from '../../shared/audit.js';

/** A person's action from the office stands for the board's version of it this long. */
export const SAME_AS_HUMAN_MS = 10 * 60_000;

interface Seen {
  at: number;
  state: Map<number, string>;
  labels: Map<number, string>;
}

const labelsOf = (it: { labels: { name: string }[] }) =>
  it.labels
    .map((l) => l.name)
    .sort()
    .join(',');
const ts = (s: string) => Date.parse(s) || 0;

export class GitHubWatch {
  private pulls = new Map<string, Seen>();
  private issues = new Map<string, Seen>();

  /** Events for a floor's pull requests as they are now; `branchOwner` names the agent working on a branch. */
  onPulls(floor: string, items: readonly GhPull[], now: number, branchOwner: (branch: string) => AuditActor | undefined): AuditInput[] {
    const seen = this.pulls.get(floor);
    this.pulls.set(floor, { at: seen?.at ?? now, state: new Map(items.map((p) => [p.number, p.state])), labels: new Map() });
    if (!seen) return [];
    const out: AuditInput[] = [];
    for (const p of items) {
      const was = seen.state.get(p.number);
      if (was === p.state) continue;
      const target = { kind: 'pr', id: `#${p.number}`, label: `PR #${p.number} ${p.title}`.slice(0, 120) };
      const actor = branchOwner(p.headRefName) ?? { kind: 'office' as const, name: 'GitHub' };
      const details = { author: p.author, branch: p.headRefName, base: p.baseRefName };
      if (p.state === 'OPEN' && was === undefined) out.push({ floor, actor, action: 'pr.open', target, summary: `PR #${p.number} was opened: ${p.title}`, details: { ...details, additions: p.additions, deletions: p.deletions } });
      // Only what happened since the baseline: an old one coming into the list isn't news.
      else if (p.state === 'MERGED' && (was !== undefined || ts(p.updatedAt) >= seen.at)) out.push({ floor, actor: { kind: 'office', name: 'GitHub' }, action: 'pr.merge', target, summary: `PR #${p.number} was merged: ${p.title}`, details, severity: 'notice' });
      else if (p.state === 'CLOSED' && (was !== undefined || ts(p.updatedAt) >= seen.at)) out.push({ floor, actor: { kind: 'office', name: 'GitHub' }, action: 'pr.close', target, summary: `PR #${p.number} was closed without merging: ${p.title}`, details });
    }
    return out;
  }

  /** Events for a floor's issues as they are now. */
  onIssues(floor: string, items: readonly GhIssue[], now: number): AuditInput[] {
    const seen = this.issues.get(floor);
    this.issues.set(floor, { at: seen?.at ?? now, state: new Map(items.map((i) => [i.number, i.state])), labels: new Map(items.map((i) => [i.number, labelsOf(i)])) });
    if (!seen) return [];
    const out: AuditInput[] = [];
    const actor: AuditActor = { kind: 'office', name: 'GitHub' };
    for (const i of items) {
      const was = seen.state.get(i.number);
      const target = { kind: 'issue', id: `#${i.number}`, label: `#${i.number} ${i.title}`.slice(0, 120) };
      if (was === undefined) {
        if (i.state === 'OPEN') out.push({ floor, actor, action: 'issue.open', target, summary: `Issue #${i.number} was opened by ${i.author || 'someone'}: ${i.title}`, details: { author: i.author, labels: labelsOf(i) || undefined } });
        continue;
      }
      if (was !== i.state) out.push({ floor, actor, action: i.state === 'OPEN' ? 'issue.reopen' : 'issue.close', target, summary: `Issue #${i.number} was ${i.state === 'OPEN' ? 'reopened' : 'closed'}: ${i.title}`, details: { author: i.author } });
      const before = seen.labels.get(i.number) ?? '';
      const after = labelsOf(i);
      if (before !== after) out.push({ floor, actor, action: 'issue.label', target, summary: `Issue #${i.number}'s labels changed to ${after || 'none'}`, details: { before: before || 'none', after: after || 'none' } });
    }
    return out;
  }
}
