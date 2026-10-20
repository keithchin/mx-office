// Start from another app, a card of the New project plan (shared/adopt-from.ts, server/adopt-from/): shown once the
// scope is approved and the project has a client (✨ New project from a client's page presets it; Advanced › Client
// picks one). Pick one of the client's apps (admins: other clients' apps too) and what to take from it: its design
// system version (name, version, status, what it was made with, the digest check, a capture or swatches), its
// toolkit pin or the newest toolkit, and its role skill selections; the client's company brain comes with the
// client. Then the summary: "This project will start with: …". Project knowledge is never copied (the brain's
// inbox is how a lesson is shared). An empty client says there's nothing to adopt yet and the card asks nothing.
import { adoptSummary, ADOPT_HONESTY, LESSONS_DOC, LESSONS_WORDS, type AdoptSource, type AdoptSourcesView } from '../../../../shared/adopt-from';
import { h } from '../../dom';
import { adoptApi } from '../../adopt-from/api';
import { icon } from './parts';
import type { Flow } from './index';
import './adopt-card.css';

const short = (sha: string) => sha.slice(0, 7);

export function adoptCard(flow: Flow) {
  const body = h('div.nw-panel-b.nw-adopt-b', {});
  const el = h('section.nw-panel.nw-adopt', { 'aria-label': 'Start from another app', hidden: true }, h('div.nw-panel-h', {}, icon('swap'), h('h2', {}, 'Start from another app'), h('span.nw-badge.draft', {}, 'OPTIONAL'), h('span.nw-grow')), body);
  let view: AdoptSourcesView | undefined;
  let failed: string | undefined;
  let all = false;
  let key = '';
  /** The plan's design was set by this card (and goes when the adoption does). */
  let adoptedDesign = false;

  const source = (): AdoptSource | undefined => view?.sources.find((s) => s.floor === flow.plan.adopt?.source);

  /** The plan's design follows the adoption's (so Advanced › Design says so), and goes with it. */
  function syncDesign() {
    const p = flow.plan;
    const s = source();
    if (p.adopt?.design && s?.design) p.design = { choice: 'use', systemId: s.design.systemId, n: s.design.n };
    else if (p.design?.choice === 'use' && adoptedDesign) delete p.design;
    adoptedDesign = !!(p.adopt?.design && s?.design);
  }

  function pick(id: string) {
    const s = view?.sources.find((x) => x.floor === id);
    if (!s) delete flow.plan.adopt;
    // What it has is offered by default: a verified design system, its pin, its role skills.
    else flow.plan.adopt = { source: s.floor, ...(s.design?.verified ? { design: true } : {}), ...(s.toolkit ? { toolkit: true } : {}), ...(s.roleSkills.length ? { roleSkills: true } : {}) };
    syncDesign();
    draw();
    flow.say(s ? `Starting from ${s.name}` : 'Not starting from another app');
  }

  function set(k: 'design' | 'toolkit' | 'roleSkills', on: boolean) {
    const a = flow.plan.adopt;
    if (!a) return;
    if (on) a[k] = true;
    else delete a[k];
    syncDesign();
    draw();
  }

  function thumb(s: AdoptSource): HTMLElement | null {
    const d = s.design!;
    if (d.capture) return h('img.nw-adopt-thumb', { src: d.capture, alt: `${s.name} on ${d.name} v${d.n} (a runtime capture)`, loading: 'lazy' });
    if (!d.swatch.length) return null;
    return h('span.nw-adopt-sw', { role: 'img', 'aria-label': `${d.name} v${d.n}: its colours` }, ...d.swatch.map((c) => h('i', { style: `background:${c}` })));
  }

  function option(id: string, on: boolean, disabled: boolean, label: (HTMLElement | string)[], hint: (HTMLElement | string | null)[], change: (on: boolean) => void, extra?: HTMLElement | null) {
    const box = h('input', { type: 'checkbox', id, checked: on && !disabled, disabled }) as HTMLInputElement;
    box.addEventListener('change', () => change(box.checked));
    return h('div.nw-adopt-opt', { 'data-off': disabled ? 'true' : 'false' }, h('label.nw-check', { for: id }, box, h('span', {}, ...label)), extra ?? null, h('p.nw-hint', {}, ...hint));
  }

  function choices(s: AdoptSource): HTMLElement[] {
    const a = flow.plan.adopt!;
    const out: HTMLElement[] = [];
    const d = s.design;
    out.push(
      d
        ? option(
            'nw-adopt-design',
            !!a.design,
            !d.verified,
            [h('strong', {}, 'Design system: '), `${d.name} v${d.n}`, d.status ? h('span.nw-badge.draft.nw-adopt-st', {}, d.status.toUpperCase()) : ''],
            [
              d.compat ? `Made with Studio Pro ${d.compat.studioPro} · mxcli ${d.compat.mxcli}. ` : '',
              d.verified ? `✓ Its files match its digest #${d.digest.slice(0, 7)}. ` : '⚠️ Its files don’t match its digest any more: it can’t be adopted. ',
              d.gaps.length ? `Tokens can’t express: ${d.gaps.map((g) => g.replace(/[.\s]+$/, '')).join('; ')}. ` : '',
              flow.plan.kind === 'change' ? 'An existing app gets a ✋ card first: nothing changes until the Project Manager adopts it.' : 'The new project is bound to this exact version at setup (the design step applies it and checks it).',
            ],
            (on) => set('design', on),
            thumb(s),
          )
        : h('div.nw-adopt-opt', { 'data-off': 'true' }, h('p', {}, h('strong', {}, 'Design system: '), `${s.name} has none`), h('p.nw-hint', {}, 'The client’s own design system (Advanced › Design) still applies, if it has one.')),
    );
    const own = view?.clientBrain;
    out.push(
      h(
        'div.nw-adopt-opt',
        { 'data-off': own?.connected ? 'false' : 'true' },
        h('p', {}, h('strong', {}, 'Company brain: '), own?.connected ? `${own.client} brain connected` : `${own?.client ?? 'This client'} has no company brain`),
        h('p.nw-hint', {}, own?.connected ? 'Comes with the client: the setup wires the project to it (as Connect a brain does) and checks the wiring.' : 'Nothing to wire: connect one on the client’s page and every project of the client gets it.', s.crossClient && s.brain?.connected ? ` ${s.brain.client}’s brain isn’t offered: a project is wired to its own client’s brain only.` : ''),
      ),
    );
    if (s.toolkit) {
      const radio = (same: boolean, text: string) => {
        const r = h('input', { type: 'radio', name: 'nw-adopt-tk', checked: !!a.toolkit === same }) as HTMLInputElement;
        r.addEventListener('change', () => r.checked && set('toolkit', same));
        return h('label.nw-check', {}, r, h('span', {}, text));
      };
      out.push(h('div.nw-adopt-opt', { role: 'radiogroup', 'aria-label': 'Toolkit version' }, h('p', {}, h('strong', {}, 'Toolkit')), radio(true, `Same toolkit version as ${s.name} (${short(s.toolkit.sha)})`), radio(false, 'Newest toolkit (default)'), h('p.nw-hint', {}, 'A pin is a fixed toolkit commit: the project’s scripts and wiring run from it until someone updates it.')));
    } else out.push(h('div.nw-adopt-opt', { 'data-off': 'true' }, h('p', {}, h('strong', {}, 'Toolkit: '), 'the newest toolkit (default)'), h('p.nw-hint', {}, `${s.name} isn’t pinned to a toolkit commit, so there’s no version to match.`)));
    const n = s.roleSkills.reduce((t, r) => t + r.changes, 0);
    out.push(
      n
        ? option('nw-adopt-skills', !!a.roleSkills, false, [h('strong', {}, 'Role skills: '), `the selections from ${s.name}`], [`${n} change${n === 1 ? '' : 's'} from the defaults (${s.roleSkills.map((r) => `${r.title} ${r.changes}`).join(', ')}): permissions, their approval rules and the toolkit skills each Playbook lists, set on this project before its team is hired.`], (on) => set('roleSkills', on))
        : h('div.nw-adopt-opt', { 'data-off': 'true' }, h('p', {}, h('strong', {}, 'Role skills: '), `${s.name} uses the defaults`), h('p.nw-hint', {}, 'Nothing to copy.')),
    );
    out.push(h('div.nw-adopt-opt.nw-adopt-only', {}, h('p', {}, '✓ ', h('strong', {}, 'Copy approved company skills only')), h('p.nw-hint', {}, `${LESSONS_WORDS} `, h('a', { href: LESSONS_DOC, target: '_blank', rel: 'noopener' }, 'How lessons are shared'))));
    return out;
  }

  function summary(s: AdoptSource | undefined): HTMLElement {
    const parts = adoptSummary(flow.plan.adopt, s, view?.clientBrain);
    return h('div.nw-adopt-sum', { role: 'status', 'aria-live': 'polite' }, h('p', {}, h('strong', {}, 'This project will start with: '), parts.length ? parts.join(' · ') : 'the defaults'), h('p.nw-hint', {}, ADOPT_HONESTY));
  }

  function draw() {
    if (failed) return void body.replaceChildren(h('p.nw-note', {}, icon('info'), h('span', {}, `Couldn’t ask the office for the client’s apps: ${failed}`)));
    if (!view) return void body.replaceChildren(h('p.nw-hint', {}, 'Asking the office for the client’s apps…'));
    const client = view.clientBrain?.client ?? 'This client';
    const toggle = view.admin ? (h('input', { type: 'checkbox', id: 'nw-adopt-all', checked: all }) as HTMLInputElement) : null;
    toggle?.addEventListener('change', () => ((all = toggle.checked), void load(true)));
    const allRow = toggle ? h('label.nw-check.nw-adopt-all', { for: 'nw-adopt-all' }, toggle, h('span', {}, 'Show other clients’ apps too (admins only)')) : null;
    if (!view.sources.length) {
      delete flow.plan.adopt;
      syncDesign();
      return void body.replaceChildren(h('p.nw-note.nw-adopt-empty', {}, icon('info'), h('span', {}, `Nothing to adopt yet: ${client} has no ${all ? '' : 'other '}apps in the office. This project starts with the client’s defaults; later projects can start from this one.`)), ...(allRow ? [allRow] : []));
    }
    if (flow.plan.adopt && !source()) delete flow.plan.adopt;
    const s = source();
    const sel = h(
      'select',
      { id: 'nw-adopt-src' },
      h('option', { value: '', selected: !s }, 'Don’t start from another app'),
      ...view.sources.map((x) => h('option', { value: x.floor, selected: s?.floor === x.floor }, `${x.name}${x.crossClient && x.client ? ` — ${x.client.label}` : ''}`)),
    ) as HTMLSelectElement;
    sel.addEventListener('change', () => pick(sel.value));
    body.replaceChildren(
      h('p.nw-hint', {}, `Take reusable material from one of ${client}’s apps, each through the office’s own mechanism. Nothing is copied from its repository.`),
      h('div.nw-field', {}, h('label', { for: 'nw-adopt-src' }, 'Start from'), sel),
      ...(allRow ? [allRow] : []),
      ...(s ? choices(s) : []),
      summary(s),
    );
  }

  async function load(force = false) {
    const client = flow.plan.portfolio;
    if (!client) return;
    const k = `${client}|${all}`;
    if (k === key && !force) return;
    key = k;
    view = undefined;
    failed = undefined;
    draw();
    try {
      const v = await adoptApi.sources(client, all);
      if (key !== k) return;
      view = v;
    } catch (err) {
      if (key !== k) return;
      failed = (err as Error).message;
    }
    syncDesign();
    draw();
  }

  function update() {
    const d = flow.draft;
    const ready = !!d?.approved && d.domainsStatus !== 'mapping' && d.busy !== 'domains';
    const client = flow.plan.portfolio;
    el.hidden = !ready || !client;
    if (!client && flow.plan.adopt) {
      delete flow.plan.adopt;
      syncDesign();
    }
    if (!el.hidden && !key.startsWith(`${client}|`)) {
      all = false;
      delete flow.plan.adopt;
      void load();
    }
  }

  // Advanced › Client changing the client: the card follows it (its apps, or none).
  flow.layer.addEventListener('change', (e) => (e.target as HTMLElement | null)?.id === 'nw-a-portfolio' && setTimeout(update, 0));
  return { el, update };
}
