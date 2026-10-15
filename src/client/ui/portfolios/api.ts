// Portfolios' calls (server/http/routes/portfolios.ts): the list, an admin's change, and a project's
// existing-context review. Each answers the office's words on a refusal (S03's cross-portfolio message).

import type { BrainRead, ExistingContext, PortfoliosView, WiringCheckView } from '../../../shared/portfolios';

export interface ActResult {
  error?: string;
  warning?: string;
  view?: PortfoliosView;
  read?: BrainRead;
  check?: WiringCheckView;
  results?: Record<string, WiringCheckView>;
  removed?: Record<string, string[]>;
}

export async function portfoliosView(): Promise<PortfoliosView> {
  const res = await fetch('/api/portfolios', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PortfoliosView;
}

export async function portfolioAct(body: { action: 'create' | 'add' | 'connect' | 'disconnect'; portfolio?: string; label?: string; floor?: string; path?: string }): Promise<ActResult> {
  try {
    const res = await fetch('/api/portfolios/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as ActResult;
    return res.ok ? out : { error: out.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function existingContext(floor: string): Promise<ExistingContext | undefined> {
  const res = await fetch(`/api/portfolios/context?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' }).catch(() => undefined);
  return res?.ok ? ((await res.json()) as ExistingContext) : undefined;
}
