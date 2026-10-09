// The Firm's API from the browser (server/http/routes/firm.ts).

import type { Engagement, EngagementConfig, Estimate, FirmFloorStatus } from '../../shared/firm/engagement';
import type { Report } from '../../shared/firm/report';
import type { ReviewerRole } from '../../shared/firm/roles';

export interface FirmView {
  admin: boolean;
  people: (ReviewerRole & { model: string })[];
  settings: { models: Record<string, string>; budget: number; maxMinutes: number };
  engagements: Engagement[];
  floors: { id: string; name: string; repo?: string; auditing: boolean }[];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const fetchFirm = () => fetch('/api/firm').then((r) => json<FirmView>(r));
export const fetchEngagement = (id: string) => fetch(`/api/firm/engagement?id=${encodeURIComponent(id)}`).then((r) => json<Engagement>(r));
export const fetchReport = (id: string) => fetch(`/api/firm/report?id=${encodeURIComponent(id)}`).then((r) => json<Report>(r));
export const fetchFloorStatus = (floor: string) => fetch(`/api/firm/status?floor=${encodeURIComponent(floor)}`).then((r) => json<FirmFloorStatus>(r));
export const fetchDefaults = (floor: string) => fetch(`/api/firm/defaults?floor=${encodeURIComponent(floor)}`).then((r) => json<{ config: EngagementConfig; estimate: Estimate }>(r));

export function postEstimate(config: EngagementConfig) {
  return fetch('/api/firm/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }).then((r) => json<{ config: EngagementConfig; estimate: Estimate }>(r));
}

export function firmAction(body: Record<string, unknown>) {
  return fetch('/api/firm/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ ok: true; engagement?: Engagement }>(r));
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const reportUrl = (id: string) => `/firm?report=${encodeURIComponent(id)}`;
