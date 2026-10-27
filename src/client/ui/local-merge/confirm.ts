// The confirm step before a local-only project's merge (server/local-merge/): opened by the panel's Merge and by a
// Developer change receipt's "Review and merge @C", so both go through the same logic. It lists the commit and its
// subject (and how many newer commits stay out), the DC(s) it belongs to, the files and model units it changes
// (or "notes only"), the checks and journeys recorded at exactly that commit, the data-impact finding, and the
// review that lets it merge. Merge merges that commit; with `reviewFirst` (the receipt, a notes branch) your
// approval of exactly that commit is recorded first. ✕ top-right, and ✕ or Esc gives focus back to the opener.

import { dcWords, filesWords, mergingWords, type LocalMergeBranch, type LocalMergeConfirm, type LocalMergeDone } from '../../../shared/local-merge';
import { h, openModal, toast } from '../dom';

const short = (sha: string) => sha.slice(0, 7);

export async function lmPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof out.error === 'string' ? out.error : `${res.status}`);
  return out as T;
}

export interface ConfirmOpts {
  floor: string;
  branch: string;
  sha: string;
  opener?: HTMLElement | null;
  /** Record the PM's approval of exactly `sha` before merging (when it has none yet). */
  reviewFirst?: boolean;
  /** After a merge, with what it did. */
  onDone?(r: LocalMergeDone): void;
  /** After an approval recorded on the way, with the branch's row as the server has it now. */
  onReviewed?(row: LocalMergeBranch | undefined): void;
}

const VERDICT_ICON: Record<string, string> = { passed: '✓', failed: '✗', skipped: '–' };

function results(label: string, list: LocalMergeConfirm['checks'], sha: string): HTMLElement[] {
  return [h('dt', {}, label), h('dd', { 'data-lmc': label.toLowerCase() }, list.length ? list.map((r) => `${VERDICT_ICON[r.verdict] ?? '·'} ${r.name} (${r.verdict})`).join(' · ') : `None recorded at @${short(sha)}`)];
}

const IMPACT: Record<LocalMergeConfirm['dataImpact']['status'], string> = {
  clear: 'Clear: no stored data at risk',
  impact: 'Possible data impact',
  unknown: 'Unknown: the model couldn’t be read, so the live app’s guard will hold its update',
  none: 'None: no domain model change',
};

/** The confirm step's body for its facts (exported for the tests). */
export function confirmBody(c: LocalMergeConfirm, reviewFirst: boolean): HTMLElement {
  const dcs = dcWords({ dcs: c.dcs, branch: c.branch });
  const what = filesWords(c.files, c.kind);
  const review = c.review?.verdict === 'approve' ? `Approved @${short(c.review.sha)} by ${c.review.by}` : reviewFirst ? `Not reviewed yet: merging records your approval of exactly @${short(c.sha)} first` : 'Not approved: approve this commit first';
  return h(
    'div.body.lmc',
    {},
    h('p.lmc-lead', { 'data-lmc': 'words' }, mergingWords(c.sha, c.newer), c.newer ? ` They stay on ${c.branch} for a later review.` : ''),
    h(
      'dl.lmc-facts',
      {},
      h('dt', {}, 'Commit'),
      h('dd', { 'data-lmc': 'commit' }, h('code', {}, `@${short(c.sha)}`), ` “${c.subject}” on ${c.branch}`),
      h('dt', {}, 'Change'),
      h('dd', { 'data-lmc': 'dc' }, dcs || 'No Developer change (a team branch)'),
      h('dt', {}, 'What it changes'),
      h('dd', { 'data-lmc': 'files', 'data-kind': c.kind }, c.kind === 'notes' ? h('b', {}, 'Notes only: ') : '', what, c.paths.length ? h('small.lmc-paths', {}, c.paths.join(', ')) : ''),
      ...(c.units.length ? [h('dt', {}, 'Model units'), h('dd', { 'data-lmc': 'units' }, c.units.map((u) => u.split(':').slice(1).join(':') || u).join(', '))] : []),
      ...results('Checks', c.checks, c.sha),
      ...results('Journeys', c.journeys, c.sha),
      h('dt', {}, 'Data impact'),
      h('dd', { 'data-lmc': 'impact', 'data-status': c.dataImpact.status }, IMPACT[c.dataImpact.status], c.dataImpact.lines.length ? h('ul.lmc-lines', {}, ...c.dataImpact.lines.map((l) => h('li', {}, l))) : ''),
      h('dt', {}, 'Review'),
      h('dd', { 'data-lmc': 'review' }, review),
    ),
    h('p.lmc-small', {}, `Into ${c.main} with a merge commit (--no-ff), as the office, never forced, and recorded in the audit log. ${c.levelName}${c.pmDecides ? ': merges are yours to decide.' : ': the team may merge too.'}`),
  );
}

