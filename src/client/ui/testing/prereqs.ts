// The Testing page's prerequisites (server/testing/prereqs.ts): what this project's tests need on this machine,
// the test database and Playwright, each ready, missing (with its one fix, and the command or SQL it runs so it
// can be done by hand) or unknown (and why). Shown at the top of the page while anything is missing; one line
// once both are ready. Fixes are admins'. Asked when the page loads, never on a timer.

import type { TestPrereq, TestPrereqs } from '../../../shared/testing/prereqs';
import { h, toast } from '../dom';

const ICON: Record<TestPrereq['state'], string> = { ready: '✅', missing: '⚠️', unknown: '❔' };

export function prereqsPanel(v: TestPrereqs & { admin?: boolean }, floor: string, again: () => void): HTMLElement {
  if (v.ready) return h('p.tst-prereq-ok', { 'data-prereqs': 'ready' }, '✅ Test prerequisites ready: the test database and Playwright are in place.');
  const row = (p: TestPrereq) => {
    const fix = p.fix && v.admin ? (h('button.btn.small', { type: 'button', 'data-fix': p.id }, p.fix) as HTMLButtonElement) : null;
    fix?.addEventListener('click', async () => {
      fix.disabled = true;
      fix.textContent = p.id === 'playwright' ? 'Installing…' : 'Preparing…';
      const res = await fetch('/api/testing/prereqs', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, what: p.id }) }).catch(() => undefined);
      const out = (await res?.json().catch(() => ({}))) as { error?: string };
      if (!res?.ok) toast(out.error ?? 'The office could not be reached', 'warn');
      else toast(`${p.title}: ready`);
      again();
    });
    const how = p.command ? h('code', {}, p.command) : p.sql ? h('code', {}, p.sql.join(' ')) : null;
    return h('li', { 'data-prereq': p.id, 'data-state': p.state }, h('b', {}, `${ICON[p.state]} ${p.title}`), ' ', p.text, fix ? h('span', {}, ' ', fix) : '', how ? h('details', {}, h('summary', {}, 'What it runs'), how) : '');
  };
  return h('section.tst-prereqs', { 'aria-label': 'Test prerequisites', 'data-prereqs': 'missing' }, h('h3', {}, 'Before the tests can run'), h('ul', {}, ...v.items.map(row)));
}
