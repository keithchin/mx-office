// What 🔑 Claude for agents' Needs-you buttons do (shared/decisions/claude-auth.ts), from any page: keep the
// environment's key, switch to the agents' Claude login (then offer to restart every agent, so none keeps what
// it started with), restart them (after a confirm), or open the docs on how to fix it.

import type { NeedTarget } from '../../../shared/needsyou';
import { toast } from '../dom';
import { confirmDialog } from '../prompt';
import { claudeAuthApi } from './feed';

export const CLAUDE_HELP = '/docs/troubleshooting/agents-and-github#agents-fail-with-invalid-api-key';

/** After a change to the agents' Claude credentials: restart every agent on them, once the admin confirms. */
export function confirmRestart(after?: () => void) {
  confirmDialog(
    'Restart all agents?',
    'Every agent running on the office’s Claude credentials (and any Claude refused) is stopped and started again with them as they are now, and carries on with its task. An agent in the middle of a turn is interrupted.',
    '🔁 Restart all agents',
    () => void restart().then(after),
  );
}

async function restart() {
  try {
    const v = await claudeAuthApi.restart();
    const n = v.restarted ?? 0;
    toast(`🔁 Restarted ${n} agent${n === 1 ? '' : 's'}${v.names?.length ? `: ${v.names.join(', ')}` : ''}`);
  } catch (err) {
    toast((err as Error).message, 'warn');
  }
}

export async function goClaudeAuth(t: Extract<NeedTarget, { to: 'claude-auth' }>): Promise<void> {
  if (t.act === 'help') return void window.open(CLAUDE_HELP, '_blank', 'noopener');
  if (t.act === 'restart') return confirmRestart();
  try {
    await claudeAuthApi.set(t.act === 'keep' ? 'env' : 'login');
    toast(t.act === 'keep' ? '🔑 Agents keep using the key from the office’s environment' : '🔑 Agents use their Claude login (no key passed) from now on');
    confirmRestart();
  } catch (err) {
    toast((err as Error).message, 'warn');
  }
}
