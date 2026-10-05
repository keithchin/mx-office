// The office audit log, for the Firm: what reviewers read as evidence (`readAudit`) and where the
// Firm records its own steps (`record`).
//
// INTEGRATION POINT: the audit log (src/server/audit/, exporting `readAudit(...)` and `record(...)`,
// with GET /api/audit) is being built alongside the Firm and isn't on this branch yet. Until it is,
// this adapter looks for it at run time and, when it isn't there, reads as empty and records nothing.
// Once it's merged, replace the dynamic import below with a plain
// `import { readAudit, record } from '../audit/index.js'` and adjust `AuditEntry` to its type.

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

const NONE: AuditSource = { read: async () => [], record: () => {} };

type AuditModule = { readAudit?: (...a: unknown[]) => unknown; record?: (...a: unknown[]) => unknown };

/** The audit log when the office has one, else one that's always empty. `load` is for the tests. */
export async function auditSource(load: () => Promise<AuditModule> = () => import(/* @vite-ignore */ AUDIT_MODULE) as Promise<AuditModule>): Promise<AuditSource> {
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
        const rows = await readAudit(opts);
        return Array.isArray(rows) ? (rows as AuditEntry[]).slice(-(opts.limit ?? 500)) : [];
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

/** A variable, so the typecheck doesn't need the module to be there yet. */
const AUDIT_MODULE = '../audit/index.js';
