// The Release section's accept (C5): what is being accepted (the delivery's version and the version it is, the
// business status with what is still missing, the guided checks of the version on screen, the open
// corrections), Accept this version and Reopen. Both go through the existing acceptance path unchanged
// (./validation-api.ts pageAcceptance: the progress bar's routes and bodies, the same permissions and checks:
// the review token, the security baseline's gate, the delivery commit and cycle checks); the server decides,
// and a refusal is said in business words (shared/app-workspace/acceptance-words.ts). The workspace adds no
// permission: a person who isn't the Project Manager sees why the button isn't for them, and the server
// refuses them anyway. Nothing extra under an approval policy (there is no policy store yet).

import { h, openModal, toast } from '../dom';
import { plainMissing } from '../../../shared/app-workspace/words';
import { plainRefusal } from '../../../shared/app-workspace/acceptance-words';
import { scenarioSummary, summaryLine } from '../../../shared/guided-validation';
import { suggestVersion, versionProblem, type Exception } from '../../../shared/acceptance';
import type { ChangeRequestView } from '../../../shared/change-requests';
import type { WorkspaceData } from './data';
import type { AcceptancePort, ActResult } from './validation-api';
import { statePill } from './requests';
import { versionChip } from './panel';

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const day = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const OPEN = (r: ChangeRequestView) => r.state !== 'done' && r.state !== 'stopped';

/** The corrections guided checks made that aren't settled, with their requests (newest first). */
export function openCorrections(d: WorkspaceData): { id: string; title: string; request?: ChangeRequestView }[] {
  const out: { id: string; title: string; request?: ChangeRequestView }[] = [];
  for (const c of d.validation?.corrections ?? []) {
    const r = d.requests?.find((x) => x.id === c.id);
    if (r && !OPEN(r)) continue;
    out.push({ id: c.id, title: c.title, ...(r ? { request: r } : {}) });
  }
  return out;
}

/** A refusal in business words, in the element given. */
function showRefusal(el: HTMLElement, r: Extract<ActResult, { ok: false }>) {
  const p = plainRefusal(r.status, r.error);
  el.hidden = false;
  el.replaceChildren(h('p', {}, p.lead), ...(p.reasons.length ? [h('ul.aw-list', {}, ...p.reasons.map((x) => h('li', {}, x)))] : []));
}

export interface ReleaseDeps {
  acceptance?: AcceptancePort;
  acted(): void;
  open(tab: string): void;
}

