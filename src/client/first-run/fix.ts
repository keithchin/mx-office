// First-run setup's one-click fixes (server/first-run/fixes.ts): a missing row's 🔧 Fix and ⚡ Set up
// everything. Pressing one asks the office for its plan first and shows it in a window: every command
// it would run and where each program comes from, and what the office can't do here (links and
// commands to type). Only Install and set up runs it, with the plan's confirm token; the window then
// shows the live progress, gh's one-time code big with Copy and GitHub's page, and how it ended. ✕ or
// Esc stops a run and puts focus back on the button that opened it.
import type { PrereqResult } from '../../shared/first-run';
import { FIX_FOR, type FixEvent, type FixId, type FixManual, type FixPlan, type FixStep } from '../../shared/first-run-fix';
import { h, openModal, toast } from '../ui/dom';
import { setupApi } from './api';

/** Opens the plan for `ids` ('all': Set up everything), from `opener`; `after` runs once the window closes on a run that did something. */
export function openFix(ids: FixId[] | 'all', opener: HTMLElement | null, after: () => void) {
  const title = h('h2', { id: 'fx-title' }, ids === 'all' ? '⚡ Set up everything' : '🔧 Fix');
  const body = h('div.body.fx-body', {}, h('p.fx-note', {}, 'Asking the office what it would do…'));
  const el = h('div.modal.fx-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fx-title' }, h('header', {}, title), body);
  let ran = false;
  const ac = new AbortController();
  const modal = openModal(el, {
    backdropCloses: false,
    doing: 'setting up the office',
    onClose: () => {
      ac.abort();
      if (ran) after();
      if (opener?.isConnected) opener.focus();
    },
  });

  setupApi.fixPlan(ids).then(confirmView, (e: Error) => body.replaceChildren(h('p.fx-note.bad', {}, `Couldn’t plan it: ${e.message}`)));

  function stepItem(s: FixStep, skip: Set<FixId>): HTMLElement {
    const head = s.optional
      ? h('label.fx-step-head', {}, h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? skip.delete(s.id) : skip.add(s.id)) }), h('b', {}, s.title))
      : h('div.fx-step-head', {}, h('b', {}, s.title));
    return h('li.fx-step', { 'data-id': s.id }, head, ...s.commands.map((c) => h('code.fx-cmd', {}, c)), h('p.fx-src', {}, `From: ${s.sources.join(' · ')}`), s.note ? h('p.fx-step-note', {}, s.note) : null);
  }

  function manualItem(m: FixManual): HTMLElement {
    return h(
      'li.fx-step.manual',
      { 'data-id': m.id },
      h('div.fx-step-head', {}, h('b', {}, m.title)),
      h('p.fx-step-note', {}, m.why),
      ...m.commands.map((c) => h('code.fx-cmd', {}, c)),
      m.links.length ? h('p.fx-links', {}, ...m.links.map((l) => h('a', { href: l, target: '_blank', rel: 'noopener noreferrer' }, `${l.replace(/^https:\/\//, '')} ↗`))) : null,
    );
  }

  function confirmView(plan: FixPlan) {
    const skip = new Set<FixId>();
    const parts: (HTMLElement | null)[] = [];
    if (plan.steps.length) parts.push(h('p.fx-note', {}, 'The office will run these, in this order, and stop at the first that fails:'), h('ol.fx-steps', {}, ...plan.steps.map((s) => stepItem(s, skip))));
    else parts.push(h('p.fx-note', {}, ids === 'all' ? 'Nothing the office can fix by itself is missing.' : 'The office can’t do this one by itself here.'));
    if (plan.manual.length) parts.push(h('p.fx-note', {}, 'These need you (the office can’t do them here):'), h('ul.fx-steps', {}, ...plan.manual.map(manualItem)));
    const go = h('button.btn.primary', { type: 'button' }, 'Install and set up');
    const cancel = h('button.btn', { type: 'button', onclick: () => modal.close() }, plan.steps.length ? 'Cancel' : 'Close');
    go.addEventListener('click', () => runView(plan, [...skip]));
    body.replaceChildren(...parts, h('div.fx-buttons', {}, plan.confirm ? go : null, cancel));
    (plan.confirm ? go : cancel).focus();
  }

  function runView(plan: FixPlan, skip: FixId[]) {
    ran = true;
    title.textContent = ids === 'all' ? '⚡ Setting up…' : '🔧 Fixing…';
    const steps = h('ol.fx-progress', {}, ...plan.steps.filter((s) => !skip.includes(s.id)).map((s) => h('li', { 'data-id': s.id }, h('span.fx-mark', { 'aria-hidden': 'true' }, '○'), s.title)));
    const code = h('div.fx-code-slot');
    const log = h('pre.fr-log.fx-log', { 'aria-live': 'polite' });
    const end = h('div.fx-end');
    const stop = h('button.btn', { type: 'button', onclick: () => ac.abort() }, '■ Stop');
    body.replaceChildren(steps, code, log, end, h('div.fx-buttons', {}, stop));
    const mark = (id: FixId, m: string, cls: string) => {
      const li = steps.querySelector(`[data-id="${id}"]`);
      if (!li) return;
      li.className = cls;
      li.querySelector('.fx-mark')!.textContent = m;
    };
    const on = (e: FixEvent) => {
      if (e.t === 'step') mark(e.id, '◔', 'running');
      else if (e.t === 'line') log.append(`${e.text}\n`), (log.scrollTop = log.scrollHeight);
      else if (e.t === 'code') code.replaceChildren(deviceCode(e.code, e.url));
      else if (e.t === 'step-done') {
        mark(e.id, e.ok ? '✓' : '✕', e.ok ? 'ok' : 'bad');
        if (e.id === 'gh-auth') code.replaceChildren();
      } else if (e.t === 'path' && e.refreshed && e.added.length) log.append(`The office’s PATH now has ${e.added.join(', ')}\n`);
      else if (e.t === 'done') finish(e.ok ? undefined : e.error, e.ok ? e.restart : undefined);
    };
    const finish = (error?: string, restart?: string) => {
      title.textContent = error ? '⚠️ Setup stopped' : '✅ Done';
      end.replaceChildren(h('p', { class: `fx-note ${error ? 'bad' : 'good'}` }, error ?? 'Everything in the plan worked.'), restart ? h('p.fx-note.warn', {}, `🔁 ${restart}`) : null);
      const close = h('button.btn.primary', { type: 'button', onclick: () => modal.close() }, '🔄 Close and re-check');
      stop.replaceWith(close);
      close.focus();
    };
    setupApi.fixRun(plan.confirm!, skip, on, ac.signal).catch((e: Error) => finish(ac.signal.aborted ? 'Stopped' : `Lost the office: ${e.message}`));
  }
}

