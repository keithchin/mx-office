// Advanced › Design (server/design/): shown only when the project's client has an approved design system.
// "Acme Design System v1 — recommended for this client" with Use this version / Choose another / Keep the
// app's design. A new app starts on Use (the client's own recommendation); Change an existing app starts on
// Keep, and even Use there only puts a ✋ card in front of the Project Manager after setup: an existing app is
// never changed without that decision. No client, or a client without one: nothing shown, today's flow.

import type { ProjectPlan } from '../../../../shared/wizard';
import type { DesignChoice } from '../../../../shared/design/views';
import { KEEP_WORDS } from '../../../../shared/design/words';
import { h } from '../../dom';
import { designApi } from '../../design/api';
import '../../design/design.css';

const lists = new Map<string, DesignChoice[]>();
const asked = new Set<string>();

const label = (c: DesignChoice) => `${c.name} v${c.n}`;

export function designField(d: ProjectPlan, redraw: () => void): HTMLElement | null {
  const client = d.portfolio;
  // Start from another app chose the source's exact version (adopt-card.ts): said here, never reset to the client's list.
  if (client && d.adopt?.design && d.design?.choice === 'use') return h('div.nw-field.nw-design', {}, h('span.nw-lbl', {}, 'Design system'), h('span.nw-hint', {}, `v${d.design.n} of the design system of the app this project starts from (Start from another app, above): the new project is bound to that exact version at setup.`));
  if (!client) {
    delete d.design;
    return null;
  }
  if (!asked.has(client)) {
    asked.add(client);
    designApi.choices(client).then(
      (v) => {
        lists.set(client, v.choices);
        if (v.choices.length) redraw();
      },
      () => asked.delete(client),
    );
  }
  const choices = lists.get(client) ?? [];
  if (!choices.length) {
    delete d.design;
    return null;
  }
  const rec = choices.find((c) => c.recommended) ?? choices[0];
  // Picked once per client: a new app starts on the recommendation, an existing app on Keep.
  if (!d.design || (d.design.choice === 'use' && !choices.some((c) => c.systemId === d.design!.systemId && c.n === d.design!.n))) d.design = d.kind === 'new' ? { choice: 'use', systemId: rec.systemId, n: rec.n } : { choice: 'keep' };
  const chosen = d.design.choice === 'use' ? choices.find((c) => c.systemId === d.design!.systemId && c.n === d.design!.n) : undefined;
  const pressed = (on: boolean) => (on ? 'true' : 'false');
  const use = h('button.btn.ph-outline', { type: 'button', 'aria-pressed': pressed(!!chosen && chosen === rec) }, 'Use this version') as HTMLButtonElement;
  use.onclick = () => ((d.design = { choice: 'use', systemId: rec.systemId, n: rec.n }), redraw());
  const keep = h('button.btn.ph-outline', { type: 'button', 'aria-pressed': pressed(d.design.choice === 'keep') }, KEEP_WORDS) as HTMLButtonElement;
  keep.onclick = () => ((d.design = { choice: 'keep' }), redraw());
  const others = choices.filter((c) => c !== rec);
  const other = h(
    'select',
    { 'aria-label': 'Choose another version', id: 'nw-a-design-other', disabled: !others.length, title: others.length ? 'Another approved version of this client’s design system' : 'The client has no other approved version' },
    h('option', { value: '', selected: !(chosen && chosen !== rec) }, others.length ? 'Choose another…' : 'Choose another (none)'),
    ...others.map((c) => h('option', { value: `${c.systemId}|${c.n}`, selected: chosen === c }, `${label(c)} (${c.status})`)),
  ) as HTMLSelectElement;
  other.addEventListener('change', () => {
    const [systemId, n] = other.value.split('|');
    if (systemId && n) d.design = { choice: 'use', systemId, n: Number(n) };
    redraw();
  });
  const said = d.design.choice === 'keep' ? 'The app keeps its own design: nothing is applied.' : d.kind === 'new' ? `${chosen ? label(chosen) : label(rec)} is applied right after the app is created (mxcli theme, checked), and the setup's commit takes it.` : `After setup you get a ✋ card to adopt ${chosen ? label(chosen) : label(rec)}: the existing app's styling is scanned first and nothing changes until you approve.`;
  return h(
    'div.nw-field.nw-design',
    {},
    h('span.nw-lbl', {}, 'Design system'),
    h('span.nw-design-rec', {}, `${label(rec)} — recommended for this client`, h('small.pf-hint', {}, ` · ${rec.kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults'} · #${rec.digest.slice(0, 7)}`)),
    h('div.nw-design-acts', {}, use, other, keep),
    h('span.nw-hint', {}, said),
  );
}