/** Opens the confirm step for merging `sha` of `branch`. */
export async function openMergeConfirm(o: ConfirmOpts): Promise<void> {
  let c: LocalMergeConfirm;
  try {
    const res = await fetch(`/api/local-merge/confirm?floor=${encodeURIComponent(o.floor)}&branch=${encodeURIComponent(o.branch)}&sha=${encodeURIComponent(o.sha)}`, { credentials: 'same-origin' });
    const body = (await res.json().catch(() => ({}))) as LocalMergeConfirm & { error?: string };
    if (!res.ok) throw new Error(body.error || `${res.status}`);
    c = body;
  } catch (err) {
    toast(`Can’t merge @${short(o.sha)}: ${(err as Error).message}`, 'warn');
    return;
  }
  const approved = c.review?.verdict === 'approve';
  const canGo = approved || !!o.reviewFirst;
  const err = h('p.aw-warn.lmc-err', { role: 'alert', hidden: true });
  const cancel = h('button.btn', { type: 'button' }, 'Cancel') as HTMLButtonElement;
  const go = h('button.btn.primary', { type: 'button', 'data-act': 'confirm-merge', disabled: !canGo }, approved ? `Merge @${short(c.sha)} into ${c.main}` : `Approve @${short(c.sha)} and merge`) as HTMLButtonElement;
  const box = h('div.modal.lmc-dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Merge @${short(c.sha)} into ${c.main}` }, h('header', {}, h('h2', {}, c.kind === 'notes' ? `Merge notes @${short(c.sha)} into ${c.main}?` : `Merge @${short(c.sha)} into ${c.main}?`)), confirmBody(c, !!o.reviewFirst), err, h('footer', {}, h('span.grow'), cancel, go));
  const modal = openModal(box, { onClose: () => o.opener?.focus?.() });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    go.disabled = true;
    void (async () => {
      try {
        if (!approved) {
          const r = await lmPost<{ branch?: LocalMergeBranch }>('/api/local-merge/review', { floor: o.floor, branch: c.branch, sha: c.sha, verdict: 'approve' });
          if (o.onReviewed) o.onReviewed(r.branch);
          // A receipt's approval: every merge panel on the page shows the new review at once.
          else if (r.branch) window.dispatchEvent?.(new CustomEvent('mx:local-reviewed', { detail: { floor: o.floor, row: r.branch } }));
        }
        const done = await lmPost<LocalMergeDone>('/api/local-merge/merge', { floor: o.floor, branch: c.branch, sha: c.sha });
        modal.close();
        toast(`${done.words} ${c.main} is now @${short(done.merge)}.${done.told.length ? ` Told ${done.told.join(' and ')}.` : ''}`);
        o.onDone?.(done);
        window.dispatchEvent?.(new CustomEvent('mx:local-merged', { detail: { floor: o.floor, merge: done.merge } }));
      } catch (e) {
        go.disabled = false;
        err.hidden = false;
        err.textContent = (e as Error).message;
      }
    })();
  });
  go.focus();
}