/** gh's one-time code, big, with Copy and GitHub's page. */
function deviceCode(code: string, url: string): HTMLElement {
  const copy = h('button.btn', { type: 'button' }, '📋 Copy');
  copy.addEventListener('click', () =>
    navigator.clipboard?.writeText(code).then(
      () => toast('Code copied'),
      () => toast('Couldn’t copy: select it instead', 'warn'),
    ),
  );
  return h(
    'div.fx-code',
    {},
    h('p.fx-code-label', {}, 'Type this code on GitHub’s page:'),
    h('div.fx-code-row', {}, h('output.fx-code-value', { 'aria-label': 'One-time code' }, code), copy, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open github.com/login/device ↗')),
    h('p.fx-code-hint', {}, 'Sign in there and approve GitHub CLI. This window carries on by itself once GitHub says yes.'),
  );
}

/** A row's 🔧 Fix (rows the office can fix), or its offer once it's ok (save the agents' token from gh's sign-in). */
export function fixButton(r: PrereqResult, recheck: () => void): HTMLElement | null {
  if (r.status === 'ok') {
    if (r.offer !== 'gh-token') return null;
    const b = h('button.btn.fr-row-action', { type: 'button' }, '🔑 Save as the agents’ GitHub token');
    b.addEventListener('click', () => openFix(['gh-token'], b, recheck));
    return b;
  }
  const fix = FIX_FOR[r.id];
  if (!fix || r.id === 'longpaths') return null;
  const label = fix === 'claude-auth' ? '🔑 Sign in with your Claude account' : '🔧 Fix';
  const b = h('button.btn.fr-row-action.fr-fix', { type: 'button', 'data-fix': fix }, label);
  b.addEventListener('click', () => openFix([fix], b, recheck));
  return b;
}

/** Claude Code's other way in: an Anthropic API key, saved in 🔌 Connections and never shown again. */
export function claudeKeyForm(recheck: () => void): HTMLElement {
  const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-api03-…', 'aria-label': 'Anthropic API key' }) as HTMLInputElement;
  const save = h('button.btn', { type: 'button' }, 'Use an API key');
  save.addEventListener('click', () => {
    const key = input.value.trim();
    if (!key) return void input.focus();
    input.value = '';
    save.disabled = true;
    setupApi
      .claudeKey(key)
      .then(() => (toast('API key saved in 🔌 Connections'), recheck()))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => (save.disabled = false));
  });
  return h('div.fr-inline.fx-key', {}, input, save);
}

/** ⚡ Set up everything: every fix the check asks for, in order. */
export function setupEverything(recheck: () => void): HTMLElement {
  const b = h('button.btn.primary.fr-all', { type: 'button' }, '⚡ Set up everything');
  b.addEventListener('click', () => openFix('all', b, recheck));
  return b;
}
