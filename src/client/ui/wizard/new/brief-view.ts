// The project brief panel of the New project plan: Goal, Success criteria, User roles, Scope (in and out),
// Constraints and Open questions, each item with its tag (Answered, Assumed, Unverified: a word as well as
// a colour) and where it came from. Assumed items have Confirm and Edit, open questions Answer in chat,
// and every section can be added to. While the Chief Analyst drafts, the sections wait under shimmering
// lines; when the brief arrives they appear one by one, quickly. Once the scope is approved it folds away.
import { DRAFTED, SECTION_IDS, SECTION_INFO, sourceText, whenDrafted, type BriefItem, type DraftView, type ItemOp, type SectionId } from '../../../../shared/brief';
import { h, toast } from '../../dom';
import { briefApi } from './api';
import { openDialog } from './dialog';
import { draftingCard, hhmm, icon, skeleton, tagPill } from './parts';
import type { Flow } from './index';

export interface BriefPanelCtx {
  /** Puts text in the chat box and opens the chat (the phone's sheet too). */
  prefill(text: string): void;
}

const REVEAL_MS = 260;

export function briefPanel(flow: Flow, ctx: BriefPanelCtx) {
  const body = h('div.nw-panel-b', {});
  const badge = h('span.nw-badge.draft', {}, 'DRAFT');
  const approvedLine = h('span.nw-approved', {});
  const chev = icon('chev', 'nw-ico nw-chev');
  const head = h('button.nw-panel-h', { type: 'button', 'aria-expanded': 'true', 'aria-controls': 'nw-brief-c', disabled: true }, icon('doc'), h('h2', {}, 'Project brief'), badge, approvedLine, h('span.nw-grow'), chev);
  const collapse = h('div.nw-collapse', { id: 'nw-brief-c' }, h('div', {}, body));
  const el = h('section.nw-panel', { 'aria-label': 'Project brief' }, head, collapse);
  const secs = new Map<SectionId, HTMLElement>(SECTION_IDS.map((s) => [s, h('div.nw-sec', { id: `nw-sec-${s}`, 'data-state': 'pending' })]));
  body.append(...secs.values());
  /** Sections shown with their items (the rest wait, or are being revealed). */
  let shown = new Set<SectionId>();
  let revealing: ReturnType<typeof setTimeout> | undefined;
  /** The section being revealed now. */
  let now: SectionId | undefined;
  /** The item being edited inline, kept across redraws. */
  let editing: string | undefined;

  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(open));
    collapse.classList.toggle('shut', !open);
  });

  const act = async (op: ItemOp, said: string) => {
    const d = flow.draft!;
    try {
      flow.setDraft(await briefApi.item(d.id, op));
      flow.say(said);
      return true;
    } catch (err) {
      toast((err as Error).message, 'warn');
      return false;
    }
  };

  function metaRow(it: BriefItem, s: SectionId, locked: boolean): HTMLElement {
    const src = sourceText(it, flow.me);
    const srcIcon = it.by ? 'user' : /\.(pdf|docx|md|txt)/i.test(src) ? 'file' : 'chat';
    const acts = h('span.nw-acts', {});
    if (!locked) {
      if (it.tag === 'assumed') acts.append(h('button.btn.sm', { type: 'button', onclick: () => void act({ op: 'confirm', id: it.id }, 'Confirmed. Recorded as answered, confirmed by you').then((ok) => ok && focusItem(it.id)) }, 'Confirm'));
      if (s === 'questions') acts.append(h('button.btn.sm.nw-ghost', { type: 'button', onclick: () => ctx.prefill(`About "${it.text}": `) }, 'Answer in chat'));
      else if (it.tag === 'assumed') acts.append(h('button.btn.sm.nw-ghost', { type: 'button', 'aria-label': `Edit: ${it.name ?? it.text}`, onclick: () => ((editing = it.id), draw(s)) }, icon('pencil'), 'Edit'));
      else acts.append(h('button.nw-iconbtn.nw-quiet', { type: 'button', 'aria-label': `Edit: ${it.name ?? it.text}`, title: 'Edit', onclick: () => ((editing = it.id), draw(s)) }, icon('pencil')));
    }
    return h('div.nw-imeta', {}, tagPill(it.tag), h('span.nw-src', {}, icon(srcIcon), src), acts);
  }

  function editor(it: BriefItem, s: SectionId): HTMLElement {
    const role = s === 'roles';
    const name = role ? (h('input', { type: 'text', value: it.name ?? '', 'aria-label': 'Role' }) as HTMLInputElement) : null;
    const text = h('textarea', { 'aria-label': role ? 'What the role is' : 'Edit the item' }) as HTMLTextAreaElement;
    text.value = it.text;
    const when = role ? (h('textarea', { 'aria-label': 'When I… I need to…' }) as HTMLTextAreaElement) : null;
    if (when) when.value = it.when ?? '';
    const cancel = () => ((editing = undefined), draw(s), focusItem(it.id));
    const save = h('button.btn.sm.primary', { type: 'button' }, 'Save');
    save.addEventListener('click', () => void act({ op: 'edit', id: it.id, text: text.value, ...(name ? { name: name.value } : {}), ...(when ? { when: when.value } : {}) }, 'Saved. Recorded as answered, edited by you').then((ok) => ok && ((editing = undefined), draw(s), focusItem(it.id))));
    const remove = h('button.btn.sm.nw-ghost.nw-danger', { type: 'button' }, 'Remove');
    remove.addEventListener('click', () => void act({ op: 'remove', id: it.id }, 'Removed from the brief').then((ok) => ok && ((editing = undefined), draw(s))));
    const box = h('div.nw-edit', {}, ...(name ? [name] : []), text, ...(when ? [when] : []), h('div.nw-imeta', {}, h('span.nw-acts.left', {}, save, h('button.btn.sm.nw-ghost', { type: 'button', onclick: cancel }, 'Cancel'), remove)));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), cancel());
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), save.click());
    });
    setTimeout(() => (name ?? text).focus(), 10);
    return box;
  }

  function itemEl(it: BriefItem, s: SectionId, i: number, locked: boolean): HTMLElement {
    const attrs = { class: `${it.tag}${s === 'roles' ? ' nw-role' : ''}`, style: `animation-delay:${i * 60}ms`, id: `nw-it-${it.id}`, 'data-item': it.id };
    if (editing === it.id && !locked) return h('div.nw-item', attrs, editor(it, s));
    // The statement is the Chief Analyst's wording unless someone said it: said so, and not covered by the role's tag.
    const drafted = whenDrafted(it) ? h('p.nw-drafted', {}, icon('compass'), `Statement ${DRAFTED}`) : null;
    if (s === 'roles') return h('div.nw-item', attrs, h('h4', { tabindex: '-1' }, icon('user'), it.name ?? ''), h('p.nw-rd', {}, it.text), it.when ? h('p.nw-when', {}, it.when) : null, drafted, metaRow(it, s, locked));
    return h('div.nw-item', attrs, h('p.nw-itxt', { tabindex: '-1' }, it.text), metaRow(it, s, locked));
  }

  function addLink(s: SectionId, side?: 'in' | 'out'): HTMLElement {
    const label = s === 'roles' ? 'Add user role' : s === 'scope' ? (side === 'out' ? 'Add to out of scope' : 'Add to scope') : s === 'questions' ? 'Add an open question' : `Add to ${SECTION_INFO[s].title.toLowerCase()}`;
    const b = h('button.nw-link', { type: 'button' }, icon('plus'), label);
    b.addEventListener('click', () => addDialog(s, side, b));
    return b;
  }

  function addDialog(s: SectionId, side: 'in' | 'out' | undefined, opener: HTMLElement) {
    const role = s === 'roles';
    const name = h('input', { type: 'text', id: 'nw-add-name', required: true, placeholder: 'e.g. Security officer' }) as HTMLInputElement;
    const text = h('textarea', { id: 'nw-add-text', placeholder: role ? 'What the role is, in a line' : '' }) as HTMLTextAreaElement;
    const when = h('textarea', { id: 'nw-add-when', placeholder: 'When a visitor is flagged, I need to see their history so I can decide whether to let them in.' }) as HTMLTextAreaElement;
    const err = h('p.nw-problem', { role: 'alert' });
    const add = h('button.btn.primary', { type: 'submit' }, role ? 'Add role' : 'Add');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const form = h(
      'form',
      {},
      ...(role ? [h('div.nw-field', {}, h('label', { for: 'nw-add-name' }, 'Role'), name)] : []),
      h('div.nw-field', {}, h('label', { for: 'nw-add-text' }, role ? 'What the role is' : SECTION_INFO[s].title), text),
      ...(role ? [h('div.nw-field', {}, h('label', { for: 'nw-add-when' }, 'When I want to… I need to…'), when)] : []),
      h('p.nw-hint', {}, s === 'questions' ? 'Recorded as Unverified until someone answers it.' : 'Recorded as Answered, "added by you".'),
      err,
      h('div.nw-dlg-f', {}, cancel, add),
    );
    const dlg = openDialog(el, role ? 'Add a user role' : `Add to ${SECTION_INFO[s].title}`, form, { opener });
    cancel.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void act({ op: 'add', section: s, text: text.value, ...(role ? { name: name.value, when: when.value } : {}), ...(side ? { side } : {}) }, 'Added to the brief').then((ok) => (ok ? dlg.close() : (err.textContent = 'Couldn’t add it')));
    });
  }

  function draw(s: SectionId) {
    const d = flow.draft;
    const node = secs.get(s)!;
    const info = SECTION_INFO[s];
    const items = d?.brief?.sections[s] ?? [];
    const locked = !!d?.approved;
    const state = !d?.brief || d.status === 'drafting' ? (d?.status === 'drafting' && s === 'goal' ? 'loading' : 'pending') : shown.has(s) ? 'done' : s === now ? 'loading' : 'pending';
    node.dataset.state = state;
    const ask = state === 'done' && !locked && !d!.manual && flow.status.available ? h('button.nw-link', { type: 'button', onclick: () => ctx.prefill(`Refine ${info.title.toLowerCase()}: `) }, icon('spark'), 'Ask the Chief Analyst to refine') : null;
    const right = state === 'pending' ? h('span.nw-wait', {}, 'Waiting') : ask;
    let content: HTMLElement | null = null;
    if (state === 'loading') content = d?.status === 'drafting' ? draftingCard('Drafting the brief…', 'The Chief Analyst writes all six sections in one go; they appear here as soon as it’s done. ' + info.tip) : draftingCard(info.status, info.tip);
    else if (state === 'pending') content = skeleton();
    else if (s === 'scope') {
      const side = (x: 'in' | 'out') => items.filter((it) => (it.side ?? 'in') === x);
      content = h('div.nw-scope2', {}, h('div', {}, h('h4', {}, 'In scope'), h('div.nw-items', {}, ...side('in').map((it, i) => itemEl(it, s, i, locked))), locked ? null : addLink(s, 'in')), h('div', {}, h('h4', {}, 'Out of scope'), h('div.nw-items', {}, ...side('out').map((it, i) => itemEl(it, s, i, locked))), locked ? null : addLink(s, 'out')));
    } else {
      content = h('div', {}, h(s === 'roles' ? 'div.nw-roles' : 'div.nw-items', {}, ...items.map((it, i) => itemEl(it, s, i, locked))), items.length ? null : h('p.nw-empty', {}, d?.manual ? 'Nothing yet.' : 'Nothing found for this section.'), locked ? null : h('div.nw-sec-foot', {}, addLink(s)));
    }
    node.replaceChildren(h('div.nw-sec-h', {}, h('h3', {}, info.title), h('span.nw-grow'), right ?? ''), h('div.nw-sec-b', {}, content));
  }

  function focusItem(id: string) {
    const n = el.querySelector<HTMLElement>(`#nw-it-${CSS.escape(id)} .nw-itxt, #nw-it-${CSS.escape(id)} h4`);
    n?.focus({ preventScroll: true });
  }

  function flash(ids: string[]) {
    for (const id of ids) {
      const n = el.querySelector<HTMLElement>(`#nw-it-${CSS.escape(id)}`);
      if (!n) continue;
      n.classList.remove('flash');
      void n.offsetWidth;
      n.classList.add('flash');
    }
  }

  /** The sections one by one (the brief just arrived), at REVEAL_MS each, with each one's status line meanwhile. */
  function reveal() {
    if (revealing) clearTimeout(revealing);
    shown = new Set();
    const next = (i: number) => {
      if (i >= SECTION_IDS.length) {
        revealing = undefined;
        now = undefined;
        flow.say(`Brief ready: ${flow.draft?.brief ? counts(flow.draft) : ''}`);
        return;
      }
      const s = SECTION_IDS[i];
      now = s;
      draw(s);
      flow.say(SECTION_INFO[s].status);
      revealing = setTimeout(() => {
        shown.add(s);
        draw(s);
        next(i + 1);
      }, REVEAL_MS);
    };
    next(0);
  }

  const counts = (d: DraftView) => {
    const all = SECTION_IDS.flatMap((s) => d.brief!.sections[s]);
    const a = all.filter((x) => x.tag === 'assumed').length;
    return `${a} assumption${a === 1 ? '' : 's'} to confirm`;
  };

  function update(prev?: DraftView) {
    const d = flow.draft;
    if (!d) return;
    const arrived = prev?.status === 'drafting' && d.status === 'ready' && !!d.brief;
    if (arrived && !revealing) {
      reveal();
    } else if (!revealing) {
      if (d.brief && d.status !== 'drafting') shown = new Set(SECTION_IDS);
      SECTION_IDS.forEach(draw);
    }
    // The last chat turn's changes, highlighted once.
    const last = d.chat[d.chat.length - 1];
    if (last?.changed?.length && prev && prev.chat.length < d.chat.length) setTimeout(() => flash(last.changed!), 30);
    const approved = !!d.approved;
    badge.className = approved ? 'nw-badge ok' : 'nw-badge draft';
    badge.textContent = approved ? 'APPROVED' : 'DRAFT';
    approvedLine.textContent = approved ? `✋ Stage 0 · confirmed by ${d.approved!.by === flow.me ? 'you' : d.approved!.by} · ${hhmm(d.approved!.at)}${d.approved!.assumed ? ` · ${d.approved!.assumed} ASSUMED` : ''}` : '';
    head.disabled = !approved;
    if (approved && !prev?.approved) {
      head.setAttribute('aria-expanded', 'false');
      collapse.classList.add('shut');
      head.replaceChild(icon('lock'), head.firstChild!);
    }
  }

  /** Esc while an item is edited cancels the edit (true when it did). */
  const escape = () => {
    if (!editing) return false;
    const s = SECTION_IDS.find((x) => flow.draft?.brief?.sections[x].some((it) => it.id === editing));
    editing = undefined;
    if (s) draw(s);
    return true;
  };

  /** The first item still Assumed: scrolled to, highlighted, its Confirm focused (the approve dialog's Review them). */
  function reviewAssumed() {
    const first = SECTION_IDS.flatMap((s) => flow.draft?.brief?.sections[s] ?? []).find((x) => x.tag === 'assumed');
    if (!first) return;
    const n = el.querySelector<HTMLElement>(`#nw-it-${CSS.escape(first.id)}`);
    n?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flash([first.id]);
    setTimeout(() => n?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 220);
  }

  return { el, update, escape, reviewAssumed };
}
