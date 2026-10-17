// 🔑 Claude for agents: where the agents' Claude Code gets its credentials (source.ts), shown and chosen in
// 🔌 Connections (an admin's choice, audited as claude-auth.change), the one-time decision when the office's
// environment has a key nobody confirmed, and the office-wide alert when Claude rejects the agents'
// credentials (watch.ts reads it off their transcripts): one red Needs-you item and one incident for the
// office, however many agents hit it, cleared by the next turn that works. Its claude-auth.* audit events
// tell the pages to fetch again (GET /api/claude-auth, ui/claude-auth/).

import { CREDENTIAL_META } from '../../shared/connections.js';
import { cleanBaseUrl, decisionPending, decisionText, failureText, isClaudeAuthMode, sourceWords, type ClaudeAuthMode, type ClaudeAuthView } from '../../shared/claude-auth.js';
import { maskTail } from '../../shared/connections.js';
import { audit, human, office } from '../audit/index.js';
import { connectionsVault, updateOfficeSettings } from '../connections/store.js';
import { notedTranscript } from '../convo/index.js';
import { raise, updateIncident, incidentStore } from '../incidents/index.js';
import type { Ctx } from '../office/context.js';
import { claudeAuthState, sourceDeps, sourceLogLine, type SourceDeps } from './source.js';
import { AuthWatch, POLL_MS, type WatchedWorker } from './watch.js';

export { withClaudeAuth } from './source.js';

const ACTOR = office('Claude for agents');
const LABEL: Record<ClaudeAuthMode, string> = { login: 'their Claude login', key: 'the API key saved in Connections', gateway: 'the gateway saved in Connections', env: 'the office’s environment' };
const target = { kind: 'setting', id: 'claudeAuth', label: 'Claude for agents' } as const;

interface Failure {
  at: number;
  mode: ClaudeAuthMode;
  text: string;
  workers: Map<string, WatchedWorker>;
  incident?: string;
}

let failure: Failure | undefined;

/** Forgets the alert (tests). */
export function resetClaudeAuth() {
  failure = undefined;
}

/** An agent's turn ended with Claude's authentication failure: the office's one alert, and its incident. */
export function noteAuthFailure(w: WatchedWorker, at: number, d: SourceDeps = sourceDeps()) {
  if (failure?.workers.has(w.id)) return;
  const first = !failure;
  if (!failure) {
    const s = claudeAuthState(d);
    failure = { at, mode: s.mode, text: failureText(s.mode, s.env), workers: new Map() };
  }
  failure.workers.set(w.id, w);
  failure.at = Math.max(failure.at, at);
  const inc = raise({
    rule: 'claudeAuth',
    severity: 'sev2',
    title: 'Claude rejected the agents’ credentials',
    summary: failure.text,
    again: `${w.name}’s turn failed the same way`,
    workers: [{ id: w.id, name: w.name, floor: w.floor }],
    at,
  });
  failure.incident = inc?.id ?? failure.incident;
  if (first) audit.record({ actor: ACTOR, action: 'claude-auth.failed', target, summary: failure.text, details: { mode: failure.mode, worker: w.name }, severity: 'warning' });
}

/** A turn that worked, after the alert: it's over (and so is its incident). */
export function noteTurnOk(at: number) {
  if (!failure || at <= failure.at) return;
  const was = failure;
  failure = undefined;
  if (was.incident && incidentStore()?.get(was.incident)?.status !== 'resolved') updateIncident(was.incident, { status: 'resolved' }, ACTOR, { note: 'An agent’s turn worked again: Claude accepts the agents’ credentials.' });
  audit.record({ actor: ACTOR, action: 'claude-auth.cleared', target, summary: 'Claude accepts the agents’ credentials again (an agent’s turn worked)', severity: 'info' });
}

/** What the page shows (an admin sees the tails; nobody sees a value). */
export function claudeAuthView(admin: boolean, d: SourceDeps = sourceDeps()): ClaudeAuthView {
  const s = claudeAuthState(d);
  const saved = { key: s.key ? maskTail(s.key) : undefined, gatewayKey: s.gatewayKey ? maskTail(s.gatewayKey) : undefined, baseUrl: s.setting?.baseUrl };
  const words = sourceWords(s.mode, s.chosen, s.env, saved);
  return {
    mode: s.mode,
    chosen: s.chosen,
    ...words,
    env: admin ? s.env : { ...s.env, keys: s.env.keys.map((k) => ({ name: k.name })) },
    saved: admin ? saved : { baseUrl: saved.baseUrl },
    ...(decisionPending(s.setting, !!s.key, s.env) ? { decision: { text: decisionText(s.env) } } : {}),
    ...(failure ? { failure: { at: failure.at, text: failure.text, workers: [...failure.workers.values()], incident: failure.incident } } : {}),
    admin,
  };
}

