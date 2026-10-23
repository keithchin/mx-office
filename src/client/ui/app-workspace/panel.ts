// The App Workspace's side panel (proposal section 5.1), 340 px on the right, below the canvas on a phone:
//
//   Status            the business status (shared/business-status.ts, the same answer every view gives)
//                     with the version it's about, and the first thing still missing, in business words
//   Current request   the newest open change request (./requests.ts): its words, its state in business words and
//                     the version that has it, and Request a change
//   Decision needed   the most blocking decision Needs you holds for this project
//   Progress          the progress bar's steps done
//   Finished changes  the newest finished changes, as the team titled them
//   Next action       one button, by stage (an open decision first)
//   footer            the team's autonomy level, and where to change it (admins)
//
// Nothing here is made up: what isn't known yet says so, and an empty part says what will appear in it.

import { h, timeAgo } from '../dom';
import { plainMissing, type WorkspaceStage } from '../../../shared/app-workspace/words';
import type { AppSection } from '../../../shared/app-workspace/route';
import type { WorkspaceData } from './data';
import { currentRequest } from '../../../shared/change-requests';
import { currentRequestPart } from './requests';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const KIND_WORD = { served: 'running', main: 'latest', accepted: 'accepted' } as const;

const part = (key: string, title: string, ...body: (Node | string)[]) => h('div.aw-sec', { 'data-part': key }, h('div.aw-k', {}, title), ...body);
const none = (text: string) => h('p.aw-none', {}, text);
/** A slot a later increment fills: marked as such, saying what will appear. */
export const slot = (what: string, text: string) => h('div.aw-slot', {}, h('span.aw-slot-tag', {}, what), h('p', {}, text));

/** The version chip: the short revision, its kind, and the full one copied on a click. */
export function versionChip(sha: string | undefined, kind?: keyof typeof KIND_WORD, version?: string): HTMLElement | null {
  if (!sha) return null;
  const b = h('button.aw-ver', { type: 'button', title: `Version ${sha}: click to copy it` }, `${version ? `${version} · ` : ''}${kind ? `${KIND_WORD[kind]} ` : ''}${short(sha)}`);
  b.addEventListener('click', () => void navigator.clipboard?.writeText(sha).catch(() => undefined));
  return b;
}

export interface SidePanel {
  readonly el: HTMLElement;
  draw(d: WorkspaceData, stage: WorkspaceStage, section: AppSection): void;
}

export function sidePanel(deps: { open(tab: string): void; request(): void }): SidePanel {
  const el = h('aside.aw-side', { 'aria-label': 'Project panel' });

  function next(d: WorkspaceData, stage: WorkspaceStage, section: AppSection): { label: string; why: string; go(): void } {
    const top = d.decisions?.[0];
    if (top && top.level === 'block') return { label: 'Answer the decision', why: 'The team needs your answer to go on.', go: () => (section === 'decisions' ? top.answer() : deps.open('decisions')) };
    switch (stage) {
      case 'before':
        return { label: 'Read the brief', why: 'The scope comes first: check the goal and the open questions.', go: () => deps.open('requirements') };
      case 'validation':
        return { label: 'Check this version', why: 'See what has been checked on the running version, and what hasn’t.', go: () => deps.open('review') };
      case 'accepted':
      case 'awaiting':
      case 'released':
        return { label: 'See the release', why: 'Acceptance and deployment for this version.', go: () => deps.open('release') };
      default:
        if (d.appUrl) return { label: 'Request a change', why: 'Describe what should behave differently. It becomes a request the team works on.', go: () => deps.request() };
        return { label: 'Start the app', why: 'Nothing runs yet: start it on the Engineering view’s Live app page.', go: () => deps.open('live') };
    }
  }

  return {
    el,
    draw(d, stage, section) {
      const b = d.business;
      const status = b
        ? part(
            'status',
            'Status',
            h('div.aw-statusrow', {}, h('span.aw-pill', { class: b.tone }, b.label), versionChip(b.revision, b.revisionKind, b.version) ?? ''),
            ...plainMissing(b.missing).slice(0, 2).map((m) => h('p.aw-small', {}, m)),
          )
        : part('status', 'Status', none('Working out the status of this version…'));
      const request = part('request', 'Current request', currentRequestPart(d.requests, d.requests && currentRequest(d.requests), d.floor ? () => deps.request() : undefined));
      const top = d.decisions?.[0];
      const decision = part(
        'decision',
        'Decision needed',
        d.decisions === undefined
          ? none('Checking what waits on you…')
          : top
            ? h('div', {}, h('p.aw-q', {}, top.question), h('p.aw-small', {}, `${d.decisions.length > 1 ? `${d.decisions.length} decisions wait on you` : 'One decision waits on you'}${top.since ? ` · since ${timeAgo(top.since)}` : ''}`))
            : none('Nothing waits on you right now. When the team needs a decision, it shows here.'),
      );
      const p = d.progress;
      const progress = part(
        'progress',
        'Progress',
        p && p.total
          ? h('div', {}, h('div.aw-prog', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done), 'aria-label': 'Steps done' }, h('i', { style: `width:${Math.round((p.done / p.total) * 100)}%` })), h('p.aw-small', {}, `${p.done} of ${p.total} steps done${p.phaseTitle ? ` · now: ${p.phaseTitle}` : ''}`))
          : none(p ? 'No steps known for this project yet.' : 'Reading the project’s progress…'),
      );
      const changes = part(
        'changes',
        'Finished changes',
        d.changes === undefined
          ? none('Reading the finished changes…')
          : d.changes.length
            ? h('ul.aw-list', {}, ...d.changes.slice(0, 3).map((c) => h('li', {}, c.title, c.at ? h('span.aw-small', {}, ` · ${timeAgo(c.at)}`) : '')))
            : none('Finished changes show here, newest first.'),
      );
      const n = next(d, stage, section);
      const action = part('next', 'Next action', h('button.aw-btn.aw-primary', { type: 'button', onclick: n.go }, n.label), h('p.aw-small', {}, n.why));
      const a = d.autonomy;
      const foot = h(
        'p.aw-foot',
        {},
        a ? `The team works at ${a.level} ${a.name}${a.byStage ? ' (by stage)' : ''}` : 'The team’s level of independence isn’t known yet',
        ...(a && d.admin ? [' · ', h('button.aw-link', { type: 'button', onclick: () => deps.open('settings') }, 'change')] : []),
      );
      el.replaceChildren(status, request, decision, progress, changes, action, foot);
    },
  };
}
