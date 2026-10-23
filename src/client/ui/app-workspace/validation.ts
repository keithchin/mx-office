// The Review section's guided validation (C5, shared/guided-validation.ts): the scenarios of the version on
// screen, each with its result at exactly that version (Passed / Failed / Not run on this version; a result on
// another version is only ever a note), its steps in the journey's own words, Try it (the canvas opened at its
// start page, where the journey names one) and the person's own mark: Works as expected, or Something's
// wrong, which goes to the team as a correction (a change request with its task id) and shows here with the
// request's state. The mark's dialog captures the page and version the way Request a change does; ✕ and Esc
// close it and give the focus back to the button that opened it.

import { h, openModal, timeAgo } from '../dom';
import { NOTE_MAX, RESULT_TONE, RESULT_WORDS, VERDICT_WORDS, WRONG_MIN, scenarioSummary, summaryLine, type ScenarioView, type ValidationView, type Verdict } from '../../../shared/guided-validation';
import type { ChangeRequestView } from '../../../shared/change-requests';
import { statePill } from './requests';
import './validation.css';
import type { MarkAsk, MarkSent } from './validation-api';

const short = (sha?: string) => (sha ?? '').slice(0, 7);

export interface ValidationDeps {
  /** Opens the canvas (the App section) at a page of the app. */
  tryIt(path?: string): void;
  /** Where the canvas is, for the mark's captured page. */
  where(): { path: string; moved: boolean } | undefined;
  mark?(m: MarkAsk): Promise<MarkSent>;
  done(text: string): void;
}

/** A finding's correction, with its request's state when the Requests feed has it. */
function correctionLine(id: string, requests: readonly ChangeRequestView[] | undefined): HTMLElement {
  const r = requests?.find((x) => x.id === id);
  return h('p.aw-small.aw-corr', { 'data-correction': id }, `Sent to the team as ${id} `, r ? statePill(r) : h('span.aw-pill.idle', {}, 'Received'));
}

function scenarioRow(s: ScenarioView, requests: readonly ChangeRequestView[] | undefined, deps: ValidationDeps, open: (s: ScenarioView, verdict: Verdict, from: HTMLElement) => void): HTMLElement {
  const f = s.finding;
  const earlier = s.earlier ? h('p.aw-small.aw-earlier', {}, `${s.earlier.status === 'passed' ? 'Passed' : 'Failed'} on an earlier version (${short(s.earlier.revision)}); that doesn’t count for this one.`) : '';
  const steps = s.steps.length ? h('ol.aw-steps', {}, ...s.steps.map((t) => h('li', {}, t))) : h('p.aw-none', {}, 'Its steps aren’t written down in a way the office can show.');
  const start = s.start?.path ? `Starts on ${s.start.path}` : s.start?.words ? `Starts with: ${s.start.words}` : 'Starts on the app’s home page';
  const mine = f
    ? h(
        'div.aw-mark',
        { 'data-verdict': f.verdict },
        h('p', {}, h('span.aw-pill', { class: f.verdict === 'works' ? 'good' : 'warn' }, VERDICT_WORDS[f.verdict]), h('span.aw-small', {}, ` marked by ${f.by} ${timeAgo(f.at)}${s.marks > 1 ? ` (${s.marks} marks on this version)` : ''}`)),
        f.note ? h('p.aw-small', {}, `“${f.note}”`) : '',
        f.correction ? correctionLine(f.correction.id, requests) : '',
      )
    : '';
  const btns = deps.mark
    ? h(
        'div.aw-row.aw-markbtns',
        {},
        h('button.aw-btn.aw-try', { type: 'button', onclick: () => deps.tryIt(s.start?.path) }, 'Try it'),
        h('button.aw-btn.aw-works', { type: 'button', onclick: (e: Event) => open(s, 'works', e.currentTarget as HTMLElement) }, 'Works as expected'),
        h('button.aw-btn.aw-wrong', { type: 'button', onclick: (e: Event) => open(s, 'wrong', e.currentTarget as HTMLElement) }, 'Something’s wrong'),
      )
    : h('div.aw-row', {}, h('button.aw-btn.aw-try', { type: 'button', onclick: () => deps.tryIt(s.start?.path) }, 'Try it'));
  return h(
    'li.aw-scn',
    { 'data-scenario': s.id, 'data-result': s.result },
    h('div.aw-row.aw-scnhead', {}, h('span.aw-pill', { class: RESULT_TONE[s.result] }, RESULT_WORDS[s.result]), h('b', {}, s.title)),
    earlier,
    h('details.aw-scnsteps', {}, h('summary', {}, `${s.steps.length} ${s.steps.length === 1 ? 'step' : 'steps'} · ${start}`), steps),
    mine,
    btns,
  );
}

