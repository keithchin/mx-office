// What will refuse ✅ Accept, shown before it's pressed (server/acceptance/preflight.ts works it out with the
// same checks Accept runs, without starting anything). Each gate says whether the office's code enforces it
// (Accept is refused while it fails, the server's refusal unchanged) or it's informational (recorded with the
// acceptance, never a refusal: guided checks, the testing policy, reviews at merge time). Pure.

export type AcceptGateId = 'admin' | 'cycle' | 'commit' | 'security' | 'testing' | 'guided' | 'reviews';

export interface AcceptGate {
  id: AcceptGateId;
  label: string;
  /** True: Accept is refused while it fails (code). False: shown, recorded, never a refusal. */
  enforced: boolean;
  /** pass, fail (enforced: Accept will be refused), unknown (couldn't tell), info (informational, nothing to pass). */
  state: 'pass' | 'fail' | 'unknown' | 'info';
  /** For a failing enforced gate: the words Accept's refusal gives. Otherwise what the office found. */
  text: string;
  /** Where it's fixed (a project tab), when somewhere. */
  action?: { label: string; tab: string };
}

/** The gates that will refuse Accept now. */
export const blockers = (gates: readonly AcceptGate[]): AcceptGate[] => gates.filter((g) => g.enforced && g.state === 'fail');

/** "Accept will be refused: 2 checks aren't met" / "Nothing enforced stands in the way". */
export function gatesHeadline(gates: readonly AcceptGate[]): string {
  const b = blockers(gates).length;
  return b ? `Accept will be refused until ${b === 1 ? 'this is' : `these ${b} are`} met` : 'Nothing the office enforces stands in the way of Accept';
}
