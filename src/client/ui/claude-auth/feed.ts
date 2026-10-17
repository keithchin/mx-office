// 🔑 Claude for agents for Needs you (server/claude-auth/), from GET /api/claude-auth: office-wide, fetched on
// first use and again when the audit log says a claude-auth.* event happened (a choice, an alert, its end) or an
// incident changed (another agent hit the same alert). No polling of its own. Also the page's calls to change it.

import type { ClaudeAuthMode, ClaudeAuthView } from '../../../shared/claude-auth';
import type { ServerMsg } from '../../../shared/protocol';
import { loadProfile } from '../../state/persist';

let view: ClaudeAuthView | undefined;
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

async function call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<ClaudeAuthView & { restarted?: number }> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify({ ...body, by: loadProfile()?.name }),
  });
  const data = (await res.json().catch(() => ({}))) as ClaudeAuthView & { error?: string; restarted?: number };
  if (!res.ok) throw new Error(data.error ?? `The office said ${res.status}`);
  return data;
}

function take(next: ClaudeAuthView) {
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  for (const fn of subs) fn();
}

async function refresh() {
  try {
    take(await call('GET', '/api/claude-auth'));
  } catch {
    // Next event.
  }
}

export const claudeAuthApi = {
  view: () => call('GET', '/api/claude-auth').then((v) => (take(v), v)),
  set: (mode: ClaudeAuthMode, extra: { baseUrl?: string; key?: string } = {}) => call('POST', '/api/claude-auth', { mode, ...extra }).then((v) => (take(v), v)),
  restart: () => call('POST', '/api/claude-auth/restart', {}).then((v) => (take(v), v)),
};

/** The view as last fetched (the first call starts fetching). */
export function claudeAuthNeed(): ClaudeAuthView | undefined {
  if (typeof fetch !== 'function') return undefined;
  if (!started) {
    started = true;
    void refresh();
  }
  return view;
}

export function onClaudeAuthChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: a claude-auth or incident event means the view may have changed. */
export function claudeAuthFeedMessage(msg: ServerMsg) {
  if (!started) return;
  const again = msg.t === 'welcome' || (msg.t === 'audit.new' && (msg.event.action.startsWith('claude-auth.') || msg.event.action.startsWith('incident.')));
  if (!again) return;
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 300);
}
