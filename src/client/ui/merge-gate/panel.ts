// The merge gate in the PR window (server/merge-gate/, GET /api/merge-gate): the review status of the PR's
// current head (Reviewed ✓ by X at abc1234 / Changes requested / Stale: changed since review / Not
// reviewed), whether the office's Merge button would merge it and why not, and whether GitHub protects the
// base branch with the mx-office/review status (if not, the gate is only advisory for an agent's own gh).
// "Reviewed and approved this revision" and "Request changes" record your review of exactly that head,
// with your password typed again. In the merge dialog it holds the Merge button back with the reason, and
// an admin can override it with a typed reason (audited).

import './panel.css';
import type { MergeGateView, ReviewRecord } from '../../../shared/merge-gate';
import { short, VERDICT_WORDS } from '../../../shared/merge-gate';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../dom';

const ICON: Record<MergeGateView['review']['state'], string> = { reviewed: '✅', changes: '✋', stale: '⏳', none: '⚪' };
const CLS: Record<MergeGateView['review']['state'], string> = { reviewed: 'ok', changes: 'bad', stale: 'warn', none: 'muted' };
const PROTECT_ICON: Record<NonNullable<MergeGateView['protection']>['state'], string> = { 'requires-gate': '🔒', protected: '⚠️', unprotected: '⚠️', unknown: '❔' };
const SOURCE: Record<ReviewRecord['source'], string> = { 'agent-comment': 'Review comment', 'github-review': 'GitHub review', office: 'in the office' };

export async function fetchGate(pr: number): Promise<MergeGateView> {
  const floor = store.floor ?? '';
  const r = await fetch(`/api/merge-gate?floor=${encodeURIComponent(floor)}&pr=${pr}`, { credentials: 'same-origin' });
  const b = (await r.json().catch(() => null)) as (MergeGateView & { error?: string }) | null;
  if (!r.ok || !b) throw new Error(b?.error ?? `The office said ${r.status}`);
  return b;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string; view?: MergeGateView }> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const b = (await r.json().catch(() => null)) as { error?: string; view?: MergeGateView } | null;
  return r.ok ? { ok: true, view: b?.view } : { ok: false, error: b?.error ?? `The office said ${r.status}` };
}

/** The review state, the merge decision and the protection, as lines. */
export function gateLines(v: MergeGateView, opts: { merge?: boolean } = {}): HTMLElement[] {
  const rec = v.review.record;
  const lines: HTMLElement[] = [
    h('div.mg-state', { class: CLS[v.review.state] }, h('span', { 'aria-hidden': 'true' }, ICON[v.review.state]), h('b', {}, v.review.text), rec ? h('small', {}, ` · ${timeAgo(rec.at)} · ${SOURCE[rec.source]}`) : null),
  ];
  if (v.state === 'OPEN' && opts.merge !== false) lines.push(h('div.mg-merge', { class: v.decision.allowed ? 'ok' : 'bad' }, h('span', { 'aria-hidden': 'true' }, v.decision.allowed ? '🔀' : '🚫'), v.decision.allowed ? `The office’s Merge would go ahead: ${v.decision.reason}` : v.decision.reason));
  if (v.protection) lines.push(h('div.mg-protect', { class: v.protection.state }, h('span', { 'aria-hidden': 'true' }, PROTECT_ICON[v.protection.state]), v.protection.text));
  return lines;
}

function historyOf(v: MergeGateView): HTMLElement | null {
  if (!v.history.length && !v.overrides.length && !v.review.refused.length) return null;
  const rows = [
    ...v.history.map((r) => h('li', {}, h('b', {}, VERDICT_WORDS[r.verdict]), ` by ${r.reviewer.name}${r.reviewer.role ? ` (${r.reviewer.role})` : ''} at `, h('code', {}, short(r.sha)), ` · ${timeAgo(r.at)} · ${SOURCE[r.source]}${r.shaFrom === 'inferred' ? ' (commit inferred from its time)' : ''}${r.note ? ` · “${r.note}”` : ''}`)),
    ...v.overrides.map((o) => h('li.mg-over', {}, h('b', {}, 'Override'), ` by ${o.by.name} at `, h('code', {}, short(o.sha)), ` · ${timeAgo(o.at)} · “${o.reason}”`)),
    ...v.review.refused.map((x) => h('li.mg-refused', {}, h('b', {}, 'Not counted'), ` ${x.who}: ${x.why}`)),
  ];
  return h('details.mg-history', {}, h('summary', {}, `History (${v.history.length + v.overrides.length})`), h('ul', {}, ...rows));
}