/** The Release section's acceptance card: what's being accepted, and Accept / Reopen for the Project Manager. */
export function acceptCard(d: WorkspaceData, deps: ReleaseDeps): HTMLElement[] {
  const a = d.progress?.acceptance;
  const b = d.business;
  const v = d.validation;
  const corr = openCorrections(d);
  const accepted = !!a?.accepted;
  const what = h(
    'dl.aw-facts',
    {},
    h('dt', {}, 'Version'),
    h('dd', {}, a ? a.version : 'Reading…'),
    h('dt', {}, 'Delivery'),
    h('dd', {}, d.delivery === undefined ? 'Reading what would be recorded…' : d.delivery?.commit ? `the latest finished version, ${short(d.delivery.commit)}` : 'The office can’t read the latest finished version right now'),
    h('dt', {}, 'Status'),
    h('dd', {}, b ? h('span', {}, h('span.aw-pill', { class: b.tone }, b.label), ' ', versionChip(b.revision, b.revisionKind, b.version) ?? '') : 'Working it out…'),
    h('dt', {}, 'Guided checks'),
    h('dd', {}, !d.onScreen ? 'No version is running to check' : v ? `${summaryLine(scenarioSummary(v.scenarios))} (version ${short(v.revision)})` : 'Reading…'),
    h('dt', {}, 'Open corrections'),
    h('dd', {}, corr.length ? h('ul.aw-list', {}, ...corr.map((c) => h('li', { 'data-correction': c.id }, `${c.id}: ${c.title} `, c.request ? statePill(c.request) : ''))) : 'None'),
  );
  const missing = b ? plainMissing(b.missing) : [];
  const differs = !!(d.delivery?.commit && d.onScreen && !d.delivery.commit.startsWith(d.onScreen) && !d.onScreen.startsWith(d.delivery.commit));
  const port = deps.acceptance;
  const btn = !port
    ? ''
    : accepted
      ? h('button.aw-btn.aw-reopen', { type: 'button', disabled: !d.admin, onclick: (e: Event) => openReopenDialog(d, port, deps, e.currentTarget as HTMLElement) }, 'Reopen for the next version')
      : h('button.aw-btn.aw-primary.aw-accept', { type: 'button', disabled: !d.admin, onclick: (e: Event) => openAcceptDialog(d, port, deps, e.currentTarget as HTMLElement) }, 'Accept this version');
  return [
    h(
      'section.aw-card.aw-acceptcard',
      {},
      h('h3', {}, accepted ? `${a!.version} is accepted` : 'Accept this version'),
      accepted ? h('p', {}, `Accepted by ${a!.accepted!.by} on ${day(a!.accepted!.at)}.`) : h('p.aw-small', {}, 'Accepting records this version as what you agreed to, with what was checked on it. The team can’t accept for you.'),
      ...(accepted && a!.changed?.length ? [h('p.aw-warn', {}, 'It changed after it was accepted, so it needs accepting again: reopen it to start the next version.')] : []),
      what,
      missing.length && !accepted ? h('div', {}, h('p.aw-small', {}, 'Still missing for the next status:'), h('ul.aw-list', {}, ...missing.map((m) => h('li', {}, m)))) : '',
      differs && !accepted ? h('p.aw-warn', {}, `The app on screen runs ${short(d.onScreen)}, not the version being accepted (${short(d.delivery!.commit)}). Try the version being accepted first: it reaches the app shortly after it’s finished.`) : '',
      h('div.aw-row', {}, btn, d.admin ? '' : h('span.aw-small', {}, accepted ? 'Only the Project Manager reopens a version.' : 'Only the Project Manager accepts a version.')),
      ...(a?.earlier.length ? [h('p.aw-small', {}, `Accepted before: ${a.earlier.map((e) => `${e.version} on ${day(e.at)}`).join(', ')}`)] : []),
      h('button.aw-link', { type: 'button', onclick: () => deps.open('command') }, 'See the full acceptance record in Project Management'),
    ),
  ];
}

