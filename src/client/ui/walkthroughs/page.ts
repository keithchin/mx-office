// 🎬 Walkthroughs (/lite?tab=walkthroughs): short videos of the app's workflows, recorded by the office by
// itself from the project's test journeys (server/walkthroughs/): when a build on main passes them or a
// milestone becomes ready, against the office's own copy of the app at that commit. The page: the guided
// tour on top, one card per workflow (its newest recording, earlier ones under it: status, commit, when,
// auto or manual, ▶ Watch, Download, Save to repo / In PR #N), the current batch's progress (queued,
// starting the recording app, recording N of M, finishing) with Cancel, and for admins the auto switch,
// Record one journey, Re-record all and Make guided tour. It asks the office when shown, every couple of
// seconds while a batch runs, and now and then otherwise; nothing while it's hidden.

import type { WalkBatch, WalkCardRecording, WalkView } from '../../../shared/walkthroughs/types';
import { SOURCE_WORDS } from '../../../shared/walkthroughs/identity';
import { store } from '../../state';
import type { TabHooks } from '../../tabs/registry';
import { h, timeAgo, toast } from '../dom';
import { act, fileUrl, loadView, takePending } from './api';
import { evidenceLine, openPlayer } from './player';
import './page.css';

const BUSY_MS = 2000;
const IDLE_MS = 20_000;
const STATUS: Record<WalkCardRecording['status'], string> = { queued: 'Queued', recording: 'Recording', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled', error: 'Didn’t finish' };
const secs = (ms?: number) => (ms === undefined ? '' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const short = (sha: string) => sha.slice(0, 7);

/** A batch's place, in words: what the progress panel says. */
export function batchWords(b: WalkBatch, ahead: number): { pill: string; text: string; done: number } {
  const of = b.journeys.length;
  const now = b.journeys[b.n - 1];
  switch (b.phase) {
    case 'queued':
      return { pill: 'Queued', text: `${b.kind === 'tour' ? 'Guided tour' : `${of} workflow${of === 1 ? '' : 's'}`} of @${short(b.commit)}${ahead ? `, after ${ahead} other recording${ahead === 1 ? '' : 's'} in the office` : ''}`, done: 0 };
    case 'booting':
      return { pill: 'Starting the app', text: `Starting the recording app at @${short(b.commit)} on a fresh database${b.line && !/^Starting the recording app/.test(b.line) ? ` · ${b.line}` : '…'}`, done: 0 };
    case 'recording': {
      const rest = (b.line ?? '').replace(/^Recording \d+ of \d+: /, '');
      return { pill: 'Recording', text: `Recording ${b.n} of ${of}: ${now?.title ?? ''}${rest && rest !== now?.title ? ` · ${rest}` : ''}`, done: Math.max(0, b.n - 1) };
    }
    default:
      return { pill: b.kind === 'tour' ? 'Making the tour' : 'Finishing', text: b.kind === 'tour' ? `Making the guided tour of @${short(b.commit)}${b.line ? ` · ${b.line}` : '…'}` : `Done recording; stopping the recording app…`, done: b.kind === 'tour' ? 0 : of };
  }
}

/** The page in `container`; `floorOf` says which project the 1D view is on (the store's, but for tests). */
export function walkthroughsPage(container: HTMLElement, floorOf: () => string = () => store.floor ?? ''): TabHooks {
  const el = h('section.wtp', { 'aria-label': 'Walkthroughs' });
  container.replaceChildren(el);
  let view: WalkView | null = null;
  let floor = '';
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let picked = '';
  let narrate = true;

  async function load() {
    const f = floorOf();
    if (!f) {
      // Not on a project yet (the page is still coming in): ask again in a moment.
      clearTimeout(timer);
      if (shown) timer = setTimeout(() => void load(), 500);
      return;
    }
    if (loading) return;
    loading = true;
    try {
      const v = await loadView(f);
      if (v && v.floor === floorOf()) {
        view = v;
        draw();
        const want = takePending();
        const r = want ? v.recordings.find((x) => x.id === want) : undefined;
        if (r) openPlayer(f, r, el.querySelector<HTMLElement>(`[data-rec="${r.id}"]`));
      }
    } finally {
      loading = false;
      clearTimeout(timer);
      if (shown) timer = setTimeout(() => void load(), view?.batches.length ? BUSY_MS : IDLE_MS);
    }
  }

  const after = (p: Promise<unknown>) => void p.then(() => load());

  function card(list: WalkCardRecording[]): HTMLElement {
    const r = list[0];
    const main = view?.main?.commit;
    const thumb = r.kind === 'tour' ? 'cards/intro.png' : (r.steps.find((s) => s.status === 'failed' && s.screenshot)?.screenshot ?? r.steps.find((s) => s.screenshot)?.screenshot ?? '');
    const watch = h('button.btn.primary', { type: 'button', disabled: !r.outputs.video, 'data-rec': r.id, onclick: () => openPlayer(floor, r, watch) }, '▶ Watch');
    const admin = !!view?.admin;
    const saved = r.saved ? h('a.wt-saved', { href: r.saved.url ?? '#', target: '_blank', rel: 'noopener' }, r.saved.pr ? `In PR #${r.saved.pr}` : `On ${r.saved.branch}`) : null;
    const save =
      admin && r.status === 'passed' && !r.saved
        ? h('button.btn', { type: 'button', title: 'Open a pull request that adds this walkthrough to the project’s repo (docs/walkthroughs/)', onclick: (e: Event) => ((e.currentTarget as HTMLButtonElement).disabled = true, after(act({ action: 'save', floor, id: r.id }).then((o) => o && toast('Opened a pull request with the walkthrough')))) }, 'Save to repo')
        : null;
    const tags = [
      r.trigger === 'auto' ? `Auto${r.milestone ? ` · ${r.milestone.title}` : ''}` : `Manual · ${r.by}`,
      `@${short(r.app.commit)}${main && main !== r.app.commit ? ' (an older build)' : ''}`,
      timeAgo(r.startedAt),
      secs(r.durationMs),
      r.outputs.format ? `${r.outputs.format.toUpperCase()}${r.outputs.narration !== 'none' ? ' · voice' : ' · captions'}` : '',
    ].filter(Boolean);
    const earlier = list.slice(1, 6);
    const notes = r.status !== 'passed' && r.status !== 'recording' && r.journey.notes?.length ? h('ul.wt-cnotes', { 'aria-label': 'What the journey says it needs' }, ...r.journey.notes.map((n) => h('li', {}, n))) : null;
    return h(
      'article',
      { class: `wt-card ${r.status}${r.kind === 'tour' ? ' tour' : ''}` },
      thumb && r.outputs.video ? h('button.wt-thumb', { type: 'button', onclick: () => openPlayer(floor, r, watch), 'aria-label': `Watch ${r.journey.title}` }, h('img', { src: fileUrl(floor, r.id, thumb), alt: '', loading: 'lazy' })) : h('div.wt-thumb.empty', { 'aria-hidden': 'true' }, r.status === 'recording' ? '●' : '—'),
      h(
        'div.wt-body',
        {},
        h('h4', {}, r.journey.title, ' ', h('span', { class: `pill wt-pill ${r.status}` }, r.status === 'failed' && r.failure?.step ? `Failed at step ${r.failure.step}` : STATUS[r.status])),
        h('p.wt-tags', {}, tags.join(' · ')),
        h('p.wt-small', {}, evidenceLine(r)),
        notes,
        h(
          'div.wt-actions',
          {},
          watch,
          r.outputs.video ? h('a.btn', { href: fileUrl(floor, r.id, r.outputs.video), download: `${r.journey.id}-${short(r.app.commit)}.${r.outputs.format}` }, 'Download') : null,
          save,
          saved,
          admin && r.status !== 'recording' ? h('button.btn.wt-del', { type: 'button', title: 'Delete this recording from the office (not from the repo)', onclick: () => confirm('Delete this recording from the office?') && after(act({ action: 'delete', floor, id: r.id })) }, 'Delete') : null,
        ),
        earlier.length ? h('p.wt-small', {}, 'Earlier: ', ...earlier.flatMap((x, k) => [k ? ' · ' : '', h('button.wt-link', { type: 'button', onclick: (e: Event) => openPlayer(floor, x, e.currentTarget as HTMLElement) }, `${STATUS[x.status]} @${short(x.app.commit)}, ${timeAgo(x.startedAt)}`)])) : null,
      ),
    );
  }

  function progress(v: WalkView): HTMLElement | null {
    if (!v.batches.length) return null;
    return h(
      'div.wt-batches',
      { role: 'status', 'aria-live': 'polite' },
      ...v.batches.map((b, i) => {
        const w = batchWords(b, i === 0 ? v.ahead : 0);
        const of = b.kind === 'tour' ? 1 : b.journeys.length;
        return h(
          'div',
          { class: `wt-batch ${b.phase}` },
          h('span', { class: `pill wt-pill ${b.phase === 'queued' ? 'queued' : 'recording'}` }, w.pill),
          h('span.wt-btext', {}, w.text, b.trigger === 'auto' ? h('small', {}, ` · auto${b.milestone ? `, ${b.milestone.title}` : ''}`) : h('small', {}, ` · by ${b.by}`)),
          b.phase !== 'queued' ? h('progress.wt-bar', { max: String(of), value: String(w.done), 'aria-label': `${w.done} of ${of} done` }) : null,
          v.admin ? h('button.btn', { type: 'button', onclick: () => after(act({ action: 'cancel', floor, batch: b.id })) }, 'Cancel') : null,
        );
      }),
    );
  }

  function controls(v: WalkView): HTMLElement | null {
    if (!v.admin) return null;
    const can = v.available.recorder && !!v.journeys.length;
    if (!v.journeys.some((j) => j.id === picked)) picked = v.journeys[0]?.id ?? '';
    const sel = h('select.wt-pick', { 'aria-label': 'Journey to record', disabled: !can, onchange: (e: Event) => (picked = (e.target as HTMLSelectElement).value) }, ...v.journeys.map((j) => h('option', { value: j.id, selected: j.id === picked }, `${j.title}${j.requirement.length ? ` (${j.requirement.slice(0, 3).join(', ')})` : ''}`)));
    const canVoice = v.available.narration !== 'none';
    const voice = h('label.wt-check', { title: canVoice ? 'A local voice reads each step (nothing leaves the machine)' : 'No local voice on the office’s machine: captions only' }, h('input', { type: 'checkbox', checked: canVoice && narrate && v.settings.narrate, disabled: !canVoice, onchange: (e: Event) => (narrate = (e.target as HTMLInputElement).checked) }), ' Narrate');
    const hasPass = v.recordings.some((r) => r.kind === 'workflow' && r.status === 'passed');
    const voiceOn = canVoice && narrate && v.settings.narrate;
    return h(
      'div.wt-controls',
      {},
      h('label.wt-check.wt-auto', { title: 'When a build on main passes its journeys, or a milestone becomes ready, record each passing journey once per commit' }, h('input', { type: 'checkbox', checked: v.settings.autoRecord, onchange: (e: Event) => after(act({ action: 'settings', floor, autoRecord: (e.target as HTMLInputElement).checked })) }), ' Record automatically'),
      h('span.wt-sep', { 'aria-hidden': 'true' }),
      sel,
      voice,
      h('button.btn.primary', { type: 'button', disabled: !can || !picked, title: 'Record this journey of main’s newest commit, on the office’s own copy of the app', onclick: () => after(act({ action: 'record', floor, journey: picked, narrate: voiceOn })) }, '● Record'),
      h('button.btn', { type: 'button', disabled: !can, title: 'Record every journey of main’s newest commit again', onclick: () => after(act({ action: 'record', floor, all: true, narrate: voiceOn })) }, '⟳ Re-record all'),
      h('button.btn', { type: 'button', disabled: !hasPass || !v.available.ffmpeg, title: v.available.ffmpeg ? 'One longer video: an intro, each workflow’s newest passing video of one build, an outro' : 'Needs ffmpeg on the office’s machine', onclick: () => after(act({ action: 'tour', floor })) }, 'Make guided tour'),
    );
  }

  function draw() {
    if (!view) return void el.replaceChildren(h('p.wt-small', {}, 'Asking the office…'));
    const v = view;
    const inBatch = new Set(v.batches.flatMap((b) => b.journeys.map((j) => j.rec).filter(Boolean)));
    const groups = new Map<string, WalkCardRecording[]>();
    for (const r of v.recordings) {
      if (r.status === 'recording' && inBatch.has(r.id)) continue;
      const k = `${r.kind}|${r.journey.id}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const all = [...groups.values()];
    const tours = all.filter((g) => g[0].kind === 'tour').map(card);
    const flows = all.filter((g) => g[0].kind !== 'tour').sort((a, b) => b[0].startedAt - a[0].startedAt).map(card);
    const who = v.identity ? h('p.wt-small', {}, `Recordings sign in as ${v.identity.user} (${SOURCE_WORDS[v.identity.from]}), unless a journey names its own identity. Never an admin.`) : null;
    const empty =
      !flows.length && !tours.length && !v.batches.length
        ? h(
            'div.wt-empty',
            {},
            h('h3', {}, 'No walkthroughs yet'),
            h('p', {}, 'Videos appear here by themselves after the next ready milestone or passing build on main: the office records each journey that passed, against its own copy of the app at that commit.'),
            !v.journeys.length ? h('p.wt-small', {}, 'Main has no test journeys (tests/e2e/*.journey.json) to record yet.') : null,
            v.admin ? h('button.btn.primary', { type: 'button', disabled: !v.available.recorder || !v.journeys.length, onclick: () => after(act({ action: 'record', floor, all: true })) }, '● Record now') : null,
          )
        : null;
    const disk = v.disk.quota ? h('p.wt-small', {}, `Working copies: ${(v.disk.bytes / 1024 / 1024).toFixed(1)} MB of ${(v.disk.quota / 1024 ** 3).toFixed(0)} GB. Their home is the project’s repo (Save to repo opens a pull request); old auto-recordings are cleaned up.`) : null;
    const parts: (HTMLElement | null)[] = [
      h('p.wt-lead', {}, 'Short videos of the app’s workflows, made by the office from the project’s test journeys. When a build on main passes them, or a milestone becomes ready, each passing journey is recorded once per commit, against the office’s own copy of the app at that commit on a fresh database (your live app is never touched). A video is evidence only for the commit it recorded; a failed step stops it and it says so.'),
      ...v.available.notes.map((n) => h('p.wt-note', {}, n)),
      controls(v),
      who,
      progress(v),
      tours.length ? h('div.wt-tours', {}, ...tours) : null,
      flows.length ? h('div.wt-cards', {}, ...flows) : null,
      empty,
      disk,
    ];
    el.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  function enter() {
    const f = floorOf();
    if (f !== floor) {
      floor = f;
      view = null;
      draw();
    }
    void load();
  }

  draw();
  return {
    show() {
      shown = true;
      enter();
    },
    hide() {
      shown = false;
      clearTimeout(timer);
    },
    refresh() {
      enter();
    },
  };
}
