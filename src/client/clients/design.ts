// A client's Design system on its page (clients/view.ts; server/design/): None (today's behaviour), Atlas
// defaults or Branded Atlas (the short form, ui/design/form.ts). Save draft, Publish v<n> (an immutable version
// with its digest and the mxcli it was made with), Approve, Make default, Edit as a new draft; the versions
// with their status and the projects bound to each. Changing the default never moves a project's binding.
// Asked once when the client's page opens, and again after each change.

import type { DesignInput, DesignKind } from '../../shared/design/types';
import { DEFAULT_INPUT } from '../../shared/design/tokens';
import { STATUS_WORDS } from '../../shared/design/words';
import type { ClientDesignView, VersionView } from '../../shared/design/views';
import { h, toast } from '../ui/dom';
import { designApi } from '../ui/design/api';
import { brandForm, type BrandForm } from '../ui/design/form';
import '../ui/design/design.css';

const cache = new Map<string, ClientDesignView>();
/** The part itself, kept across the page's redraws (the socket redraws it often): what's typed in the form stays. */
const parts = new Map<string, HTMLElement>();

export function designPart(client: string, admin: boolean): HTMLElement {
  const key = `${client}|${admin}`;
  const had = parts.get(key);
  if (had) return had;
  const root = h('section.pf-part.ds-part', { 'aria-label': 'Design system' });
  parts.set(key, root);
  let view = cache.get(client);
  let mode: 'none' | DesignKind | undefined;
  let form: BrandForm | undefined;
  let dirty = false;

  const act = async (btn: HTMLButtonElement, body: Record<string, unknown>, done: string) => {
    btn.disabled = true;
    const r = await designApi.act(body);
    btn.disabled = false;
    if (r.error) return void toast(`Couldn’t: ${r.error}`, 'warn');
    toast(done);
    dirty = false;
    await load();
  };

  const versionRow = (v: VersionView) => {
    const s = view!.system!;
    const isDefault = view!.default?.systemId === s.id && view!.default.n === v.n;
    const acts: HTMLElement[] = [];
    if (admin && v.status === 'draft') {
      const b = h('button.btn.ph-outline', { type: 'button', title: 'Approve this version: projects may adopt it and it can be the client’s default' }, 'Approve') as HTMLButtonElement;
      b.onclick = () => act(b, { action: 'approve', system: s.id, n: v.n }, `Approved v${v.n}`);
      acts.push(b);
    }
    if (admin && v.status === 'approved' && !isDefault) {
      const b = h('button.btn.ph-outline', { type: 'button', title: 'Recommend this version to new projects of this client (existing projects keep theirs)' }, 'Make default') as HTMLButtonElement;
      b.onclick = () => act(b, { action: 'default', client, system: s.id, n: v.n }, `v${v.n} is the default for new projects`);
      acts.push(b);
    }
    if (admin && s.kind === 'branded') {
      const b = h('button.btn.ph-outline', { type: 'button', title: `A new draft starting from v${v.n} (v${v.n} itself never changes)` }, 'Edit as new draft') as HTMLButtonElement;
      b.onclick = () => act(b, { action: 'edit', system: s.id, n: v.n }, 'A new draft: change it and publish it as the next version');
      acts.push(b);
    }
    return h(
      'tr',
      { 'data-v': v.n },
      h('td', {}, h('strong', {}, `v${v.n}`), isDefault ? h('span.pf-chip', { 'data-tone': 'good' }, 'Default') : null),
      h('td', {}, h('span.pf-chip', { 'data-tone': v.status === 'approved' ? 'good' : v.status === 'draft' ? 'warn' : 'none' }, STATUS_WORDS[v.status])),
      h('td', {}, h('code', { title: v.digest }, v.digest.slice(0, 12))),
      h('td', {}, `${new Date(v.publishedAt).toLocaleDateString()} by ${v.by || 'someone'}`),
      h('td', {}, v.compat ? `Studio Pro ${v.compat.studioPro} · mxcli ${v.compat.mxcli}` : '—'),
      h('td', {}, v.usedBy.length ? v.usedBy.join(', ') : 'No project yet'),
      h('td.ds-acts', {}, ...acts),
    );
  };

  function draw() {
    if (!view) return void root.replaceChildren(h('h3', {}, 'Design system'), h('p.pf-hint', {}, 'Asking the office…'));
    const s = view.system;
    mode ??= s ? s.kind : 'none';
    const parts: (HTMLElement | null)[] = [h('h3', {}, 'Design system')];
    if (admin && !view.versions.length) {
      const pick = (m: typeof mode, label: string, hint: string) => {
        const r = h('input', { type: 'radio', name: `ds-mode-${client}`, value: m!, checked: mode === m }) as HTMLInputElement;
        r.addEventListener('change', () => ((mode = m), draw()));
        return h('label.ds-mode', {}, r, h('span', {}, h('strong', {}, label), h('small', {}, hint)));
      };
      parts.push(h('div.ds-modes', { role: 'radiogroup', 'aria-label': 'Design system for this client' }, pick('none', 'None', 'Today’s behaviour: each project keeps its own styling.'), pick('atlas', 'Atlas defaults', 'Atlas as it ships, plus the administration patterns.'), pick('branded', 'Branded Atlas', 'The client’s colours, type, density and shape.')));
    } else if (s) parts.push(h('p', {}, h('strong', {}, s.name), ` · ${s.kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults'} · administration preset`));
    if (mode === 'none' && !s) parts.push(h('p.pf-hint', {}, 'No design system: new projects of this client are set up exactly as today.'));
    if (mode && mode !== 'none' && admin) {
      const start: DesignInput = { ...DEFAULT_INPUT, ...(s?.draft ?? view.latest ?? {}), name: s?.draft?.name || s?.name || `${view.label} Design System` };
      if (mode === 'branded') {
        form = brandForm(start, () => ((dirty = true), (publish.disabled = true)));
        parts.push(form.el);
      } else form = undefined;
      const save = h('button.btn.ph-outline', { type: 'button' }, 'Save draft') as HTMLButtonElement;
      save.onclick = () => act(save, { action: 'draft', client, kind: mode, input: form ? form.value() : { ...start } }, 'Draft saved');
      const next = Math.max(0, ...view.versions.map((v) => v.n)) + 1;
      const publish = h('button.btn.primary', { type: 'button', disabled: !s?.draft, title: s?.draft ? 'Freeze the draft as an immutable version with its digest' : 'Save a draft first' }, `Publish v${next}`) as HTMLButtonElement;
      publish.onclick = () => (dirty ? toast('Save the draft first', 'warn') : act(publish, { action: 'publish', system: s!.id }, `Published v${next}`));
      parts.push(h('div.pf-acts.ds-bar', {}, save, publish, s?.draft ? h('small.pf-hint', {}, 'A draft is waiting to be published.') : null));
    }
    if (s && view.versions.length) {
      parts.push(
        h('table.ds-versions', { 'aria-label': 'Published versions' }, h('thead', {}, h('tr', {}, ...['Version', 'Status', 'Digest', 'Published', 'Made with', 'Used by', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...view.versions.map(versionRow))),
        h('p.pf-hint', {}, 'Published versions never change: editing starts a new draft. Changing the default only affects new projects; a project keeps the exact version it adopted.'),
      );
    }
    root.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  async function load() {
    try {
      view = await designApi.client(client);
      cache.set(client, view);
      mode = undefined;
    } catch (err) {
      root.replaceChildren(h('h3', {}, 'Design system'), h('p.pf-warn', {}, `Couldn’t ask the office: ${(err as Error).message}`));
      return;
    }
    draw();
  }
  draw();
  if (!view) void load();
  return root;
}