export interface ClaudeAuthChange {
  mode: unknown;
  baseUrl?: unknown;
  key?: unknown;
}

const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** An admin's choice (the route checked who): saved, the key in the vault, and audited. Returns why it couldn't. */
export async function setClaudeAuth(change: ClaudeAuthChange, who: { name: string; id?: string }, d: SourceDeps = sourceDeps()): Promise<string | undefined> {
  const mode = change.mode;
  if (!isClaudeAuthMode(mode)) return 'Pick where the agents’ Claude credentials come from';
  const before = claudeAuthState(d);
  const key = str(change.key);
  if (key && /\s/.test(key)) return 'That has spaces or line breaks in it: paste just the key';
  let baseUrl = before.setting?.baseUrl;
  const vault = connectionsVault();
  if (mode === 'gateway') {
    baseUrl = cleanBaseUrl(str(change.baseUrl, 600) || baseUrl || '');
    if (!baseUrl) return 'The gateway’s base URL: an https:// address, with no user name or password in it';
    if (!key && !before.gatewayKey) return 'Paste the gateway’s key';
  }
  if (mode === 'key') {
    const shape = CREDENTIAL_META.anthropic.shape!;
    if (key && !shape.test(key)) return CREDENTIAL_META.anthropic.shapeHint;
    if (!key && !before.key) return 'Paste the API key';
  }
  if (mode === 'env' && !before.env.keys.length && !before.env.cloud.length && !before.env.withheld.length) return 'The office’s environment has no Claude credentials to use';
  if (key && (mode === 'gateway' || mode === 'key')) {
    if (!vault) return 'Connections isn’t open in this office';
    try {
      await vault.set(mode === 'gateway' ? 'claude-gateway' : 'anthropic', key, who.name);
    } catch (err) {
      return (err as Error).message;
    }
  }
  updateOfficeSettings({ claudeAuth: { mode, ...(baseUrl ? { baseUrl } : {}), at: Date.now(), by: who.name } });
  const was = before.chosen ? LABEL[before.mode] : `${LABEL[before.mode]} (nobody chose)`;
  audit.record({
    actor: human(who.name, who.id),
    action: 'claude-auth.change',
    target,
    summary: `${who.name} set the agents’ Claude credentials to ${LABEL[mode]} (was ${was}); agents started from now on${key ? ', with a new key saved' : ''}`,
    details: { before: { mode: before.mode, chosen: before.chosen }, after: { mode, ...(mode === 'gateway' ? { baseUrl } : {}) }, ...(key ? { key: 'replaced' } : {}) },
    severity: 'notice',
  });
  return undefined;
}

/** The agents the alert names, stopped and started again with the environment as it is now: how many. */
export async function restartAffected(ctx: Pick<Ctx, 'floors'>, who: { name: string; id?: string }, waitMs = 10_000): Promise<number> {
  const ids = [...(failure?.workers.values() ?? [])];
  let n = 0;
  for (const w of ids) {
    const floor = w.floor ? ctx.floors.get(w.floor) : [...ctx.floors.values()].find((f) => f.workers.list().some((x) => x.id === w.id));
    const m = floor?.workers;
    const info = m?.list().find((x) => x.id === w.id);
    if (!m || !info) continue;
    if (info.status !== 'exited') {
      m.sleep(w.id);
      const until = Date.now() + waitMs;
      while (m.list().find((x) => x.id === w.id)?.status !== 'exited' && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    }
    const err = m.resume(w.id, 'The office fixed how you sign in to Claude (your last turn failed with an authentication error before it could start). Carry on with your task from where you were.', true);
    if (!err) n++;
  }
  audit.record({ actor: human(who.name, who.id), action: 'claude-auth.restart', target, summary: `${who.name} restarted ${n} agent${n === 1 ? '' : 's'} Claude had refused, with the agents’ Claude credentials as they are now`, details: { workers: ids.map((w) => w.name) }, severity: 'notice' });
  return n;
}

/** At start (server.ts): the log line, and the watch on the agents' transcripts. Returns its stop. */
export function installClaudeAuth(ctx: Pick<Ctx, 'floors'>): () => void {
  console.log(`  🔑 ${sourceLogLine(claudeAuthState())}`);
  const watch = new AuthWatch({
    workers: () =>
      [...ctx.floors.values()].flatMap((f) =>
        f.workers
          .list()
          // A worker run as someone (their own Claude sign-in, signins.ts) isn't the office's credentials.
          .filter((w) => w.kind === 'agent' && !f.workers.ownerOf(w.id))
          .map((w) => ({ id: w.id, name: w.name, floor: f.id, transcript: notedTranscript(w.id) })),
      ),
    onFail: (w, at) => noteAuthFailure(w, at),
    onOk: (_w, at) => noteTurnOk(at),
    now: Date.now,
  });
  const timer = setInterval(() => void watch.tick().catch(() => undefined), POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
