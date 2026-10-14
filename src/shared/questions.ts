// The Questions page (server/questions/, docs/site/using-the-office/questions.md): the open questions an
// analyst agent raised for the client in the BRD files (`openQuestions`, with the mxcli-project-toolkit's
// controlled vocabulary from bin/open-questions.sh), collected by the office from the project's folder
// and every agent's working copy, shown to the Project Manager in one place, answered there and sent to
// the agent to record. This file is the part both sides read: the shapes, what "waiting on you" means,
// the words each card and the Needs-you row say, and the one message Send builds. Pure.

/** The toolkit's six states (bin/open-questions.sh): UNRAISED and UNRECOGNISED block a gate. */
export const Q_STATES = ['UNRAISED', 'RAISED', 'ANSWERED', 'ASSUMED', 'MOOT', 'UNRECOGNISED'] as const;
export type QState = (typeof Q_STATES)[number];
export const isQState = (v: unknown): v is QState => typeof v === 'string' && (Q_STATES as readonly string[]).includes(v);

/** The states that mean it's settled: the person decided, consented, or it stopped mattering. */
export const RESOLVED_STATES: readonly QState[] = ['ANSWERED', 'ASSUMED', 'MOOT'];
export const isResolved = (s: QState) => RESOLVED_STATES.includes(s);

/** Where a question was read: the project's folder (main), or an agent's worktree, and whether it's committed there. */
export interface QuestionSource {
  where: 'main' | 'worktree';
  /** The agent whose worktree it is, when the office knows it. */
  agent?: string;
  workerId?: string;
  /** The worktree's folder name (.agent-office/worktrees/<name>). */
  worktree?: string;
  /** The file is committed as it is (false: new or changed in the working copy). */
  committed: boolean;
}

export interface Question {
  /** Stable: `<file>#<id>`, the merge key. */
  key: string;
  id: string;
  /** The BRD's file name (F002-visitor-invitations.brd.json), or sme-questions.md for one only there. */
  file: string;
  /** The BRD's id and title, when it's a BRD's. */
  brd?: string;
  brdTitle?: string;
  question: string;
  /** user-only (a fact only the client has), choice (a fork the client decides), gap, conflict… as written. */
  kind?: string;
  /** The toolkit's verdict (the script's, or the office's reading of the same rules when it can't run). */
  state: QState;
  rawStatus: string;
  /** Why the toolkit placed it there ("raised, awaiting the user (rule 6)"). */
  reason?: string;
  evidence?: string;
  proposedPosition?: string;
  /** What it holds up, in words ("FR05, AC03"). */
  blocks?: string;
  owner?: string;
  sourceRef?: string;
  options?: string[];
  answer?: string;
  consentBy?: string;
  consentAt?: string;
  /** The position an agent took (decision / assumption), as recorded. */
  assumption?: string;
  /** Written ASSUMED with no consentBy/consentAt: the toolkit reads it as UNRAISED, the page warns. */
  assumedNoConsent?: boolean;
  /** When it was put to the user (raisedAtGate's date), else when the office first saw it or the file's time (ms). */
  since?: number;
  source: QuestionSource;
}

/** A BRD the questions came from. */
export interface BrdRef {
  file: string;
  id?: string;
  title?: string;
}

/** One collection of a floor's questions. */
export interface QuestionSet {
  floor: string;
  at: number;
  /** script: bin/open-questions.sh gave the states; brd: read from the BRD files (the script couldn't run); none: no BRDs anywhere. */
  via: 'script' | 'brd' | 'none';
  /** Said on the page when it isn't the script's word ("read from the BRD files (toolkit script unavailable)"). */
  note?: string;
  brds: BrdRef[];
  questions: Question[];
  /** What went wrong on the way, per folder, for the page's small print. */
  problems?: string[];
}

export type AnswerKind = 'answer' | 'accept' | 'ask-client' | 'moot';
export const ANSWER_KINDS: readonly AnswerKind[] = ['answer', 'accept', 'ask-client', 'moot'];

/** Where the person's answer is on its way back into the BRD. */
export type WriteBack = 'pending' | 'sent' | 'recorded';

/** The person's answer to one question, kept in the office's data until the toolkit shows it recorded. */
export interface PmAnswer {
  key: string;
  id: string;
  file: string;
  kind: AnswerKind;
  /** The answer (answer), or the reason (moot). */
  text?: string;
  /** Which option of a choice, when the data has options. */
  option?: string;
  by: string;
  at: number;
  /** Imported from the client's filled-in file (or pasted lines): who imported it. */
  fromClient?: { by: string; at: number };
  status: WriteBack;
  sentAt?: number;
  sentTo?: string;
  recordedAt?: number;
  /** The toolkit's state when it was seen recorded. */
  recordedState?: QState;
}

/** Who Send goes to: the agent whose worktree the questions are in, or whoever covers Analysis. */
export interface Recipient {
  name: string;
  workerId: string;
  working: boolean;
}

