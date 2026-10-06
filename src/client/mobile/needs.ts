// What the phone version's buttons do on a Needs-you item and in the Status tab: answer an escalation
// (approving a merge-order one is risky), open a PR on GitHub or merge it there (risky), raise the
// floor's cap (risky), hire a role (risky), and what can only be done on a computer. Risky ones go
// through confirm.ts: a second tap and a fresh sign-in.

import { isRisky, type ProjectStatus } from '../../shared/mobile';
import { ROLE_BY_ID } from '../../shared/roster/roles';
import type { ApprovalItem, RosterView } from '../../shared/roster/types';
import { store } from '../state';
import { h, openModal, toast } from '../ui/dom';
import type { NeedTarget } from '../ui/needsyou/logic';
import { settingsHref } from '../../shared/settings-sections';
import { act } from './confirm';

/** Approve or reject an escalation from the phone (a reason is asked for a rejection). */
export async function answerEscalation(floor: string, id: string, verdict: 'approve' | 'reject', roster: RosterView | undefined): Promise<boolean> {
  const esc = roster?.escalations.find((e) => e.id === id);
  let text = '';
  if (verdict === 'reject') {
    text = window.prompt('Why is it rejected? (the agent is told)')?.trim() ?? '';
    if (!text) return false;
  }
  const risky = esc && isRisky({ do: 'escalation', verdict }, esc);
  const r = await act(
    { do: 'escalation', floor, escalation: id, verdict, ...(text ? { text } : {}) },
    risky ? { title: 'Approve this merge decision?', detail: `${esc!.by} asked: “${esc!.title}”${esc!.recommendation ? ` They recommend: ${esc!.recommendation}.` : ''} Approving lets them go ahead, and code lands on the default branch.`, label: 'Approve' } : undefined,
  );
  return !!r;
}

/** Opening a PR on GitHub, to read it or to merge it there (merging is risky: confirmed first). */
export function prSheet(floor: string, number: number) {
  const pr = store.pulls.items.find((p) => p.number === number);
  if (!pr) return void toast(`PR #${number} isn’t in the list here any more`, 'warn');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const merge = h('button.btn.primary.m-danger', { type: 'button' }, '🔀 Merge…');
  const modal = openModal(
    h(
      'div.modal.m-sheet',
      { role: 'dialog', 'aria-label': `PR #${number}` },
      h('header', {}, h('h2', {}, `PR #${pr.number}`), close),
      h(
        'div.body',
        {},
        h('p', {}, h('b', {}, pr.title)),
        h('p.m-dim', {}, `${pr.author ?? 'someone'} · ${pr.headRefName ?? ''}${pr.checks ? ` · checks ${pr.checks}` : ''}${pr.isDraft ? ' · draft' : ''}`),
        pr.checks === 'fail' ? h('p.m-warn', {}, '❌ Its checks fail: merging it now is probably not what you want.') : null,
      ),
      h('footer', {}, h('a.btn', { href: pr.url, target: '_blank', rel: 'noopener' }, 'Open PR on GitHub'), merge),
    ),
    { doing: '📱 looking at a PR' },
  );
  close.addEventListener('click', () => modal.close());
  merge.addEventListener('click', async () => {
    modal.close();
    await mergePr(floor, number, pr.title);
  });
}

/** The Merge link: confirmed and re-authenticated, then GitHub's page for the PR, where it's merged. */
export async function mergePr(floor: string, number: number, title: string) {
  // Opened before the request finishes, so Safari doesn't take it for a pop-up.
  const r = await act({ do: 'merge', floor, number }, { title: `Merge PR #${number}?`, detail: `“${title}” opens on GitHub, signed in as you, to merge it there. Its code lands on the default branch and the agents build on it.`, label: `Merge PR #${number}` });
  if (r?.url) window.location.assign(r.url);
}

