// The App Workspace's other four sections (proposal section 5.1), each a page in business words over what
// the office already keeps:
//
//   Requirements  the approved brief (docs/project-brief.md, as the Overview's brief card reads it)
//   Decisions     the decisions Needs you holds for this project, most blocking first, each answered where
//                 it's answered today; C4's slot for change requests
//   Review        the business status of the running version and of each part of the plan, what is still
//                 missing in business words; C5's slot for guided validation
//   Release       the acceptance record and the deployment, which stays with people; C5's slot for accepting
//                 from here
//
// An empty section says what will appear in it. Nothing is made up.

import { h, timeAgo } from '../dom';
import { plainMissing } from '../../../shared/app-workspace/words';
import type { AppSection } from '../../../shared/app-workspace/route';
import type { WorkspaceData } from './data';
import { slot, versionChip } from './panel';

const day = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const card = (title: string, ...body: (Node | string)[]) => h('section.aw-card', {}, h('h3', {}, title), ...body);
const none = (text: string) => h('p.aw-none', {}, text);

export interface SectionPage {
  readonly el: HTMLElement;
  draw(section: Exclude<AppSection, 'app'> | AppSection, d: WorkspaceData): void;
}

export function sectionPage(deps: { open(tab: string): void }): SectionPage {
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
    const body =
      list === undefined
        ? none('Checking what waits on you…')
        : list.length
          ? h(
              'ul.aw-decisions',
              {},
              ...list.map((x) =>
                h(
                  'li.aw-decision',
                  { 'data-level': x.level },
                  h('p.aw-q', {}, x.question),
                  x.detail ? h('p.aw-small', {}, x.detail.length > 240 ? `${x.detail.slice(0, 239)}…` : x.detail) : '',
                  h('div.aw-row', {}, x.since ? h('span.aw-small', {}, `Waiting since ${timeAgo(x.since)}`) : '', h('span.aw-grow'), h('button.aw-btn', { type: 'button', onclick: () => x.answer() }, 'Answer')),
                ),
              ),
            )
          : none('Nothing waits on you. When the team needs a decision from you, it shows here, most blocking first.');
    const out = [card('Decisions for you', body)];
    if (d.others) out.push(card('For the team’s side', h('p', {}, `${d.others} more ${d.others === 1 ? 'item waits' : 'items wait'} on someone: sign-ins, permissions and other hands-on steps.`), h('button.aw-link', { type: 'button', onclick: () => deps.open('command') }, 'See them on the Engineering view')));
    out.push(card('Change requests', slot('Coming with change requests', 'Each change you ask for will be listed here with its state, the decisions it raised and the version that has it.')));
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
      card('Guided validation', slot('Coming with guided validation', 'The scenarios to try on this version, with their results, and a way to report what you find.')),
    ];
  }

  function release(d: WorkspaceData): HTMLElement[] {
    const a = d.progress?.acceptance;
    const b = d.business;
    const acceptance = !d.progress
      ? none('Reading the acceptance record…')
      : !a
        ? none('No acceptance record yet.')
        : h(
            'div',
            {},
            a.accepted ? h('p', {}, h('b', {}, `${a.version} accepted`), ` by ${a.accepted.by} on ${day(a.accepted.at)}`) : h('p', {}, `${a.version} isn’t accepted yet.`),
            ...(a.accepted && a.changed?.length ? [h('p.aw-warn', {}, 'It changed after it was accepted, so it needs accepting again.')] : []),
            ...(a.earlier.length ? [h('p.aw-small', {}, `Accepted before: ${a.earlier.map((e) => `${e.version} on ${day(e.at)}`).join(', ')}`)] : []),
          );
    const deployNote = b?.state === 'deployed-recorded' ? b.notes.find((n) => n.startsWith('Deploy: '))?.slice(8) : undefined;
    return [
      card('Acceptance', acceptance, slot('Coming with guided validation', 'Accepting a version from here, after trying its scenarios. Until then, accept it on the Engineering view’s progress bar.'), h('button.aw-link', { type: 'button', onclick: () => deps.open('command') }, 'Go to acceptance on the Engineering view')),
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
      el.replaceChildren(...(section === 'requirements' ? requirements(d) : section === 'decisions' ? decisions(d) : section === 'review' ? review(d) : release(d)));
    },
  };
}
