// The phone version as an app: its service worker (public/sw.js: the app shell offline, and the push
// notifications), "Add to Home Screen" for iPhone Safari, and Web Push. On iOS (16.4 and later) a page
// only gets push once it's opened from the home screen, and only over https: through Phone access's
// tunnel, or on localhost.

import type { AlertSettings } from '../../shared/phone';
import { mobileApi, type PhoneView } from './api';

const SUB_KEY = 'agent-office.m.push-sub';

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** The phone's name for the list of subscribed phones: "iPhone · Safari". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'A device';
  const app = isStandalone() ? 'home-screen app' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : 'browser';
  return `${what} · ${app}`;
}

export type PushState = 'unsupported' | 'insecure' | 'install-first' | 'denied' | 'off' | 'on';

let registration: Promise<ServiceWorkerRegistration | undefined> | undefined;

/** Registers the service worker once (only where the browser allows: https or localhost). */
export function registerWorker(): Promise<ServiceWorkerRegistration | undefined> {
  registration ??= !('serviceWorker' in navigator) || !window.isSecureContext ? Promise.resolve(undefined) : navigator.serviceWorker.register('/sw.js', { scope: '/m' }).catch(() => undefined);
  return registration;
}

export function savedSubId(): string | undefined {
  try {
    return localStorage.getItem(SUB_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveSubId(id: string | undefined) {
  try {
    if (id) localStorage.setItem(SUB_KEY, id);
    else localStorage.removeItem(SUB_KEY);
  } catch {
    // only for this visit
  }
}

/** Where push stands on this phone, and why when it can't be on. */
export async function pushState(phones: readonly PhoneView[]): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure';
  if (isIos() && !isStandalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registerWorker();
  const sub = await reg?.pushManager.getSubscription();
  const id = savedSubId();
  return sub && id && phones.some((p) => p.id === id) ? 'on' : 'off';
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Asks for permission (from a tap), subscribes and tells the office. Why not, if it couldn't. */
export async function enablePush(alerts: AlertSettings): Promise<string | undefined> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notifications were not allowed. Settings → Notifications → Agent Office turns them on.';
  const reg = await registerWorker();
  if (!reg) return 'This browser has no service agent here (it needs https).';
  try {
    const { vapidKey } = await mobileApi.pushKey();
    const old = await reg.pushManager.getSubscription();
    const sub = old ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
    const r = await mobileApi.subscribe(sub.toJSON(), deviceName(), alerts);
    saveSubId(r.id);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

export async function disablePush(): Promise<void> {
  const id = savedSubId();
  const reg = await registerWorker();
  await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => undefined);
  saveSubId(undefined);
  if (id) await mobileApi.unsubscribe(id).catch(() => undefined);
}
