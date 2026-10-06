// A workflow's shape: checked once when it's registered (every step named once, every fixed edge
// going somewhere), and where to go after a step. Pure, so the traversal is tested on its own.

import { END, type StepDef, type WorkflowDef } from './types.js';

/** What's wrong with a workflow's shape, or undefined. */
export function checkWorkflow<S>(wf: WorkflowDef<S>): string | undefined {
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(wf.id)) return `A workflow's id is letters, digits and ._- (not "${wf.id}")`;
  if (!wf.steps.length) return `${wf.id} has no steps`;
  const ids = new Set<string>();
  for (const s of wf.steps) {
    if (s.id === END || !s.id) return `${wf.id}: a step can't be called "${s.id}"`;
    if (ids.has(s.id)) return `${wf.id}: two steps are called ${s.id}`;
    ids.add(s.id);
    if (s.retry && !(s.retry.maxAttempts >= 1)) return `${wf.id}: ${s.id}'s retry needs maxAttempts of 1 or more`;
  }
  if (wf.start && !ids.has(wf.start)) return `${wf.id} starts at ${wf.start}, which isn't one of its steps`;
  for (const [from, to] of Object.entries(wf.edges ?? {})) {
    if (!ids.has(from)) return `${wf.id} has an edge from ${from}, which isn't one of its steps`;
    if (typeof to === 'string' && to !== END && !ids.has(to)) return `${wf.id}: ${from} goes to ${to}, which isn't one of its steps`;
  }
  for (const edge of Object.keys(wf.limits?.loops ?? {})) {
    const [from, to] = edge.split('->');
    if (!ids.has(from) || (to !== END && !ids.has(to))) return `${wf.id}: the loop limit on ${edge} isn't between two of its steps (write it from->to)`;
  }
  return undefined;
}

export const firstStep = <S>(wf: WorkflowDef<S>): string => wf.start ?? wf.steps[0].id;

export const stepOf = <S>(wf: WorkflowDef<S>, id: string): StepDef<S> | undefined => wf.steps.find((s) => s.id === id);

/** Where the run goes after `from`, given the state now: its edge, else the next step in the list, else END. Throws on a step that isn't there. */
export function nextStep<S>(wf: WorkflowDef<S>, from: string, state: S): string {
  const edge = wf.edges?.[from];
  let to: string;
  if (edge === undefined) {
    const i = wf.steps.findIndex((s) => s.id === from);
    to = i >= 0 && i + 1 < wf.steps.length ? wf.steps[i + 1].id : END;
  } else to = typeof edge === 'function' ? edge(state) : edge;
  if (to !== END && !stepOf(wf, to)) throw new Error(`${wf.id}: ${from} chose to go to ${String(to)}, which isn't one of its steps`);
  return to;
}

export const edgeName = (from: string, to: string) => `${from}->${to}`;