/** The PR window's panel: the head's review status, and your review buttons. */
export function reviewGatePanel(pr: number): HTMLElement {
  const root = h('section.mg', { 'aria-label': 'Review gate' });
  const draw = (v: MergeGateView) => {
    const canReview = (v.state === 'OPEN' || v.state === 'MERGED') && v.review.state !== 'reviewed';
    const approve = h('button.btn.primary', { type: 'button' }, v.state === 'MERGED' ? `✅ Reviewed and approved the merged revision ${short(v.head)}` : `✅ Reviewed and approved this revision (${short(v.head)})`);
    const changes = h('button.btn', { type: 'button' }, '✋ Request changes');
    approve.addEventListener('click', () => reviewDialog(v, 'approve', approve, draw));
    changes.addEventListener('click', () => reviewDialog(v, 'changes', changes, draw));
    root.replaceChildren(
      h('div.mg-head', {}, h('span.mg-label', {}, '🛡️ Review gate'), h('code', { title: v.head }, short(v.head)), v.authors.length ? h('small', {}, `authored by ${v.authors.join(', ')}`) : null),
      ...gateLines(v),
      canReview ? h('div.mg-acts', {}, v.personReviews ? h('small', {}, 'No other agent on this team can review it: you are the reviewer. ') : '', changes, approve) : '',
      historyOf(v) ?? '',
    );
  };
  root.append(h('div.mg-head', {}, h('span.mg-label', {}, '🛡️ Review gate'), h('span.spinner')));
  fetchGate(pr)
    .then(draw)
    .catch((err) => root.replaceChildren(h('div.mg-head', {}, h('span.mg-label', {}, '🛡️ Review gate')), h('div.mg-state.muted', {}, `Couldn’t check: ${(err as Error).message}`)));
  return root;
}

/** Your review of exactly this head, with your password typed again. */
function reviewDialog(v: MergeGateView, verdict: 'approve' | 'changes', from: HTMLElement, done: (v: MergeGateView) => void) {
  const pw = h('input.mg-pw', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' }) as HTMLInputElement;
  const note = h('textarea.mg-note', { rows: 3, placeholder: verdict === 'approve' ? 'What you checked (optional)' : 'What needs to change', 'aria-label': 'Note' }) as HTMLTextAreaElement;
  const err = h('p.mg-err', { role: 'alert' });
  const go = h('button.btn.primary', { type: 'submit' }, verdict === 'approve' ? '✅ Approve this revision' : '✋ Request changes');
  const form = h(
    'form.modal.mg-modal',
    { role: 'dialog', 'aria-label': verdict === 'approve' ? `Approve PR #${v.pr} at ${short(v.head)}` : `Request changes on PR #${v.pr}` },
    h('header', {}, h('h2', {}, verdict === 'approve' ? `✅ Approve PR #${v.pr} at ${short(v.head)}` : `✋ Request changes on PR #${v.pr}`)),
    h(
      'div.body',
      {},
      h('p', {}, `This records that you reviewed exactly commit `, h('code', {}, short(v.head)), verdict === 'approve' ? '. It counts for that revision only: a later commit makes it stale and needs a new review.' : '. It blocks the office’s Merge for this revision until it is reviewed again.'),
      v.authors.length ? h('p.mg-small', {}, `Authored by ${v.authors.join(', ')}. Your review is recorded under your office sign-in, not a GitHub account.`) : null,
      note,
      h('label.mg-small', {}, 'Type your password again to sign it'),
      pw,
      err,
    ),
    h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), go),
  );
  const modal = openModal(form, { doing: `reviewing PR #${v.pr}`, onClose: () => from.focus() });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.value) return pw.focus();
    if (verdict === 'changes' && !note.value.trim()) return note.focus();
    go.disabled = true;
    err.textContent = '';
    try {
      const auth = await post('/api/m/reauth', { password: pw.value });
      if (!auth.ok) {
        err.textContent = auth.error ?? 'Wrong password';
        pw.select();
        return;
      }
      const r = await post('/api/merge-gate/review', { floor: store.floor, pr: v.pr, sha: v.head, verdict, note: note.value.trim() || undefined });
      if (!r.ok) {
        err.textContent = r.error ?? 'Not recorded';
        return;
      }
      modal.close();
      if (r.view) done(r.view);
    } catch (x) {
      err.textContent = (x as Error).message;
    } finally {
      go.disabled = false;
    }
  });
  setTimeout(() => (verdict === 'changes' ? note : pw).focus(), 30);
}

