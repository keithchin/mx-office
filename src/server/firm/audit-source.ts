// The office audit log, for the Firm: what reviewers read as evidence (`readAudit`) and where the
// Firm records its own steps (`record`).
//
// The audit log is src/server/audit/: its newest events (as evidence), and the Firm's steps recorded
// in it with the reviewer actor kind.

export interface AuditEntry {
  at?: number;
  floor?: string;
  kind?: string;
  text?: string;
  [k: string]: unknown;
}

export interface AuditSource {
  read(opts: { floor?: string; limit?: number }): Promise<AuditEntry[]>;
  record(entry: { floor?: string; kind: string; text: string; data?: unknown }): void;
}

import { audit, readAudit } from '../audit/index.js';

const NONE: AuditSource = { read: async () => [], record: () => {} };

type AuditModule = { readAudit?: (...a: unknown[]) => unknown; record?: (...a: unknown[]) => unknown };

/** The audit log when the office has one, else one that's always empty. `load` is for the tests. */
export async function auditSource(load: () => Promise<AuditModule> = async () => OFFICE_AUDIT): Promise<AuditSource> {
  let mod: AuditModule;
  try {
    mod = await load();
  } catch {
    return NONE;
  }
  if (typeof mod.readAudit !== 'function') return NONE;
  const readAudit = mod.readAudit;
  const rec = mod.record;
  return {
    async read(opts) {
      try {
        const got = (await readAudit(opts)) as AuditEntry[] | { events?: AuditEntry[] };
        const rows = Array.isArray(got) ? got : (got?.events ?? []);
        return rows.slice(-(opts.limit ?? 500));
      } catch {
        return [];
      }
    },
    record(entry) {
      try {
        if (typeof rec === 'function') rec(entry);
      } catch {
        // the log is best-effort for the Firm
      }
    },
  };
}

/** The office's own log, in the shape this adapter reads: the Firm's steps are a reviewer's. */
const OFFICE_AUDIT: AuditModule = {
  readAudit: (opts) => readAudit(opts as { floor?: string; limit?: number }),
  record: (raw) => {
    const e = raw as { floor?: string; kind: string; text: string; data?: unknown };
    audit.record({ floor: e.floor, actor: { kind: 'reviewer', name: 'The Firm' }, action: e.kind, target: { kind: 'engagement', label: 'Audit' }, summary: e.text, details: (e.data ?? undefined) as Record<string, unknown> | undefined, severity: 'notice' });
  },
};
