// The summary's "What's happening": a few plain sentences from the facts the summary already has.
// The small model writes them (through the analyzer's shared, capped Haiku), but only from those
// facts, and its answer is shown only while the facts it was given still hold; otherwise, and when
// there's no model, a template says the same things. It is asked again at most once a minute when
// something significant changed, and every few minutes otherwise, in the background: a request never
// waits on it.

import type { ProjectSummary } from '../../shared/summary.js';
import { waitsOnPerson } from '../../shared/progress.js';
import type { Haiku } from '../analysis/llm.js';
import { withBilling } from '../budget/meter.js';

const MIN_GAP_MS = 60_000;
const REFRESH_MS = 5 * 60_000;

type Facts = Omit<ProjectSummary, 'narrative' | 'narrativeBy'>;

const SYSTEM = `You write the "What's happening" note at the top of a software project's dashboard, where AI coding agents work on the project.
Write 2 to 4 short, plain-English sentences for a manager who wants to know where things stand.
Use ONLY the facts in the JSON you are given: never add, guess, generalise or embellish (say "all" only if every item qualifies; do not describe what a PR is for unless its title says so). Mention who needs a human and any risks first if there are any.
Name agents by name. No markdown, no lists, no greetings, no exact timestamps.`;

const SCHEMA = { type: 'object', properties: { narrative: { type: 'string' } }, required: ['narrative'], additionalProperties: false };

/** What makes the note out of date: who's doing what, the counts and the risks (not how many minutes have passed). */
export function significance(f: Facts): string {
  return JSON.stringify([f.phase?.label, f.progress, f.needsHuman.count, f.agents.map((a) => [a.name, a.status]), f.risks.map((r) => r.text.replace(/\d+(\.\d+)? (min|h)/, ''))]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The note without a model: the same facts, in fixed sentences. */
export function templateNarrative(f: Facts): string {
  const out: string[] = [];
  const working = f.agents.filter((a) => a.status === 'working');
  if (f.needsHuman.count) {
    const names = f.agents.filter((a) => a.waitingMs !== undefined).map((a) => a.name);
    out.push(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} waiting on a human, the longest for ${Math.max(1, Math.round(f.needsHuman.longestMs / 60_000))} min.`);
  }
  if (working.length) out.push(`${plural(working.length, 'agent')} ${working.length === 1 ? 'is' : 'are'} working on ${f.name}: ${working.map((a) => a.name).join(', ')}${f.progress.queued ? `, with ${plural(f.progress.queued, 'task')} queued` : ''}.`);
  else if (!f.needsHuman.count) out.push(`Nobody is working on ${f.name} right now${f.progress.queued ? `, though ${plural(f.progress.queued, 'task')} ${f.progress.queued === 1 ? 'is' : 'are'} queued` : ''}.`);
  out.push(`${plural(f.progress.prsOpen, 'pull request')} open, ${f.progress.prsMerged}${f.progress.prsMergedCapped ? '+' : ''} merged, and ${plural(f.progress.issuesOpen, 'issue')} open.`);
  if (f.phase) out.push(`The project is at ${f.phase.label.replace(/\*\*/g, '')}.`);
  if (f.risks.length) out.push(`Watch: ${f.risks[0].text}${f.risks.length > 1 ? ` (and ${plural(f.risks.length - 1, 'more risk')})` : ''}.`);
  return out.slice(0, 4).join(' ');
}

/** Just what the model needs to see, so it has nothing else to draw on. */
function factsFor(f: Facts): string {
  return JSON.stringify({
    project: f.name,
    goal: f.goal,
    phase: f.phase?.label,
    failingGates: f.phase?.stages.filter((s) => s.status === 'FAIL' && !waitsOnPerson(s.detail)).map((s) => s.title),
    gatesAwaitingSignoff: f.phase?.stages.filter((s) => s.status === 'FAIL' && waitsOnPerson(s.detail)).map((s) => s.title),
    progress: f.progress,
    agents: f.agents.map((a) => ({ name: a.name, model: a.model, status: a.status, doing: a.doing, waitingMinutes: a.waitingMs !== undefined ? Math.round(a.waitingMs / 60_000) : undefined })),
    needsHuman: f.needsHuman.count,
    risks: f.risks.map((r) => r.text),
    recentActivity: f.activity.slice(0, 6).map((a) => a.text),
    spendUsd: f.spend,
  });
}

export class Narrator {
  private notes = new Map<string, { sig: string; text: string; at: number }>();
  private asked = new Map<string, number>();
  private asking = new Set<string>();

  constructor(private haiku: Haiku | null) {}

  narrative(floor: string, f: Facts): Pick<ProjectSummary, 'narrative' | 'narrativeBy'> {
    const sig = significance(f);
    const note = this.notes.get(floor);
    const since = Date.now() - (this.asked.get(floor) ?? 0);
    const stale = !note || note.sig !== sig ? since > MIN_GAP_MS : since > REFRESH_MS;
    if (stale && this.haiku?.enabled && !this.asking.has(floor)) void this.ask(floor, sig, f);
    return note?.sig === sig ? { narrative: note.text, narrativeBy: 'llm' } : { narrative: templateNarrative(f), narrativeBy: 'template' };
  }

  private async ask(floor: string, sig: string, f: Facts) {
    this.asking.add(floor);
    this.asked.set(floor, Date.now());
    try {
      const v = await withBilling({ floor, source: 'summary' }, () => this.haiku!.ask(SYSTEM, factsFor(f), SCHEMA));
      const text = typeof v?.narrative === 'string' ? v.narrative.replace(/\s+/g, ' ').trim().slice(0, 700) : '';
      if (text) this.notes.set(floor, { sig, text, at: Date.now() });
    } finally {
      this.asking.delete(floor);
    }
  }
}
