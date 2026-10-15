// Company brain cards (server/portfolios/): one per project at most for each of
//   - a brain change under a live session: "Company brain changed: 1 corrected, 1 withdrawn since Ada's
//     session was prepared", a decision with Rehire for a fresh session / Dismiss (no automatic restart);
//   - incomplete wiring found by the office's completion check, with Wire again / Dismiss.
// The new card kind for decision cards (./candidates.ts has the others). Pure.

import { changeWords, type BrainChangeView } from '../portfolios.js';
import type { NeedItem } from '../needsyou.js';
import type { Candidate } from './candidates.js';

export function brainCandidates(v: BrainChangeView | undefined, floor: string | undefined): Candidate[] {
  if (!v || !floor || v.floor !== floor) return [];
  const out: Candidate[] = [];
  const c = v.change;
  if (c && (c.roles.length || c.rehiring?.length)) {
    const who = c.roles[0]?.name ?? 'the team';
    const text = c.roles.length ? changeWords(c.diff, who) : `Company brain changed: ${c.rehiring!.length} session${c.rehiring!.length === 1 ? '' : 's'} being refreshed`;
    const action = v.admin ? (c.rehiring?.length ? 'Rehire pending: hired again once benched' : 'Rehire for a fresh session') : 'View';
    const need: NeedItem = { key: `brain-${floor}`, kind: 'brain', icon: '🧠', tag: c.label, text, since: c.since, level: 'warn', action, target: { to: 'brain', floor, act: 'rehire' }, ...(v.admin ? { alt: { action: 'Dismiss', target: { to: 'brain', floor, act: 'dismiss' } } } : {}) };
    const files = [...c.diff.corrected.map((p) => `corrected: ${p}`), ...c.diff.withdrawn.map((p) => `withdrawn: ${p}`), ...c.diff.added.map((p) => `added: ${p}`)];
    out.push({
      need,
      source: { id: `brain:${floor}:${c.key}`, type: 'brain', label: `${c.label}'s company brain`, text, target: need.target },
      keys: [],
      kind: 'decision',
      prio: 4,
      body: {
        question: text,
        detail: `The sessions of ${c.roles.map((r) => r.name).join(', ') || 'the team'} were prepared against an earlier version of the brain. They carry on as they are unless you rehire them: a fresh session reads the brain as it is now. Nothing restarts by itself, and withdrawing an item does not take it out of a session or of work already done.`,
        evidence: files.slice(0, 8).map((label) => ({ label, where: `${c.label}'s brain at ${c.key.startsWith('content:') ? 'not versioned' : c.key.slice(0, 7)}` })),
        blocks: [],
        owner: who,
        after: 'After you choose: Rehire benches each session above (it writes its handoff note first) and hires it again fresh; Dismiss leaves them as they are. Nothing is sent to the agents until you press one.',
        notes: ['The context manifest records what each session was offered, not what it read.', ...(c.rehiring?.length ? [`Benching ${c.rehiring.join(', ')} first; each is hired again once benched.`] : [])],
      },
    });
  }
  const wi = v.wiring;
  if (wi) {
    const text = `Company brain wiring is incomplete on this project (${wi.label}): ${wi.problems[0]}${wi.problems.length > 1 ? ` and ${wi.problems.length - 1} more` : ''}`;
    const need: NeedItem = { key: `brain-wiring-${floor}`, kind: 'brain', icon: '🧠', tag: wi.label, text, since: wi.since, level: 'warn', action: v.admin ? 'Wire again' : 'View', target: { to: 'brain', floor, act: 'rewire' }, ...(v.admin ? { alt: { action: 'Dismiss', target: { to: 'brain', floor, act: 'dismiss-wiring' } } } : {}) };
    out.push({ need, source: { id: `brain-wiring:${floor}`, type: 'brain', label: 'the office’s wiring check', text, target: need.target }, keys: [], kind: 'status', prio: 4, body: { question: text, detail: wi.problems.join('; '), evidence: [], blocks: [], owner: 'the office', notes: ['The toolkit’s script exits 0 even when it skips a file, so the office checks each instruction file itself.'] } });
  }
  return out;
}
