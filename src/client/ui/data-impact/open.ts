// A data-impact hold's findings from wherever the hold is shown as a fact (a Developer change's preview fact,
// env candidate:DC-n): GET /api/data-impact for that environment, then the approve dialog for someone with the
// `data-impact approval` permission (./dialog.ts: what the approval binds), with the findings said first in a
// toast, and for anyone else the findings with who may approve.

import type { DataImpactView } from '../../../shared/data-impact';
import { toast } from '../dom';
import { openApproveDialog } from './dialog';

export async function openFindings(floor: string, env: string, back?: HTMLElement): Promise<void> {
  const res = await fetch(`/api/data-impact?${new URLSearchParams({ floor, env }).toString()}`, { credentials: 'same-origin' }).catch(() => undefined);
  const v = res?.ok ? ((await res.json().catch(() => undefined)) as DataImpactView | undefined) : undefined;
  if (!v?.held) return void toast('Nothing is held there any more.', 'info');
  const f = v.assessment?.findings ?? [];
  if (v.canApprove) {
    toast(`${v.held.reason}${f.length ? `: ${f.slice(0, 3).map((x) => x.risk).join('; ')}${f.length > 3 ? '…' : ''}` : ''}`, 'warn');
    return openApproveDialog(v, () => back?.focus());
  }
  toast(`${v.held.reason}${f.length ? `: ${f.slice(0, 3).map((x) => x.risk).join('; ')}${f.length > 3 ? '…' : ''}` : ''}. Who may approve: ${v.approvers}.`, 'warn');
}
