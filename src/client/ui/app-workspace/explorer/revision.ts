// The explorer's revision line: which revision it reads (main's newest commit by default, the live app's
// revision, or the active Developer change's candidate, labelled "Candidate of DC-n (not merged)", when the viewer
// picks one), the live app's revision as information only ("Live app runs 6a1f09c, 3 commits behind main"), and,
// when main moved after the tree was read, a stale note with Show it. The explorer never needs the app to be
// running; this line only says where the app is. The Model preview and Select element read whichever revision
// is picked (the server reads any commit the project folder has).

import { h } from '../../dom';
import { shortSha, type ExplorerHead } from '../../../../shared/app-explorer';
import type { DevChangesView } from '../../../../shared/dev-changes';

export type RevPick = 'main' | 'served' | 'candidate';
export interface RevCandidate {
  id: string;
  sha: string;
}

/** The active change's newest candidate (late ones never), the one the explorer can open. */
export function candidateOf(v: DevChangesView | undefined): RevCandidate | undefined {
  const c = v?.changes.find((x) => x.queue === 'active');
  const sha = c?.candidates.filter((x) => !x.late).at(-1)?.sha;
  return c && sha && sha.length === 40 ? { id: c.id, sha } : undefined;
}

/** The option's words: "Candidate of DC-3 (not merged) · c0ffee1". */
export const candidateLabel = (c: RevCandidate) => `Candidate of ${c.id} (not merged) · ${shortSha(c.sha)}`;

export interface RevisionState {
  head?: ExplorerHead;
  /** The revision the tree shows. */
  rev?: string;
  /** The live app's revision (running or last run), and whether it runs now. */
  served?: string;
  running: boolean;
  /** The viewer picked the live app's revision. */
  onServed: boolean;
  /** The active change's candidate, and whether the viewer picked it. */
  candidate?: RevCandidate;
  onCandidate?: boolean;
  /** Why main's newest commit couldn't be found. */
  error?: string;
}

export interface RevisionLine {
  readonly el: HTMLElement;
  paint(s: RevisionState): void;
}

export function revisionLine(on: { pick(which: RevPick): void; refresh(): void }): RevisionLine {
  const sel = h('select.ax-revsel', { 'aria-label': 'Which revision the explorer reads' }) as HTMLSelectElement;
  sel.addEventListener('change', () => on.pick(sel.value === 'served' || sel.value === 'candidate' ? sel.value : 'main'));
  const live = h('span.ax-live', { role: 'status' });
  const stale = h('p.ax-stale', { hidden: true, role: 'status' });
  const el = h('div.ax-revline', {}, h('div.ax-revrow', {}, sel, live), stale);
  return {
    el,
    paint(s) {
      const main = s.head?.rev;
      const opts: HTMLOptionElement[] = [];
      opts.push(h('option', { value: 'main' }, main ? `${s.head!.branch.replace(/^origin\//, '')} · ${shortSha(main)}` : 'main · no commits yet') as HTMLOptionElement);
      if (s.served && s.served !== main) opts.push(h('option', { value: 'served' }, `Live app · ${shortSha(s.served)}`) as HTMLOptionElement);
      if (s.candidate) opts.push(h('option', { value: 'candidate', 'data-candidate': s.candidate.id }, candidateLabel(s.candidate)) as HTMLOptionElement);
      sel.replaceChildren(...opts);
      sel.value = s.onCandidate && s.candidate ? 'candidate' : s.onServed && s.served && s.served !== main ? 'served' : 'main';
      sel.disabled = opts.length < 2;
      sel.dataset.reading = sel.value;
      sel.title = s.onCandidate && s.candidate ? `Reading ${s.candidate.id}’s candidate ${s.candidate.sha}: not merged, not in the live preview` : s.onServed ? `Reading the live app’s revision ${s.served}` : main ? `Reading main’s newest commit ${main}${s.head?.subject ? `: ${s.head.subject}` : ''}` : '';
      const b = s.head?.served;
      let text = '';
      if (s.error) text = s.error;
      else if (!s.served) text = 'The live app hasn’t run yet. Exploring doesn’t need it.';
      else {
        const n = (k: number) => `${k} commit${k === 1 ? '' : 's'}`;
        const where =
          s.served === main || (b?.behind === 0 && !b.ahead)
            ? 'main’s newest'
            : b?.behind === undefined
              ? 'not on main'
              : b.behind && b.ahead
                ? `${n(b.behind)} behind main and ${n(b.ahead)} not on it`
                : b.behind
                  ? `${n(b.behind)} behind main`
                  : `${n(b.ahead ?? 0)} ahead of main (not merged)`;
        text = s.running ? `Live app runs ${shortSha(s.served)}, ${where}` : `Live app isn’t running (last ran ${shortSha(s.served)}, ${where})`;
      }
      live.textContent = text;
      live.title = 'Information only: the explorer reads the repository, not the running app';
      const moved = !!main && !!s.rev && !s.onServed && !s.onCandidate && s.rev !== main;
      stale.hidden = !moved;
      if (moved) stale.replaceChildren(`Main moved to ${shortSha(main)} since this was read (showing ${shortSha(s.rev)}). `, h('button.aw-btn.ax-stale-go', { type: 'button', onclick: () => on.refresh() }, 'Show it'));
    },
  };
}