/** Raise the floor's daily team cap: how much, then confirmed. */
export async function raiseCap(p: Pick<ProjectStatus, 'floor' | 'name' | 'spend'>) {
  const cap = p.spend?.cap;
  const spent = p.spend?.usd ?? 0;
  const raw = window.prompt(`${p.name}: spent $${spent.toFixed(2)} today${cap ? ` of a $${cap.toFixed(2)} cap` : ''}. New daily cap in dollars:`, String(Math.ceil(Math.max(cap ?? 0, spent) * 1.5) || 20));
  if (raw === null) return;
  const amount = Number(raw.replace(/[$,\s]/g, ''));
  if (!(amount > 0)) return void toast('A cap in dollars, more than 0', 'warn');
  await act({ do: 'raise-cap', floor: p.floor, amount }, { title: `Raise the cap to $${amount.toFixed(2)}?`, detail: `${p.name}'s agents may spend up to $${amount.toFixed(2)} today${cap ? ` (now $${cap.toFixed(2)})` : ''}. Office prompts start again once the spend is under it.`, label: `Raise to $${amount.toFixed(2)}` });
}

/** Hire one of the roles nobody fills: pick it, then confirmed. */
export function hireSheet(floor: string, roster: RosterView) {
  const open = roster.members.filter((m) => m.status === 'not-hired' || m.status === 'benched');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const modal = openModal(
    h(
      'div.modal.m-sheet',
      { role: 'dialog', 'aria-label': 'Hire' },
      h('header', {}, h('h2', {}, '➕ Hire'), close),
      h(
        'div.body',
        {},
        roster.paused ? h('p.m-warn', {}, `💸 ${roster.paused}`) : null,
        h(
          'ul.m-roles',
          {},
          ...open.map((m) =>
            h(
              'li',
              {},
              h('button.btn', {
                type: 'button',
                onclick: async () => {
                  modal.close();
                  const role = ROLE_BY_ID.get(m.role);
                  await act({ do: 'hire', floor, role: m.role }, { title: `Hire the ${role?.title ?? m.title}?`, detail: `${m.name} starts work on this floor${m.status === 'benched' ? ' again, from its handoff note' : ''}: it takes turns, and they cost money.`, label: `Hire ${m.name}` });
                },
              }, `${m.icon} ${m.title}`, h('small.m-dim', {}, ` ${m.status === 'benched' ? 'benched' : 'not hired'}`)),
            ),
          ),
        ),
      ),
    ),
    { doing: '📱 hiring' },
  );
  close.addEventListener('click', () => modal.close());
}

/** The roster's merges waiting on you (at levels where merges need the PM) and a cap reached: Needs you's own rows. */
export function approvalRows(floor: string, roster: RosterView | undefined, status: ProjectStatus | undefined): HTMLElement[] {
  if (!roster?.admin) return [];
  const rows: HTMLElement[] = [];
  for (const a of roster.approvals.filter((x): x is ApprovalItem & { url: string } => x.kind === 'merge' && !!x.url)) {
    const n = Number(a.id.replace(/^m-/, ''));
    rows.push(h('li.m-row.m-appr', {}, h('span.m-row-ico', { 'aria-hidden': 'true' }, '🔀'), h('div.m-row-main', {}, h('b', {}, a.title), h('small.m-dim', {}, a.detail)), h('button.btn.small.m-danger', { type: 'button', onclick: () => void mergePr(floor, n, a.title) }, 'Merge…')));
  }
  if (roster.paused) rows.push(h('li.m-row.m-appr', {}, h('span.m-row-ico', { 'aria-hidden': 'true' }, '💸'), h('div.m-row-main', {}, h('b', {}, 'Spend cap reached'), h('small.m-dim', {}, roster.paused)), h('button.btn.small', { type: 'button', onclick: () => void raiseCap({ floor, name: store.floors.find((f) => f.id === floor)?.name ?? floor, spend: status?.spend ?? { usd: roster.spentToday, ...(roster.cap ? { cap: roster.cap } : {}) } }) }, 'Raise cap…')));
  return rows;
}

/** Targets the phone can't open itself: they wait for a computer (the 1D view's tab for it, or its ⚙️ Settings section). */
export function onComputer(t: NeedTarget, floor: string) {
  if (t.to === 'settings') return void toast(`That one is on a computer: ${settingsHref(t.section ?? 'team', floor)}`);
  const tab = t.to === 'setup' ? 'command' : t.to === 'live' ? 'live' : t.to === 'git' ? 'git' : 'command';
  toast(`That one is on a computer: /lite?floor=${floor}&tab=${tab}`);
}
