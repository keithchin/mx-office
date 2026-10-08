// The acceptance record (shared/acceptance.ts), from the progress bar's Handover and Accepted segments
// and its line: every delivery cycle with its record, read-only (scope, commit, tests, documents,
// exceptions and owners, who accepted when, the spend frozen then), "changed since acceptance" when the
// delivery branch or the deliverables moved on, and for the Project Manager (an admin) the two actions:
// ✅ Accept (pick the version, review the evidence, list the exceptions with owners, confirm) and ↩ Reopen
// (the next version with a scope note; the accepted record stays). Every window has openModal's ✕ and Esc.

import type { AcceptanceDraft, AcceptanceRecord, AcceptanceView, Cycle, EvidenceLine, Exception } from '../../../shared/acceptance';
import { suggestVersion, versionProblem } from '../../../shared/acceptance';
import { h, openModal, toast } from '../dom';
import { getAcceptance, getDraft, postAccept, postReopen } from './api';

const ST: Record<EvidenceLine['status'], string> = { pass: '✅', fail: '❌', pending: '⏳', present: '📄', missing: '⚠️ gap', unknown: '❔ unknown' };
/** The elements of a list that has `null`s for what isn't there. */
const kids = (...xs: (HTMLElement | null)[]): HTMLElement[] => xs.filter((x): x is HTMLElement => !!x);
const usd = (n: number) => `$${n.toFixed(2)}`;
const when = (ms: number) => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function lines(title: string, list: readonly EvidenceLine[], more?: number): HTMLElement {
  return h(
    'section.acc-sec',
    {},
    h('h3', {}, title),
    list.length ? h('ul.acc-lines', {}, ...list.map((l) => h('li', { class: `acc-${l.status}` }, h('span.acc-st', {}, ST[l.status]), h('span.acc-l', {}, l.label), l.detail ? h('small', {}, l.detail) : null))) : h('p.acc-dim', {}, 'Nothing recorded.'),
    more ? h('p.acc-dim', {}, `…and ${more} more on main.`) : null,
  );
}

function costLines(c: AcceptanceRecord['cost']): HTMLElement {
  const fx = c.fx ? ` (${c.fx.currency} ${(c.spent * c.fx.rate).toFixed(2)})` : '';
  return h(
    'section.acc-sec',
    {},
    h('h3', {}, `💰 Spend at acceptance, frozen ${when(c.at)}`),
    h('p', {}, `${usd(c.spent)}${fx} spent${c.estimated ? `, ${usd(c.estimated)} of it estimated from history` : ''}${c.budget ? ` · budget ${usd(c.budget)}` : ''}${c.planned ? ` · plan ${usd(c.planned)}` : ''}`),
    c.unmeteredCalls ? h('p.acc-dim', {}, `⚠️ ${c.unmeteredCalls} calls the office couldn't price: the spend is a floor, not the whole cost.`) : null,
    c.byStage.length ? h('ul.acc-lines', {}, ...c.byStage.map((s) => h('li', {}, h('span.acc-l', {}, s.label), h('small', {}, `${usd(s.actual)}${s.planned !== undefined ? ` of ${usd(s.planned)} planned` : ''}`)))) : null,
  );
}

function recordView(r: AcceptanceRecord, changed: readonly string[] | undefined): HTMLElement {
  return h(
    'div.acc-record',
    {},
    changed?.length ? h('p.acc-changed', { role: 'note' }, `⚠️ Changed since acceptance: ${changed.join('; ')}. The checks below are as they were at acceptance; accept again (after a reopen) to record the change.`) : null,
    h('p.acc-who', {}, `✅ ${r.version} accepted by ${r.acceptedBy.name}, ${when(r.acceptedAt)}`),
    h('p.acc-dim', {}, `Record ${r.id}${r.source.commit ? ` · ${r.source.branch ?? 'branch'} @ ${r.source.commit.slice(0, 12)}` : ''}${r.source.build ? ` · build ${r.source.build}` : ''}${r.source.deploy ? ` · deploy ${r.source.deploy}` : ''}`),
    r.source.gaps.length ? h('ul.acc-gaps', {}, ...r.source.gaps.map((g) => h('li', {}, `⚠️ ${g}`))) : null,
    r.scope.note ? h('p.acc-note', {}, `📝 ${r.scope.note}`) : null,
    lines('Scope agreed', r.scope.agreed),
    lines('Scope delivered', r.scope.delivered),
    lines('Test evidence', r.tests),
    lines('Documents (at the accepted commit)', r.docs, r.docsMore),
    h('section.acc-sec', {}, h('h3', {}, 'Exceptions'), r.exceptions.length ? h('ul.acc-lines', {}, ...r.exceptions.map((e) => h('li', {}, h('span.acc-l', {}, e.text), h('small', {}, `owner: ${e.owner}`)))) : h('p.acc-dim', {}, 'None.')),
    costLines(r.cost),
  );
}

