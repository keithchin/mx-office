// 🔑 Claude for agents in Needs you (server/claude-auth/): the office-wide alert when Claude rejects the
// agents' credentials (red: nothing works until it's fixed) and the one-time decision about a key the
// office's environment had that nobody confirmed. Office-wide, so the same on every project. Pure.

import type { ClaudeAuthView } from '../claude-auth.js';
import type { NeedItem } from '../needsyou.js';

export const CLAUDE_FAILED_KEY = 'claude-auth-failed';

export function claudeAuthNeeds(v: ClaudeAuthView | undefined): NeedItem[] {
  if (!v) return [];
  const out: NeedItem[] = [];
  const f = v.failure;
  if (f) {
    const who = f.workers.length ? ` (${f.workers.map((w) => w.name).slice(0, 4).join(', ')}${f.workers.length > 4 ? '…' : ''})` : '';
    const help = { action: 'How to fix', target: { to: 'claude-auth', act: 'help' } } as const;
    // Already switched since it failed: what's left is starting the agents again.
    const switched = v.mode === 'login' && v.chosen;
    out.push({
      key: CLAUDE_FAILED_KEY,
      kind: 'claude',
      icon: '🔑',
      text: `${f.text}${who}`,
      since: f.at,
      level: 'block',
      ...(v.admin ? (switched ? { action: 'Restart all agents', target: { to: 'claude-auth', act: 'restart' }, alt: help } : { action: 'Use the agents’ Claude login instead', target: { to: 'claude-auth', act: 'login' }, alt: help }) : help),
    });
  }
  if (v.decision && !f) {
    out.push({
      key: 'claude-auth-decision',
      kind: 'claude',
      icon: '🔑',
      text: v.decision.text,
      level: 'warn',
      ...(v.admin ? { action: 'Keep using it', target: { to: 'claude-auth', act: 'keep' }, alt: { action: 'Use the agents’ Claude login instead', target: { to: 'claude-auth', act: 'login' } } } : { action: 'How to fix', target: { to: 'claude-auth', act: 'help' } }),
    });
  }
  return out;
}
