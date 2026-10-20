// A project's test journey (tests/e2e/*.journey.json, the mxcli toolkit's shape) as a walkthrough script:
// the steps in order, each with its caption (the step's own name), what to do (the journey-runner's action
// vocabulary: nav, click, fill, setFiles, pickLanguage, combobox, dismissModal, wait, with its `within` /
// `hasText` targeting and `settleMs`), and what must be true after (its `ui` rung; the `data` and `spans`
// rungs need the runner's database and tracing, so a step that has them says they weren't run). Both shapes the
// toolkit ships are read: `steps[].actions[]` with `do`, and the simple `click` / `page` / `expectText` steps.
// Seeds with a literal `value` are filled in; a seed only a database query gives (`sql`) isn't guessed: a
// step that needs it is blocked and fails honestly. Who runs it (./identity.ts) and the `$comment` lines worth
// showing when it fails (a time window, the start state it needs) come along. Pure.

import { hintOf, journeyNotes } from './identity.js';
import { readStartState, templateWhy } from './start-state.js';
import { slugOf, type WalkAction, type WalkChecks, type WalkScript, type WalkStep } from './types.js';

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
/** A bare widget name ("btnSubmit") as the Mendix class the runner uses; a full selector stays as it is. */
export const widgetSelector = (w: string) => (/^[A-Za-z_][\w-]*$/.test(w) ? `.mx-name-${w}` : w);

const SEED = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** `{{name}}` replaced by the seed's value; the names it needed that have no value. */
function subst(text: string, seeds: ReadonlyMap<string, string>, missing: Set<string>): string {
  return text.replace(SEED, (all, name: string) => {
    const v = seeds.get(name);
    if (v === undefined) {
      missing.add(name);
      return all;
    }
    return v;
  });
}

/** Every action the recorder plays (tests/walkthroughs-parity.test.ts holds it to the journey runner's own list). */
export const RECORDER_ACTIONS = ['nav', 'click', 'fill', 'setFiles', 'pickLanguage', 'combobox', 'dismissModal', 'wait'] as const;

/** The journey-runner's action, captioned the way its describeAct says it, with its targeting and settle time. */
function actionOf(a: Json, seeds: ReadonlyMap<string, string>, missing: Set<string>): WalkAction | undefined {
  const s = (v: unknown) => subst(String(v ?? ''), seeds, missing);
  const widget = str(a.widget);
  const label = str(a.label) ?? widget ?? '';
  // `within` + `hasText`: the runner's container scoping (seeds filled in, as it does).
  const within = str(a.within);
  const target = within ? { within: widgetSelector(within), ...(a.hasText !== undefined ? { hasText: s(a.hasText) } : {}) } : {};
  const settle = typeof a.settleMs === 'number' && Number.isFinite(a.settleMs) ? { settleMs: Math.min(30_000, Math.max(0, a.settleMs)) } : {};
  switch (a.do) {
    case 'nav': {
      const item = str(a.item);
      if (!item) return undefined;
      const group = str(a.group);
      return { do: 'nav', ...(group ? { group } : {}), item, caption: `Open ${[group, item].filter(Boolean).join(' › ')}`, ...settle };
    }
    case 'click':
      return widget ? { do: 'click', selector: widgetSelector(widget), caption: `Click ${label}`, ...target, ...settle } : undefined;
    case 'fill':
      return widget ? { do: 'fill', selector: widgetSelector(widget), value: s(a.value), caption: `Type “${s(a.value)}” into ${label}`, ...(a.blur ? { blur: true as const } : {}), ...target, ...settle } : undefined;
    case 'combobox':
      return widget ? { do: 'combobox', selector: widgetSelector(widget), match: s(a.match), caption: `Pick “${s(a.match)}” in ${label}`, ...target, ...settle } : undefined;
    case 'setFiles': {
      const files = (Array.isArray(a.file) ? a.file : [a.file]).filter((f) => typeof f === 'string' && f.trim()).map((f) => s(f));
      return widget && files.length ? { do: 'setFiles', selector: widgetSelector(widget), files, caption: `Attach ${files.join(', ')} to ${label}`, ...target, ...settle } : undefined;
    }
    case 'pickLanguage':
      return str(String(a.match ?? '')) ? { do: 'pickLanguage', match: s(a.match), caption: `Pick the language ${s(a.match)}`, ...settle } : undefined;
    case 'dismissModal':
      return { do: 'dismissModal', caption: 'Close the dialog', ...settle };
    case 'wait':
      return { do: 'wait', ms: Math.min(10_000, Math.max(0, Number(a.ms) || 1000)), caption: 'Wait', ...settle };
    default:
      return undefined;
  }
}