/** GET /api/questions?floor=: the last collection, the person's answers, and who answers go to. */
export interface QuestionsView {
  floor: string;
  set?: QuestionSet;
  answers: Record<string, PmAnswer>;
  /** Who each question's answer goes to, by question key: a name from `recipients`. */
  routes: Record<string, string>;
  recipients: Recipient[];
  /** A collection is running now. */
  collecting: boolean;
  admin: boolean;
  /** What Needs you shows of it (the same the server's Needs you reads). */
  need?: QuestionsNeed;
}

// ---- What waits on whom --------------------------------------------------------------------------------

/** The toolkit says the person hasn't settled it: never raised, raised and awaiting them, or unreadable. */
export const openState = (s: QState) => s === 'RAISED' || s === 'UNRAISED' || s === 'UNRECOGNISED';

/** Waiting on the person: open by the toolkit, and no answer (or Ask the client) of theirs yet. */
export const waitingOnYou = (q: Question, a: PmAnswer | undefined) => openState(q.state) && !a;

/** It holds work up: its `blocks` names something. */
export const blocksWork = (q: Question) => !!q.blocks && !/^\s*(none|nothing|n\/a|-)?\s*\.?\s*$/i.test(q.blocks);

/** Needs the client: a fact only they have. */
export const needsClient = (q: Question) => q.kind === 'user-only';

/** The person could decide it themselves: a choice (and the gaps and conflicts the analyst offers a position on). */
export const youCanDecide = (q: Question) => !!q.kind && q.kind !== 'user-only';

export interface QuestionCounts {
  total: number;
  answered: number;
  waiting: number;
  blocking: number;
  /** BRDs with a question waiting on you. */
  brds: number;
}

