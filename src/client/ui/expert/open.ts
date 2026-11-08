// "Open existing toolkit project" (Expert mode, from ➕ Add a project): the full path of a folder on the office's
// machine, its readiness check (server/expert-ready/: toolkit, mxcli, Mendix, git, Team Server, demo users, tests,
// budget, lint baseline; the check never writes to the folder), the fixes a person may click one by one, then
// "Attach and open session". Nothing is required to attach; only demo users block a Deploy. The rows are drawn
// by ./ready.ts.

import { h, openModal, toast } from '../dom';
import { checkReady, fixReady, openFolder } from './api';
import { drawReport, type FixAsk } from './ready';
import type { ReadyReport } from '../../../shared/expert-ready';
import './ready.css';

export interface OpenFolderOptions {
  /** Into the new project (its Session screen opens on arrival). */
  go(floorId: string): void;
}

export function openExistingProject(opts: OpenFolderOptions) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = h('input.xs-open-path', { type: 'text', placeholder: 'C:\\work\\order-desk', 'aria-label': 'The project folder’s full path', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const check = h('button.btn', { type: 'submit' }, 'Check folder');
  const err = h('p.xs-open-err', { role: 'alert', hidden: true });
  const out = h('div.xr-out', { 'aria-live': 'polite' });
  const attach = h('button.btn.primary', { type: 'button', disabled: true }, 'Attach and open session');
  const back = h('button.btn', { type: 'button' }, 'Back');
  const form = h('form.xr-pathrow', {}, input, check);
  let report: ReadyReport | undefined;
  let checkedPath = '';

  const el = h(
    'div.modal.xs-open.xr',
    { role: 'dialog', 'aria-label': 'Open an existing toolkit project' },
    h('header', {}, h('h2', {}, 'Open an existing toolkit project')),
    h(
      'div.body',
      {},
      h('p.xr-intro', {}, 'For apps you already build with the toolkit. The office checks the folder, offers fixes, and then runs in the background of your session. It never changes the app without asking.'),
      form,
      err,
      out,
    ),
    h('footer.xr-foot', {}, h('span.grow'), back, attach),
  );
  const modal = openModal(el, { onClose: () => opener?.focus() });
  back.addEventListener('click', () => modal.close());

  const say = (text: string | undefined) => {
    err.textContent = text ?? '';
    err.hidden = !text;
  };

  const show = (r: ReadyReport) => {
    report = r;
    out.replaceChildren(drawReport(r, { fix: onFix }));
    attach.removeAttribute('disabled');
    attach.textContent = r.attached ? 'Open session' : 'Attach and open session';
    check.textContent = 'Check again';
  };

  const run = async (fresh: boolean) => {
    const path = input.value.trim();
    if (!path) return input.focus();
    say(undefined);
    check.setAttribute('disabled', '');
    if (path !== checkedPath) {
      attach.setAttribute('disabled', '');
      out.replaceChildren(h('p.xr-wait', {}, 'Checking the folder… (read-only)'));
    } else out.classList.add('xr-busy');
    const r = await checkReady(path, fresh);
    check.removeAttribute('disabled');
    out.classList.remove('xr-busy');
    if ('error' in r) {
      out.replaceChildren();
      report = undefined;
      return say(r.error);
    }
    checkedPath = path;
    show(r);
  };

  async function onFix(ask: FixAsk): Promise<string | undefined> {
    const r = await fixReady(checkedPath, ask.fix, ask.more);
    if ('error' in r) return r.error;
    toast(r.message);
    show(r.report);
    return undefined;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run(input.value.trim() === checkedPath);
  });
  input.addEventListener('input', () => {
    if (input.value.trim() !== checkedPath) check.textContent = 'Check folder';
  });
  attach.addEventListener('click', async () => {
    if (!report) return;
    if (report.attached) return modal.close(), opts.go(report.attached);
    attach.setAttribute('disabled', '');
    say(undefined);
    const r = await openFolder(checkedPath);
    attach.removeAttribute('disabled');
    if ('error' in r) return say(r.error);
    modal.close();
    opts.go(r.floor);
  });
  setTimeout(() => input.focus(), 30);
  return { modal, input, run };
}
