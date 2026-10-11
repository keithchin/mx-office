// The new-project wizard's calls to the office (server/http/routes/wizard.ts). Plain fetches: the
// wizard asks, and polls a running setup, rather than adding messages to the office's socket.
import type { IntakeAnswer, JobView, ProjectPlan, SetupView, WizardInfo } from '../../../shared/wizard';
import type { CancelJobView, CancelPlan, CancelRequest, SetupBlocker, UnfinishedSetup } from '../../../shared/setup-cancel';

/** What a refused call said; a Retry that would fail anyway carries why (`blocker`). */
export type CallError = Error & { status?: number; blocker?: SetupBlocker };

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The office said ${res.status}`), { status: res.status, blocker: (data as { blocker?: SetupBlocker }).blocker }) as CallError;
  return data;
}

const q = (s: string) => encodeURIComponent(s);

export const wizardApi = {
  info: () => call<WizardInfo>('GET', '/api/wizard/info'),
  job: (id: string) => call<JobView>('GET', `/api/wizard/job?id=${q(id)}`),
  start: (plan: ProjectPlan, by?: string) => call<JobView>('POST', '/api/wizard/start', { ...plan, by }),
  retry: (id: string) => call<JobView>('POST', `/api/wizard/retry?id=${q(id)}`, {}),
  edit: (id: string, plan: ProjectPlan) => call<JobView>('POST', `/api/wizard/edit?id=${q(id)}`, plan),
  setup: (floor: string) => call<SetupView>('GET', `/api/wizard/setup?floor=${q(floor)}`),
  answers: (floor: string) => call<{ repo?: string; answers: IntakeAnswer[] }>('GET', `/api/wizard/answers?floor=${q(floor)}`),
  appVersion: (repo: string) => call<{ saved?: string; installed?: string }>('GET', `/api/wizard/app-version?repo=${q(repo)}`),
  unfinished: () => call<{ admin: boolean; setups: UnfinishedSetup[] }>('GET', '/api/wizard/unfinished'),
  cancelPlan: (id: string) => call<CancelPlan>('GET', `/api/wizard/cancel-plan?id=${q(id)}`),
  cancelJob: (id: string) => call<CancelJobView>('GET', `/api/wizard/cancel?id=${q(id)}`),
  cancel: (id: string, req: CancelRequest, by?: string) => call<CancelJobView>('POST', `/api/wizard/cancel?id=${q(id)}`, { ...req, by }),
  recheck: (floor: string) => call<{ checking: boolean }>('POST', `/api/wizard/recheck?floor=${q(floor)}`, {}),
};