/** The header's numbers: "answered" is every question settled by the toolkit or answered by the person. */
export function questionCounts(qs: readonly Question[], answers: Readonly<Record<string, PmAnswer>>): QuestionCounts {
  const waiting = qs.filter((q) => waitingOnYou(q, answers[q.key]));
  return {
    total: qs.length,
    answered: qs.filter((q) => isResolved(q.state) || (answers[q.key] && answers[q.key].kind !== 'ask-client')).length,
    waiting: waiting.length,
    blocking: waiting.filter(blocksWork).length,
    brds: new Set(waiting.map((q) => q.file)).size,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** " · 6 block work", or nothing when none do or every one does (then it narrows nothing down). */
const blockWords = (blocking: number, of: number) => (blocking > 0 && blocking < of ? ` · ${blocking} block work` : '');

/** "Questions · 9 of 24 answered · 6 block work". */
export function headerWords(c: QuestionCounts): string {
  return `Questions · ${c.answered} of ${c.total} answered${blockWords(c.blocking, c.total)}`;
}

// ---- Needs you -----------------------------------------------------------------------------------------

/** What Needs you reads of a project's questions (GET /api/questions, or the server's own view). */
export interface QuestionsNeed {
  floor: string;
  waiting: number;
  brds: number;
  blocking: number;
  /** Goes up each time questions the office hadn't seen start waiting: one notification per batch. */
  batch: number;
  /** When the newest of them was first seen. */
  since?: number;
}

/** "24 questions for the client · 5 BRDs · 6 block work". */
export const needsWords = (n: QuestionsNeed) => `${plural(n.waiting, 'question')} for the client · ${plural(n.brds, 'BRD')}${blockWords(n.blocking, n.waiting)}`;

/** The Needs-you row's parts (shared/needsyou.ts makes the item): one per project, keyed by its batch. */
export function questionsNeedParts(n: QuestionsNeed | undefined): { key: string; text: string; since?: number; level: 'block' | 'warn' } | undefined {
  if (!n || n.waiting <= 0) return undefined;
  return { key: `questions-b${n.batch}`, text: needsWords(n), ...(n.since !== undefined ? { since: n.since } : {}), level: n.blocking ? 'block' : 'warn' };
}

/** The need from a view, as the page's feed and the server work it out. */
export function needOf(floor: string, set: QuestionSet | undefined, answers: Readonly<Record<string, PmAnswer>>, batch: number, since?: number): QuestionsNeed | undefined {
  if (!set) return undefined;
  const c = questionCounts(set.questions, answers);
  return c.waiting ? { floor, waiting: c.waiting, brds: c.brds, blocking: c.blocking, batch, ...(since !== undefined ? { since } : {}) } : undefined;
}

// ---- Each card's words ---------------------------------------------------------------------------------

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Tim's working copy, not committed" / "Tim's branch" / "main". */
export function sourceWords(s: QuestionSource): string {
  if (s.where === 'main') return s.committed ? 'main' : 'the project folder, not committed';
  const who = s.agent ? `${s.agent}'s` : s.worktree ? `worktree ${s.worktree}'s` : "an agent's";
  return s.committed ? `${who} branch, committed` : `${who} working copy, not committed`;
}

export type CardTone = 'wait' | 'mine' | 'sent' | 'done' | 'warn' | 'client';

/** The status line on a card. */
export function cardStatus(q: Question, a: PmAnswer | undefined): { tone: CardTone; text: string } {
  if (isResolved(q.state)) {
    const by = q.consentBy || (a?.status === 'recorded' || a?.status === 'sent' ? a.by : '') || '';
    const when = q.consentAt || (a?.recordedAt ? day(a.recordedAt) : '');
    const detail = [by && `by ${by}`, when].filter(Boolean).join(', ');
    return { tone: 'done', text: `Recorded (${q.state}${detail ? ` ${detail}` : ''})` };
  }
  if (a?.kind === 'ask-client') return { tone: 'client', text: 'Asked the client: in the export for the client' };
  if (a?.status === 'sent') return { tone: 'sent', text: `Your answer: sent to ${a.sentTo ?? 'the analyst'}, not recorded yet` };
  if (a) return { tone: 'mine', text: a.fromClient ? `Answered (from the client file, imported by ${a.fromClient.by}): ready to send` : 'Your answer: ready to send' };
  if (q.assumedNoConsent) return { tone: 'warn', text: 'Assumed by agent without your consent' };
  return { tone: 'wait', text: 'Waiting on you' };
}

export const ANSWER_LABEL: Record<AnswerKind, string> = { accept: 'Accept proposal', answer: 'Answer', 'ask-client': 'Ask the client', moot: 'Not relevant' };

// ---- The message Send builds ---------------------------------------------------------------------------

/** "2026-10-13T14:05Z": consentAt as the toolkit wants it, non-empty and to the minute. */
export const stamp = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`;

const quote = (s: string) => `"${s.replace(/\s+/g, ' ').trim()}"`;

/** One answer's lines in the message: the id, the file, the status to set and what to write with it. */
function answerLines(n: number, a: PmAnswer, q: Question | undefined): string[] {
  const where = q?.brd ? `${a.file} (${q.brd}${q.brdTitle ? ` ${q.brdTitle}` : ''})` : a.file;
  const head = `${n}. ${a.id} in ${where}${q ? `: ${q.question.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
  const md = a.file.endsWith('.md');
  switch (a.kind) {
    case 'accept':
      return [head, `   status: ASSUMED`, `   decision: ${quote(q?.proposedPosition ?? a.text ?? '')} (the proposed position, accepted)`, `   consentBy: ${quote(a.by)}`, `   consentAt: ${quote(stamp(a.at))}`];
    case 'moot':
      return [head, `   status: ${quote(`MOOT - ${(a.text ?? '').trim()}`)}${md ? ' (the Status cell)' : ''}`];
    default: {
      const said = [a.option, a.text?.trim()].filter(Boolean).join(': ');
      const from = a.fromClient ? ` (the client's answer, imported by ${a.fromClient.by})` : '';
      return [head, `   status: ANSWERED`, `   answer: ${quote(said)}${from}`, ...(md ? ['   (in sme-questions.md: the Status cell ANSWERED and the answer in its Answer or Decision column)'] : [])];
    }
  }
}

/**
 * The one message Send to <analyst> types: every answer with its id, BRD, the status to set (the toolkit's
 * vocabulary), the answer, and consentBy/consentAt for an accepted proposal; then record and re-run.
 */
export function answersMessage(answers: readonly PmAnswer[], questions: ReadonlyMap<string, Question>, by: string): string {
  const sendable = answers.filter((a) => a.kind !== 'ask-client');
  const lines = sendable.flatMap((a, i) => answerLines(i + 1, a, questions.get(a.key)));
  return [
    `The Project Manager (${by}) answered ${plural(sendable.length, 'open question')} on the office's Questions page. Record each in its BRD's \`openQuestions\` entry (same id) with the toolkit's vocabulary, exactly as below: set \`status\`, and write \`answer\`, or \`decision\` with \`consentBy\` and \`consentAt\`, where given. Change nothing else.`,
    '',
    ...lines,
    '',
    'Then re-run `bin/open-questions.sh .` and check each of these now reads ANSWERED, ASSUMED or MOOT (fix any that reads UNRECOGNISED), and commit the BRD files. The office marks them recorded once the script says so.',
  ].join('\n');
}

// ---- Import: the client's answers ------------------------------------------------------------------------

/** "OQ-05: answer" lines (also "OQ-05 - answer", "OQ-05 = answer"); a line without an id continues the one before. */
export function parsePastedAnswers(text: string): { id: string; answer: string }[] {
  const out: { id: string; answer: string }[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^[-*•]?\s*\**([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\**\s*[:=–—-]\s*(.*)$/.exec(line);
    if (m && /\d/.test(m[1])) out.push({ id: m[1], answer: m[2].trim() });
    else if (out.length) out[out.length - 1].answer = `${out[out.length - 1].answer} ${line}`.trim();
  }
  return out.filter((x) => x.answer);
}
