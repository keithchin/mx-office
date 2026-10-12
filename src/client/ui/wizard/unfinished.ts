import './unfinished.css';
/**
 * Unfinished new-project setups (shared/setup-cancel.ts): a card each, on Home and at the top of the
 * wizard's first page, so ✨ New project always opens a fresh wizard and a setup that stopped is never
 * lost. Each card says where it stopped and why, and what would stop a Retry right now (a paused
 * project, with Resume for admins); then Retry, Show setup (carry on in the wizard), Open project (when
 * its floor is there) and Cancel & undo (admins, ui/wizard/cancel.ts). The section hides itself when
 * there's nothing unfinished.
 */
import type { Net } from '../../net';
import type { UnfinishedSetup } from '../../../shared/setup-cancel';
import { groupNameOf, plainError } from '../../../shared/setup-groups';
import { h, toast } from '../dom';
import { startResume } from '../project-run/api';
import { wizardApi, type CallError } from './api';
import { openCancelDialog } from './cancel';
import { operationBox } from './operation';

export interface UnfinishedOptions {
  net: Net;
  go(floor: string): void;
  /** Show this setup's progress: in the wizard that's open, else a wizard opened on it. */
  carryOn(id: string): void;
  /** Heard after something changed (a setup cancelled, a project resumed). */
  changed?(): void;
}

const POLL_MS = 3000;
const STATUS: Record<UnfinishedSetup['status'], string> = { failed: 'Stopped', running: 'Running', idle: 'Not finished', cancelling: 'Cancel & undo stopped' };

export function unfinishedSection(opts: UnfinishedOptions): { el: HTMLElement; refresh(): void } {
  const list = h('ul.us-list', { 'aria-label': 'Unfinished setups' });
  const el = h(
    'section.us-section.hidden',
    { 'aria-labelledby': 'us-title' },
    h('h3.us-title', { id: 'us-title' }, 'Unfinished setups'),
    h('p.us-intro', {}, 'New projects whose setup didn’t finish. Carry one on, or cancel it and undo what it did.'),
    list,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let admin = false;
  let setups: UnfinishedSetup[] = [];

  const refresh = () => {
    clearTimeout(timer);
    void wizardApi.unfinished().then(
      (r) => {
        admin = r.admin;
        setups = r.setups;
        draw();
        if (el.isConnected && setups.some((s) => s.status === 'running')) timer = setTimeout(refresh, POLL_MS);
      },
      () => undefined,
    );
  };

  const card = (s: UnfinishedSetup) => {
    const retry = h('button.btn.primary', { type: 'button' }, 'Retry') as HTMLButtonElement;
    const blockerBox = h('div.us-blocker', { role: 'status' });
    const drawBlocker = (b = s.blocker) => {
      blockerBox.replaceChildren();
      blockerBox.classList.toggle('hidden', !b);
      retry.disabled = !!b;
      retry.title = b ? b.text : 'Carry on from the step that stopped: the steps already done are skipped';
      if (!b) return;
      blockerBox.append(h('span', {}, b.text));
      if (b.resume && admin) {
        const resume = h('button.btn', { type: 'button' }, 'Resume project') as HTMLButtonElement;
        resume.addEventListener('click', () => {
          resume.disabled = true;
          startResume(b.resume!, { mode: 'work' }).then(
            () => (toast(`Resuming ${s.name}`), setTimeout(refresh, 1200), opts.changed?.()),
            (err: Error) => (toast(err.message, 'error'), (resume.disabled = false)),
          );
        });
        blockerBox.append(resume);
      }
    };
    drawBlocker();
    retry.addEventListener('click', () => {
      retry.disabled = true;
      wizardApi.retry(s.id).then(
        () => opts.carryOn(s.id),
        (err: CallError) => {
          if (err.blocker) return drawBlocker(err.blocker);
          toast(err.message, 'error');
          retry.disabled = false;
        },
      );
    });
    const cancelling = s.status === 'cancelling';
    // An operation the office couldn't confirm: Check again (and Use this existing …) instead of Retry.
    const op = !cancelling && s.status !== 'running' ? s.operation : undefined;
    const acts = h(
      'div.us-acts',
      {},
      admin && !cancelling && s.status !== 'running' && !op ? retry : null,
      !(cancelling && !s.done) ? h('button.btn', { type: 'button', onclick: () => opts.carryOn(s.id) }, s.status === 'running' ? 'Show progress' : 'Show setup') : null,
      s.floor ? h('button.btn', { type: 'button', onclick: () => opts.go(s.floor!) }, 'Open project') : null,
      admin && s.status !== 'running'
        ? h('button.btn.us-danger', { type: 'button', onclick: () => openCancelDialog(s.id, s.repo, { done: () => (refresh(), opts.changed?.()) }) }, cancelling ? 'Carry on cancelling…' : 'Cancel & undo…')
        : null,
    );
    const pct = Math.round((s.done / Math.max(1, s.total)) * 100);
    return h(
      'li.us-card',
      { 'data-st': s.status, 'data-id': s.id },
      h('div.us-head', {}, h('span.us-name', {}, s.repo), h('span.us-badge', {}, STATUS[s.status])),
      s.step ? h('p.us-line', {}, `${s.status === 'running' ? 'On' : 'Stopped at'}: ${s.status !== 'cancelling' && groupNameOf(s.step) ? `${groupNameOf(s.step)} · ` : ''}${s.step}`) : null,
      op ? operationBox(op, { id: s.id, admin, compact: true, changed: () => (refresh(), opts.changed?.()) }) : s.error ? h('p.us-line.us-muted', {}, plainError(s.error)) : null,
      cancelling && s.cancel?.error ? h('p.us-line.us-muted', {}, s.cancel.error) : null,
      h('div.us-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(s.total), 'aria-valuenow': String(s.done), 'aria-label': `${s.done} of ${s.total} steps done` }, h('span', { style: `width:${pct}%` })),
      h('p.us-line.us-muted', {}, `${s.done} of ${s.total} steps done · started by ${s.by}`),
      blockerBox,
      acts,
    );
  };

  function draw() {
    el.classList.toggle('hidden', setups.length === 0);
    list.replaceChildren(...setups.map(card));
  }

  refresh();
  return { el, refresh };
}