/** The merge dialog's gate box: holds `go` back until the gate allows it, with the reason; an admin can override. */
export function mergeGateBox(pr: number, allow: (ok: boolean) => void): HTMLElement {
  const root = h('div.mg.mg-inmerge', {}, h('div.mg-state.muted', {}, h('span.spinner'), 'Checking the review gate…'));
  allow(false);
  const draw = (v: MergeGateView) => {
    // Checks still running don't hold back "Merge when ready" (the office checks the real choice when you merge).
    allow(v.decision.allowed || !!v.autoAllowed);
    const over = !v.decision.allowed && v.admin && v.state === 'OPEN' ? h('button.btn', { type: 'button', title: 'Merge anyway from the office (an admin); recorded in the audit log' }, '⚠️ Override…') : null;
    over?.addEventListener('click', () => overrideDialog(v, over, draw));
    root.replaceChildren(...gateLines(v), over ? h('div.mg-acts', {}, over) : '');
  };
  fetchGate(pr)
    .then(draw)
    .catch((err) => {
      // The office checks again when you merge, and says why if it won't.
      allow(true);
      root.replaceChildren(h('div.mg-state.muted', {}, `Couldn’t check the review gate here (${(err as Error).message}); the office checks again when you merge.`));
    });
  return root;
}

function overrideDialog(v: MergeGateView, from: HTMLElement, done: (v: MergeGateView) => void) {
  const reason = h('textarea.mg-note', { rows: 3, placeholder: 'Why it must merge without a counting review (goes in the audit log)', 'aria-label': 'Reason' }) as HTMLTextAreaElement;
  const pw = h('input.mg-pw', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Your password' }) as HTMLInputElement;
  const err = h('p.mg-err', { role: 'alert' });
  const go = h('button.btn.danger', { type: 'submit' }, '⚠️ Override for this revision');
  const form = h(
    'form.modal.mg-modal',
    { role: 'dialog', 'aria-label': `Override the review gate for PR #${v.pr}` },
    h('header', {}, h('h2', {}, `⚠️ Override the review gate for PR #${v.pr}`)),
    h('div.body', {}, h('p', {}, v.decision.reason), h('p.mg-small', {}, `For ${short(v.head)} only, for 30 minutes, from the office’s Merge button. The mx-office/review status on GitHub stays as it is, so a protected branch still refuses it.`), reason, h('label.mg-small', {}, 'Type your password again'), pw, err),
    h('footer', {}, h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Cancel'), go),
  );
  const modal = openModal(form, { onClose: () => from.isConnected && from.focus() });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reason.value.trim().length < 10) return reason.focus();
    if (!pw.value) return pw.focus();
    go.disabled = true;
    err.textContent = '';
    try {
      const auth = await post('/api/m/reauth', { password: pw.value });
      if (!auth.ok) {
        err.textContent = auth.error ?? 'Wrong password';
        return;
      }
      const r = await post('/api/merge-gate/override', { floor: store.floor, pr: v.pr, sha: v.head, reason: reason.value.trim() });
      if (!r.ok) {
        err.textContent = r.error ?? 'Not overridden';
        return;
      }
      modal.close();
      if (r.view) done(r.view);
    } catch (x) {
      err.textContent = (x as Error).message;
    } finally {
      go.disabled = false;
    }
  });
  setTimeout(() => reason.focus(), 30);
}
