// The setup's operation records wired to the real office: every change in the audit log (redacted by the
// audit itself), GitHub looked at with the office's own gh login (step 1's classified lookup), and the
// setups the office loads reconciled once at start. The wizard (index.ts) uses these.

import { SETUP_STEPS } from '../../shared/wizard.js';
import { unsettled, type OperationRecord } from '../../shared/setup-operations.js';
import { audit, human, office } from '../audit/index.js';
import type { OperationChange } from './operations.js';
import type { JobBook } from './job.js';
import { reconcile, type ReconcileDeps } from './reconcile.js';
import { lookupWithRun } from './repo-lookup.js';
import { runCommand } from './run.js';

const LABEL: Record<OperationRecord['kind'], string> = {
  'repo-create': 'Creating the GitHub repository',
  'repo-delete': 'Deleting the GitHub repository',
  'folder-create': 'Cloning the local folder',
  'folder-delete': 'Deleting the local folder',
};

/** Each change of an operation record, in the audit log. */
export const auditOperation: OperationChange = (op, from, by) => {
  audit.record({
    ...(op.project ? { floor: op.project } : {}),
    actor: by ? human(by.name, by.id) : office(),
    action: 'project.setup-operation',
    target: { kind: op.kind.startsWith('repo') ? 'repository' : 'folder', id: op.target, label: op.target },
    summary: `${LABEL[op.kind]} ${op.target}: ${from ? `${from} → ` : ''}${op.state}${op.state === 'resolved' || op.state === 'succeeded' ? ` (${op.provenance})` : ''}`,
    details: {
      operation: op.id,
      setup: op.setup,
      attempt: op.attempt,
      kind: op.kind,
      target: op.target,
      from: from ?? null,
      state: op.state,
      provenance: op.provenance,
      ...(op.identity ? { identity: op.identity } : {}),
      ...(op.before ? { before: op.before } : {}),
      ...(op.evidence ? { evidence: op.evidence } : {}),
      ...(op.authorisedBy ? { authorisedBy: op.authorisedBy } : {}),
      ...(op.detail ? { detail: op.detail } : {}),
    },
    severity: op.state === 'outcome-unknown' || op.state === 'failed-confirmed' || op.kind.endsWith('delete') ? 'warning' : op.state === 'resolved' ? 'notice' : 'info',
  });
};

/** GitHub asked through the office's gh login, as the repo step does. */
export function officeLookup(projectsDir: () => string, env: () => NodeJS.ProcessEnv): ReconcileDeps {
  return { lookup: (repo) => lookupWithRun((a) => runCommand('gh', a, { cwd: projectsDir(), env: env(), timeoutMs: 60_000, allowFail: true }), repo) };
}

/**
 * Settles a job's operation records by looking (`recheck`: also those waiting to be adopted), notes it in
 * the setup's log and step line, and saves the job. Returns the records that still need someone.
 */
export async function reconcileJob(book: JobBook, job: Parameters<JobBook['opsOf']>[0], deps: ReconcileDeps, recheck = false): Promise<OperationRecord[]> {
  const left = await reconcile(book.ops, job, deps, { recheck });
  const ops = book.opsOf(job);
  const stepOf = (o: OperationRecord) => (o.kind === 'repo-create' ? 'repo' : 'clone');
  for (const o of ops.filter((x) => x.kind === 'repo-create' || x.kind === 'folder-create')) {
    const id = stepOf(o);
    const s = job.steps[id];
    if (s.status !== 'failed') continue;
    // The step's line says where it stands now, so the page and the card agree with the record.
    const label = SETUP_STEPS.find((x) => x.id === id)?.label ?? id;
    if (o.state === 'failed-confirmed' && !left.length) job.steps[id] = { status: 'failed', detail: `${o.detail ?? 'it didn’t happen'}: Retry tries again` };
    else if (left.some((l) => l.id === o.id)) job.steps[id] = { status: 'failed', detail: o.detail ?? s.detail };
    book.log(job, `🔎 ${label}: ${o.state}${o.detail ? ` — ${o.detail}` : ''}`);
  }
  book.save(job);
  return left;
}

/** At start: every setup that isn't done and has a record whose outcome nobody confirmed is looked at once. */
export async function reconcileOnStart(book: JobBook, deps: ReconcileDeps): Promise<void> {
  for (const job of book.all()) {
    if (job.status === 'done' || book.isRunning(job.id) || !book.opsOf(job).some(unsettled)) continue;
    try {
      await reconcileJob(book, job, deps);
    } catch (err) {
      console.error(`agent-office: couldn't reconcile the setup of ${job.plan.owner}/${job.plan.name}: ${(err as Error).message}`);
    }
  }
}
