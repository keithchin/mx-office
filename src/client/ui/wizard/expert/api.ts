// The Expert wizard's calls (server/http/routes/expert-create.ts): the pin choices, and Create and open session.
// The setup it starts is followed with the wizard's own GET /api/wizard/job (../api.ts), like any setup.
import type { ExpertForm, ExpertSetupInfo } from '../../../../shared/expert-setup';
import type { JobView } from '../../../../shared/wizard';

export async function setupInfo(): Promise<ExpertSetupInfo> {
  try {
    const res = await fetch('/api/expert/setup-info', { credentials: 'same-origin' });
    if (res.ok) return (await res.json()) as ExpertSetupInfo;
  } catch {
    // offline for a moment: the dropdowns offer "latest release" only
  }
  return { toolkit: { recent: [] }, mxcli: { versions: [] } };
}

export async function createExpert(form: ExpertForm, by?: string): Promise<JobView> {
  const res = await fetch('/api/expert/create', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, by }) });
  const data = (await res.json().catch(() => ({}))) as JobView & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The office said ${res.status}`);
  return data;
}