/** One step of either shape. */
function stepOf(raw: Json, n: number, seeds: ReadonlyMap<string, string>): WalkStep {
  const missing = new Set<string>();
  const s = (v: string) => subst(v, seeds, missing);
  const actions: WalkAction[] = [];
  const unknown: string[] = [];
  const malformed: string[] = [];
  if (Array.isArray(raw.actions)) {
    for (const a of raw.actions) {
      if (!a || typeof a !== 'object') continue;
      const act = actionOf(a as Json, seeds, missing);
      const name = String((a as Json).do ?? '?');
      if (act) actions.push(act);
      else if ((RECORDER_ACTIONS as readonly string[]).includes(name)) malformed.push(name);
      else unknown.push(name);
    }
  }
  // The simple shape: open a page by path, or click a button by its label or a selector.
  const page = str(raw.goto) ?? (str(raw.page)?.startsWith('/') ? str(raw.page) : undefined);
  if (page) actions.push({ do: 'goto', path: page, caption: `Open ${page}` });
  const click = str(raw.click);
  if (click) actions.push({ do: 'click', selector: /^[.#[]/.test(click) ? click : `text=${click}`, caption: `Click ${click}` });
  const ui = (raw.ui && typeof raw.ui === 'object' ? raw.ui : {}) as Json;
  const checks: WalkChecks = {
    ...(str(ui.ready) ? { ready: str(ui.ready) } : {}),
    visible: strs(ui.checks).map(widgetSelector),
    textPresent: [...strs(ui.textPresent), ...strs(raw.expectText)].map(s),
    textAbsent: strs(ui.textAbsent).map(s),
  };
  const caption = str(raw.name) ?? actions[0]?.caption ?? `Step ${n}`;
  const blocked = unknown.length
    ? `the recorder can't do “${unknown.join('”, “')}” yet`
    : malformed.length
      ? `its “${malformed.join('”, “')}” action is missing what it acts on (a widget, a file, a match)`
      : missing.size
        ? `needs ${[...missing].map((m) => `{{${m}}}`).join(', ')}, a seed only a database query gives`
        : undefined;
  // The runner's data (OQL) and trace rungs need its database and tracing: a recording plays the screen only.
  const off = [raw.data && typeof raw.data === 'object' ? 'data (OQL)' : '', raw.spans && typeof raw.spans === 'object' ? 'trace (spans)' : ''].filter(Boolean);
  const unchecked = off.length ? `${off.join(' and ')} checks not run in recordings` : undefined;
  return { n, caption: s(caption), actions, checks, ...(blocked ? { blocked } : {}), ...(unchecked ? { unchecked } : {}) };
}

/** The journey's literal seeds ({ name, value }); ones with `sql` stay unresolved. */
function seedsOf(j: Json): Map<string, string> {
  const out = new Map<string, string>();
  for (const x of Array.isArray(j.seeds) ? j.seeds : []) {
    if (!x || typeof x !== 'object') continue;
    const name = str((x as Json).name);
    const value = (x as Json).value;
    if (name && (typeof value === 'string' || typeof value === 'number')) out.set(name, String(value));
  }
  return out;
}

/** The walkthrough script of a journey file, or why it can't be one. */
export function scriptOf(file: string, text: string): WalkScript | string {
  let j: Json;
  try {
    j = JSON.parse(text) as Json;
  } catch {
    return `${file} isn't valid JSON`;
  }
  if (!j || typeof j !== 'object') return `${file} has no steps`;
  const journey = str(j.id) ?? file.split('/').pop()!.replace(/\.journey\.json$/i, '');
  const seeds = seedsOf(j);
  const steps = (Array.isArray(j.steps) ? j.steps : []).filter((x): x is Json => !!x && typeof x === 'object').map((x, i) => stepOf(x, i + 1, seeds));
  // A template is listed (as one, never recorded) even when it has no steps to walk.
  if (!steps.length && !templateWhy(journey, file, j)) return `${file} has no steps`;
  const persona = str(j.persona) ?? str(j.role);
  const notes = journeyNotes(j);
  return {
    journey,
    title: str(j.title) ?? str(j.name) ?? str(j.goal) ?? journey,
    file,
    requirement: strs(j.requirement),
    ...(persona ? { persona } : {}),
    identity: hintOf(j),
    ...(notes.length ? { notes } : {}),
    start: readStartState(journey, file, j),
    steps,
  };
}

/** The line a step is narrated with: its caption, then its first action when that says more. */
export function narrationOf(step: WalkStep): string {
  const first = step.actions.find((a) => a.do !== 'wait' && a.do !== 'dismissModal');
  const said = step.caption.replace(/\s+/g, ' ').trim();
  const extra = first && !said.toLowerCase().includes(first.caption.toLowerCase()) ? `. ${first.caption.replace(/[“”]/g, '')}` : '';
  return `${said}${extra}.`.replace(/\.\.$/, '.');
}

/** Where a workflow lives in the project's repo. */
export const repoDirOf = (journey: string, kind: 'workflow' | 'tour' = 'workflow') => `docs/walkthroughs/${kind === 'tour' ? 'guided-tour' : slugOf(journey)}`;
