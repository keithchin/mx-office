// The Design gallery tab's page (./tab.ts, loaded on first show): what the project adopted (or the ✋ proposal
// waiting, or the client's version it could adopt), the administration patterns with their states, constraints
// and Mendix reference, "Use for…" (a pattern selection: recorded only, no model call, the app doesn't change),
// and screenshots of the running live app (Capture now never starts it; a stopped app's screenshots stay,
// labelled as history). Fetched on show and after each action; nothing runs while the tab is hidden.

import { PATTERNS, PATTERN_VERIFIED, type Pattern } from '../../../shared/design/patterns';
import { pointerOf } from '../../../shared/design/types';
import { adoptionWords, bindingWords, KEEP_WORDS, startWords } from '../../../shared/design/words';
import type { ProjectDesignView } from '../../../shared/design/views';
import type { TabHooks } from '../../tabs/registry';
import { store } from '../../state';
import { h, toast } from '../dom';
import { designApi } from './api';
import './design.css';

/** Text with `code` spans as <code>. */
const rich = (s: string): (string | HTMLElement)[] => s.split('`').map((part, i) => (i % 2 ? h('code', {}, part) : part));

export function designTab(container: HTMLElement): TabHooks {
  const root = h('div.dg-page');
  container.replaceChildren(root);
  let view: ProjectDesignView | undefined;
  let shown = false;
  let asking = 0;

  const admin = () => !!view?.admin && store.me.admin;
  const act = async (btn: HTMLButtonElement, body: Record<string, unknown>, done: string) => {
    btn.disabled = true;
    const r = await designApi.act({ floor: view?.floor, ...body });
    btn.disabled = false;
    if (r.error) return void toast(`Couldn’t: ${r.error}`, 'warn');
    toast(done);
    await load();
  };
  const button = (text: string, cls: string, body: Record<string, unknown>, done: string, title?: string) => {
    const b = h(`button.btn.${cls}`, { type: 'button', ...(title ? { title } : {}) }, text) as HTMLButtonElement;
    b.onclick = () => act(b, body, done);
    return b;
  };

  function head(v: ProjectDesignView): HTMLElement {
    const b = v.binding;
    const lines: (HTMLElement | null)[] = [h('h2', {}, 'Design gallery')];
    if (b) {
      lines.push(h('p', {}, h('strong', {}, bindingWords(b)), ` · ${b.preset} preset · adopted ${new Date(b.approval.at).toLocaleDateString()} by ${b.approval.by} (${b.approval.kind === 'wizard' ? 'at setup' : 'on the decision card'})`));
      lines.push(h('p.pf-hint', {}, `Started from ${startWords(b.start)}.${b.applied ? ` Theme ${b.themeName} applied with mxcli ${b.applied.mxcli ?? ''}${b.applied.branch ? ` on the branch ${b.applied.branch}, merged` : ''}.` : b.kind === 'atlas' ? ' Atlas defaults: no theme change.' : ''} Agents get one Design line and a guidance file with each task.`));
      for (const w of b.warnings ?? []) lines.push(h('p.pf-warn', {}, `⚠️ ${w}`));
    } else if (!v.proposal) lines.push(h('p.pf-hint', {}, 'No design system adopted: the project keeps its own styling, as before.'));
    else if (v.adoption) lines.push(h('p.pf-hint', {}, 'No design system adopted yet: agents keep the app’s current styling until the candidate below is merged.'));
    if (v.apply?.state === 'failed') lines.push(h('p.pf-warn', { role: 'alert' }, `⚠️ The last apply failed: ${v.apply.detail ?? ''}`));
    return h('div.dg-head', {}, ...lines.filter((x): x is HTMLElement => !!x));
  }

  /** An adoption that ran: failed at a stage (Retry / Discard) or a candidate on its branch, not merged yet. */
  function adoption(v: ProjectDesignView): HTMLElement | null {
    const a = v.adoption;
    if (!a) return null;
    const failed = a.status === 'failed';
    return h(
      'section.dg-card',
      { 'data-tone': failed ? 'warn' : '', 'data-adoption': a.status },
      h(failed ? 'p.pf-warn' : 'p', failed ? { role: 'alert' } : {}, `${failed ? '⚠️ ' : ''}${adoptionWords(a)}`),
      a.commit ? h('p.pf-hint', {}, `Candidate commit ${a.commit.slice(0, 7)} on ${a.branch}.${a.preserved ? ` The branch had ${a.preserved} commit${a.preserved === 1 ? '' : 's'} of its own: kept.` : ''}`) : null,
      admin() && a.status !== 'running' ? h('div.pf-acts.ds-bar', {}, failed ? button('Retry', 'primary', { action: 'adopt' }, 'Retried: see where it got to') : null, button('Discard', 'ph-outline', { action: 'keep' }, 'Discarded: the project’s design is as it was')) : null,
    );
  }

  function proposal(v: ProjectDesignView): HTMLElement | null {
    if (v.adoption && v.adoption.status !== 'running') return adoption(v);
    const p = v.proposal;
    if (p) {
      const s = p.scan;
      const items = [...s.overrides.map((o) => `${o.name} set in ${o.file}:${o.line} would be overridden by the theme`), ...s.custom.map((f) => `custom rules in ${f} stay, outside the theme’s blocks`), ...s.modules.map((m) => `theme module ${m} stays as it is`)];
      return h(
        'section.dg-card',
        { 'data-tone': 'warn' },
        h('strong', {}, `✋ Adopt ${p.name} v${p.n} in ${v.name}?`),
        h('p', {}, `The app starts from ${startWords(s.start)}.${items.length ? ' What would change:' : ' Nothing of its own would be overridden.'}`),
        items.length ? h('ul', {}, ...items.slice(0, 12).map((t) => h('li', {}, t))) : null,
        h('p.pf-hint', {}, 'Adopt applies the package with mxcli theme on a branch of its own and commits it there; the project is bound to it once that branch is merged. Keep existing design changes nothing.'),
        admin() ? h('div.pf-acts.ds-bar', {}, button(`Adopt ${p.name} v${p.n}`, 'primary', { action: 'adopt' }, 'Committed on its own branch: a candidate until it’s merged'), button('Keep existing design', 'ph-outline', { action: 'keep' }, 'Kept: nothing changed')) : null,
      );
    }
    const a = v.available;
    if (!a) return null;
    return h(
      'section.dg-card',
      {},
      h('strong', {}, `${a.name} v${a.n} is ${v.binding ? 'the client’s newer default' : 'available for this project'}`),
      h('p.pf-hint', {}, v.binding ? `This project stays on v${v.binding.n} until you choose otherwise.` : `Recommended for ${v.client?.label ?? 'this client'}. Adopting it is a decision: the app’s styling is scanned first and shown to you.`),
      admin() ? h('div.pf-acts', {}, button(v.binding ? `Propose v${a.n}` : 'Propose adoption', 'ph-outline', { action: 'propose', system: a.systemId, n: a.n }, 'Proposed: see the ✋ card')) : null,
    );
  }

  function patternCard(v: ProjectDesignView, p: Pattern): HTMLElement {
    const how = h('p.dg-how', {}, ...rich(p.states[0].how));
    const pills = p.states.map((s, i) => {
      const b = h('button.dg-state', { type: 'button', 'aria-pressed': i === 0 ? 'true' : 'false' }, s.label) as HTMLButtonElement;
      b.onclick = () => {
        for (const x of pills) x.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        how.replaceChildren(...rich(s.how));
      };
      return b;
    });
    const used = v.selections.filter((s) => s.patternId === p.id).map((s) => ('issue' in s.scope ? `#${s.scope.issue}` : 'page' in s.scope ? s.scope.page : 'whole project'));
    let use: HTMLElement | null = null;
    if (admin() && v.binding) {
      const where = h('input', { type: 'text', placeholder: 'Issue # or page', 'aria-label': `Use ${p.title} for (issue number or page name)` }) as HTMLInputElement;
      const behalf = h('input', { type: 'checkbox' }) as HTMLInputElement;
      const go = h('button.btn.ph-outline', { type: 'button' }, 'Use for') as HTMLButtonElement;
      go.onclick = () => {
        const w = where.value.trim().replace(/^#/, '');
        act(go, { action: 'select', pattern: p.id, ...(/^\d+$/.test(w) ? { issue: Number(w) } : w ? { page: w } : {}), behalf: behalf.checked }, `${p.title}: recorded for ${w ? (/^\d+$/.test(w) ? `#${w}` : w) : 'the whole project'}`);
      };
      use = h('div.dg-use', {}, go, where, h('label', {}, behalf, ' on behalf of the client'));
    }
    return h(
      'article.dg-pattern',
      { 'data-pattern': p.id },
      h('h4', {}, p.title),
      h('code', {}, `${p.id}@${p.version}`),
      h('p', {}, p.whenToUse),
      h('div.dg-states', { role: 'group', 'aria-label': 'States' }, ...pills),
      how,
      h('details', {}, h('summary', {}, 'Constraints and Mendix reference'), h('ul', {}, ...p.constraints.map((c) => h('li', {}, ...rich(c)))), h('p.pf-hint', {}, `Atlas: ${p.atlas.join(', ')}`), h('pre', {}, p.mdl), h('p.pf-hint', {}, PATTERN_VERIFIED)),
      used.length ? h('p.dg-used', {}, `Used here: ${used.join(', ')}`) : null,
      use,
    );
  }

  function shots(v: ProjectDesignView): HTMLElement {
    const now = v.binding ? pointerOf(v.binding) : 'none';
    const cap = admin() ? (h('button.btn.ph-outline', { type: 'button', disabled: !v.live.running, title: v.live.running ? 'Screenshots of the running live app, light and dark, at 1440 px' : 'Start the live app first: a capture never starts it' }, 'Capture now') as HTMLButtonElement) : null;
    if (cap) cap.onclick = () => act(cap, { action: 'capture' }, 'Captured');
    return h(
      'section.dg-sec',
      {},
      h('h3', {}, 'Runtime screenshots'),
      h('div.ds-bar', {}, cap, h('small.pf-hint', {}, v.live.running ? 'The live app is running.' : v.captures.length ? `The live app is ${v.live.status}: the screenshots below are history.` : `The live app is ${v.live.status}.`)),
      v.captures.length
        ? h('div.dg-shots', {}, ...v.captures.slice(0, 12).map((c) => h('figure.dg-shot', { 'data-old': String(!v.live.running || c.design !== now) }, h('img', { src: designApi.captureUrl(v.floor, c.id), alt: `The app, ${c.scheme}, ${c.viewport.width} px`, loading: 'lazy' }), h('figcaption', {}, `${new Date(c.at).toLocaleString()} · ${c.viewport.width}×${c.viewport.height} ${c.scheme}${c.appSha ? ` · ${c.appSha.slice(0, 7)}` : ''} · ${c.design === 'none' ? 'no design system' : c.design}${!v.live.running || c.design !== now ? ' · history' : ''}`))))
        : h('p.pf-hint', {}, v.live.running ? 'No screenshots yet: Capture now takes the first.' : 'No screenshots yet. Start the live app (Live app tab), then Capture now.'),
    );
  }

  function draw() {
    if (!view) return void root.replaceChildren(h('p.pf-hint', {}, 'Asking the office…'));
    const v = view;
    root.replaceChildren(
      ...[
        head(v),
        proposal(v),
        h('section.dg-sec', {}, h('h3', {}, 'Patterns (administration)'), h('p.pf-hint', {}, v.binding ? '“Use for” records which pattern a page or an issue uses: its task then gets that pattern’s guidance. Nothing in the app changes, and no model is asked.' : `These are the patterns a design system brings. Adopt one to record choices.${v.binding ? '' : ` (${KEEP_WORDS} is the default.)`}`), h('div.dg-patterns', {}, ...PATTERNS.map((p) => patternCard(v, p)))),
        shots(v),
      ].filter((x): x is HTMLElement => !!x),
    );
  }

  async function load() {
    const floor = store.floor;
    if (!floor) return;
    const n = ++asking;
    try {
      const v = await designApi.project(floor);
      if (n !== asking || floor !== store.floor) return;
      view = v;
    } catch (err) {
      root.replaceChildren(h('p.pf-warn', {}, `Couldn’t ask the office: ${(err as Error).message}`));
      return;
    }
    if (shown) draw();
  }

  return {
    show: () => {
      shown = true;
      draw();
      void load();
    },
    hide: () => {
      shown = false;
    },
    refresh: () => {
      view = undefined;
      draw();
      void load();
    },
  };
}
