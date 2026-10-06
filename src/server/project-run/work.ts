// Whether an asleep agent has work waiting, and why: the preview's reasons (▶ Resume project). Pure: the
// facts are gathered elsewhere (preview.ts) from the roster, the floor's GitHub lists and the worker
// manager, so each source can be tested on its own. An agent with no reason stays asleep by default.

import type { WorkReason } from '../../shared/project-run.js';

export interface WorkFacts {
  /** Escalation answers it hasn't been told (Escalations.owedTo), one line each. */
  owed: string[];
  /** Prompts held for it in the one delivery path (Delivery.heldFor). */
  held: number;
  /** What the office's outbox holds for it (relays.ts): the Coordinator's relays, a Lead's notes. */
  outbox: string[];
  /** Cut off mid-turn by a restart or a crash, and not carried on. */
  cutOff: boolean;
  /** Its open pull requests whose checks fail. */
  failingPrs: { number: number; title: string }[];
  /** Open issues that are its to do: its team's (assigned, or with nobody assigned: `unassigned`); or the one its task names. */
  issues: { number: number; title: string; unassigned?: boolean }[];
  /** The Coordinator only: a compiled standup page it hasn't been handed. */
  standup?: string;
}

export const noFacts = (): WorkFacts => ({ owed: [], held: 0, outbox: [], cutOff: false, failingPrs: [], issues: [] });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: { number: number }[]) => xs.slice(0, 4).map((x) => `#${x.number}`).join(', ') + (xs.length > 4 ? ` +${xs.length - 4}` : '');

/** Each reason it has work waiting, in the order the preview shows them. Empty: nothing to do. */
export function workWaiting(f: WorkFacts): WorkReason[] {
  const out: WorkReason[] = [];
  if (f.owed.length) out.push({ kind: 'owed', text: `${plural(f.owed.length, 'escalation answer')} owed to it` });
  if (f.held) out.push({ kind: 'held', text: `${plural(f.held, 'prompt')} held for it` });
  if (f.outbox.length) out.push({ kind: 'outbox', text: `${plural(f.outbox.length, 'note')} queued for it` });
  if (f.cutOff) out.push({ kind: 'cut-off', text: 'Cut off mid-turn' });
  if (f.failingPrs.length) out.push({ kind: 'failing-pr', text: `Failing checks on PR ${list(f.failingPrs)}` });
  if (f.issues.length) {
    const mine = f.issues.filter((i) => !i.unassigned);
    const free = f.issues.filter((i) => i.unassigned);
    out.push({ kind: 'issue', text: [mine.length ? `Open issue ${list(mine)} assigned` : '', free.length ? `${mine.length ? '' : 'Open '}team issue ${list(free)} with nobody assigned` : ''].filter(Boolean).join('; ') });
  }
  if (f.standup) out.push({ kind: 'standup', text: `Standup ${f.standup} page not handed over` });
  return out;
}

/** Issue numbers a worker's own words name ("issue #12", "#12"): its task, from the queue or a person. */
export function issueRefs(...texts: (string | undefined)[]): number[] {
  const out = new Set<number>();
  for (const t of texts) for (const m of (t ?? '').matchAll(/(?:^|[\s(])#(\d{1,6})\b/g)) out.add(Number(m[1]));
  return [...out];
}
