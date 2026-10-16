// The sign-off dialog for a ✋ MANUAL toolkit stage in play (shared/gate-play.ts, server/signoff/): what
// signing it off means, what the lead is told ("Signed off: Stage N" and the exact CONFIRMED row for
// PROJECT.md's Decisions), and two buttons: Sign off, or Not yet. Nothing is sent until Sign off is
// pressed. Its ✕ or Esc gives focus back to the button that opened it (openModal).

import type { SetupView } from '../../../shared/wizard';
import { signoffMeaning, signoffRow, signoffState } from '../../../shared/gate-play';
import { store } from '../../state';
import { h, openModal, timeAgo, toast } from '../dom';
import { cachedSetup } from '../setup-panel';
import { currentRoster } from '../teams/world';
import { leadOf } from '../lead-panel/logic';
import './signoff.css';

export interface SignoffDeps {
  floor: string | undefined;
  /** The setup view as last fetched (its decision rows and the sign-offs already given). */
  setup?: SetupView;
  /** The lead's name, for the words. */
  lead?: string;
  /** May sign off (the Project Manager, an admin). */
  admin: boolean;
  /** After a sign-off went: the setup and Needs you fetched again. */
  done?(): void;
  /** POST, for tests. */
  post?(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }>;
}

async function postSignoff(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch('/api/signoff', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  const out = ((await res?.json().catch(() => ({}))) ?? {}) as { ok?: boolean; error?: string };
  if (!res?.ok) out.error ??= 'the office could not be reached';
  return out;
}

/** Opens the dialog for `stage`. Returns the dialog element (tests press its buttons). */
export function openSignoff(t: { stage: string; title: string }, deps: SignoffDeps): HTMLElement {
  const back = document.activeElement as HTMLElement | null;
  const lead = deps.lead ?? 'the team lead';
  const me = store.me.account?.name ?? store.profile.name ?? 'The Project Manager';
  const st = signoffState(deps.setup, t.stage);
  const status = h('p.so-msg', { role: 'status', 'aria-live': 'polite' });
  const signBtn = h('button.btn.primary.so-sign', { type: 'button', disabled: !deps.admin || !deps.floor || st.state === 'recorded' }, st.state === 'requested' ? `Sign off Stage ${t.stage} again` : `Sign off Stage ${t.stage}`) as HTMLButtonElement;
  const notYet = h('button.btn.so-later', { type: 'button' }, 'Not yet') as HTMLButtonElement;
  const content = h(
    'div.modal.so-modal',
    { role: 'dialog', 'aria-label': `Sign off Stage ${t.stage} (${t.title})` },
    h('header', {}, h('h2', {}, `Sign off Stage ${t.stage} (${t.title})?`)),
    h(
      'div.body',
      {},
      h('p', {}, signoffMeaning(t.stage, t.title)),
      h('p', {}, `What happens: ${lead} is told, after their current turn, “Signed off: Stage ${t.stage} (${t.title})” and asked to add this row to PROJECT.md’s Decisions in their next docs pull request:`),
      h('pre.so-row', { tabindex: 0, 'aria-label': 'The Decisions row' }, signoffRow(t.stage, t.title, me, new Date().toISOString().slice(0, 10))),
      h('p.so-small', {}, 'The office never edits PROJECT.md itself. Until the row is there, Needs you says the sign-off waits for the lead; once it is, the card goes. If the stage isn’t really done, the lead escalates instead of recording it.'),
      st.state === 'requested' ? h('p.so-small', {}, `You signed it off ${timeAgo(st.req.at)}; ${st.req.lead ?? lead} hasn’t recorded it yet. Signing off again sends it again.`) : null,
      st.state === 'recorded' ? h('p.so-small', {}, 'PROJECT.md already has the CONFIRMED row: nothing to do.') : null,
      !deps.admin ? h('p.so-small', {}, 'Only the Project Manager (an admin) can sign off a stage.') : null,
      status,
    ),
    h('footer', {}, notYet, signBtn),
  );
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  notYet.addEventListener('click', () => modal.close());
  signBtn.addEventListener('click', () => void sign());
  (deps.admin ? signBtn : notYet).focus();
  async function sign() {
    if (!deps.floor) return;
    signBtn.disabled = notYet.disabled = true;
    status.textContent = 'Sending…';
    const out = await (deps.post ?? postSignoff)({ floor: deps.floor, stage: t.stage });
    if (!out.ok) {
      signBtn.disabled = notYet.disabled = false;
      status.textContent = `Not signed off: ${out.error ?? 'something went wrong'}`;
      return;
    }
    modal.close();
    toast(`Signed off Stage ${t.stage}: ${lead} records it after their current turn`);
    deps.done?.();
  }
  return content;
}

/** The Needs-you button's way in (lite.ts goToNeed): the floor, its setup, its lead and whether you're an admin, as the page has them. */
export function goSignoff(t: { stage: string; title: string }, done: () => void): HTMLElement {
  const floor = store.floor ?? undefined;
  const r = currentRoster();
  const lead = leadOf(r?.floor === floor ? r : undefined);
  return openSignoff(t, { floor, setup: cachedSetup(floor), lead: lead && lead.kind === 'lead' ? lead.name : undefined, admin: !!(r?.floor === floor && r?.admin), done });
}
