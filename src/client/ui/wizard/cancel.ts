// Cancel & undo for an unfinished setup (shared/setup-cancel.ts), GitHub-style: what the setup did, a
// summary of exactly what will happen, the local folder and the GitHub repository each offered (ticked)
// only when this setup recorded proof of making it, and the server's reason when not (no proof, a
// different repository at that name now, GitHub couldn't say, a junction), the Mendix note (the .mpr
// goes with the folder and the repository; a Portal / Team Server app never does), then "To confirm,
// type <owner/name>" and the red button, disabled until the box says exactly that. Once started it
// shows the steps as they run; one that stopped part way carries on with Retry. ✕ and Esc close it.

import '../project-delete/dialog.css';
import { cancelConfirmed, cancelConsequences, type CancelJobView, type CancelPlan } from '../../../shared/setup-cancel';
import { loadProfile } from '../../state/persist';
import { h, openModal, toast } from '../dom';
import { wizardApi } from './api';

const POLL_MS = 700;
const some = (...xs: (Node | null | false | undefined)[]): Node[] => xs.filter((x): x is Node => !!x);

export function openCancelDialog(id: string, repo: string, opts: { done?: () => void } = {}) {
  const title = h('h2', { id: 'sc-title' }, `Cancel the setup of ${repo}`);
  const body = h('div.body.pd-body', {}, h('p.pd-note', {}, 'Working out what the setup did…'));
  const el = h('div.modal.pd-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sc-title', 'data-mode': 'delete' }, h('header', {}, title), body);
  let open = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // ✕ or Esc gives focus back to what opened it (the Cancel & undo button), when that's still there.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const modal = openModal(el, {
    onClose: () => {
      open = false;
      clearTimeout(timer);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    },
    backdropCloses: false,
    doing: `cancelling the setup of ${repo}`,
  });
  const by = () => loadProfile()?.name;

  wizardApi.cancelPlan(id).then(
    (plan) => open && draw(plan),
    (err: Error) => open && body.replaceChildren(h('p.pd-note.bad', {}, `Couldn’t ask the office: ${err.message}`)),
  );

  function draw(plan: CancelPlan) {
    const unfinished = plan.unfinished;
    const folder = h('input', { type: 'checkbox', id: 'sc-folder', disabled: !plan.folder.deletable }) as HTMLInputElement;
    const repoBox = h('input', { type: 'checkbox', id: 'sc-repo', disabled: !plan.repoDelete.possible }) as HTMLInputElement;
    // Ticked only for what this setup made itself.
    folder.checked = plan.folder.deletable && plan.folder.createdBySetup;
    repoBox.checked = plan.repoDelete.possible && plan.repoDelete.createdBySetup;
    const typed = h('input.pd-input', { type: 'text', id: 'sc-confirm', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': 'sc-type' }) as HTMLInputElement;
    const go = h('button.btn.danger.pd-go', { type: 'button', disabled: true }, unfinished ? 'Retry' : 'Cancel the setup and undo it') as HTMLButtonElement;
    const list = h('ul.pd-list');
    const why = h('p.pd-why', { role: 'status' });
    const req = () => (unfinished ? { deleteFolder: unfinished.deleteFolder, deleteRepo: unfinished.deleteRepo } : { deleteFolder: folder.checked, deleteRepo: repoBox.checked });
    const drawList = () => list.replaceChildren(...cancelConsequences(plan, req()).map((l) => h('li', {}, l)));
    const ready = () => {
      go.disabled = !!plan.blocked || !cancelConfirmed(typed.value, plan.confirm);
      why.textContent = plan.blocked ?? '';
    };
    for (const b of [folder, repoBox]) b.addEventListener('change', () => (drawList(), ready()));
    typed.addEventListener('input', ready);
    typed.addEventListener('keydown', (e) => e.key === 'Enter' && !go.disabled && go.click());
    const choice = (box: HTMLInputElement, label: string, note: Node | string) => h('label.pd-choice', { for: box.id, class: box.disabled ? 'off' : '' }, box, h('span', {}, label, h('small', {}, note)));
    const folderNote = !plan.folder.exists
      ? 'It isn’t there.'
      : !plan.folder.deletable
        ? `Not offered: ${plan.folder.why}.`
        : plan.folder.createdBySetup
          ? `This setup cloned it. Everything in it goes${plan.mendix.mpr ? ', the Mendix app (.mpr) too' : ''}; there is no recycle bin.`
          : 'This setup didn’t clone it: left unticked.';
    const repoNote = plan.repoDelete.offline
      ? 'A test office’s local repository: nothing on GitHub.'
      : !plan.repoDelete.possible
        ? h('span', {}, `${plan.repoDelete.why ? `Not offered: ${plan.repoDelete.why}.` : 'The token can’t delete it.'} `, plan.repoDelete.settingsUrl ? h('a', { href: plan.repoDelete.settingsUrl, target: '_blank', rel: 'noopener' }, 'Delete it on GitHub ↗') : null)
        : plan.repoDelete.createdBySetup
          ? 'This setup created it on GitHub. Its code, issues and pull requests go, for good.'
          : 'You created this repository yourself (or it was there already): left unticked.';
    drawList();
    body.replaceChildren(
      ...some(
        unfinished ? h('div.pd-flash.warn', {}, h('strong', {}, 'Cancel & undo stopped part way. '), unfinished.error ?? '', ' Retry carries on from that step.') : null,
        plan.blocked ? h('div.pd-flash.warn', {}, plan.blocked) : null,
        plan.did.length ? h('p.pd-note', {}, 'What the setup did:') : null,
        plan.did.length ? h('ol.us-did', {}, ...plan.did.map((d) => h('li', {}, d))) : null,
        h('div.pd-warn', { role: 'alert' }, h('strong', {}, 'Undone in reverse. Deleting can’t be undone.'), list),
        !unfinished
          ? h(
              'div.pd-choices',
              {},
              choice(folder, `Also delete the local folder ${plan.dir}`, folderNote),
              plan.repoDelete.offline ? null : choice(repoBox, `Also delete the GitHub repository ${plan.repo}`, repoNote),
            )
          : null,
        plan.mendix.mpr ? h('p.pd-note', {}, 'The Mendix app (.mpr) lives in the folder and the repository, so it goes with them (when they’re ticked).') : null,
        h('p.pd-type', { id: 'sc-type' }, 'To confirm, type ', h('strong', {}, plan.confirm), ' in the box below'),
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
      go.textContent = 'Cancelling…';
      wizardApi.cancel(id, { confirm: typed.value, ...req() }, by()).then(
        (job) => open && follow(job, plan),
        (err: Error) => {
          if (!open) return;
          why.textContent = err.message;
          go.textContent = unfinished ? 'Retry' : 'Cancel the setup and undo it';
          ready();
        },
      );
    });
  }

  function follow(job: CancelJobView, plan: CancelPlan) {
    const steps = h('ol.pd-steps', {}, ...job.steps.map((s) => h('li', { 'data-st': s.status }, h('span.pd-dot', { 'aria-hidden': 'true' }), h('span', {}, s.label), s.detail ? h('small', {}, s.detail) : null)));
    const head = job.status === 'done' ? `Cancelled the setup of ${job.repo} and undid it.` : job.status === 'failed' ? `Stopped: ${job.error ?? 'a step failed'}` : 'Cancelling…';
    const close = h('button.btn', { type: 'button', onclick: () => modal.close() }, 'Close');
    const retry = h('button.btn.danger', { type: 'button' }, 'Retry') as HTMLButtonElement;
    retry.addEventListener('click', () => {
      retry.disabled = true;
      wizardApi.cancel(id, { confirm: plan.confirm, deleteFolder: job.deleteFolder, deleteRepo: job.deleteRepo }, by()).then(
        (j) => open && follow(j, plan),
        (err: Error) => (toast(err.message, 'error'), (retry.disabled = false)),
      );
    });
    body.replaceChildren(...some(h('p.pd-head', { role: 'status', class: job.status }, head), steps, h('div.pd-foot', {}, ...some(job.status === 'failed' && retry, job.status !== 'running' && close))));
    if (job.status === 'running') timer = setTimeout(() => wizardApi.cancelJob(id).then((j) => open && follow(j, plan), () => undefined), POLL_MS);
    else {
      if (job.status === 'done') toast(`Cancelled the setup of ${job.repo}`);
      opts.done?.();
    }
  }
}
