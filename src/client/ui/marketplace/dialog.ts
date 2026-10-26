// "Use a package file…" for a Marketplace request: the PM picks a .mpk they downloaded from the Marketplace
// website (an upload from this browser), or gives its path on the office's machine. The office checks it is a
// Mendix package of the kind, name and version asked for (a wrong one is refused, said here, nothing changed)
// before it places and commits it. ✕ top right; ✕ or Esc gives focus back to the button that opened it.

import type { MarketplaceRequest } from '../../../shared/marketplace';
import { askWords } from '../../../shared/marketplace';
import { h, openModal } from '../dom';
import { marketplaceApi, type ActResult } from './api';

/** Opens the dialog; resolves with what the office answered once a file went through, or undefined when closed. */
export function openPackageDialog(floor: string, r: MarketplaceRequest, back?: HTMLElement | null): Promise<ActResult | undefined> {
  const opener = back ?? (document.activeElement as HTMLElement | null);
  return new Promise((resolve) => {
    let settled: ActResult | undefined;
    const msg = h('p.mk-msg', { role: 'status', 'aria-live': 'polite' });
    const file = h('input.mk-pick', { type: 'file', accept: '.mpk', 'aria-label': 'A .mpk package file' }) as HTMLInputElement;
    const where = h('input.mk-path', { type: 'text', placeholder: 'or its full path on the office’s machine, e.g. C:\\Downloads\\FileUploader.mpk', 'aria-label': 'Path of the .mpk on the office’s machine' }) as HTMLInputElement;
    const go = h('button.btn.primary.mk-use', { type: 'button', disabled: true }, 'Check and add') as HTMLButtonElement;
    const paint = () => (go.disabled = !file.files?.length && !where.value.trim());
    file.addEventListener('change', paint);
    where.addEventListener('input', paint);
    const want = [r.name ? `the package ${r.name}` : `a ${r.kind} package`, r.version ? `version ${r.version}` : ''].filter(Boolean).join(', ');
    const content = h(
      'div.modal.mk-modal',
      { role: 'dialog', 'aria-label': 'Use a package file' },
      h('header', {}, h('h2', {}, `Use a package file for ${askWords(r)}`)),
      h(
        'div.mk-body',
        {},
        h('p', {}, `Download the .mpk from the item’s page on the Mendix Marketplace (item ${r.id}), then pick it here. The office checks it is ${want} before it adds it to ${r.branch ?? `${r.by.name}’s folder`} and commits it as the office. No token is needed.`),
        h('label.mk-row', {}, h('span', {}, 'Package file'), file),
        h('label.mk-row', {}, h('span', {}, 'Or a path'), where),
        msg,
      ),
      h('footer', {}, go),
    );
    const modal = openModal(content, { onClose: () => (opener?.focus?.(), resolve(settled)) });
    go.addEventListener('click', async () => {
      go.disabled = true;
      msg.classList.remove('bad');
      msg.textContent = 'Checking the package…';
      const f = file.files?.[0];
      const out = f ? await marketplaceApi.upload(floor, r.rid, f) : await marketplaceApi.act(floor, r.rid, 'path', { path: where.value.trim() });
      if (!out.ok) {
        msg.textContent = out.error;
        msg.classList.add('bad');
        paint();
        return;
      }
      settled = out;
      modal.close();
    });
    file.focus();
  });
}
