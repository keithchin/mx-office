// Whether a floor has a design-system binding, for the Playbooks (roster/members.ts): the design service hands
// its check in at start (./index.ts); before that, and in tests without it, no floor is bound. A project with
// no binding gets exactly the Playbook it got before design systems.

let check: (floor: string) => boolean = () => false;

export const useDesignBound = (fn: (floor: string) => boolean) => void (check = fn);

export function designBound(floor: string): boolean {
  try {
    return check(floor);
  } catch {
    return false;
  }
}
