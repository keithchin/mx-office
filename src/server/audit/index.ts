// The office's audit log (see log.ts for the file and its chain): `audit.record(...)` from anywhere in
// the server, once the office has installed it (office.ts); before that, and in tests that don't, it
// does nothing. Everything recorded is redacted first: token-like strings in the summary, the target
// and the details become [redacted], and so does any detail named like a secret. Other modules read it
// with readAudit (The Firm's reviewers among them) and GET /api/audit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OFFICE_FLOOR, type AuditActor, type AuditChain, type AuditEvent, type AuditInput, type AuditPage } from '../../shared/audit.js';
import { redact } from '../judge/pure.js';
import { AuditLog, fileKey } from './log.js';
import { queryEvents, type AuditQuery } from './query.js';

export { AuditLog } from './log.js';
export type { AuditQuery } from './query.js';

let current: AuditLog | undefined;
let onNew: ((e: AuditEvent) => void) | undefined;
/** The last time each floor:action:target was recorded, so the GitHub watcher doesn't repeat what a person just did. */
const recent = new Map<string, number>();

/** Uses `log` from now on (undefined: stops recording), telling `notify` about every new event. */
export function useAudit(log: AuditLog | undefined, notify?: (e: AuditEvent) => void) {
  current = log;
  onNew = notify;
  recent.clear();
}

export const auditLog = () => current;

const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|cookie/i;

/** A detail value redacted: strings cut short and cleaned, nesting and lists kept small. */
export function redactValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return redact(v.length > 2000 ? `${v.slice(0, 2000)}…` : v);
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v).slice(0, 60)) out[k] = SECRET_KEY.test(k) && x !== undefined && typeof x !== 'boolean' ? '[redacted]' : redactValue(x, depth + 1);
  return out;
}

/** What gets written: the input with anything secret-looking taken out. */
export function redactInput(e: AuditInput): AuditInput {
  return {
    ...e,
    actor: { ...e.actor, name: redact(String(e.actor.name).slice(0, 80)) },
    summary: redact(String(e.summary).replace(/\s+/g, ' ').trim().slice(0, 300)),
    ...(e.target ? { target: redactValue(e.target) as AuditInput['target'] } : {}),
    ...(e.details ? { details: redactValue(e.details) as Record<string, unknown> } : {}),
  };
}

export const audit = {
  /** Records one event; never throws (a log that can't be written is said so in the office's log). */
  record(e: AuditInput): AuditEvent | undefined {
    const log = current;
    if (!log) return undefined;
    try {
      const event = log.append(redactInput(e));
      recent.set(`${fileKey(e.floor)}:${e.action}:${e.target?.id ?? ''}`, event.at);
      if (recent.size > 2000) recent.delete(recent.keys().next().value!);
      onNew?.(event);
      return event;
    } catch (err) {
      console.error(`agent-office: couldn't write the audit log: ${(err as Error).message}`);
      return undefined;
    }
  },
  /**
   * A floor's team settings changed: `roster.settings` with just the fields that did, before and
   * after, and `roster.autonomy` too when the autonomy level is one of them. Nothing when none did.
   */
  settingsDiff(floor: string, actor: AuditActor, before: object, after: object) {
    const diff = changedFields(before as Record<string, unknown>, after as Record<string, unknown>);
    const keys = Object.keys(diff.after);
    if (!keys.length) return;
    audit.record({ floor, actor, action: 'roster.settings', target: { kind: 'settings', id: floor, label: 'Team settings' }, summary: `Changed the team settings: ${keys.join(', ')}`, details: diff, severity: 'notice' });
    if ('autonomy' in diff.after) audit.record({ floor, actor, action: 'roster.autonomy', target: { kind: 'settings', id: floor, label: 'Autonomy level' }, summary: `Set the team's autonomy level from ${String(diff.before.autonomy)} to ${String(diff.after.autonomy)}`, details: { before: { autonomy: diff.before.autonomy }, after: { autonomy: diff.after.autonomy } }, severity: 'warning' });
  },
  /** Whether `action` on `target` was recorded on that floor in the last `ms`. */
  recently(floor: string | undefined, action: string, targetId: string | undefined, ms: number): boolean {
    const at = recent.get(`${fileKey(floor)}:${action}:${targetId ?? ''}`);
    return at !== undefined && Date.now() - at < ms;
  },
};

/** The top-level fields that differ between two settings objects, before and after. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    out.before[k] = before[k] ?? null;
    out.after[k] = after[k] ?? null;
  }
  return out;
}

// ---- Actors ----------------------------------------------------------------------------------------

export const human = (name: string, id?: string): AuditActor => ({ kind: 'human', name: name || 'Someone', ...(id ? { id } : {}) });
export const office = (name = 'The office'): AuditActor => ({ kind: 'office', name });
export const jeff = (): AuditActor => ({ kind: 'jeff', name: 'Jeff' });
export const agent = (name: string, id?: string): AuditActor => ({ kind: 'agent', name, ...(id ? { id } : {}) });
/** A `by` the roster passes: a person's name, or the office acting by itself. */
export const byWhom = (by: string, id?: string): AuditActor => (/^(the office|idle|schedule)$/i.test(by) ? office() : /jeff/i.test(by) ? jeff() : human(by, id));

// ---- Settings --------------------------------------------------------------------------------------

/** Whether a human's prompt to a worker is logged with its first 80 characters (off: just its length). */
export function promptTextLogged(log = current): boolean {
  if (!log) return false;
  try {
    return JSON.parse(readFileSync(path.join(log.dir, 'settings.json'), 'utf8')).promptText === true;
  } catch {
    return false;
  }
}

export function setPromptTextLogged(on: boolean, log = current) {
  if (!log) return;
  mkdirSync(log.dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(log.dir, 'settings.json'), JSON.stringify({ promptText: on }), { mode: 0o600 });
}

/** A prompt as the log keeps it: its length, and its start only when that's switched on. */
export function promptDetails(text: string): Record<string, unknown> {
  return promptTextLogged() ? { length: text.length, start: text.slice(0, 80) } : { length: text.length };
}

// ---- Reading ---------------------------------------------------------------------------------------

/** The file keys a query reads: one floor's, or all of them. */
function keysFor(log: AuditLog, floor: string | undefined): string[] {
  if (floor && floor !== 'all') return [fileKey(floor)];
  return log.floors();
}

/** Whether the chain holds on every floor asked for; the earliest break when it doesn't. */
export function verifyAudit(floor?: string, log = current): AuditChain {
  if (!log) return { ok: true };
  let worst: AuditChain = { ok: true };
  for (const key of keysFor(log, floor)) {
    const r = log.verify(key);
    if (!r.ok && (worst.ok || (r.brokenAt ?? 0) < (worst.brokenAt ?? Infinity))) worst = r;
  }
  return worst;
}

/**
 * A page of the audit log, newest first, for other modules (The Firm's reviewers) and the API:
 * the events, the cursor to the next page, counts by action and actor kind, and whether the chain holds.
 */
export function readAudit(q: AuditQuery = {}, log = current): AuditPage {
  if (!log) return { events: [], total: 0, counts: { actions: {}, actors: {} }, chain: { ok: true }, promptText: false };
  const lists = keysFor(log, q.floor).filter((k) => existsSync(path.join(log.dir, `${k}.jsonl`))).map((k) => log.events(k));
  return { ...queryEvents(lists, q), chain: verifyAudit(q.floor, log), promptText: promptTextLogged(log) };
}

export { OFFICE_FLOOR };
