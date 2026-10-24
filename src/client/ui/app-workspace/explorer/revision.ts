// The explorer's revision line: which revision it reads (main's newest commit by default, or the live app's
// revision when the viewer picks it), the live app's revision as information only ("Live app runs 6a1f09c,
// 3 commits behind main"), and, when main moved after the tree was read, a stale note with Show it. The
// explorer never needs the app to be running; this line only says where the app is.

import { h } from '../../dom';
import { shortSha, type ExplorerHead } from '../../../../shared/app-explorer';

export interface RevisionState {
  head?: ExplorerHead;
  /** The revision the tree shows. */
  rev?: string;
  /** The live app's revision (running or last run), and whether it runs now. */
  served?: string;
  running: boolean;
  /** The viewer picked the live app's revision. */
  onServed: boolean;
  /** Why main's newest commit couldn't be found. */
  error?: string;
}

export interface RevisionLine {
  readonly el: HTMLElement;
  paint(s: RevisionState): void;
}

export function revisionLine(on: { pick(which: 'main' | 'served'): void; refresh(): void }): RevisionLine {
  const sel = h('select.ax-revsel', { 'aria-label': 'Which revision the explorer reads' }) as HTMLSelectElement;
  sel.addEventListener('change', () => on.pick(sel.value === 'served' ? 'served' : 'main'));
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
      sel.replaceChildren(...opts);
      sel.value = s.onServed && opts.length > 1 ? 'served' : 'main';
      sel.disabled = opts.length < 2;
      sel.title = s.onServed ? `Reading the live app’s revision ${s.served}` : main ? `Reading main’s newest commit ${main}${s.head?.subject ? `: ${s.head.subject}` : ''}` : '';
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
      const moved = !!main && !!s.rev && !s.onServed && s.rev !== main;
      stale.hidden = !moved;
      if (moved) stale.replaceChildren(`Main moved to ${shortSha(main)} since this was read (showing ${shortSha(s.rev)}). `, h('button.aw-btn.ax-stale-go', { type: 'button', onclick: () => on.refresh() }, 'Show it'));
    },
  };
}
