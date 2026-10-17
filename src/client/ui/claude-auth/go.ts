// What 🔑 Claude for agents' Needs-you buttons do (shared/decisions/claude-auth.ts), from any page: keep the
// environment's key, switch to the agents' Claude login (then offer to restart the agents Claude refused, so
// they start with it), restart them, or open the docs on how to fix it.

import type { NeedTarget } from '../../../shared/needsyou';
import { toast } from '../dom';
import { confirmDialog } from '../prompt';
import { claudeAuthApi } from './feed';

export const CLAUDE_HELP = '/docs/troubleshooting/agents-and-github#agents-fail-with-invalid-api-key';

function offerRestart(n: number) {
  if (!n) return;
  confirmDialog('Restart the agents Claude refused?', `${n} agent${n === 1 ? '' : 's'} failed to sign in to Claude. Restart ${n === 1 ? 'it' : 'them'} now, so ${n === 1 ? 'it starts' : 'they start'} with the agents’ Claude credentials as they are now and carr${n === 1 ? 'ies' : 'y'} on with the task?`, '🔁 Restart them', () => void restart());
}

async function restart() {
  try {
    const v = await claudeAuthApi.restart();
    toast(`🔁 Restarted ${v.restarted ?? 0} agent${v.restarted === 1 ? '' : 's'}`);
  } catch (err) {
    toast((err as Error).message, 'warn');
  }
}

export async function goClaudeAuth(t: Extract<NeedTarget, { to: 'claude-auth' }>): Promise<void> {
  if (t.act === 'help') return void window.open(CLAUDE_HELP, '_blank', 'noopener');
  if (t.act === 'restart') return restart();
  try {
    const v = await claudeAuthApi.set(t.act === 'keep' ? 'env' : 'login');
    toast(t.act === 'keep' ? '🔑 Agents keep using the key from the office’s environment' : '🔑 Agents use their Claude login (no key passed) from now on');
    if (t.act === 'login') offerRestart(v.failure?.workers.length ?? 0);
  } catch (err) {
    toast((err as Error).message, 'warn');
  }
}
