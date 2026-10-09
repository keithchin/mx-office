// The GitHub-style confirmation for removing or deleting a project: its title, a red summary of exactly
// what will happen (agents stopped, worktrees removed and which hold work, where the office data is
// archived, whether the folder and the repository go), the choices Delete project adds (the local
// folder, the GitHub repository, each off until ticked and only offered when the office may), then
// "To confirm, type <owner/name> in the box below" and the red button, which stays disabled until the
// box says exactly that. Once started it shows the job's steps as they run; a job that stopped part way
// carries on with Retry. ✕ and Esc close it (openModal).

import './dialog.css';
import { consequences, confirmMatches, worktreesWithWork, type DeleteJobView, type DeleteMode, type DeletePlan } from '../../../shared/project-delete';
import { h, openModal, toast } from '../dom';
import { fetchDeleteJob, fetchDeletePlan, startDelete } from './api';

const POLL_MS = 700;

/** The nodes there are (a part that doesn't apply is null). */
const some = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => !!x);

const WORDS: Record<DeleteMode, { title: (n: string) => string; button: string; busy: string }> = {
  remove: {
    title: (n) => `Remove ${n} from the office`,
    button: 'Remove this project from the office',
    busy: 'Removing…',
  },
  delete: {
    title: (n) => `Delete ${n}`,
    button: 'Delete this project',
    busy: 'Deleting…',
  },
};

