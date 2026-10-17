// 🔑 Claude for agents, the card on 🔌 Connections: where the agents' Claude Code gets its credentials (never
// a value: a source line and at most a key's last 4), the alert when Claude refused them, and the choice:
// their Claude login, an API key saved here, a gateway (its base URL with its key) or the office's environment.
// When the environment has a key, a switch says whether it's passed on. Its own fetches (feed.ts), so the
// rest of the page doesn't wait on it.

import type { ClaudeAuthMode, ClaudeAuthView } from '../../../shared/claude-auth';
import { h, timeAgo, toast } from '../dom';
import { claudeAuthApi, onClaudeAuthChanged } from './feed';
import { CLAUDE_HELP } from './go';

const CHOICES: { mode: ClaudeAuthMode; label: string; note: string }[] = [
  { mode: 'login', label: 'Their Claude login (no key passed)', note: 'Each agent’s Claude Code uses the Claude account it’s signed in with. The default.' },
  { mode: 'key', label: 'An Anthropic API key saved here', note: 'Sent to Anthropic’s API as ANTHROPIC_API_KEY, billed to that API account.' },
  { mode: 'gateway', label: 'A gateway', note: 'An LLM gateway your company runs: its base URL (ANTHROPIC_BASE_URL) with its key, always together.' },
  { mode: 'env', label: 'The office’s environment', note: 'Whatever the office was started with (a Windows user variable, a launcher). Only if you’re sure it’s right.' },
];

const input = (attrs: Record<string, string>) => h('input', { spellcheck: 'false', autocomplete: 'off', ...attrs }) as HTMLInputElement;

export function claudeAuthSection(): HTMLElement {
  const el = h('section.cx-card', { id: 'cx-claude' }, h('p.cx-note', {}, 'Loading…'));
  let picked: ClaudeAuthMode | undefined;
  const run = async (what: () => Promise<ClaudeAuthView>, done: string) => {
    try {
      paint(await what());
      toast(`🔑 ${done}`);
    } catch (err) {
      toast((err as Error).message, 'warn');
    }
  };
  const paint = (v: ClaudeAuthView) => {
    const mode = picked ?? v.mode;
    const envHas = v.env.keys.length > 0 || v.env.cloud.length > 0 || v.env.withheld.length > 0;
    const keyIn = input({ type: 'password', placeholder: v.saved.key ? `Replace ${v.saved.key}` : 'sk-ant-api…', 'aria-label': 'Anthropic API key' });
    const baseIn = input({ type: 'text', placeholder: 'https://llm-gateway.example.com', value: v.saved.baseUrl ?? '', 'aria-label': 'Gateway base URL' });
    const gwKeyIn = input({ type: 'password', placeholder: v.saved.gatewayKey ? `Replace ${v.saved.gatewayKey}` : 'The gateway’s key', 'aria-label': 'Gateway key' });
    const radios = CHOICES.filter((c) => c.mode !== 'env' || envHas || v.mode === 'env').map((c) => {
      const r = h('input', { type: 'radio', name: 'cx-claude-mode', value: c.mode }) as HTMLInputElement;
      r.checked = c.mode === mode;
      r.addEventListener('change', () => {
        picked = c.mode;
        paint(v);
      });
      const extra = c.mode !== mode ? null : c.mode === 'key' ? h('div.cx-two', {}, keyIn) : c.mode === 'gateway' ? h('div.cx-two', {}, baseIn, gwKeyIn) : null;
      return h('div', {}, h('label.cx-check', {}, r, c.label), h('p.cx-note', {}, c.note), extra);
    });
    const save = h('button.btn.primary', { type: 'button' }, 'Use this for agents');
    save.addEventListener('click', () => {
      const extra = mode === 'key' ? { key: keyIn.value } : mode === 'gateway' ? { baseUrl: baseIn.value, key: gwKeyIn.value } : {};
      void run(() => claudeAuthApi.set(mode, extra), 'Saved: agents started from now on use it').then(() => (picked = undefined));
    });
    // The switch the incident asked for: the environment's key, passed on or not.
    const envKey = v.env.keys.length > 0 || v.env.withheld.length > 0;
    const sw = envKey ? (h('input', { type: 'checkbox' }) as HTMLInputElement) : null;
    if (sw) {
      sw.checked = v.mode !== 'env';
      sw.addEventListener('change', () => void run(() => claudeAuthApi.set(sw.checked ? 'login' : 'env'), sw.checked ? 'The environment’s key is no longer passed to agents' : 'Agents use the office’s environment'));
    }
    const restart = v.failure ? h('button.btn', { type: 'button', onclick: () => void run(() => claudeAuthApi.restart(), 'Restarted the agents Claude refused') }, '🔁 Restart affected agents') : null;
    el.replaceChildren(
      h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '🔑'), h('h4', {}, 'Claude for agents'), h('span.cx-status', { class: v.failure ? 'invalid' : 'connected' }, v.failure ? '⛔ Refused' : v.chosen ? '✅ Chosen' : '➖ Not chosen yet')),
      h('p.cx-where', {}, `Agents use: ${v.source}`),
      v.warning ? h('p.cx-warn', {}, `⚠️ ${v.warning}`) : '',
      v.failure ? h('p.cx-err', {}, `⛔ ${v.failure.text} (${timeAgo(v.failure.at)})`) : '',
      v.decision ? h('p.cx-warn', {}, `🔑 ${v.decision.text}`) : '',
      sw ? h('label.cx-check', {}, sw, 'Don’t pass the environment’s ANTHROPIC_API_KEY to agents (use their Claude login)') : '',
      h('div.cx-form', {}, ...radios, h('div.cx-actions', {}, save, restart, h('a.cx-link', { href: CLAUDE_HELP, target: '_blank', rel: 'noopener' }, 'How it works and how to fix it'))),
      h('p.cx-note', {}, 'Agents already running keep what they started with until they’re restarted. Keys are kept encrypted like the other credentials and never shown again.'),
    );
  };
  const load = () =>
    void claudeAuthApi.view().then(paint, (err: Error) => el.replaceChildren(h('p.cx-err', {}, `Couldn’t load Claude for agents: ${err.message}`)));
  load();
  const off = onClaudeAuthChanged(() => {
    if (!el.isConnected) return off();
    if (!picked) load();
  });
  return el;
}
