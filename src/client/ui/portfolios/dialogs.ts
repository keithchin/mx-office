// Portfolios' dialogs (Clients on screen), from the Clients page and a project's ⚙️ Settings › Client: New client, Rename, Connect a
// brain (its path, checked by the office: README.md and ROUTING.md, a git repository or "not versioned"),
// Disconnect, and Add to portfolio (only ungrouped projects, after a review of what the project already has
// wired). Each has a ✕; ✕ and Esc give focus back to the button that opened it.

import { NOT_ACCESS_CONTROL, NOT_ACCESS_CONTROL_LONG, type ExistingContext, type PortfoliosView, type PortfolioView } from '../../../shared/portfolios';
import { h, openModal } from '../dom';
import { existingContext, portfolioAct, type ActResult } from './api';
import './portfolios.css';

function dialog(title: string, opener: HTMLElement | null, body: (Node | string | null)[], foot: HTMLElement[]) {
  const status = h('p.pf-status', { role: 'status' });
  const content = h('div.modal.pf-dialog', { role: 'dialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), h('div.body', {}, ...body, status), h('footer', {}, ...foot));
  const modal = openModal(content, { onClose: () => opener?.focus?.() });
  setTimeout(() => content.querySelector<HTMLElement>('input, select, footer .primary')?.focus(), 0);
  return { modal, status, content };
}

const note = () => h('p.pf-note', {}, h('strong', {}, `${NOT_ACCESS_CONTROL}. `), NOT_ACCESS_CONTROL_LONG);

/**
 * A client's name, sent once: the button is off while it's being sent (a second Enter or click waits for
 * the first answer), and a refusal (no name, a name taken) is said in the dialog, the name kept to fix.
 */
function nameDialog(opts: { title: string; opener: HTMLElement | null; value?: string; button: string; hint: string; send: (label: string) => Promise<ActResult>; done: (r: ActResult) => void }) {
  const name = h('input.pf-input', { type: 'text', maxlength: '80', placeholder: 'Company or organisation, e.g. Acme', 'aria-label': 'Client name', autocomplete: 'off', value: opts.value ?? '' }) as HTMLInputElement;
  const ok = h('button.btn.primary', { type: 'button' }, opts.button) as HTMLButtonElement;
  const d = dialog(opts.title, opts.opener, [h('label.pf-field', {}, h('span', {}, 'Name'), name), h('p.pf-hint', {}, opts.hint), note()], [ok]);
  d.status.setAttribute('aria-live', 'polite');
  let busy = false;
  const go = async () => {
    if (busy) return;
    if (!name.value.trim()) {
      d.status.textContent = 'Give the client a name';
      return name.focus();
    }
    busy = true;
    ok.disabled = true;
    d.status.textContent = 'Saving…';
    const r = await opts.send(name.value);
    busy = false;
    ok.disabled = false;
    if (r.error) {
      d.status.textContent = r.error;
      return name.focus();
    }
    d.modal.close();
    opts.done(r);
  };
  ok.onclick = () => void go();
  name.oninput = () => !busy && (d.status.textContent = '');
  name.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    void go();
  };
  setTimeout(() => name.select(), 0);
  return d;
}

/** New client: a name. */
export function newPortfolioDialog(opener: HTMLElement | null, done: (r: ActResult) => void) {
  nameDialog({ title: 'New client', opener, button: 'Create client', hint: 'A client (the company or organisation you build for) groups its projects, so their agents are pointed at the same company brain. It can exist without a brain: connect one later.', send: (label) => portfolioAct({ action: 'create', label }), done });
}

/** Rename a client: the name only; its projects, its brain and its id stay as they are. */
export function renameClientDialog(opener: HTMLElement | null, p: Pick<PortfolioView, 'id' | 'label'>, done: (r: ActResult) => void) {
  nameDialog({ title: `Rename ${p.label}`, opener, value: p.label, button: 'Rename', hint: 'Only the name changes: its projects, its company brain and the agents’ wiring stay as they are. The change is in the audit log.', send: (label) => portfolioAct({ action: 'rename', portfolio: p.id, label }), done });
}

/** Connect a brain: the folder's path; the office validates it and wires every project in the portfolio. */
export function connectBrainDialog(opener: HTMLElement | null, p: PortfolioView, done: (r: ActResult) => void) {
  const input = h('input.pf-input', { type: 'text', placeholder: 'C:/Clients/acme-brain', 'aria-label': 'Company brain folder', spellcheck: 'false' }) as HTMLInputElement;
  const connect = h('button.btn.primary', { type: 'button' }, 'Connect and wire');
  const d = dialog(`Connect a company brain to ${p.label}`, opener, [
    h('label.pf-field', {}, h('span', {}, 'Company brain folder on the office’s computer'), input),
    h('ul.pf-hint', {}, h('li', {}, 'It needs README.md and ROUTING.md (the toolkit’s init-company-brain.sh makes one).'), h('li', {}, 'A git repository gives each session a snapshot (its commit). A plain folder is allowed but shown as not versioned.'), h('li', {}, `Each of the client’s ${p.projects.length} project${p.projects.length === 1 ? '' : 's'} gets the toolkit’s short pointer block in its instruction files, checked by the office afterwards.`)),
    note(),
  ], [connect]);
  const go = async () => {
    connect.setAttribute('disabled', '');
    d.status.textContent = 'Checking the folder and wiring the projects… (a few seconds a project)';
    const r = await portfolioAct({ action: 'connect', portfolio: p.id, path: input.value });
    connect.removeAttribute('disabled');
    if (r.error) return void (d.status.textContent = r.error);
    d.modal.close();
    done(r);
  };
  connect.onclick = () => void go();
}

/** Disconnect: the pointer blocks come out of every project; the context manifests stay. */
export function disconnectDialog(opener: HTMLElement | null, p: PortfolioView, done: (r: ActResult) => void) {
  const yes = h('button.btn.primary', { type: 'button' }, 'Disconnect');
  const no = h('button.btn', { type: 'button' }, 'Cancel');
  const d = dialog(`Disconnect ${p.label}'s company brain?`, opener, [h('p', {}, 'The office takes the company brain block out of each project’s instruction files. The context manifests (what each session was offered) are kept.'), h('p.pf-hint', {}, 'Disconnecting can’t take anything back from sessions already running, code or documents already written, or logs.')], [no, yes]);
  no.onclick = () => d.modal.close();
  yes.onclick = async () => {
    d.status.textContent = 'Disconnecting…';
    const r = await portfolioAct({ action: 'disconnect', portfolio: p.id });
    if (r.error) return void (d.status.textContent = r.error);
    d.modal.close();
    done(r);
  };
}

/** What a project already has wired, in a few lines (the review before Add to portfolio). */
export function contextLines(c: ExistingContext | undefined): (Node | string)[] {
  if (!c) return [h('p.pf-hint', {}, 'Couldn’t read what the project already has.')];
  return [
    h('p', {}, `Instruction files: ${c.surfaces.join(', ') || 'none'}.`),
    c.blocks.length ? h('p', {}, `Already wired to a company brain in ${c.blocks.map((b) => `${b.file}${b.brain ? ` (${b.brain})` : ''}`).join(', ')}.`) : h('p', {}, 'No company brain block yet.'),
    c.manifests ? h('p', {}, `${c.manifests} context manifest${c.manifests === 1 ? '' : 's'} recorded: it was offered ${c.consumed?.path ?? 'a brain'} before.`) : h('p', {}, 'No brain offered to it before (no context manifests).'),
  ];
}

/**
 * Add to portfolio, from a portfolio (pick an ungrouped project) or from a project (pick a portfolio). The
 * project's existing context is shown first; a project in another portfolio is refused (S03).
 */
export function addToPortfolioDialog(opener: HTMLElement | null, view: PortfoliosView, at: { portfolio?: string; floor?: string }, done: (r: ActResult) => void, pick?: string) {
  const inOther = at.floor ? view.portfolios.find((p) => p.projectIds.includes(at.floor!)) : undefined;
  const picks = at.portfolio ? view.ungrouped.map((f) => [f.id, f.name] as const) : view.portfolios.map((p) => [p.id, p.label] as const);
  const sel = h('select.pf-input', { 'aria-label': at.portfolio ? 'Project' : 'Client' }, ...picks.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const review = h('div.pf-review', {});
  const add = h('button.btn.primary', { type: 'button' }, 'Add to client');
  const floorOf = () => at.floor ?? sel.value;
  const showReview = async () => {
    review.replaceChildren(h('p.pf-hint', {}, 'Reading what the project already has…'));
    const c = await existingContext(floorOf());
    const target = at.portfolio ?? sel.value;
    const blocked = c?.portfolio && c.portfolio.id !== target ? `It already belongs to the client ${c.portfolio.label}: a project can belong to one client, and moving it between clients isn’t available.` : c?.consumed && c.consumed.portfolioId !== target ? 'It was offered another client’s company brain before: moving it isn’t available, as what it was offered can’t be taken back.' : undefined;
    review.replaceChildren(h('h3', {}, 'What the project already has'), ...contextLines(c), ...(blocked ? [h('p.pf-refused', { role: 'alert' }, blocked)] : []));
    add.toggleAttribute('disabled', !!blocked);
  };
  const body: (Node | string | null)[] = inOther
    ? [h('p.pf-refused', { role: 'alert' }, `This project already belongs to the client ${inOther.label}, and a project can belong to one client. Moving a project between clients isn’t available in this version: it may already have used that client’s company brain, and moving it can’t take that back.`)]
    : !picks.length
      ? [h('p', {}, at.portfolio ? 'Every project belongs to a client already.' : 'There are no clients yet. Make one here (＋ New client) or on the Clients page, then add the project to it.')]
      : [h('label.pf-field', {}, h('span', {}, at.portfolio ? 'Project (only ones without a client)' : 'Client'), sel), review, h('p.pf-hint', {}, 'If the client has a company brain, the project is wired to it straight away and checked.'), note()];
  // From a project: a client that doesn't exist yet can be made here, then picked (S01: an admin's action).
  const fresh = at.floor && !inOther && view.admin ? (h('button.btn', { type: 'button' }, '＋ New client') as HTMLButtonElement) : null;
  const d = dialog('Add to client', opener, body, [...(fresh ? [fresh] : []), ...(inOther || !picks.length ? [] : [add])]);
  if (fresh) fresh.onclick = () => (d.modal.close(), newPortfolioDialog(opener, (r) => r.view && addToPortfolioDialog(opener, r.view, at, done, r.portfolio?.id)));
  if (inOther || !picks.length) return;
  if (pick && picks.some(([v]) => v === pick)) sel.value = pick;
  sel.onchange = () => void showReview();
  void showReview();
  add.onclick = async () => {
    add.setAttribute('disabled', '');
    d.status.textContent = 'Adding…';
    const r = await portfolioAct({ action: 'add', portfolio: at.portfolio ?? sel.value, floor: floorOf() });
    add.removeAttribute('disabled');
    if (r.error) return void (d.status.textContent = r.error);
    if (r.check && !r.check.ok) d.status.textContent = `Added, but the wiring is incomplete: ${r.check.problems.join('; ')} (also in Needs you).`;
    else d.modal.close();
    done(r);
  };
}
