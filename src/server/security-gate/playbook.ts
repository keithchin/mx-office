// The security policy in the Playbooks (roster/members.ts asks here when it writes one): the security
// service hands in its lookup at start (index.ts); before that, and in tests without it, a Playbook has no
// security section, exactly as before E2. Which roles get it is `securityRole`.

import type { RoleId } from '../../shared/roster/roles.js';
import type { SecurityPolicy } from '../../shared/security.js';

let peek: ((floor: string) => SecurityPolicy | undefined) | undefined;

export const useSecurityPolicy = (fn: ((floor: string) => SecurityPolicy | undefined) | undefined) => void (peek = fn);

/** The project's policy for its Playbooks, when the service is running. */
export function securityOfProject(floor: string): { security?: SecurityPolicy } {
  try {
    const p = peek?.(floor);
    return p ? { security: p } : {};
  } catch {
    return {};
  }
}

/** Roles that write or check the model: they get the baseline's section (and whoever covers Development for them). */
export const securityRole = (role: RoleId, also: readonly RoleId[] = []) => role === 'lead-developer' || role === 'solo-lead' || role === 'lead-tester' || also.includes('lead-developer');
