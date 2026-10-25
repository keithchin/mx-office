// 🔑 Claude for agents, the card on 🔌 Connections: where the agents' Claude Code gets its credentials (never
// any part of a key: a source line with variable names), the alert when Claude refused them, and the choice:
// their Claude login, an API key saved here, a gateway (its base URL with its key) or the office's environment.
// While the office's environment is the source, a switch stops passing its key on (it isn't shown for any other
// source: there it would only switch to the environment by mistake). 🔁 Restart all agents (after a confirm,
// and never while a choice is unsaved or saving) restarts every agent on the office's credentials, and the
// card offers it after each change; 🧪 Test the gateway makes one request through the saved gateway, only when
// pressed. Its own fetches (feed.ts), so the rest of the page doesn't wait on it.

import type { ClaudeAuthMode, ClaudeAuthView } from '../../../shared/claude-auth';
import { h, timeAgo, toast } from '../dom';
import { claudeAuthApi, onClaudeAuthChanged } from './feed';
import { CLAUDE_HELP, confirmRestart } from './go';

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
  let busy = false;
  let check: { ok: boolean; text: string } | undefined;
  let last: ClaudeAuthView | undefined;
  /** Runs a change; true when it went through. */
  const run = async (what: () => Promise<ClaudeAuthView>, done: string): Promise<boolean> => {
    busy = true;
    if (last) paint(last);
    try {
      const v = await what();
      busy = false;
      paint(v);
      toast(`🔑 ${done}`);
      return true;
    } catch (err) {
      busy = false;
      if (last) paint(last);
      toast((err as Error).message, 'warn');
      return false;
    }
  };
  const paint = (v: ClaudeAuthView) => {
    last = v;
    const mode = picked ?? v.mode;
    const unsaved = picked !== undefined && picked !== v.mode;
    const envHas = v.env.keys.length > 0 || v.env.cloud.length > 0 || v.env.withheld.length > 0;
    const keyIn = input({ type: 'password', placeholder: v.saved.key ? 'Replace the saved key' : 'Paste an Anthropic API key', 'aria-label': 'Anthropic API key' });
    const baseIn = input({ type: 'text', placeholder: 'https://llm-gateway.example.com', value: v.saved.baseUrl ?? '', 'aria-label': 'Gateway base URL' });
    const gwKeyIn = input({ type: 'password', placeholder: v.saved.gatewayKey ? 'Replace the gateway’s saved key' : 'The gateway’s key', 'aria-label': 'Gateway key' });
    const radios = CHOICES.filter((c) => c.mode !== 'env' || envHas || v.mode === 'env').map((c) => {
      const r = h('input', { type: 'radio', name: 'cx-claude-mode', value: c.mode }) as HTMLInputElement;
      r.checked = c.mode === mode;
      r.disabled = busy;
      r.addEventListener('change', () => {
        picked = c.mode;
        check = undefined;
        paint(v);
      });
      const extra = c.mode !== mode ? null : c.mode === 'key' ? h('div.cx-two', {}, keyIn) : c.mode === 'gateway' ? h('div.cx-two', {}, baseIn, gwKeyIn) : null;
      return h('div', {}, h('label.cx-check', {}, r, c.label), h('p.cx-note', {}, c.note), extra);
    });
    const save = h('button.btn.primary', { type: 'button' }, busy ? 'Saving…' : 'Use this for agents') as HTMLButtonElement;
    save.disabled = busy;
    save.addEventListener('click', () => {
      const extra = mode === 'key' ? { key: keyIn.value } : mode === 'gateway' ? { baseUrl: baseIn.value, key: gwKeyIn.value } : {};
      void run(() => claudeAuthApi.set(mode, extra), 'Saved: agents started from now on use it').then((ok) => {
        if (!ok) return;
        picked = undefined;
        check = undefined;
        // Agents already running keep what they started with: offer to restart them all now.
        confirmRestart();
      });
    });
    // While the environment is the source (and nothing else is picked): stop passing its key on.
    const envKey = v.env.keys.length > 0 || v.env.withheld.length > 0;
    const sw = envKey && v.mode === 'env' && !unsaved ? (h('input', { type: 'checkbox' }) as HTMLInputElement) : null;
    if (sw) {
      sw.checked = false;
      sw.disabled = busy;
      sw.addEventListener('change', () => void run(() => claudeAuthApi.set('login'), 'The environment’s key is no longer passed to agents').then((ok) => ok && confirmRestart()));
    }
    const restart = v.admin ? (h('button.btn', { type: 'button', title: unsaved ? 'Save your choice first (Use this for agents)' : 'Stops and starts every agent on the office’s Claude credentials, so they use them as they are now' }, v.failure ? '🔁 Restart all agents (Claude refused some)' : '🔁 Restart all agents') as HTMLButtonElement) : null;
    if (restart) {
      restart.disabled = busy || unsaved;
      restart.addEventListener('click', () => confirmRestart());
    }
    const canTest = v.admin && mode === 'gateway' && !unsaved && v.mode === 'gateway' && !!v.saved.baseUrl && !!v.saved.gatewayKey;
    const test = canTest ? (h('button.btn', { type: 'button', title: 'One request to the gateway’s models list with its key; no model is called' }, '🧪 Test the gateway') as HTMLButtonElement) : null;
    if (test) {
      test.disabled = busy;
      test.addEventListener('click', () => {
        test.disabled = true;
        test.textContent = 'Testing…';
        void claudeAuthApi.test().then(
          (r) => {
            check = r.check;
            paint(r);
          },
          (err: Error) => {
            check = { ok: false, text: err.message };
            paint(v);
          },
        );
      });
    }
    el.replaceChildren(
      h('div.cx-head', {}, h('span.cx-icon', { 'aria-hidden': 'true' }, '🔑'), h('h4', {}, 'Claude for agents'), h('span.cx-status', { class: v.failure ? 'invalid' : 'connected' }, v.failure ? '⛔ Refused' : v.chosen ? '✅ Chosen' : '➖ Not chosen yet')),
      h('p.cx-where', {}, `Agents use: ${v.source}`),
      v.warning ? h('p.cx-warn', {}, `⚠️ ${v.warning}`) : '',
      v.failure ? h('p.cx-err', {}, `⛔ ${v.failure.text} (${timeAgo(v.failure.at)})`) : '',
      v.decision ? h('p.cx-warn', {}, `🔑 ${v.decision.text}`) : '',
      sw ? h('label.cx-check', {}, sw, 'Don’t pass the environment’s ANTHROPIC_API_KEY to agents (use their Claude login)') : '',
      h('div.cx-form', {}, ...radios, h('div.cx-actions', {}, save, restart, test, h('a.cx-link', { href: CLAUDE_HELP, target: '_blank', rel: 'noopener' }, 'How it works and how to fix it'))),
      check ? h(check.ok ? 'p.cx-where' : 'p.cx-err', {}, `${check.ok ? '✅' : '⛔'} ${check.text}`) : '',
      unsaved ? h('p.cx-warn', {}, '⚠️ Not saved yet: press Use this for agents, then restart the agents.') : '',
      h('p.cx-note', {}, 'Agents already running keep what they started with until they’re restarted. Keys are kept encrypted like the other credentials and never shown again.'),
    );
  };
  const load = () =>
    void claudeAuthApi.view().then(paint, (err: Error) => el.replaceChildren(h('p.cx-err', {}, `Couldn’t load Claude for agents: ${err.message}`)));
  load();
  const off = onClaudeAuthChanged(() => {
    if (!el.isConnected) return off();
    if (!picked && !busy) load();
  });
  return el;
}
