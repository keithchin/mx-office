// The App Workspace's other four sections (proposal section 5.1), each a page in business words over what
// the office already keeps:
//
//   Requirements  the approved brief (docs/project-brief.md, as the Overview's brief card reads it)
//   Decisions     the business owner's decisions (./decision-cards.ts: the related artifact beside each one that
//                 names one, answered here with the revision it was opened at), and every change request with
//                 its state (./requests.ts)
//   Review        the business status of the running version and of each part of the plan, what is still
//                 missing in business words, and guided validation of the version on screen (./validation.ts:
//                 its checks with their results at exactly that version, Try it, the person's marks)
//   Release       accepting the version through the existing acceptance path (./release.ts: what's being
//                 accepted, Accept this version, Reopen, a refusal in business words) and the deployment,
//                 which stays with people
//
// An empty section says what will appear in it. Nothing is made up.

import { h } from '../dom';
import { plainMissing } from '../../../shared/app-workspace/words';
import type { AppSection } from '../../../shared/app-workspace/route';
import type { WorkspaceData } from './data';
import { versionChip } from './panel';
import { validationPart, type ValidationDeps } from './validation';
import { acceptCard, type ReleaseDeps } from './release';
import { decisionCards, type AnswerResult } from './decision-cards';
import { requestList } from './requests';
import type { WorkspaceDecision } from './data';

const card = (title: string, ...body: (Node | string)[]) => h('section.aw-card', {}, h('h3', {}, title), ...body);
const none = (text: string) => h('p.aw-none', {}, text);

export interface SectionPage {
  readonly el: HTMLElement;
  draw(section: Exclude<AppSection, 'app'> | AppSection, d: WorkspaceData): void;
}

export function sectionPage(deps: { open(tab: string): void; answer(x: WorkspaceDecision, a: { verdict: 'reply'; text: string }): Promise<AnswerResult>; redraw(): void; request(): void; want?(what: 'validation' | 'delivery'): void; validation: ValidationDeps; release: ReleaseDeps }): SectionPage {
  const el = h('div.aw-page');

  function requirements(d: WorkspaceData): HTMLElement[] {
    const b = d.brief;
    if (b === undefined) return [card('The brief', none('Reading the brief…'))];
    if (!b) return [card('The brief', none('No brief yet. A project made with New project keeps its approved brief here: the goal, the areas of the app and the open questions.'))];
    return [
      card(
        b.title ? `The brief: ${b.title}` : 'The brief',
        ...(b.approved ? [h('p.aw-badge', {}, b.approved)] : []),
        b.goal.length ? h('p', {}, b.goal.join(' ')) : none('The brief has no goal written down.'),
        h('button.aw-link', { type: 'button', onclick: () => deps.open('documents') }, 'Open the whole brief'),
      ),
      card('Areas of the app', b.domains.length ? h('div.aw-chips', {}, ...b.domains.map((x) => h('span.aw-chip', {}, x))) : none('The brief names no areas yet.')),
      card('Open questions', b.questions.length ? h('ul.aw-list', {}, ...b.questions.map((q) => h('li', {}, q))) : none('No open questions in the brief.')),
    ];
  }

  function decisions(d: WorkspaceData): HTMLElement[] {
    const list = d.decisions;
    const body = list === undefined ? none('Checking what waits on you…') : decisionCards(list, { floor: d.floor, admin: d.admin, open: deps.open, answer: deps.answer, redraw: deps.redraw });
    const out = [card('Decisions for you', body)];
    if (d.others) out.push(card('For the team’s side', h('p', {}, `${d.others} more ${d.others === 1 ? 'item waits' : 'items wait'} on someone: sign-ins, permissions, the team’s own questions and other hands-on steps.`), h('button.aw-link', { type: 'button', onclick: () => deps.open('command') }, 'See them on the Engineering view')));
    out.push(card('Requests', h('div.aw-row', {}, h('p.aw-small', {}, 'What you asked for, newest first, with where each one is.'), h('span.aw-grow'), d.floor ? h('button.aw-btn.aw-ask', { type: 'button', onclick: () => deps.request() }, 'Request a change') : ''), requestList(d.requests)));
    return out;
  }

  function review(d: WorkspaceData): HTMLElement[] {
    const b = d.business;
    if (!b) return [card('This version', none('Working out what has been checked on the running version…'))];
    const missing = plainMissing(b.missing);
    const parts = d.milestones.filter((m) => m.title);
    return [
      card(
        'This version',
        h('div.aw-statusrow', {}, h('span.aw-pill', { class: b.tone }, b.label), versionChip(b.revision, b.revisionKind, b.version) ?? ''),
        missing.length ? h('div', {}, h('p.aw-small', {}, 'Still to check:'), h('ul.aw-list', {}, ...missing.map((m) => h('li', {}, m)))) : none('Nothing is missing for this status.'),
      ),
      card('Parts of the plan', parts.length ? h('ul.aw-parts', {}, ...parts.map((m) => h('li', {}, h('span', {}, m.title!), h('span.aw-pill', { class: m.tone }, m.label)))) : none('Each part of the plan shows here with its status once the plan numbers its parts.')),
      h('section.aw-card.aw-guided', {}, h('h3', {}, 'Guided checks on this version'), validationPart(d.validation, d.onScreen, d.requests, deps.validation)),
    ];
  }

  function release(d: WorkspaceData): HTMLElement[] {
    const b = d.business;
    const deployNote = b?.state === 'deployed-recorded' ? b.notes.find((n) => n.startsWith('Deploy: '))?.slice(8) : undefined;
    return [
      ...acceptCard(d, deps.release),
      card(
        'Deployment',
        deployNote ? h('p', {}, h('b', {}, 'Deployment recorded: '), deployNote) : none('No deployment recorded.'),
        h('p.aw-small', {}, 'The office doesn’t deploy. A person deploys the accepted version outside the office and records it with the acceptance.'),
      ),
    ];
  }

  return {
    el,
    draw(section, d) {
      el.dataset.section = section;
      // Review and Release read guided validation of the version on screen (Release also what Accept would record): asked only once they show.
      if (section === 'review' || section === 'release') deps.want?.('validation');
      if (section === 'release') deps.want?.('delivery');
      el.replaceChildren(...(section === 'requirements' ? requirements(d) : section === 'decisions' ? decisions(d) : section === 'review' ? review(d) : release(d)));
    },
  };
}
