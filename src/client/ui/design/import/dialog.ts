// 📁 Import from folder… on a client's Design system part (admins only): a path on the office's machine (a
// folder, or one .css/.scss/.html/token .json file), scanned read-only by the office, then the mapping review
// (./review.ts) and Save as draft. Nothing is published: Publish v<n> stays the page's own step. ✕ or Esc closes
// it and gives focus back to the button that opened it.

import { h, openModal, toast } from '../../dom';
import { importApi } from './api';
import { mappingReview, type MappingReview } from './review';
import './import.css';

export interface ImportOpts {
  client: string;
  /** The client's design system name (or a starting one). */
  name: string;
  /** Prefilled: the folder the draft (or the newest version) was imported from (Re-import). */
  path?: string;
  /** A draft is waiting: saving replaces it. */
  hasDraft: boolean;
  /** After a save. */
  saved(): void;
}

export function openImport(opener: HTMLElement | null, o: ImportOpts) {
  const title = h('h2', { id: 'di-title' }, o.path ? '↻ Re-import from folder' : '📁 Import from folder');
  const body = h('div.body.di-body-wrap');
  const foot = h('footer');
  const el = h('div.modal.di-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'di-title' }, h('header', {}, title), body, foot);
  const modal = openModal(el, {
    backdropCloses: false,
    doing: 'importing a design system',
    onClose: () => opener?.isConnected && opener.focus(),
  });

  const pathIn = h('input', {
    type: 'text',
    value: o.path ?? '',
    placeholder: 'C:\\work\\brand-site',
    'aria-label': 'Folder or file path on the office’s machine',
    'data-k': 'path',
    spellcheck: false,
  }) as HTMLInputElement;
  const msg = h('p.pf-hint.di-msg', { role: 'status' });
  const scan = h('button.btn.primary', { type: 'button', 'data-act': 'scan' }, 'Scan') as HTMLButtonElement;
  const cancel = h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel');

  const pathStep = () => {
    body.replaceChildren(
      h('p', {}, 'Point at a folder of the client’s design files on the office’s machine (or one file). The office reads CSS custom properties, Sass variables, ', h('code', {}, '<style>'), ' blocks and inline colours in HTML, design-token JSON (W3C DTCG, Style Dictionary, Tokens Studio) and a Tailwind config’s literal colours, then suggests the Branded Atlas form from them for you to review.'),
      h('label.ds-field', {}, h('span', {}, 'Folder or file path'), pathIn),
      h('p.pf-hint', {}, 'Only read, never changed. Nothing in it is run or fetched from the web; dependencies, build output, links, binaries and secrets-like files are left out, and the scan stops at 300 files or 8 MB.'),
      msg,
    );
    foot.replaceChildren(cancel, scan);
    pathIn.focus();
  };

  const go = async () => {
    if (!pathIn.value.trim()) return void (msg.textContent = 'Type the folder’s full path');
    scan.disabled = true;
    msg.textContent = 'Scanning…';
    const r = await importApi.scan(o.client, pathIn.value);
    scan.disabled = false;
    if (r.error || !r.out) return void (msg.textContent = `Couldn’t: ${r.error}`);
    reviewStep(r.out);
  };
  scan.addEventListener('click', () => void go());
  pathIn.addEventListener('keydown', (e) => e.key === 'Enter' && void go());

  const reviewStep = (view: Parameters<typeof mappingReview>[0]) => {
    el.classList.add('wide');
    const review: MappingReview = mappingReview(view, o.name);
    const save = h('button.btn.primary', { type: 'button', 'data-act': 'save' }, 'Save as draft') as HTMLButtonElement;
    const back = h(
      'button.btn',
      {
        type: 'button',
        onclick: () => (el.classList.remove('wide'), pathStep()),
      },
      '← Another folder',
    );
    save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await importApi.save(o.client, review.body());
      save.disabled = false;
      if (r.error) return void toast(`Couldn’t: ${r.error}`, 'warn');
      toast('Imported as a draft: check it on the page, then publish it as the next version');
      modal.close();
      o.saved();
    });
    body.replaceChildren(review.el);
    foot.replaceChildren(h('span.grow', {}, o.hasDraft ? 'Saving replaces the waiting draft. Nothing is published.' : 'Saved as a draft. Nothing is published.'), back, cancel, save);
    save.focus();
  };

  pathStep();
}
