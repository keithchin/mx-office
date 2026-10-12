import './operation.css';
/**
 * An operation whose outcome the office couldn't confirm (shared/setup-operations.ts), in the setup's
 * failure place (the group view, progress.ts) and on its unfinished card (unfinished.ts): the plain words,
 * "Check GitHub again" as the one primary action, and "Use this existing repository" only once a look
 * has found it there. No Retry and no Cancel & undo deletion are offered for it while it's uncertain.
 */
import type { JobView } from '../../../shared/wizard';
import type { OperationNotice } from '../../../shared/setup-operations';
import { h, toast } from '../dom';
import { wizardApi } from './api';

export interface OperationBoxOptions {
  id: string;
  admin: boolean;
  /** The setup's view after a look or an adoption. */
  changed(job: JobView): void;
  /** The card's smaller version. */
  compact?: boolean;
}

export function operationBox(n: OperationNotice, o: OperationBoxOptions): HTMLElement {
  const check = h('button.btn.primary', { type: 'button' }, n.check) as HTMLButtonElement;
  const adopt = n.adopt ? (h('button.btn', { type: 'button' }, n.adopt) as HTMLButtonElement) : null;
  const busy = (on: boolean) => {
    check.disabled = on;
    if (adopt) adopt.disabled = on;
  };
  const act = (call: () => Promise<JobView>, done: string) => {
    busy(true);
    call().then(
      (job) => {
        if (done) toast(done);
        o.changed(job);
      },
      (err: Error) => (toast(err.message, 'error'), busy(false)),
    );
  };
  check.addEventListener('click', () => act(() => wizardApi.check(o.id), ''));
  adopt?.addEventListener('click', () => act(() => wizardApi.adopt(o.id, n.op), n.kind === 'repo-create' ? 'Using the existing repository: setup carries on' : 'Using the existing folder: setup carries on'));
  return h(
    `div.op-box${o.compact ? '.op-compact' : ''}`,
    { role: 'alert', 'data-op': n.op, 'data-state': n.state, 'data-provenance': n.provenance },
    h('p.op-title', {}, h('b', {}, n.title)),
    h('p', {}, n.text),
    o.admin
      ? h(
          'div.op-acts',
          {},
          check,
          adopt,
          h('small', {}, adopt ? 'Cancel & undo never deletes a repository or folder you chose to use.' : 'No Retry or Undo until the office knows what happened.'),
        )
      : h('p.op-note', {}, 'An admin (operator) can check again.'),
  );
}
