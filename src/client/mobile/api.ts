// The phone version's calls to the office (http/routes/mobile.ts): who you are, the password typed again
// for a risky action, an action, the projects' status, and this phone's push subscription. Plain fetches.

import type { MobileAction, ProjectStatus } from '../../shared/mobile';
import type { AlertSettings } from '../../shared/phone';
import { storedAlerts } from '../../shared/phone';
import { store } from '../state';
import { browserKey } from '../ui/phone/reads';

export interface PhoneView {
  id: string;
  name: string;
  device: string;
  createdAt: number;
  lastOkAt?: number;
  lastError?: string;
  mine: boolean;
}

export interface MeView {
  admin: boolean;
  account?: string;
  /** Until when risky actions go through without the password (0: they don't). */
  reauthUntil: number;
  vapidKey?: string;
  phones: PhoneView[];
  tunnel?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reauth = false,
  ) {
    super(message);
  }
}

async function call<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify({ ...body, by: store.profile.name, browser: browserKey() }) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; reauth?: boolean };
  if (!r.ok) throw new ApiError(j.error ?? `The office said ${r.status}`, r.status, !!j.reauth);
  return j;
}

export const mobileApi = {
  me: () => call<MeView>(`/api/m/me?browser=${encodeURIComponent(browserKey())}`),
  reauth: (password: string) => call<{ ok: true; reauthUntil: number }>('/api/m/reauth', { password }),
  act: (a: MobileAction) => call<{ ok: true; summary: string; url?: string }>('/api/m/act', a as unknown as Record<string, unknown>),
  status: () => call<{ projects: ProjectStatus[] }>('/api/m/status').then((j) => j.projects),
  subscribe: (subscription: PushSubscriptionJSON, device: string, alerts: AlertSettings) => call<{ id: string; phones: PhoneView[] }>('/api/m/push/subscribe', { subscription: subscription as unknown as Record<string, unknown>, device, alerts: storedAlerts(alerts) }),
  unsubscribe: (id: string) => call<{ phones: PhoneView[] }>('/api/m/push/unsubscribe', { id }),
  alerts: (id: string, alerts: AlertSettings) => call<{ ok: true }>('/api/m/push/alerts', { id, alerts: storedAlerts(alerts) }),
  pushKey: () => call<{ vapidKey: string }>('/api/m/push/key', {}),
  testPush: (id: string) => call<{ ok: true }>('/api/m/push/test', { id }),
};
