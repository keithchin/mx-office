// The 🌐 Live app tab's Walkthroughs section: short videos of the app's workflows, recorded from the
// project's test journeys against the live app (server/walkthroughs/). One card per workflow (its newest
// recording, earlier ones under it): status, Auto · milestone label, the commit it is evidence for, ▶ Watch,
// Download, Save to repo (a pull request) and Delete. Admins get Record (a journey of the running build,
// narration when the office has a local voice), Make guided tour, and the per-project switch to record a
// milestone's passing journeys by itself when it becomes ready. While something records, the section asks
// again every couple of seconds; otherwise only when the app's commit changes or the tab is drawn.

import type { LiveAppState } from '../../../shared/protocol';
import type { WalkCardRecording, WalkView } from '../../../shared/walkthroughs/types';
import { h, toast } from '../dom';
import { evidenceLine, fileUrl, openPlayer } from './walkthroughs-player';
import './walkthroughs.css';

const POLL_MS = 2000;
const STATUS: Record<WalkCardRecording['status'], string> = { queued: 'Queued', recording: 'Recording', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled', error: 'Didn’t finish' };
const secs = (ms?: number) => (ms === undefined ? '' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

async function act(body: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch('/api/walkthroughs/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) {
      toast(out.error ?? `HTTP ${res.status}`, 'warn');
      return undefined;
    }
    return out;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

export interface WalkSection {
  el: HTMLElement;
  /** The live app changed (or the tab was drawn). */
  update(s: LiveAppState | null, shown: boolean): void;
  /** A "▶ Walkthrough" link for a ready milestone, when a passing recording of it at `commit` exists. */
  linkFor(milestone: string, commit: string | undefined): HTMLElement | null;
  /** Called when the list changed (the readiness card's links follow). */
  onChange?: () => void;
}

export function walkthroughsSection(): WalkSection {
  const el = h('section.wt', { 'aria-label': 'Walkthroughs' });
  let view: WalkView | null = null;
  let floor = '';
  let key = '';
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let picked = '';
  let narrate = true;

  async function load() {
    if (!floor || loading) return;
    loading = true;
    try {
      const res = await fetch(`/api/walkthroughs?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
      if (res.ok) {
        const v = (await res.json()) as WalkView;
        if (v.floor === floor) {
          const changed = JSON.stringify(v.recordings.map((r) => [r.id, r.status, r.saved?.pr])) !== JSON.stringify(view?.recordings.map((r) => [r.id, r.status, r.saved?.pr]));
          view = v;
          draw();
          if (changed) section.onChange?.();
        }
      }
    } catch {
      // Asked again on the next change.
    } finally {
      loading = false;
      clearTimeout(timer);
      if (shown && view?.jobs.length) timer = setTimeout(() => void load(), POLL_MS);
    }
  }

  const after = (p: Promise<unknown>) => void p.then(() => load());

  function card(list: WalkCardRecording[]): HTMLElement {
    const r = list[0];
    const live = view?.live?.commit;
    const thumb = r.kind === 'tour' ? 'cards/intro.png' : (r.steps.find((s) => s.screenshot)?.screenshot ?? '');
    const watch = h('button.btn.primary', { type: 'button', disabled: !r.outputs.video, onclick: () => openPlayer(floor, r, watch) }, '▶ Watch');
    const admin = !!view?.admin;
    const saved = r.saved ? h('a.wt-saved', { href: r.saved.url ?? '#', target: '_blank', rel: 'noopener' }, r.saved.pr ? `In PR #${r.saved.pr}` : `On ${r.saved.branch}`) : null;
    const save =
      admin && r.status === 'passed' && !r.saved
        ? h('button.btn', { type: 'button', title: 'Open a pull request that adds this walkthrough to the project’s repo (docs/walkthroughs/)', onclick: (e: Event) => ((e.currentTarget as HTMLButtonElement).disabled = true, after(act({ action: 'save', floor, id: r.id }).then((o) => o && toast('Opened a pull request with the walkthrough')))) }, 'Save to repo')
        : null;
    const tags = [
      r.trigger === 'auto' ? `Auto${r.milestone ? ` · ${r.milestone.title}` : ''}` : `By ${r.by}`,
      `@${r.app.commit.slice(0, 7)}${live && live !== r.app.commit ? ' (an older build)' : ''}`,
      secs(r.durationMs),
      r.outputs.format ? `${r.outputs.format.toUpperCase()}${r.outputs.narration !== 'none' ? ' · voice' : ' · captions'}` : '',
    ].filter(Boolean);
    const earlier = list.slice(1, 6);
    return h(
      'article',
      { class: `wt-card ${r.status}` },
      thumb && r.outputs.video ? h('button.wt-thumb', { type: 'button', onclick: () => openPlayer(floor, r, watch), 'aria-label': `Watch ${r.journey.title}` }, h('img', { src: fileUrl(floor, r.id, thumb), alt: '', loading: 'lazy' })) : h('div.wt-thumb.empty', {}, r.status === 'recording' ? '●' : '—'),
      h(
        'div.wt-body',
        {},
        h('h4', {}, r.journey.title, ' ', h('span', { class: `pill wt-pill ${r.status}` }, r.status === 'failed' && r.failure?.step ? `Failed at step ${r.failure.step}` : STATUS[r.status])),
        h('p.wt-tags', {}, tags.join(' · ')),
        h('p.wt-small', {}, evidenceLine(r)),
        h(
          'div.wt-actions',
          {},
          watch,
          r.outputs.video ? h('a.btn', { href: fileUrl(floor, r.id, r.outputs.video), download: `${r.journey.id}-${r.app.commit.slice(0, 7)}.${r.outputs.format}` }, 'Download') : null,
          save,
          saved,
          admin && r.status !== 'recording' ? h('button.btn.wt-del', { type: 'button', title: 'Delete this recording from the office (not from the repo)', onclick: () => confirm('Delete this recording from the office?') && after(act({ action: 'delete', floor, id: r.id })) }, 'Delete') : null,
        ),
        earlier.length ? h('p.wt-small', {}, 'Earlier: ', ...earlier.flatMap((x, k) => [k ? ' · ' : '', h('button.wt-link', { type: 'button', onclick: (e: Event) => openPlayer(floor, x, e.currentTarget as HTMLElement) }, `${STATUS[x.status]} @${x.app.commit.slice(0, 7)}`)])) : null,
      ),
    );
  }

  function draw() {
    if (!view) return void el.replaceChildren(h('h3', {}, 'Walkthroughs'), h('p.la-note', {}, 'Asking the office…'));
    const v = view;
    const running = !!v.live?.running;
    const controls: (HTMLElement | null)[] = [];
    if (v.admin) {
      if (!v.journeys.some((j) => j.id === picked)) picked = v.journeys[0]?.id ?? '';
      const sel = h('select.wt-pick', { 'aria-label': 'Journey to record', disabled: !running || !v.journeys.length, onchange: (e: Event) => (picked = (e.target as HTMLSelectElement).value) }, ...v.journeys.map((j) => h('option', { value: j.id, selected: j.id === picked }, `${j.title}${j.requirement.length ? ` (${j.requirement.slice(0, 3).join(', ')})` : ''}`)));
      const canVoice = v.available.narration !== 'none';
      const voice = h('label.wt-check', { title: canVoice ? 'A local voice reads each step (nothing leaves the machine)' : 'No local voice on the office’s machine: captions only' }, h('input', { type: 'checkbox', checked: canVoice && narrate && v.settings.narrate, disabled: !canVoice, onchange: (e: Event) => (narrate = (e.target as HTMLInputElement).checked) }), ' Narrate');
      const hasPass = v.recordings.some((r) => r.kind === 'workflow' && r.status === 'passed' && r.app.commit === v.live?.commit);
      controls.push(
        h(
          'div.wt-controls',
          {},
          sel,
          voice,
          h('button.btn.primary', { type: 'button', disabled: !running || !picked, onclick: () => after(act({ action: 'record', floor, journey: picked, narrate: canVoice && narrate && v.settings.narrate })) }, '● Record'),
          h('button.btn', { type: 'button', disabled: !running || !hasPass || !v.available.ffmpeg, title: v.available.ffmpeg ? 'One longer video: an intro, each workflow’s newest passing video of this build, an outro' : 'Needs ffmpeg on the office’s machine', onclick: () => after(act({ action: 'tour', floor })) }, 'Make guided tour'),
          h('label.wt-check', { title: 'Record each journey of a milestone that passed against the build, when the milestone becomes ready' }, h('input', { type: 'checkbox', checked: v.settings.autoRecord, onchange: (e: Event) => after(act({ action: 'settings', floor, autoRecord: (e.target as HTMLInputElement).checked })) }), ' Auto-record when a milestone becomes ready'),
        ),
      );
    }
    const hint = !running ? h('p.la-note', {}, 'Start the live app to record a walkthrough: recordings play the project’s test journeys against it, as the demo user.') : running && !v.journeys.length ? h('p.la-note', {}, 'The running build has no test journeys (tests/e2e/*.journey.json) to record yet.') : null;
    const jobs = v.jobs.map((j) => h('p.wt-job', {}, h('span', { class: `pill wt-pill ${j.status === 'running' ? 'recording' : 'queued'}` }, j.status === 'running' ? 'Recording' : 'Queued'), ` ${j.kind === 'tour' ? 'Guided tour' : (v.journeys.find((x) => x.id === j.journey)?.title ?? j.journey)}${j.trigger === 'auto' ? ' (auto)' : ''}${j.line ? ` · ${j.line}` : ''} `, v.admin ? h('button.btn', { type: 'button', onclick: () => after(act({ action: 'cancel', floor, job: j.id })) }, 'Cancel') : null));
    const groups = new Map<string, WalkCardRecording[]>();
    for (const r of v.recordings) {
      if (r.status === 'recording' && v.jobs.some((j) => j.id === r.id)) continue;
      const k = `${r.kind}|${r.journey.id}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const cards = [...groups.values()].sort((a, b) => (a[0].kind === b[0].kind ? b[0].startedAt - a[0].startedAt : a[0].kind === 'tour' ? -1 : 1)).map(card);
    const disk = v.disk.quota ? h('p.wt-small', {}, `Working copies: ${(v.disk.bytes / 1024 / 1024).toFixed(1)} MB of ${(v.disk.quota / 1024 ** 3).toFixed(0)} GB. Their home is the project’s repo (Save to repo opens a pull request); old auto-recordings are cleaned up.`) : null;
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, 'Walkthroughs'),
      h('p.wt-small', {}, 'Short videos of the app’s workflows, recorded from its test journeys against the live app, with captions and step screenshots. A video is evidence only for the commit it recorded; a failed step stops it and it says so.'),
      ...v.available.notes.map((n) => h('p.la-note', {}, n)),
      ...controls,
      hint,
      ...jobs,
      cards.length ? h('div.wt-cards', {}, ...cards) : h('p.la-empty', {}, 'No walkthroughs yet.'),
      disk,
    ];
    el.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  const section: WalkSection = {
    el,
    update(s, isShown) {
      const f = s?.floor ?? '';
      shown = isShown;
      if (f !== floor) {
        floor = f;
        view = null;
        key = '';
        draw();
      }
      const k = `${f}|${s?.sha ?? ''}|${s?.status ?? ''}|${s?.viewPort ?? ''}`;
      if (shown && (k !== key || !view)) {
        key = k;
        void load();
      } else if (!shown) clearTimeout(timer);
    },
    linkFor(milestone, commit) {
      const r = view?.recordings.find((x) => x.kind === 'workflow' && x.status === 'passed' && x.milestone?.id === milestone && x.app.commit === commit);
      if (!r) return null;
      const b: HTMLButtonElement = h('button.wt-link', { type: 'button', title: `Watch the walkthrough recorded @${r.app.commit.slice(0, 7)}`, onclick: () => openPlayer(floor, r, b) }, '▶ Walkthrough');
      return b;
    },
  };
  draw();
  return section;
}
