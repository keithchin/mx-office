// The analyzer agent: sorts each task into the fixed kinds in TASK_TYPES and writes a sentence or two
// on how its run went. The small model does it when it can (llm.ts); keyword rules do the sorting
// when it can't, and the note then just says what the numbers say. Each answer is kept on disk by a
// hash of what it was asked, so a task is classified once, and again only when its PR or scorecard changes.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BackgroundFile } from '../offloop/save.js';
import { TASK_TYPES, TASK_TYPE_LABEL, type RunRecord, type TaskType } from '../../shared/analysis.js';
import type { Haiku } from './llm.js';

/** What a kind of task looks like in words. Mendix first, since that's what the office's floors build. */
const KEYWORDS: [TaskType, RegExp][] = [
  ['domain-model', /\b(entit(y|ies)|attributes?|associations?|enumerations?|domain[- ]model|data ?model|schema|migrations?|tables?|view entit(y|ies))\b/i],
  ['ui-pages', /\b(pages?|overview|navigation|dashboard|ui|ux|layout|widgets?|forms?|data ?grid|grid|css|frontend|screens?|menu)\b/i],
  ['logic', /\b(microflows?|nanoflows?|validat(e|ion|ing)|logic|workflows?|business rules?|calculat(e|ion)|ACT_|VAL_|SUB_)/i],
  ['security', /\b(security|roles?|access rules?|permissions?|auth(entication|orization)?|login|harden(ed|ing)?|xss|csrf|secrets?)\b/i],
  ['bugfix', /\b(fix(es|ed)?|bugs?|broken|crash(es)?|regressions?|defects?|wrong)\b/i],
  ['tests', /\b(tests?|testing|e2e|playwright|unit tests?|junit|coverage|test cases?)\b/i],
  ['docs', /\b(docs?|documentation|readme|findings|guides?|changelog|write[- ]?up)\b/i],
];

/**
 * A kind's words have to come up at least this share as often as the commonest kind's do: a long
 * task mentions "fix any issues" or "docs" in passing, and that shouldn't make it a bug fix.
 */
const SHARE_OF_TOP = 0.3;

/** The deterministic fallback: the kinds whose words come up often enough, or `other` when none do. */
export function keywordTypes(text: string): TaskType[] {
  const counts = KEYWORDS.map(([t, re]) => [t, text.match(new RegExp(re.source, 'gi'))?.length ?? 0] as const);
  const top = Math.max(0, ...counts.map(([, n]) => n));
  if (!top) return ['other'];
  return counts.filter(([, n]) => n > 0 && n >= top * SHARE_OF_TOP).map(([t]) => t);
}

/** The note without a model: what the numbers say, in a sentence. */
export function fallbackNote(r: Pick<RunRecord, 'outcome' | 'pr' | 'scorecard' | 'humanPrompts' | 'needsInput' | 'excluded'>): string {
  if (r.excluded) return `Not ranked: ${r.excluded}.`;
  const bits: string[] = [];
  bits.push(r.outcome === 'merged' ? `PR #${r.pr?.number} merged` : r.outcome === 'open' ? `PR #${r.pr?.number} open` : r.outcome === 'closed' ? `PR #${r.pr?.number} closed unmerged` : 'No pull request');
  const sc = r.scorecard;
  if (sc?.score !== undefined) bits.push(`best-practices ${sc.score}/100${sc.source === 'self-reported' ? ' (self-reported)' : ''}`);
  if (sc?.mxErrors !== undefined) bits.push(sc.mxErrors === 0 ? 'mx check clean' : `${sc.mxErrors} mx check error(s)`);
  if (sc?.testsPassed !== undefined) bits.push(`tests ${sc.testsPassed} passed / ${sc.testsFailed ?? 0} failed`);
  const nudges = r.humanPrompts + r.needsInput;
  bits.push(nudges ? `needed a human ${nudges} time(s)` : 'no human help needed');
  return `${bits.join(', ')}.`;
}

const SYSTEM = `You review finished tasks done by AI coding agents, for a dashboard that compares models.
Given a task, its pull request and its numbers, answer with:
- "types": the kinds of work the task asked for, one or more of: ${TASK_TYPES.join(', ')}. (${TASK_TYPES.map((t) => `${t} = ${TASK_TYPE_LABEL[t]}`).join('; ')}.) Use "other" only when none fit.
- "note": one or two short, plain sentences (45 words at most) on what went well or badly in this run, using only the facts given. No praise words, no guesses, no markdown.`;