/** The guided validation card's body for the version on screen. */
export function validationPart(v: ValidationView | undefined, onScreen: string | undefined, requests: readonly ChangeRequestView[] | undefined, deps: ValidationDeps): HTMLElement {
  if (!onScreen) return h('p.aw-none', {}, 'No version is running in the app right now, so there’s nothing to try. When it runs, its guided checks show here with their results for that version.');
  if (!v) return h('p.aw-none', {}, `Reading the guided checks for version ${short(onScreen)}…`);
  const sum = scenarioSummary(v.scenarios);
  const checks = v.checks.passed + v.checks.failed + v.checks.skipped;
  const open = (s: ScenarioView, verdict: Verdict, from: HTMLElement) => openMarkDialog(s, verdict, v.revision, deps, from);
  return h(
    'div.aw-validation',
    { 'data-revision': v.revision },
    h('p.aw-small', {}, `For version ${short(v.revision)}, the one running in the app. Try each check in the app and say whether it works. Only results for this exact version count here.`),
    v.note ? h('p.aw-warn', {}, v.note) : '',
    v.scenarios.length ? h('p.aw-sum', {}, summaryLine(sum)) : h('p.aw-none', {}, 'No guided checks are written for this version yet. The team writes one for each part of the plan; until then, try the app yourself and use Request a change for what should be different.'),
    h('p.aw-small', {}, checks ? `Automatic checks on this version: ${v.checks.passed} passed${v.checks.failed ? `, ${v.checks.failed} failed` : ''}${v.checks.skipped ? `, ${v.checks.skipped} didn’t run to the end` : ''}.` : 'No other automatic checks ran on this version.'),
    v.scenarios.length ? h('ul.aw-scns', {}, ...v.scenarios.map((s) => scenarioRow(s, requests, deps, open))) : '',
  );
}

/**
 * Works as expected / Something's wrong for one check: the note (needed for wrong), with the version and the
 * page captured from the screen and shown, not editable. Wrong says it goes to the team as a correction.
 */
export function openMarkDialog(s: ScenarioView, verdict: Verdict, revision: string, deps: ValidationDeps, from?: HTMLElement): void {
  if (!deps.mark) return;
  const opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const at = deps.where();
  const wrong = verdict === 'wrong';
  const box = h('textarea.aw-reqtext', { rows: 4, maxlength: String(NOTE_MAX), placeholder: wrong ? 'What happened, and what you expected instead.' : 'Anything worth noting (optional).', 'aria-label': wrong ? 'What went wrong' : 'Note' }) as HTMLTextAreaElement;
  const err = h('p.aw-warn', { role: 'alert', hidden: true });
  const submit = h('button.btn.primary.aw-marksend', { type: 'submit' }, wrong ? 'Send to the team' : 'Mark as working') as HTMLButtonElement;
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const about = [
    ['Check', s.title],
    ['Version', `running ${short(revision)}`],
    ['Page', at ? `${at.path}${at.moved ? ' (the app moved on from there by itself; this is where it was last opened)' : ''}` : 'No page: the app isn’t showing here'],
  ];
  const form = h(
    'form.modal.aw-reqdlg.aw-markdlg',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': VERDICT_WORDS[verdict] },
    h('header', {}, h('h2', {}, VERDICT_WORDS[verdict])),
    h(
      'div.body',
      {},
      h('p', {}, wrong ? 'Say what went wrong. It goes to the team lead as a correction, with this check and version, and shows under Requests with its state.' : 'Mark this check as working on this version. It is kept with the version, for everyone to see.'),
      box,
      h('dl.aw-about', {}, ...about.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('p.aw-small', {}, 'The version and page are taken from what’s on screen. Your mark is shown beside the status; it doesn’t change what the automatic checks found.'),
      err,
    ),
    h('footer', {}, h('span.grow'), cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;
  const modal = openModal(form, { onClose: () => opener?.focus() });
  cancel.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = box.value.trim();
    if (wrong && note.length < WRONG_MIN) {
      err.hidden = false;
      err.textContent = 'Say what went wrong first, so the team can put it right.';
      box.focus();
      return;
    }
    submit.disabled = true;
    void deps.mark!({ revision, scenario: s.id, verdict, ...(note ? { note } : {}), ...(at ? { page: at.path, ...(at.moved ? { pageMoved: true } : {}) } : {}) }).then((r) => {
      submit.disabled = false;
      if (!r.ok) {
        err.hidden = false;
        err.textContent = r.error;
        return;
      }
      modal.close();
      deps.done(r.finding.correction ? `Sent to the team as ${r.finding.correction.id}: it shows under Requests with its state` : `Marked “${s.title}” as working on this version`);
    });
  });
  box.focus();
}
