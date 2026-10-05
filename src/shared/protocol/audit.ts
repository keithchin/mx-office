// The audit log's one message: a new event, for the Audit log tabs that are open (shared/audit.ts).
import type { AuditEvent } from '../audit.js';

export type AuditServerMsg = { t: 'audit.new'; floor: string; event: AuditEvent };
