// "Open existing toolkit project" (Expert mode, from ➕ Add a project): the full path of a folder on the
// office's machine becomes an Expert-mode project and its session opens. No readiness checks yet (they
// come later); the office only refuses its own folders, system folders and a whole drive or home folder.

import { h, openModal } from '../dom';
import { openFolder } from './api';

export interface OpenFolderOptions {
  /** Into the new project (its Session screen opens on arrival). */
  go(floorId: string): void;
}

export function openExistingProject(opts: OpenFolderOptions) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = h('input.xs-open-path', { type: 'text', placeholder: 'C:\\work\\orders-app', 'aria-label': 'The project folder’s full path', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const err = h('p.xs-open-err', { role: 'alert', hidden: true });
  const go = h('button.btn.primary', { type: 'submit' }, 'Open session');
  const form = h(
    'form.xs-open-form',
    {},
    h('label', {}, 'Project folder', input),
    h('p.xs-muted', {}, 'A Mendix app folder with the mxcli project toolkit in it. It opens in Expert mode: your own Claude Code session in that folder, the app live beside it, no team.'),
    err,
    h('div.xs-open-actions', {}, go),
  );
  const el = h('div.modal.xs-open', { role: 'dialog', 'aria-label': 'Open existing toolkit project' }, h('header', {}, h('h2', {}, 'Open existing toolkit project')), h('div.body', {}, form));
  const modal = openModal(el, { onClose: () => opener?.focus() });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const path = input.value.trim();
    if (!path) return input.focus();
    go.setAttribute('disabled', '');
    err.hidden = true;
    const r = await openFolder(path);
    go.removeAttribute('disabled');
    if ('error' in r) {
      err.textContent = r.error;
      err.hidden = false;
      return;
    }
    modal.close();
    opts.go(r.floor);
  });
  setTimeout(() => input.focus(), 30);
}