function cycleView(c: Cycle, last: boolean, changed: readonly string[]): HTMLElement {
  return h(
    'details.acc-cycle',
    { open: last },
    h('summary', {}, `${c.version}${c.record ? ` · accepted ${new Date(c.record.acceptedAt).toLocaleDateString()}` : ' · under way'}${c.opened ? ` · reopened from ${c.opened.from} by ${c.opened.by.name}` : ''}`),
    c.opened ? h('p.acc-note', {}, `📝 Scope of ${c.version}: ${c.opened.scopeNote}`) : null,
    c.record ? recordView(c.record, last ? changed : undefined) : h('p.acc-dim', {}, 'Not accepted yet.'),
  );
}

/** The acceptance record window for `floor`; `after` hears an Accept or Reopen go through. */
export async function openAcceptance(floor: string, after: () => void) {
  const body = h('div.acc-body', {}, h('p.acc-dim', {}, 'Loading…'));
  const footer = h('footer');
  const el = h('div.modal.acc-modal', { role: 'dialog', 'aria-label': 'Acceptance record' }, h('header', {}, h('h2', {}, '✅ Acceptance record')), body, footer);
  const modal = openModal(el, { doing: 'reading the acceptance record', reading: true });
  const v = await getAcceptance(floor);
  if (!v) return void body.replaceChildren(h('p.acc-dim', {}, "The acceptance record couldn't be read just now."));
  draw(v);
  function draw(view: AcceptanceView) {
    const cur = view.cycles[view.cycles.length - 1];
    body.replaceChildren(
      ...(view.chain.ok ? [] : [h('p.acc-changed', { role: 'alert' }, '⚠️ The acceptance file doesn’t fit its hash chain: a line was edited or removed outside the office.')]),
      h('p.acc-intro', {}, 'Acceptance is the Project Manager’s explicit ✅ Accept, never a merge. Each version keeps its record; reopening starts the next version and never erases one.'),
      ...[...view.cycles].reverse().map((c, i) => cycleView(c, i === 0, view.changed)),
    );
    const accept = h('button.btn.primary', { type: 'button', onclick: () => (modal.close(), void openAccept(floor, view, after)) }, `✅ Accept ${cur.version}…`);
    const reopen = h('button.btn', { type: 'button', onclick: () => (modal.close(), openReopen(floor, view, after)) }, `↩ Reopen for ${suggestVersion(view.cycles)}…`);
    footer.replaceChildren(...(view.admin ? [cur.record ? reopen : accept] : [h('span.acc-dim', {}, '🔒 Only the Project Manager (an admin) accepts or reopens.')]));
  }
}

function exceptionRow(e: Exception, list: HTMLElement): HTMLElement {
  const text = h('input', { type: 'text', value: e.text, maxlength: 400, 'aria-label': 'Exception', placeholder: 'What is still open' }) as HTMLInputElement;
  const owner = h('input', { type: 'text', value: e.owner, maxlength: 80, 'aria-label': 'Owner', placeholder: 'Owner' }) as HTMLInputElement;
  const row = h('li.acc-exc', {}, text, owner, h('button.btn.small', { type: 'button', 'aria-label': 'Remove this exception', title: 'Remove', onclick: () => row.remove() }, '✕'));
  list.append(row);
  return row;
}

