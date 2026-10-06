// The TEST MODE badge on the top bar of the 1D view, the 2D view and the home page, when the office runs
// in test mode (server/testmode.ts, GET /api/test-mode): no real agent CLI starts there, only a fake one.

import { h } from '../dom';
import './testmode.css';

export function testModeBadge() {
  void fetch('/api/test-mode', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ on: boolean; why?: string }>) : undefined))
    .then((v) => {
      if (!v?.on || document.querySelector('.tm-badge')) return;
      const badge = h('span.tm-badge', { role: 'status', title: `Test mode: ${v.why ?? 'on'}. No real agent CLI (claude, codex, opencode…) starts here, only the fake set with --agent.` }, 'TEST MODE');
      const bar = document.querySelector('.lite-bar');
      if (!bar) return void document.body.append(badge);
      bar.insertBefore(badge, bar.querySelector('#theme'));
    })
    .catch(() => undefined);
}
