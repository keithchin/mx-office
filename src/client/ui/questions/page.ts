// The Questions page (ui/questions/tab.ts registers it): the analysts' open questions for the client, read
// by the office from the BRDs on main and in every agent's working copy (server/questions/), grouped by
// BRD, filtered and searched, each with its status and the four ways to answer it. Answers wait in the
// sticky bar ("7 answers ready · Send to Tim") until Send types one message to the analyst. Drawn from the
// feed (./feed.ts), which follows the floor and the audit log, so a new collection shows by itself.

import { headerWords, questionCounts, needsClient, isResolved, type AnswerKind, type Question, type QuestionsView } from '../../../shared/questions';
import { store } from '../../state';
import { h } from '../dom';
import { questionCard } from './card';
import { openExport, openImport, openSend } from './dialogs';
import { followQuestions, onQuestionsChanged, questionsView, setQuestionsView } from './feed';
import { emptyWords, FILTERS, groups, readyByRecipient, readyWords, type QFilter } from './logic';
import './questions.css';

export function questionsTab(root: HTMLElement) {
  let filter: QFilter = 'all';
  let search = '';
  let showing = false;
  // "Questions · 9 of 24 answered · 6 block work"; Portal's page header already says "Questions", so there only the counts show.
  const counts = h('span.qs-title-counts');
  const sep = h('span.qs-title-name', {}, ' · ');
  const title = h('h2.qs-title', {}, h('span.qs-title-name', {}, 'Questions'), sep, counts);
  const note = h('p.qs-note', { role: 'status', 'aria-live': 'polite' });
  const status = h('p.qs-msg', { role: 'status', 'aria-live': 'polite' });
  const chips = h('div.qs-filters', { role: 'group', 'aria-label': 'Show' });
  const searchBox = h('input.qs-search', { type: 'search', placeholder: 'Search questions', 'aria-label': 'Search questions', oninput: () => ((search = searchBox.value), draw(true)) }) as HTMLInputElement;
  const refresh = h('button.btn.small', { type: 'button', title: 'Read the BRDs again now (main and every working copy)', onclick: () => void collect() }, '⟳ Refresh');
  const exportBtn = h('button.btn.small', { type: 'button', onclick: () => exportNow() }, 'Export for the client');
  const importBtn = h('button.btn.small', { type: 'button', onclick: () => floor() && openImport(floor()!) }, 'Import answers');
  const body = h('div.qs-body');
  const bar = h('div.qs-bar', { role: 'region', 'aria-label': 'Your answers before sending' });
  root.replaceChildren(
    h(
      'div.qs',
      {},
      h('div.qs-top', {}, title, h('div.qs-tools', {}, refresh, exportBtn, importBtn)),
      note,
      h('div.qs-find', {}, chips, searchBox),
      status,
      body,
      bar,
    ),
  );

  const floor = () => store.floor ?? undefined;

  async function collect() {
    const f = floor();
    if (!f) return;
    refresh.disabled = true;
    status.textContent = 'Reading the BRDs…';
    const res = await fetch('/api/questions/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: f }) }).catch(() => undefined);
    refresh.disabled = false;
    const v = (await res?.json().catch(() => undefined)) as QuestionsView | undefined;
    if (!res?.ok || !v?.floor) return void (status.textContent = 'The office could not read them just now.');
    status.textContent = '';
    setQuestionsView(v);
  }

  async function answer(q: Question, kind: AnswerKind | 'clear', text?: string, option?: string): Promise<string | undefined> {
    const res = await fetch('/api/questions/answer', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: floor(), key: q.key, kind, text, option, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as QuestionsView & { error?: string };
    if (!res?.ok || !out?.floor) return out?.error ?? 'the office could not be reached';
    setQuestionsView(out);
    draw(true);
    return undefined;
  }

  function exportNow() {
    const v = questionsView();
    const f = floor();
    if (!v || !f) return;
    const qs = v.set?.questions ?? [];
    const asked = qs.filter((q) => v.answers[q.key]?.kind === 'ask-client' && !isResolved(q.state)).length;
    const userOnly = qs.filter((q) => needsClient(q) && !v.answers[q.key] && !isResolved(q.state)).length;
    openExport(f, asked, userOnly);
  }

  function drawChips() {
    chips.replaceChildren(...FILTERS.map((x) => h('button.btn.small.qs-chip', { type: 'button', title: x.tip, 'aria-pressed': String(x.id === filter), class: x.id === filter ? 'on' : '', onclick: () => ((filter = x.id), draw(true)) }, x.label)));
  }

  function drawBar(v: QuestionsView) {
    const ready = readyByRecipient(v);
    const rows = [...ready].map(([to, list]) => {
      const r = v.recipients.find((x) => x.name === to);
      return h('div.qs-bar-row', {}, h('b', {}, readyWords(list.length)), r ? h('button.btn.small.primary', { type: 'button', disabled: !v.admin, onclick: () => openSend(v.floor, r, list.length) }, `Send to ${r.name}`) : h('span.qs-muted', {}, ' · nobody on the team is at work to record them'));
    });
    bar.replaceChildren(...rows);
    bar.hidden = !rows.length;
  }

  /** Draws again; a change from elsewhere waits while you're writing an answer in a card (`force`: your own change). */
  function draw(force = false) {
    if (!showing) return;
    if (!force && [...body.querySelectorAll<HTMLTextAreaElement>('.qs-form textarea')].some((t) => t.value.trim())) return;
    const v = questionsView();
    drawChips();
    if (!v || v.floor !== floor()) {
      body.replaceChildren(h('p.qs-empty', {}, 'Loading…'));
      bar.hidden = true;
      return;
    }
    const qs = v.set?.questions ?? [];
    counts.textContent = qs.length ? headerWords(questionCounts(qs, v.answers)).replace(/^Questions · /, '') : '';
    sep.hidden = !qs.length;
    note.textContent = [v.set?.via === 'brd' ? 'Toolkit script unavailable: read from the BRD files.' : '', v.collecting ? 'Reading the BRDs again…' : '', v.set ? `Read ${new Date(v.set.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''].filter(Boolean).join(' ');
    note.classList.toggle('qs-note-warn', v.set?.via === 'brd');
    exportBtn.disabled = !qs.length;
    importBtn.disabled = !qs.length || !v.admin;
    drawBar(v);
    const empty = emptyWords(v);
    if (empty) return void body.replaceChildren(h('p.qs-empty', {}, empty));
    const gs = groups(v, filter, search);
    if (!gs.length) return void body.replaceChildren(h('p.qs-empty', {}, 'Nothing matches.'));
    body.replaceChildren(
      ...gs.map((g) =>
        h(
          'section.qs-group',
          { 'aria-label': g.title },
          h('h3.qs-group-h', {}, g.title, h('small', {}, ` · ${g.questions.length}`)),
          ...g.questions.map((q) => questionCard(q, v.answers[q.key], { admin: v.admin, ...(v.routes[q.key] ? { to: v.routes[q.key] } : {}), answer })),
        ),
      ),
    );
  }

  onQuestionsChanged(() => draw());
  return {
    show() {
      showing = true;
      followQuestions(floor());
      draw();
    },
    hide() {
      showing = false;
    },
    refresh() {
      followQuestions(floor());
      draw();
    },
  };
}