/** Opens the dialog for `floor`; `name` titles it until the plan is in. */
export function openDeleteDialog(floor: string, name: string, mode: DeleteMode) {
  const words = WORDS[mode];
  const title = h('h2', { id: 'pd-title' }, words.title(name));
  const body = h('div.body.pd-body', {}, h('p.pd-note', {}, 'Working out what would go…'));
  const el = h(
    'div.modal.pd-modal',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'pd-title',
      'data-mode': mode,
    },
    h('header', {}, title),
    body,
  );
  let open = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const modal = openModal(el, {
    onClose: () => ((open = false), clearTimeout(timer)),
    backdropCloses: false,
    doing: `deleting ${name}`,
  });

  const fail = (err: Error) => open && body.replaceChildren(h('p.pd-note.bad', {}, `Couldn’t ask the office: ${err.message}`));

  fetchDeletePlan(floor).then((plan) => open && draw(plan), fail);

  function draw(plan: DeletePlan) {
    title.textContent = words.title(plan.name);
    const strong = mode === 'delete';
    const withWork = worktreesWithWork(plan.worktrees);
    const folder = h('input', {
      type: 'checkbox',
      id: 'pd-folder',
      disabled: !plan.folder.deletable,
    }) as HTMLInputElement;
    const repo = h('input', {
      type: 'checkbox',
      id: 'pd-repo',
      disabled: !plan.repoDelete.possible,
    }) as HTMLInputElement;
    const work = h('input', {
      type: 'checkbox',
      id: 'pd-work',
    }) as HTMLInputElement;
    const typed = h('input.pd-input', {
      type: 'text',
      id: 'pd-confirm',
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
      'aria-describedby': 'pd-type',
    }) as HTMLInputElement;
    const go = h('button.btn.danger.pd-go', { type: 'button', disabled: true }, plan.unfinished ? 'Retry' : words.button) as HTMLButtonElement;
    const list = h('ul.pd-list');
    const why = h('p.pd-why', { role: 'status' });

    const unfinished = plan.unfinished;
    const drawList = () => {
      const r = unfinished
        ? {
            mode: unfinished.mode,
            deleteFolder: unfinished.deleteFolder,
            deleteRepo: unfinished.deleteRepo,
          }
        : {
            mode,
            deleteFolder: strong && folder.checked,
            deleteRepo: strong && repo.checked,
          };
      list.replaceChildren(...consequences(plan, r).map((l) => h('li', {}, l)));
    };
    const ready = () => {
      const needWork = withWork.length > 0 && !unfinished;
      const ok = !plan.blocked && confirmMatches(typed.value, plan.confirm) && (!needWork || work.checked);
      go.disabled = !ok;
      why.textContent = plan.blocked ? plan.blocked : needWork && !work.checked ? 'Tick the box about the worktrees with work first.' : '';
    };
    for (const box of [folder, repo]) box.addEventListener('change', () => (drawList(), ready()));
    work.addEventListener('change', ready);
    typed.addEventListener('input', ready);
    typed.addEventListener('keydown', (e) => e.key === 'Enter' && !go.disabled && go.click());

    const choice = (box: HTMLInputElement, label: string, note?: Node | string | false) => h('label.pd-choice', { for: box.id, class: box.disabled ? 'off' : '' }, box, h('span', {}, label, note ? h('small', {}, note) : null));
    const repoNote = plan.repoDelete.possible
      ? 'Its code, issues, pull requests and wiki, for good.'
      : h(
          'span',
          {},
          `${plan.repoDelete.why ?? 'The token can’t delete it.'} `,
          plan.repoDelete.settingsUrl
            ? h(
                'a',
                {
                  href: plan.repoDelete.settingsUrl,
                  target: '_blank',
                  rel: 'noopener',
                },
                'Open its settings on GitHub ↗',
              )
            : null,
        );

    drawList();
    body.replaceChildren(
      ...some(
        unfinished ? h('div.pd-flash.warn', {}, h('strong', {}, 'A deletion stopped part way. '), unfinished.error ?? '', ' Retry carries on from that step.') : null,
        plan.blocked ? h('div.pd-flash.warn', {}, plan.blocked) : null,
        h('div.pd-warn', { role: 'alert' }, h('strong', {}, strong ? 'This can’t be undone.' : 'This takes the project out of the office.'), list),
        strong && !unfinished
          ? h(
              'div.pd-choices',
              {},
              choice(folder, `Also delete the local folder ${plan.dir}`, plan.folder.deletable ? 'Everything in it, including work nobody committed. There is no recycle bin.' : `Can’t: ${plan.folder.why}`),
              plan.repo ? choice(repo, `Also delete the GitHub repository ${plan.repo}`, repoNote) : null,
            )
          : null,
        withWork.length && !unfinished
          ? h(
              'div.pd-work',
              {},
              h('p', {}, `${withWork.length} worktree${withWork.length === 1 ? ' holds' : 's hold'} work that isn’t pushed:`),
              h(
                'ul',
                {},
                ...withWork.map((w) =>
                  h(
                    'li',
                    {},
                    h('code', {}, w.branch ?? w.path),
                    ` — ${[w.dirty ? `${w.dirty < 0 ? '?' : w.dirty} uncommitted` : '', w.unpushed ? `${w.unpushed < 0 ? '?' : w.unpushed} unpushed commit${w.unpushed === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}`,
                  ),
                ),
              ),
              choice(work, 'Remove them anyway', 'Uncommitted changes are lost. Branches with unpushed commits stay in the repository, unless the folder is deleted.'),
            )
          : null,
        plan.mendix
          ? h(
              'p.pd-note',
              {},
              'The Mendix app in the Portal (and its Team Server repository) is never deleted by the office: clean it up there if you want it gone. ',
              h(
                'a',
                {
                  href: plan.mendix.portalUrl,
                  target: '_blank',
                  rel: 'noopener',
                },
                'Open the Mendix Portal ↗',
              ),
            )
          : null,
        h('p.pd-type', { id: 'pd-type' }, 'To confirm, type ', h('strong', {}, plan.confirm), ' in the box below'),
        typed,
        why,
        go,
      ),
    );
    ready();
    setTimeout(() => typed.focus(), 30);

    go.addEventListener('click', () => {
      if (go.disabled) return;
      go.disabled = true;
      go.textContent = words.busy;
      startDelete(plan.floor, {
        mode,
        deleteFolder: strong && folder.checked,
        deleteRepo: strong && repo.checked,
        discardWork: work.checked,
        confirm: typed.value,
      }).then(
        (job) => open && follow(job, plan),
        (err: Error) => {
          if (!open) return;
          why.textContent = err.message;
          go.textContent = unfinished ? 'Retry' : words.button;
          ready();
        },
      );
    });
  }

  function follow(job: DeleteJobView, plan: DeletePlan) {
    const steps = h('ol.pd-steps', {}, ...job.steps.map((s) => h('li', { 'data-st': s.status }, h('span.pd-dot', { 'aria-hidden': 'true' }), h('span', {}, s.label), s.detail ? h('small', {}, s.detail) : null)));
    const head = job.status === 'done' ? `${job.mode === 'remove' ? 'Removed' : 'Deleted'} ${job.name}.` : job.status === 'failed' ? `Stopped: ${job.error ?? 'a step failed'}` : WORDS[job.mode].busy;
    const close = h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Close');
    const retry = h('button.btn.danger', { type: 'button' }, 'Retry') as HTMLButtonElement;
    retry.addEventListener('click', () => {
      retry.disabled = true;
      startDelete(plan.floor, {
        mode: job.mode,
        deleteFolder: job.deleteFolder,
        deleteRepo: job.deleteRepo,
        confirm: plan.confirm,
      }).then(
        (j) => open && follow(j, plan),
        (err: Error) => (toast(err.message, 'error'), (retry.disabled = false)),
      );
    });
    body.replaceChildren(
      ...some(
        h('p.pd-head', { role: 'status', class: job.status }, head),
        steps,
        job.archiveDir ? h('p.pd-note', {}, 'Archived to ', h('code', {}, job.archiveDir)) : null,
        h('div.pd-foot', {}, job.status === 'failed' ? retry : null, job.status !== 'running' ? close : null),
      ),
    );
    if (job.status === 'running')
      timer = setTimeout(
        () =>
          fetchDeleteJob(plan.floor).then(
            (j) => open && follow(j, plan),
            () => undefined,
          ),
        POLL_MS,
      );
    else if (job.status === 'done') toast(`${job.mode === 'remove' ? 'Removed' : 'Deleted'} ${job.name}`);
  }
}
