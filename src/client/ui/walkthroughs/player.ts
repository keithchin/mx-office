// The walkthrough player: a wide dialog (about 90% of the window, 85% of its height) with the video large on
// the left, keeping its shape, and the steps (or a tour's chapters) in a scrolling column on the right.
// Clicking a step seeks the video there; the step playing is highlighted as it plays; a failed step is red
// with its reason; the step's screenshot shows under the list on hover or when picked. The evidence line
// (the commit, the steps passed, or where it failed) is under the video. On a narrow screen the video is on
// top and the steps under it. A ✕ in the top right; ✕ or Esc gives focus back to what opened it.

import type { WalkCardRecording } from '../../../shared/walkthroughs/types';
import { SOURCE_WORDS } from '../../../shared/walkthroughs/identity';
import { h, openModal } from '../dom';
import { fileUrl } from './api';
import './player.css';

const clock = (ms = 0) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** What the recording is evidence of, in one line. */
export function evidenceLine(r: WalkCardRecording): string {
  const sha = r.app.commit.slice(0, 7);
  if (r.kind === 'tour') {
    const n = (r.parts ?? []).filter((p) => p.journey !== 'intro' && p.journey !== 'outro').length;
    return `Guided tour of the build @${sha}: ${n} workflow${n === 1 ? '' : 's'}, each passing against this build.`;
  }
  const passed = r.steps.filter((s) => s.status === 'passed').length;
  const as = r.app.user ? ` as ${r.app.user}${r.app.userFrom ? ` (${SOURCE_WORDS[r.app.userFrom]})` : ''}` : '';
  switch (r.status) {
    case 'passed':
      return `Evidence for @${sha} only: ${passed} of ${r.steps.length} steps passed${as}.`;
    case 'failed':
      return `Failed at step ${r.failure?.step ?? '?'} against @${sha}${as}: ${r.failure?.why ?? ''}. The steps after it didn't run.`;
    case 'cancelled':
      return `Cancelled (${r.failure?.why ?? 'by a person'}): not evidence.`;
    case 'error':
      return `Didn't finish: ${r.failure?.why ?? 'unknown error'}. Not evidence.`;
    default:
      return 'Being recorded…';
  }
}

interface Mark {
  at?: number;
  end?: number;
  text: string;
  why?: string;
  cls: string;
  shot?: string;
}

export function openPlayer(floor: string, r: WalkCardRecording, opener?: HTMLElement | null) {
  const back = opener ?? (document.activeElement as HTMLElement | null);
  const video = r.outputs.video
    ? h(
        'video.wt-video',
        { controls: true, preload: 'metadata', src: fileUrl(floor, r.id, r.outputs.video), ...(r.steps[0]?.screenshot ? { poster: fileUrl(floor, r.id, r.steps[0].screenshot) } : {}) },
        r.outputs.captions ? h('track', { kind: 'captions', label: 'Steps', srclang: 'en', default: true, src: fileUrl(floor, r.id, r.outputs.captions) }) : null,
      )
    : h('p.wt-novideo', {}, 'No video was made.');
  const marks: Mark[] =
    r.kind === 'tour' && r.parts?.length
      ? r.parts.map((p) => ({ at: p.startMs, end: p.endMs, text: p.title, cls: '' }))
      : r.steps.map((s) => ({ at: s.startMs, end: s.endMs, text: `${s.n}. ${s.caption}`, ...(s.status === 'failed' ? { why: `Failed: ${s.why ?? 'no reason given'}` } : s.status === 'not-run' ? { why: 'Not run' } : {}), cls: s.status, ...(s.screenshot ? { shot: s.screenshot } : {}) }));
  const preview = h('figure.wt-preview', { hidden: true }, h('img', { alt: '' }), h('figcaption', {}));
  const showShot = (m: Mark | undefined) => {
    if (!m?.shot) return void (preview.hidden = true);
    preview.hidden = false;
    const img = preview.querySelector('img')!;
    const src = fileUrl(floor, r.id, m.shot);
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    img.alt = m.text;
    preview.querySelector('figcaption')!.textContent = m.text;
  };
  let picked: Mark | undefined;
  const items = marks.map((m) => {
    const b = h(
      'button.wt-mark',
      {
        type: 'button',
        disabled: m.at === undefined && !m.shot,
        onclick: () => {
          picked = m;
          showShot(m);
          if (m.at !== undefined && video instanceof HTMLVideoElement) {
            video.currentTime = m.at / 1000;
            void video.play().catch(() => undefined);
          }
        },
        onmouseenter: () => showShot(m),
        onmouseleave: () => showShot(picked),
        onfocus: () => showShot(m),
      },
      h('span.wt-at', {}, m.at === undefined ? '–' : clock(m.at)),
      h('span.wt-mtext', {}, m.text, m.why ? h('span.wt-why', {}, m.why) : null),
    );
    return h('li', { class: m.cls }, b);
  });
  const list = h('ol.wt-marks', {}, ...items);
  // The step playing now, highlighted (and kept in view) as the video plays.
  if (video instanceof HTMLVideoElement) {
    let on = -1;
    video.addEventListener('timeupdate', () => {
      const t = video.currentTime * 1000;
      let k = -1;
      marks.forEach((m, i) => {
        if (m.at !== undefined && m.at <= t + 50) k = i;
      });
      if (k === on) return;
      items[on]?.classList.remove('now');
      on = k;
      if (k >= 0) {
        items[k].classList.add('now');
        items[k].scrollIntoView({ block: 'nearest' });
      }
    });
  }
  const failed = r.steps.find((s) => s.status === 'failed');
  const notes = [...(r.status !== 'passed' && r.journey.notes?.length ? r.journey.notes : []), ...r.outputs.notes];
  const box = h(
    'div.modal.wt-player',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Walkthrough: ${r.journey.title}` },
    h('header', {}, h('h2', {}, r.journey.title)),
    h(
      'div.wt-pbody',
      {},
      h(
        'div.wt-main',
        {},
        h('div.wt-stage', {}, video),
        h('p', { class: `wt-evidence ${r.status}` }, evidenceLine(r)),
        notes.length ? h('ul.wt-notes', {}, ...notes.map((n) => h('li', {}, n))) : null,
        r.journey.requirement.length || r.journey.file ? h('p.wt-small', {}, [r.journey.requirement.length ? `Shows ${r.journey.requirement.join(', ')}` : '', r.journey.file].filter(Boolean).join(' · ')) : null,
      ),
      h('aside.wt-side', { 'aria-label': r.kind === 'tour' ? 'Chapters' : 'Steps' }, h('h3', {}, r.kind === 'tour' ? 'Chapters' : `Steps (${r.steps.filter((s) => s.status === 'passed').length} of ${r.steps.length} passed)`), list, preview),
    ),
  );
  openModal(box, { doing: `watching the walkthrough of ${r.journey.title}`, onClose: () => back?.focus?.() });
  if (failed) showShot(marks[failed.n - 1]);
  (box.querySelector('video') ?? box.querySelector('.close'))?.focus?.();
}
