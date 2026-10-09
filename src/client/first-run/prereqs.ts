// First-run setup's step 2: what this machine has of what the office needs, a row each (green, red, or
// amber), what each is for, whether it's required, and where to get it. The check runs when the step
// opens and when Re-check is pressed, never on a timer (server/first-run/checks.ts).
import { PREREQ_META, prereqsReady, type PrereqResult } from '../../shared/first-run';
import { h, toast } from '../ui/dom';
import { setupApi } from './api';

const ICON = { ok: '✅', missing: '❌', warn: '⚠️' } as const;

/** mxcli's row takes a path, for an mxcli downloaded somewhere the office doesn't look. */
function mxcliForm(r: PrereqResult, recheck: () => void): HTMLElement {
  const input = h('input', { type: 'text', spellcheck: 'false', placeholder: 'C:\\Tools\\mxcli\\mxcli.exe', value: r.status === 'ok' ? '' : (r.path ?? ''), 'aria-label': 'Path to mxcli' }) as HTMLInputElement;
  const save = h('button.btn', { type: 'button' }, 'Use this mxcli');
  save.addEventListener('click', () => {
    save.disabled = true;
    setupApi
      .mxcli(input.value)
      .then(() => (toast('mxcli saved'), recheck()))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => (save.disabled = false));
  });
  return h('div.fr-inline', {}, input, save);
}

function row(r: PrereqResult, recheck: () => void): HTMLElement {
  const m = PREREQ_META[r.id];
  return h(
    'li.fr-row',
    { class: r.status, 'data-id': r.id },
    h('span.fr-row-icon', { 'aria-label': r.status }, ICON[r.status]),
    h(
      'div.fr-row-body',
      {},
      h('div.fr-row-head', {}, h('b', {}, m.label), h('span.fr-badge', { class: m.required ? 'req' : 'opt' }, m.required ? 'Required' : 'Optional')),
      h('p.fr-row-text', {}, r.text),
      h('p.fr-row-why', {}, m.purpose),
      r.status !== 'ok' && r.fix ? h('p.fr-row-fix', {}, r.fix) : null,
      r.id === 'mxcli' && r.status !== 'ok' ? mxcliForm(r, recheck) : null,
    ),
    r.status !== 'ok' && m.link ? h('a.btn.fr-row-link', { href: m.link, target: '_blank', rel: 'noopener noreferrer' }, `${m.linkLabel ?? 'Get it'} ↗`) : null,
  );
}

/** The step's body: the rows (checked as it opens) and Re-check. `ready` hears whether the required ones are there. */
export function prereqsStep(ready: (ok: boolean, rows: PrereqResult[]) => void): HTMLElement {
  const list = h('ul.fr-rows', { 'aria-live': 'polite' });
  const summary = h('p.fr-summary');
  const again = h('button.btn', { type: 'button' }, '🔄 Re-check');
  const check = () => {
    again.disabled = true;
    again.textContent = 'Checking…';
    list.setAttribute('aria-busy', 'true');
    setupApi
      .checks()
      .then(({ rows }) => {
        list.replaceChildren(...rows.map((r) => row(r, check)));
        const missing = rows.filter((r) => r.status === 'missing' && PREREQ_META[r.id].required);
        summary.textContent = missing.length ? `${missing.length} required ${missing.length === 1 ? 'thing is' : 'things are'} missing. Install ${missing.length === 1 ? 'it' : 'them'}, then Re-check (restart the office after installing a program, so it’s on its PATH). You can carry on and come back.` : 'Everything required is here.';
        summary.className = `fr-summary ${missing.length ? 'bad' : 'good'}`;
        ready(prereqsReady(rows), rows);
      })
      .catch((e: Error) => {
        summary.textContent = `Couldn’t check: ${e.message}`;
        summary.className = 'fr-summary bad';
      })
      .finally(() => {
        again.disabled = false;
        again.textContent = '🔄 Re-check';
        list.removeAttribute('aria-busy');
      });
  };
  again.addEventListener('click', check);
  list.append(h('li.fr-row.loading', {}, 'Checking this machine…'));
  check();
  return h('div.fr-prereqs', {}, h('div.fr-inline', {}, summary, again), list);
}
