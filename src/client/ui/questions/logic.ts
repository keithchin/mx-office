// What the Questions page works out from its view, as pure functions the tests drive without a page: the
// filters and search, the groups by BRD, and how many answers are ready for whom (the sticky bar).

import { blocksWork, isResolved, needsClient, youCanDecide, type BrdRef, type PmAnswer, type Question, type QuestionsView } from '../../../shared/questions';

export type QFilter = 'all' | 'client' | 'decide' | 'blocks' | 'answered';

export const FILTERS: readonly { id: QFilter; label: string; tip: string }[] = [
  { id: 'all', label: 'All', tip: 'Every open question the analysts raised' },
  { id: 'client', label: 'Needs the client', tip: 'user-only: a fact only the client has' },
  { id: 'decide', label: 'You can decide', tip: 'choice: a fork you or the client decide, often with a proposed position' },
  { id: 'blocks', label: 'Blocks work', tip: 'Questions whose "blocks" names work held up by them' },
  { id: 'answered', label: 'Answered', tip: 'Answered by you, or settled in the BRD' },
];

const answeredBy = (q: Question, a: PmAnswer | undefined) => isResolved(q.state) || (!!a && a.kind !== 'ask-client');

/** Whether `q` passes the filter and the search (id, question, evidence, blocks, owner, BRD). */
export function passes(q: Question, a: PmAnswer | undefined, f: QFilter, search: string): boolean {
  if (f === 'client' && !needsClient(q)) return false;
  if (f === 'decide' && !youCanDecide(q)) return false;
  if (f === 'blocks' && !blocksWork(q)) return false;
  if (f === 'answered' && !answeredBy(q, a)) return false;
  const s = search.trim().toLowerCase();
  if (!s) return true;
  return [q.id, q.question, q.evidence, q.blocks, q.owner, q.brd, q.brdTitle, q.proposedPosition, a?.text].some((x) => x?.toLowerCase().includes(s));
}

export interface Group {
  file: string;
  title: string;
  questions: Question[];
}

/** The questions that pass, grouped by BRD (its title), in the BRDs' order; open ones before settled ones in each. */
export function groups(v: QuestionsView, f: QFilter, search: string): Group[] {
  const qs = (v.set?.questions ?? []).filter((q) => passes(q, v.answers[q.key], f, search));
  const brds = new Map<string, BrdRef>((v.set?.brds ?? []).map((b) => [b.file, b]));
  const by = new Map<string, Question[]>();
  for (const q of qs) by.set(q.file, [...(by.get(q.file) ?? []), q]);
  const rank = (q: Question) => (isResolved(q.state) ? 2 : v.answers[q.key] ? 1 : 0);
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, list]) => {
      const b = brds.get(file);
      return { file, title: b ? [b.id, b.title].filter(Boolean).join(' · ') || file : file, questions: list.sort((x, y) => rank(x) - rank(y) || x.id.localeCompare(y.id, undefined, { numeric: true })) };
    });
}

/** The answers ready to send, by who records them ('' for questions nobody at work can take). */
export function readyByRecipient(v: QuestionsView): Map<string, PmAnswer[]> {
  const out = new Map<string, PmAnswer[]>();
  for (const a of Object.values(v.answers)) {
    if (a.status !== 'pending' || a.kind === 'ask-client') continue;
    const to = v.routes[a.key] ?? '';
    out.set(to, [...(out.get(to) ?? []), a]);
  }
  return out;
}

/** "7 answers ready · Send to Tim". */
export const readyWords = (n: number) => `${n} answer${n === 1 ? '' : 's'} ready`;

/** The page's empty state, when there's nothing to list. */
export function emptyWords(v: QuestionsView | undefined): string | undefined {
  if (!v?.set) return v?.collecting ? 'Reading the BRDs…' : 'Not collected yet.';
  if (v.set.via === 'none') return 'No BRDs yet: the questions appear here once an analyst writes them into the BRDs (openQuestions).';
  if (!v.set.questions.length) return v.set.via === 'brd' ? 'No open questions (toolkit script unavailable: read from the BRD files).' : 'No open questions.';
  return undefined;
}