const SCHEMA = {
  type: 'object',
  properties: { types: { type: 'array', items: { type: 'string', enum: [...TASK_TYPES] } }, note: { type: 'string' } },
  required: ['types', 'note'],
  additionalProperties: false,
};

export interface ClassifyInput {
  /** The task as given, the issue's title and body when it came from one, and the PR's title. */
  task: string;
  /** The PR's description, or the agent's last words when there's no PR. */
  report: string;
  /** Files the PR touched, for what kind of change it was. */
  files: string[];
}

interface Cached {
  hash: string;
  types: TaskType[];
  note: string;
  by: 'llm' | 'keywords';
}

/** Whole sentences up to about n characters, so a long answer is cut where a sentence ends. */
function sentences(text: string, n: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= n) return one;
  const cut = one.slice(0, n);
  const end = cut.lastIndexOf('. ');
  return end > n / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export class Classifier {
  private cache: Record<string, Cached> = {};
  private out?: BackgroundFile;

  constructor(
    private file: string,
    private model: Haiku | null,
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved && typeof saved === 'object') this.cache = saved;
    } catch {
      // nothing classified yet
    }
  }

  /** Sorts and notes a run; asks the model only when this exact question hasn't been answered before. */
  async classify(r: RunRecord, input: ClassifyInput, useModel: boolean): Promise<Pick<RunRecord, 'types' | 'typesBy' | 'note'>> {
    const facts = factsOf(r);
    const hash = createHash('sha256').update(JSON.stringify([input, facts])).digest('hex').slice(0, 16);
    const hit = this.cache[r.id];
    // A keyword answer is kept until the model can give a better one.
    if (hit?.hash === hash && (hit.by === 'llm' || !useModel || !this.model?.enabled)) return { types: hit.types, typesBy: hit.by, note: hit.note };
    let answer: Cached | undefined;
    if (useModel && this.model?.enabled && !r.excluded) {
      const text = `Task:\n${clip(input.task, 3000)}\n\nWhat the agent reported (PR description or last message):\n${clip(input.report, 2500)}\n\nFiles changed:\n${input.files.slice(0, 40).join('\n') || '(none)'}\n\nNumbers:\n${facts}`;
      const v = await this.model.ask(SYSTEM, text, SCHEMA);
      const types = Array.isArray(v?.types) ? [...new Set((v.types as unknown[]).filter((t): t is TaskType => (TASK_TYPES as readonly unknown[]).includes(t)))] : [];
      const note = typeof v?.note === 'string' ? sentences(v.note, 360) : '';
      if (types.length && note) answer = { hash, types, note, by: 'llm' };
    }
    answer ??= { hash, types: keywordTypes(`${input.task}\n${input.files.join('\n')}`), note: fallbackNote(r), by: 'keywords' };
    if (JSON.stringify(hit) !== JSON.stringify(answer)) {
      this.cache[r.id] = answer;
      this.save();
    }
    return { types: answer.types, typesBy: answer.by, note: answer.note };
  }

  /** In the background (offloop/save.ts): written synchronously it held the event loop up to 300 ms on a loaded machine (2026-10-08). */
  private save() {
    void (this.out ??= new BackgroundFile(this.file)).write(JSON.stringify(this.cache, null, 1));
  }

  /** Writes what's still due now (the office's exit). */
  flush() {
    this.out?.flush();
  }
}

/** The run's numbers in a few lines, for the model to write its note from. */
function factsOf(r: RunRecord): string {
  const sc = r.scorecard;
  return [
    `Model: ${r.modelLabel}${r.effort ? ` (${r.effort} effort)` : ''}`,
    `Outcome: ${r.outcome}${r.pr ? ` (PR #${r.pr.number}, +${r.pr.additions}/-${r.pr.deletions})` : ''}`,
    `Wall time: ${Math.round(r.durationMs / 60000)} min, working time: ${Math.round(r.activeMs / 60000)} min, cost: $${r.cost.toFixed(2)}, API calls: ${r.apiCalls}, tool calls: ${r.toolCalls}`,
    `Human interventions before the PR: ${r.humanPrompts + r.needsInput}`,
    sc ? `Quality (${sc.source}): best-practices ${sc.score ?? '?'}/100, mx check errors ${sc.mxErrors ?? '?'}, lint ${sc.lintErrors ?? '?'} errors / ${sc.lintWarnings ?? '?'} warnings, tests ${sc.testsPassed ?? '?'} passed / ${sc.testsFailed ?? '?'} failed` : 'Quality: no scorecard',
  ].join('\n');
}
