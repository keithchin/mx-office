// 🚀 First-run setup's page (/setup): a stepper down the side (across the top on a phone) and one step
// at a time. Where it is comes from the office (server/first-run/), so a reload opens on the same step;
// each move is saved there. Anyone signed in sees the welcome; the steps are for admins. No socket, no
// timers: everything is a plain fetch when something is pressed.
import './setup.css';
import '../ui/connections/connections.css';
import { FIRST_RUN_STEPS, STEP_LABEL, nextStep, type FirstRunStep, type FirstRunView } from '../../shared/first-run';
import { h, toast } from '../ui/dom';
import { setupApi } from './api';
import { prereqsStep } from './prereqs';
import { doneStep, githubStep, mendixStep, toolkitStep, welcomeStep, type StepCtx } from './steps';

const TITLE: Record<FirstRunStep, string> = {
  welcome: 'Welcome to Mx Office',
  prereqs: 'What this machine needs',
  github: 'Connect GitHub',
  mendix: 'Connect Mendix',
  toolkit: 'The mxcli project toolkit',
  done: 'You’re ready',
};

/** The last prerequisite check's verdict, kept for this tab so Done can say it after a reload. */
const CHECKED = 'agent-office.setup-prereqs';
function remembered(): boolean | undefined {
  try {
    const v = sessionStorage.getItem(CHECKED);
    return v === null ? undefined : v === '1';
  } catch {
    return undefined;
  }
}
function remember(ok: boolean) {
  try {
    sessionStorage.setItem(CHECKED, ok ? '1' : '0');
  } catch {
    // Just this page, then.
  }
}

export function setupPage(root: HTMLElement) {
  let view: FirstRunView | undefined;
  let step: FirstRunStep = 'welcome';
  /** Whether the last prerequisite check found everything required (unknown until it has run). */
  let prereqsOk: boolean | undefined = remembered();
  const nav = h('ol.fr-steps', { 'aria-label': 'Setup steps' });
  const body = h('section.fr-body', { 'aria-live': 'polite' });
  root.replaceChildren(h('div.fr-page', {}, nav, body));

  const reachable = (s: FirstRunStep) => s === 'welcome' || (!!view?.admin && !!view.password.set);

  const go = (s: FirstRunStep) => {
    if (!reachable(s)) return;
    step = s;
    paint();
    void setupApi.step(s).catch(() => undefined);
    scrollTo({ top: 0 });
  };

  const ctx = (): StepCtx => ({
    view: view!,
    update: (v) => {
      view = v;
      paint();
    },
    next: () => go(nextStep(step)),
  });

  function paintNav() {
    const at = FIRST_RUN_STEPS.indexOf(step);
    nav.replaceChildren(
      ...FIRST_RUN_STEPS.map((s, i) =>
        h(
          'li',
          { class: `fr-step${i < at ? ' done' : ''}${i === at ? ' on' : ''}` },
          h('button', { type: 'button', disabled: !reachable(s), 'aria-current': i === at ? 'step' : undefined, onclick: () => go(s) }, h('span.fr-num', { 'aria-hidden': 'true' }, i < at ? '✓' : String(i + 1)), h('span.fr-label', {}, STEP_LABEL[s])),
        ),
      ),
    );
  }

  function paint() {
    if (!view) return;
    paintNav();
    const head = h('header.fr-head', {}, h('p.fr-kicker', {}, `Step ${FIRST_RUN_STEPS.indexOf(step) + 1} of ${FIRST_RUN_STEPS.length}`), h('h2', {}, TITLE[step]));
    if (!view.admin) {
      body.replaceChildren(head, h('div.fr-step-body', {}, h('p', {}, 'This office is still being set up. Setting it up is for an admin: ask whoever runs this office to sign in with the office password and finish it.'), h('a.btn', { href: '/home' }, 'Back to Home')));
      return;
    }
    const c = ctx();
    const content =
      step === 'welcome' ? welcomeStep(c)
      : step === 'prereqs' ? prereqsStep((ok) => remember((prereqsOk = ok)))
      : step === 'github' ? githubStep(c)
      : step === 'mendix' ? mendixStep(c)
      : step === 'toolkit' ? toolkitStep(c)
      : doneStep(c, prereqsOk); // prettier-ignore
    const back = FIRST_RUN_STEPS.indexOf(step) > 0 ? h('button.btn.fr-back', { type: 'button', onclick: () => go(FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(step) - 1]) }, '← Back') : null;
    const onward = step !== 'welcome' && step !== 'done' ? h('button.btn.primary.fr-next', { type: 'button', onclick: () => go(nextStep(step)) }, 'Continue') : null;
    body.replaceChildren(head, content, h('div.fr-foot', {}, back, onward));
  }

  setupApi
    .view()
    .then((v) => {
      view = v;
      // A step past the password before it's set (an old record): back to the welcome.
      step = reachable(v.step) ? v.step : 'welcome';
      paint();
    })
    .catch((e: Error) => {
      body.replaceChildren(h('p.fr-bad', {}, `Couldn’t load the setup: ${e.message}`));
      toast(e.message, 'error');
    });
}
