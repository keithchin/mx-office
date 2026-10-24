// 🔐 Security (/lite?tab=security): the project's security baseline (server/security-gate/, rules in
// shared/security.ts). Three cards: what the office read of the app's security at main's head (level,
// strict mode, demo users, anonymous access, password length, entities without access rules), the last
// `mx check` with the commit it ran at, and the baseline: the policy, and what signing off the build plan,
// the build, and accepting a delivery need now (meets, or missing: …). For admins: Run mx check and the
// policy's editor. It never says "secure": only what was read, and when, at which commit. Asked when shown,
// every few seconds while an mx check runs, now and then otherwise; nothing while it's hidden.

import { LEVEL_WORDS, policyWords, type GateResult, type SecurityPolicy, type SecurityView } from '../../../shared/security';
import { store } from '../../state';
import type { TabHooks } from '../../tabs/registry';
import { h, timeAgo, toast } from '../dom';
import './security.css';
import { protectionCard } from '../merge-gate/protection-card';

const BUSY_MS = 4000;
const IDLE_MS = 30_000;
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

export async function loadSecurity(floor: string): Promise<SecurityView | undefined> {
  try {
    const res = await fetch(`/api/security?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as SecurityView) : undefined;
  } catch {
    return undefined;
  }
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch('/api/security', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) {
      toast(out.error ?? `HTTP ${res.status}`, 'warn');
      return undefined;
    }
    return out;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

type Tone = 'good' | 'bad' | 'warn' | 'none';
const row = (label: string, value: string, tone: Tone = 'none', title?: string) => h('div.sec-row', {}, h('dt', {}, label), h('dd', { class: `sec-${tone}`, ...(title ? { title } : {}) }, value));

/** The card of what was read at main. */
function stateCard(v: SecurityView): HTMLElement {
  const s = v.state;
  const head = h('h3', {}, 'App security', v.main ? h('span.sec-at', {}, ` at main @${short(v.main.commit)}`) : null);
  if (!v.main) return h('section.sec-card', { 'aria-label': 'App security' }, head, h('p.sec-muted', {}, 'Not read yet: the project has no main branch.'));
  if (v.noApp) return h('section.sec-card', { 'aria-label': 'App security' }, head, h('p.sec-muted', {}, 'No Mendix app (.mpr) at this commit: nothing to read yet.'));
  if (!s) return h('section.sec-card', { 'aria-label': 'App security' }, head, h('p.sec-muted', {}, `Not read yet${v.stateWhy ? `: ${v.stateWhy}` : '.'}`));
  const lvl = s.level ? LEVEL_WORDS[s.level] : 'Not read';
  const dl = h(
    'dl.sec-list',
    {},
    row('Security level', lvl, s.level === 'production' ? 'good' : s.level ? 'bad' : 'none'),
    row('Strict mode', s.strict === undefined ? 'Not read' : s.strict ? 'On' : 'Off', s.strict ? 'good' : s.strict === false ? 'warn' : 'none', 'Strict mode enforces XPath constraints on client requests; it disables the mx.data.* client APIs, so widgets that use them need vetting'),
    row('Demo users', s.demoUsers ? `${s.demoUsers.enabled ? 'On' : 'Off'}${s.demoUsers.count !== undefined ? ` (${s.demoUsers.count} defined)` : ''}` : 'Not read', s.demoUsers?.enabled ? 'warn' : s.demoUsers ? 'good' : 'none'),
    row('Anonymous access', s.guest ? (s.guest.enabled ? `On${s.guest.role ? ` (role ${s.guest.role})` : ''}` : 'Off') : 'Not read', s.guest?.enabled ? 'warn' : 'none'),
    row('Password minimum length', s.passwordMinLength !== undefined ? String(s.passwordMinLength) : 'Not read', s.passwordMinLength !== undefined && s.passwordMinLength < 8 ? 'warn' : 'none'),
    row('User roles', s.userRoles !== undefined ? String(s.userRoles) : 'Not read'),
    row('Entities without access rules', s.entities ? `${s.entities.withoutRules} of ${s.entities.total} persistable${s.entities.sample.length ? ` (${s.entities.sample.join(', ')}${s.entities.withoutRules > s.entities.sample.length ? ', …' : ''})` : ''}` : 'Not read', s.entities ? (s.entities.withoutRules ? 'bad' : 'good') : 'none'),
  );
  return h('section.sec-card', { 'aria-label': 'App security' }, head, dl, h('p.sec-muted', {}, `Read ${s.source === 'model' ? "from the model's units in git" : 'with mxcli (show project security)'} at ${short(s.commit)}, ${timeAgo(s.readAt)}. What the model says is set, not a verdict that the app is secure. Pages and microflows' allowed roles aren't read here: mxcli lint (MPR007) checks those.`));
}

/** The card of the last mx check. */
function checkCard(v: SecurityView, run: (() => void) | undefined): HTMLElement {
  const c = v.check;
  const running = v.running;
  const head = h('h3', {}, 'Mendix check (mx check)');
  const body: (HTMLElement | null)[] = [];
  if (running) body.push(h('p.sec-running', { role: 'status' }, `Running at @${short(running.commit)} since ${timeAgo(running.since)}…`));
  if (!c) body.push(h('p.sec-muted', {}, 'Not run yet on this project.'));
  else {
    const stale = v.main && c.commit !== v.main.commit;
    const pill = c.status === 'pass' ? h('span.sec-pill.good', {}, '0 errors') : c.status === 'fail' ? h('span.sec-pill.bad', {}, `${c.errors} error${c.errors === 1 ? '' : 's'}`) : h('span.sec-pill.warn', {}, 'Didn’t finish');
    body.push(h('p.sec-check', {}, pill, ` at @${short(c.commit)}`, stale ? h('span.sec-stale', {}, ` (not main’s head @${short(v.main!.commit)}: run it again for this commit)`) : null, `, ${timeAgo(c.at)}, by ${c.by}, ${secs(c.ms)}`));
    if (c.codes?.length) body.push(h('p.sec-muted', {}, `Codes: ${c.codes.slice(0, 6).map((x) => `${x.code} ×${x.count}`).join(', ')}`));
    if (c.first?.length) body.push(h('ul.sec-errors', { 'aria-label': 'First errors' }, ...c.first.map((l) => h('li', {}, l))));
    if (c.why) body.push(h('p.sec-muted', {}, c.why));
    if (c.tool) body.push(h('p.sec-muted', {}, c.tool));
  }
  body.push(h('p.sec-muted', {}, "Mendix's own checker (through mxcli docker check), in the office's own copy of the app at that commit. Not mxcli check, which only checks an MDL script."));
  if (run && v.main && !v.noApp) body.push(h('div.sec-actions', {}, h('button.btn.primary', { type: 'button', disabled: !!running, onclick: run }, running ? 'Running…' : `Run mx check on main @${short(v.main.commit)}`)));
  return h('section.sec-card', { 'aria-label': 'Mendix check' }, head, ...body);
}

/** One gate's line: meets, or missing with each reason. */
export function gateBlock(title: string, applies: string, g: GateResult): HTMLElement {
  const state = g.meets ? h('span.sec-pill.good', {}, 'Meets the baseline') : h('span.sec-pill', { class: g.enforced ? 'bad' : 'warn' }, g.enforced ? 'Would be refused' : 'Not met (advisory)');
  return h(
    'div',
    { class: `sec-gate ${g.meets ? 'meets' : 'missing'}`, 'data-point': g.point },
    h('h4', {}, title, ' ', state),
    h('p.sec-muted', {}, applies),
    g.missing.length ? h('div.sec-missing', {}, h('b', {}, 'Missing: '), h('ul', {}, ...g.missing.map((m) => h('li', {}, m)))) : null,
    g.flags.length ? h('div.sec-flags', {}, h('b', {}, 'Flagged: '), h('ul', {}, ...g.flags.map((m) => h('li', {}, m)))) : null,
  );
}

/** The policy's editor (admins). */
function policyEditor(p: SecurityPolicy, save: (p: SecurityPolicy) => void): HTMLElement {
  const level = h('select', { 'aria-label': 'Security level policy' }, h('option', { value: 'production' }, 'Production before the build (default)'), h('option', { value: 'prototype' }, 'Prototype only (a spike)')) as HTMLSelectElement;
  level.value = p.level;
  const strict = h('select', { 'aria-label': 'Strict mode policy' }, h('option', { value: 'recommended' }, 'Strict mode recommended (default)'), h('option', { value: 'required' }, 'Strict mode required')) as HTMLSelectElement;
  strict.value = p.strict;
  const enforce = h('input', { type: 'checkbox', 'aria-label': 'Refuse sign-offs and acceptance that don’t meet it' }) as HTMLInputElement;
  enforce.checked = p.enforce;
  const reason = h('input.sec-reason', { type: 'text', placeholder: 'Why (needed for a prototype or advisory policy)', maxlength: '400', 'aria-label': 'Reason' }) as HTMLInputElement;
  reason.value = p.reason ?? '';
  return h(
    'details.sec-policy',
    {},
    h('summary', {}, 'Change the policy'),
    h('div.sec-form', {}, level, strict, h('label.sec-check-label', {}, enforce, ' Refuse sign-offs and acceptance that don’t meet it'), reason, h('button.btn', { type: 'button', onclick: () => save({ level: level.value === 'prototype' ? 'prototype' : 'production', strict: strict.value === 'required' ? 'required' : 'recommended', enforce: enforce.checked, ...(reason.value.trim() ? { reason: reason.value.trim() } : {}) }) }, 'Save policy')),
  );
}

/** The baseline card: the policy and the two gates. */
function baselineCard(v: SecurityView, save: ((p: SecurityPolicy) => void) | undefined): HTMLElement {
  const p = v.policy;
  return h(
    'section.sec-card.sec-baseline',
    { 'aria-label': 'Security baseline' },
    h('h3', {}, 'Baseline', ' ', h('span.sec-pill', { class: p.enforce ? 'info' : 'warn' }, p.enforce ? 'Checked by the office' : 'Advisory only')),
    h('p', {}, policyWords(p)),
    p.by ? h('p.sec-muted', {}, `Set by ${p.by}${p.at ? `, ${timeAgo(p.at)}` : ''}${p.reason ? `: ${p.reason}` : ''}`) : h('p.sec-muted', {}, 'The default policy for new projects.'),
    gateBlock('Before the build', 'Signing off Stage 4 (Build Plan), so the build starts.', v.gates.build),
    gateBlock('Build done and delivery', 'Signing off Stage 5 (Build), 6 or 7, and ✅ Accept of a delivery: also a clean mx check at that commit.', v.gates.release),
    save ? policyEditor(p, save) : null,
  );
}

/** The whole page's content for `v` (pure apart from the DOM; the tests draw it). */
export function securityContent(v: SecurityView, act: { run?: () => void; save?: (p: SecurityPolicy) => void } = {}): HTMLElement {
  return h(
    'div.sec-page',
    {},
    h('p.sec-lead', {}, 'What the office read of the app’s security at main, the last Mendix check, and what the project’s baseline needs before the build and before a delivery is accepted. It reports what is set; it never says the app is secure.'),
    h('div.sec-grid', {}, stateCard(v), checkCard(v, v.admin ? act.run : undefined), baselineCard(v, v.admin ? act.save : undefined)),
  );
}

/** The page in `container`; `floorOf` says which project the 1D view is on (the store's, but for tests). */
export function securityPage(container: HTMLElement, floorOf: () => string = () => store.floor ?? ''): TabHooks {
  const el = h('section.secp', { 'aria-label': 'Security' });
  container.replaceChildren(el);
  let view: SecurityView | undefined;
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  // The review enforcement card (ui/merge-gate/protection-card.ts): made once per project, so a repaint doesn't ask GitHub again.
  let enforcement: { floor: string; el: HTMLElement } | undefined;

  const draw = () => {
    if (!view) return void el.replaceChildren(h('p.sec-muted', {}, 'Loading…'));
    const floor = view.floor;
    if (enforcement?.floor !== floor) enforcement = { floor, el: protectionCard(floor) };
    el.replaceChildren(
      securityContent(view, {
        run: () => void post({ floor, action: 'check' }).then((o) => o && (toast('mx check started: it takes a few minutes'), load())),
        save: (p) => void post({ floor, action: 'policy', policy: p }).then((o) => o && (toast('Security policy saved'), load())),
      }),
      enforcement.el,
    );
  };

  async function load() {
    const f = floorOf();
    clearTimeout(timer);
    if (!f) {
      if (shown) timer = setTimeout(() => void load(), 500);
      return;
    }
    if (loading) return;
    loading = true;
    try {
      const v = await loadSecurity(f);
      if (v && v.floor === floorOf()) {
        view = v;
        draw();
      }
    } finally {
      loading = false;
      if (shown) timer = setTimeout(() => void load(), view?.running ? BUSY_MS : IDLE_MS);
    }
  }

  draw();
  return {
    show: () => {
      shown = true;
      void load();
    },
    hide: () => {
      shown = false;
      clearTimeout(timer);
    },
    refresh: () => {
      view = undefined;
      draw();
      void load();
    },
  };
}