/** ✅ Accept: the version, the evidence the office has now, the exceptions with owners, and a confirm. */
async function openAccept(floor: string, view: AcceptanceView, after: () => void) {
  const body = h('div.acc-body', {}, h('p.acc-dim', {}, 'Gathering the evidence…'));
  const footer = h('footer');
  const el = h('div.modal.acc-modal', { role: 'dialog', 'aria-label': 'Accept the delivery' }, h('header', {}, h('h2', {}, '✅ Accept the delivery')), body, footer);
  const modal = openModal(el, { doing: 'accepting a delivery' });
  const d: AcceptanceDraft | undefined = await getDraft(floor);
  if (!d) return void body.replaceChildren(h('p.acc-dim', {}, "The evidence couldn't be gathered just now."));
  const version = h('input', { type: 'text', value: d.version, maxlength: 12, 'aria-label': 'Version', size: 8 }) as HTMLInputElement;
  const note = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'What this version is (optional)', 'aria-label': 'Scope note' }) as HTMLTextAreaElement;
  const build = h('input', { type: 'text', maxlength: 200, placeholder: 'Build reference (optional)', 'aria-label': 'Build reference' }) as HTMLInputElement;
  const deploy = h('input', { type: 'text', maxlength: 200, placeholder: 'Deploy reference (optional)', 'aria-label': 'Deploy reference' }) as HTMLInputElement;
  const excs = h('ul.acc-excs', {});
  const suggested = h('ul.acc-lines', {}, ...d.suggestions.map((s) => h('li', {}, h('span.acc-l', {}, s.text), h('button.btn.small', { type: 'button', onclick: (e: Event) => (exceptionRow(s, excs), (e.currentTarget as HTMLElement).closest('li')?.remove()) }, `+ owner ${s.owner}`))));
  const confirm = h('input', { type: 'checkbox', id: 'acc-confirm' }) as HTMLInputElement;
  const problem = h('p.acc-problem', { role: 'alert' });
  body.replaceChildren(...kids(
    h('div.acc-form', {}, h('label', {}, 'Version ', version), h('label.acc-wide', {}, 'Scope note', note), build, deploy),
    h('p.acc-dim', {}, `Delivery branch: ${d.source.branch ?? 'unknown'}${d.source.commit ? ` @ ${d.source.commit.slice(0, 12)}` : ''}`),
    d.source.gaps.length ? h('ul.acc-gaps', {}, ...d.source.gaps.map((g) => h('li', {}, `⚠️ ${g}`))) : null,
    lines('Scope agreed', d.scope.agreed),
    lines('Scope delivered', d.scope.delivered),
    lines('Test evidence', d.tests),
    lines('Documents', d.docs, d.docsMore),
    costLines(d.cost),
    h('section.acc-sec', {}, h('h3', {}, 'Exceptions (each with an owner)'), excs, h('button.btn.small', { type: 'button', onclick: () => exceptionRow({ text: '', owner: '' }, excs).querySelector('input')?.focus() }, '+ Add an exception'), d.suggestions.length ? h('div', {}, h('p.acc-dim', {}, 'Gaps and failures found now, to carry as exceptions:'), suggested) : null),
    h('label.acc-confirm', {}, confirm, ` I accept ${floor}'s delivery as recorded above, with these exceptions.`),
    problem,
  ));
  const go = h('button.btn.primary', { type: 'button' }, '✅ Accept');
  go.addEventListener('click', async () => {
    const exceptions = [...excs.querySelectorAll('li')].map((li) => {
      const [t, o] = li.querySelectorAll('input');
      return { text: t.value.trim(), owner: o.value.trim() };
    }).filter((e) => e.text || e.owner);
    const bad = versionProblem(version.value.trim(), view.cycles) ?? (exceptions.find((e) => !e.text || !e.owner) ? 'Every exception needs words and an owner' : !confirm.checked ? 'Tick the confirmation first' : undefined);
    if (bad) return void (problem.textContent = bad);
    go.disabled = true;
    const r = await postAccept(floor, { version: version.value.trim(), scopeNote: note.value.trim() || undefined, exceptions, build: build.value.trim() || undefined, deploy: deploy.value.trim() || undefined });
    go.disabled = false;
    if (!r) return;
    modal.close();
    toast(`✅ ${r.record.version} accepted`);
    after();
  });
  footer.replaceChildren(go);
}

/** ↩ Reopen: the next version and what it's for; the accepted record stays as it is. */
function openReopen(floor: string, view: AcceptanceView, after: () => void) {
  const version = h('input', { type: 'text', value: suggestVersion(view.cycles), maxlength: 12, 'aria-label': 'Next version', size: 8 }) as HTMLInputElement;
  const note = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'What the next version is for (required)', 'aria-label': 'Scope note' }) as HTMLTextAreaElement;
  const problem = h('p.acc-problem', { role: 'alert' });
  const go = h('button.btn.primary', { type: 'button' }, '↩ Reopen');
  const last = view.cycles[view.cycles.length - 1];
  const el = h(
    'div.modal.acc-modal.acc-small',
    { role: 'dialog', 'aria-label': 'Reopen the delivery' },
    h('header', {}, h('h2', {}, '↩ Reopen')),
    h('div.acc-body', {}, h('p', {}, `${last.version} stays accepted, with its record. The next version starts now, and the progress bar starts afresh for it.`), h('div.acc-form', {}, h('label', {}, 'Next version ', version), h('label.acc-wide', {}, 'Scope note', note)), problem),
    h('footer', {}, go),
  );
  const modal = openModal(el, { doing: 'reopening a delivery' });
  go.addEventListener('click', async () => {
    const bad = versionProblem(version.value.trim(), view.cycles) ?? (!note.value.trim() ? 'Say what the next version is for' : undefined);
    if (bad) return void (problem.textContent = bad);
    go.disabled = true;
    const r = await postReopen(floor, version.value.trim(), note.value.trim());
    go.disabled = false;
    if (!r) return;
    modal.close();
    toast(`↩ ${r.reopen.version} under way; ${r.reopen.from} stays accepted`);
    after();
  });
  setTimeout(() => note.focus(), 30);
}
