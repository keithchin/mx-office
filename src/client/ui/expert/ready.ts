// The readiness report's card (shared/expert-ready.ts), as ./open.ts shows it: the app's name and size, one row
// per check (icon, name, one plain line and a smaller one, the fix button), and the note that nothing is
// required. A fix that needs an answer (the budget's amount, which Team Server app) opens a small form in its
// row; every fix runs only when its button is pressed.

import { h } from '../dom';
import type { ReadyCheck, ReadyFixId, ReadyReport } from '../../../shared/expert-ready';

export interface FixAsk {
  fix: ReadyFixId;
  more?: { total?: number; projectId?: string; name?: string };
}

export interface DrawOptions {
  /** Runs the fix; an error in words when it failed. */
  fix(ask: FixAsk): Promise<string | undefined>;
}

const ICON: Record<ReadyCheck['state'], string> = { ok: '✓', warn: '!', error: '!' };

const initials = (name: string) =>
  name
    .replace(/\.mpr$/i, '')
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'A';

function statsLine(r: ReadyReport): string {
  const s = r.stats;
  if (!s) return '';
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [p(s.modules, 'app module'), p(s.entities, 'entity').replace('entitys', 'entities'), p(s.microflows, 'microflow'), p(s.pages, 'page')].join(' · ');
}

/** The small form a fix needs before it runs, or undefined when one click is enough. */
function fixForm(c: ReadyCheck, r: ReadyReport, run: (more: FixAsk['more']) => void): HTMLElement | undefined {
  if (c.fix?.id === 'set-budget') {
    const amount = h('input.xr-in', { type: 'number', min: '1', step: '1', value: '800', 'aria-label': 'Budget total in US dollars' }) as HTMLInputElement;
    const f = h('form.xr-form', {}, h('label', {}, 'Total, US dollars ', amount), h('span.xr-muted', {}, 'Auto-pause at 100 %'), h('button.btn.primary', { type: 'submit' }, 'Set budget'));
    f.addEventListener('submit', (e) => (e.preventDefault(), run({ total: Number(amount.value) })));
    setTimeout(() => amount.focus(), 0);
    return f;
  }
  if (c.fix?.id === 'add-teamserver') {
    const name = h('input.xr-in.wide', { type: 'text', value: (r.mpr ?? '').replace(/\.mpr$/i, ''), 'aria-label': 'Name of the new Portal app' }) as HTMLInputElement;
    const appId = h('input.xr-in.wide', { type: 'text', placeholder: 'App ID, like 1a2b3c4d-…', 'aria-label': 'App ID of an existing Portal app', disabled: true }) as HTMLInputElement;
    const make = h('input', { type: 'radio', name: 'xr-ts', value: 'make', checked: true }) as HTMLInputElement;
    const link = h('input', { type: 'radio', name: 'xr-ts', value: 'link' }) as HTMLInputElement;
    const sync = () => {
      name.disabled = !make.checked;
      appId.disabled = !link.checked;
    };
    make.addEventListener('change', sync);
    link.addEventListener('change', sync);
    const f = h(
      'form.xr-form.col',
      {},
      h('label', {}, make, ' Create a new app in the Mendix Portal ', name),
      h('label', {}, link, ' Use an existing app ', appId),
      h('div.xr-formfoot', {}, h('span.xr-muted', {}, 'Uses the Mendix account in Settings. Existing remotes stay as they are. Nothing is pushed now.'), h('button.btn.primary', { type: 'submit' }, 'Add remote')),
    );
    f.addEventListener('submit', (e) => (e.preventDefault(), run(link.checked ? { projectId: appId.value.trim() } : { name: name.value.trim() })));
    return f;
  }
  return undefined;
}

function drawRow(c: ReadyCheck, r: ReadyReport, o: DrawOptions): HTMLElement {
  const err = h('p.xr-err', { role: 'alert', hidden: true });
  const extra = h('div.xr-extra', { hidden: true });
  const go = async (btn: HTMLButtonElement, more?: FixAsk['more']) => {
    btn.setAttribute('disabled', '');
    err.hidden = true;
    const e = await o.fix({ fix: c.fix!.id, ...(more ? { more } : {}) });
    btn.removeAttribute('disabled');
    if (e) {
      err.textContent = e;
      err.hidden = false;
    }
  };
  let action: HTMLElement | null = null;
  if (c.done) action = h('span.xr-done', {}, c.done);
  else if (c.fix) {
    const btn = h('button.btn.xr-fix', { type: 'button', title: c.fix.off ?? c.fix.says, disabled: !!c.fix.off }, c.fix.label) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      const form = fixForm(c, r, (more) => void go(form!.querySelector('button[type=submit]') as HTMLButtonElement, more));
      if (!form) return void go(btn);
      extra.hidden = !extra.hidden;
      extra.replaceChildren(...(extra.hidden ? [] : [form]));
    });
    action = btn;
  }
  return h(
    'div.xr-row',
    { 'data-id': c.id, 'data-state': c.state },
    h('span.xr-ico', { 'aria-label': c.state === 'ok' ? 'OK' : c.state === 'warn' ? 'Look at this' : 'Problem' }, ICON[c.state]),
    h('span.xr-name', {}, c.label),
    h('div.xr-say', {}, h('div.xr-line', {}, c.line), c.detail ? h('div.xr-detail', {}, c.detail) : null, c.fix?.off && !c.done ? h('div.xr-detail', {}, c.fix.off) : null, err),
    h('div.xr-act', {}, action),
    extra,
  );
}

/** The card for a report. */
export function drawReport(r: ReadyReport, o: DrawOptions): HTMLElement {
  const name = r.mpr ?? r.dir.split(/[\\/]/).pop() ?? '';
  const head = h(
    'div.xr-head',
    {},
    h('span.xr-tile', { 'aria-hidden': 'true' }, initials(name)),
    h('strong', {}, name),
    h('span.xr-stats', {}, statsLine(r)),
    h('span.grow'),
    r.toLookAt ? h('span.xr-pill', {}, `${r.toLookAt} to look at`) : h('span.xr-pill.ok', {}, 'Ready'),
  );
  return h(
    'div.xr-wrap',
    {},
    h('div.xr-card', {}, head, ...r.checks.map((c) => drawRow(c, r, o))),
    h('p.xr-note', {}, 'Nothing is required. You can attach now and fix later from the proof strip. Only demo users block a Deploy.', r.attached ? ' This folder is already an Expert project.' : ''),
  );
}
