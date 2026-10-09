// The office's project-deletion API (server/http/routes/projects.ts), and what a page does when it hears
// a project was deleted: a page on that project goes Home, where a toast says so; any other page just
// toasts. No three.js here: the flat views and the home page import it.

import { goesHome, type DeleteJobView, type DeletePlan, type DeleteRequest } from '../../../shared/project-delete';
import type { ServerMsg } from '../../../shared/protocol';
import { store } from '../../state';
import { toast } from '../dom';

const base = (floor: string) => `/api/projects/${encodeURIComponent(floor)}`;

async function json<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

export const fetchDeletePlan = (floor: string) =>
  fetch(`${base(floor)}/delete-plan`, {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then((r) => json<DeletePlan>(r));

export const fetchDeleteJob = (floor: string) =>
  fetch(`${base(floor)}/delete`, {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then((r) => json<DeleteJobView>(r));

/** The name this browser goes by in the office (its profile), sent as who did it when there's no account. */
export const profileBy = (name: string | undefined): string | undefined => (name && name.trim() && name.trim() !== 'Guest' ? name.trim().slice(0, 32) : undefined);

export const startDelete = (floor: string, req: DeleteRequest) =>
  fetch(`${base(floor)}/delete`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...req, by: profileBy(store.profile?.name) }),
  }).then((r) => json<DeleteJobView>(r));

const FLASH = 'agent-office.deleted-flash';

/** The toast a page that went Home shows once it's there. */
function flashOnArrival() {
  let text: string | null = null;
  try {
    text = sessionStorage.getItem(FLASH);
    sessionStorage.removeItem(FLASH);
  } catch {
    return;
  }
  if (!text) return;
  const show = () => (document.getElementById('toasts') ? toast(text!, 'info') : undefined);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else setTimeout(show, 0);
}
if (typeof document !== 'undefined') flashOnArrival();

/** A deleted project: off it, Home with a toast; elsewhere, a toast. */
export function routeProjectDeleted(msg: ServerMsg) {
  if (msg.t !== 'project.deleted') return;
  const text = `Deleted ${msg.name}${msg.by ? ` (by ${msg.by})` : ''}`;
  if (goesHome(msg, { path: location.pathname, floor: store.floor, search: location.search })) {
    try {
      sessionStorage.setItem(FLASH, text);
    } catch {
      // Home without the toast, then.
    }
    location.assign('/home');
    return;
  }
  toast(text, 'info');
}