function dialogFrame(label: string, body: HTMLElement, foot: HTMLElement[], opener: HTMLElement | null) {
  const el = h('div.modal.aw-reqdlg.aw-accdlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('header', {}, h('h2', {}, label)), body, h('footer', {}, h('span.grow'), ...foot));
  return openModal(el, { onClose: () => opener?.focus(), doing: label.toLowerCase() });
}

/** Accept this version: the draft's review token, what's still open as exceptions (each with an owner), a confirm. */
export async function openAcceptDialog(d: WorkspaceData, port: AcceptancePort, deps: ReleaseDeps, opener: HTMLElement | null): Promise<void> {
  const floor = d.floor;
  if (!floor) return;
  const body = h('div.body', {}, h('p.aw-none', {}, 'Reading what would be recorded…'));
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const go = h('button.btn.primary.aw-acceptgo', { type: 'button', disabled: true }, 'Accept') as HTMLButtonElement;
  const modal = dialogFrame('Accept this version', body, [cancel, go], opener);
  cancel.addEventListener('click', () => modal.close());
  let draft = await port.draft(floor);
  if (!draft) return void body.replaceChildren(h('p.aw-warn', {}, 'The office couldn’t read what would be recorded just now. Close this and try again.'));
  const problem = h('div.aw-warn.aw-refusal', { role: 'alert', hidden: true });
  const confirm = h('input', { type: 'checkbox', class: 'aw-confirm' }) as HTMLInputElement;
  const corr = openCorrections(d);
  const ticks = corr.map((c) => ({ c, box: h('input', { type: 'checkbox', checked: true }) as HTMLInputElement }));
  const extra = h('input.aw-note', { type: 'text', maxlength: '400', placeholder: 'Anything else still open (optional)', 'aria-label': 'Anything else still open' }) as HTMLInputElement;
  const facts = h('dl.aw-about');
  const drawFacts = () =>
    facts.replaceChildren(
      h('dt', {}, 'Version'),
      h('dd', {}, draft!.version),
      h('dt', {}, 'Delivery'),
      h('dd', {}, draft!.source.commit ? `the latest finished version, ${short(draft!.source.commit)}` : 'not readable'),
      h('dt', {}, 'Status'),
      h('dd', {}, d.business ? d.business.label : 'unknown'),
      h('dt', {}, 'Guided checks'),
      h('dd', {}, d.validation ? summaryLine(scenarioSummary(d.validation.scenarios)) : 'none read'),
    );
  drawFacts();
  body.replaceChildren(
    h('p', {}, 'You’re accepting this version as what you agreed to. The office records it with what was checked on it; the record stays, and a later change needs accepting again.'),
    facts,
    ticks.length ? h('div', {}, h('p.aw-small', {}, 'Still open, noted with the acceptance (each with who owns it):'), h('ul.aw-ticks', {}, ...ticks.map((t) => h('li', {}, h('label', {}, t.box, ` ${t.c.id}: ${t.c.title} (owner: ${t.c.request?.member ?? 'the team lead'})`))))) : '',
    extra,
    h('label.aw-confirmrow', {}, confirm, ` I accept ${draft.version} as recorded above.`),
    h('p.aw-small', {}, 'The full evidence the office records is in Project Management’s acceptance record.'),
    problem,
  );
  go.disabled = false;
  go.addEventListener('click', async () => {
    if (!confirm.checked) {
      problem.hidden = false;
      problem.replaceChildren(h('p', {}, 'Tick the confirmation first.'));
      return;
    }
    const exceptions: Exception[] = ticks.filter((t) => t.box.checked).map((t) => ({ text: `${t.c.id}: ${t.c.title}`, owner: t.c.request?.member ?? 'The team lead' }));
    if (extra.value.trim()) exceptions.push({ text: extra.value.trim(), owner: 'The Project Manager' });
    go.disabled = true;
    const r = await port.accept(floor, { reviewToken: draft!.reviewToken, version: draft!.version, exceptions });
    go.disabled = false;
    if (r.ok) {
      modal.close();
      toast(`${r.version} accepted`);
      deps.acted();
      return;
    }
    showRefusal(problem, r);
    if (r.stale) {
      // Nothing was recorded: what's there now, and the confirmation asked again.
      confirm.checked = false;
      const fresh = await port.draft(floor);
      if (fresh) {
        draft = fresh;
        drawFacts();
      }
    }
  });
  confirm.focus();
}

/** Reopen: the next version and what it's for; the accepted one stays accepted. */
export async function openReopenDialog(d: WorkspaceData, port: AcceptancePort, deps: ReleaseDeps, opener: HTMLElement | null): Promise<void> {
  const floor = d.floor;
  if (!floor) return;
  const body = h('div.body', {}, h('p.aw-none', {}, 'Reading the acceptance record…'));
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const go = h('button.btn.primary.aw-reopengo', { type: 'button', disabled: true }, 'Reopen') as HTMLButtonElement;
  const modal = dialogFrame('Reopen for the next version', body, [cancel, go], opener);
  cancel.addEventListener('click', () => modal.close());
  const view = await port.view(floor);
  if (!view) return void body.replaceChildren(h('p.aw-warn', {}, 'The office couldn’t read the acceptance record just now. Close this and try again.'));
  const last = view.cycles[view.cycles.length - 1];
  const version = h('input.aw-note', { type: 'text', value: suggestVersion(view.cycles), maxlength: '12', 'aria-label': 'Next version' }) as HTMLInputElement;
  const note = h('textarea.aw-reqtext', { rows: 3, maxlength: '2000', placeholder: 'What the next version is for', 'aria-label': 'What the next version is for' }) as HTMLTextAreaElement;
  const problem = h('div.aw-warn.aw-refusal', { role: 'alert', hidden: true });
  body.replaceChildren(h('p', {}, `${last.version} stays accepted, with its record. The next version starts now.`), h('label', {}, 'Next version ', version), note, problem);
  go.disabled = false;
  go.addEventListener('click', async () => {
    const bad = versionProblem(version.value.trim(), view.cycles) ?? (!note.value.trim() ? 'Say what the next version is for.' : undefined);
    if (bad) {
      problem.hidden = false;
      problem.replaceChildren(h('p', {}, bad));
      return;
    }
    go.disabled = true;
    const r = await port.reopen(floor, version.value.trim(), note.value.trim());
    go.disabled = false;
    if (!r.ok) return showRefusal(problem, r);
    modal.close();
    toast(`${r.version} under way; ${last.version} stays accepted`);
    deps.acted();
  });
  note.focus();
}
