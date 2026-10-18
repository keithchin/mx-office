// The walkthrough player: the video with its captions track, the steps (or a tour's chapters) as a list
// that seeks the video, the step screenshots, and the evidence line (commit, steps passed, or where it
// failed). A modal with a ✕; ✕ or Esc gives focus back to what opened it.

import type { WalkCardRecording } from '../../../shared/walkthroughs/types';
import { h, openModal } from '../dom';

export const fileUrl = (floor: string, id: string, name: string) => `/api/walkthroughs/file?floor=${encodeURIComponent(floor)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;

const clock = (ms = 0) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** What the recording is evidence of, in one line. */
export function evidenceLine(r: WalkCardRecording): string {
  const sha = r.app.commit.slice(0, 7);
  if (r.kind === 'tour') {
    const n = (r.parts ?? []).filter((p) => p.journey !== 'intro' && p.journey !== 'outro').length;
    return `Guided tour of the build @${sha}: ${n} workflow${n === 1 ? '' : 's'}, each passing against this build.`;
  }
  const passed = r.steps.filter((s) => s.status === 'passed').length;
  switch (r.status) {
    case 'passed':
      return `Evidence for @${sha} only: ${passed} of ${r.steps.length} steps passed, as ${r.app.user ?? 'the demo user'}.`;
    case 'failed':
      return `Failed at step ${r.failure?.step ?? '?'} against @${sha}: ${r.failure?.why ?? ''}. The steps after it didn't run.`;
    case 'cancelled':
      return `Cancelled (${r.failure?.why ?? 'by a person'}): not evidence.`;
    case 'error':
      return `Didn't finish: ${r.failure?.why ?? 'unknown error'}. Not evidence.`;
    default:
      return 'Being recorded…';
  }
}

export function openPlayer(floor: string, r: WalkCardRecording, opener?: HTMLElement | null) {
  const back = opener ?? (document.activeElement as HTMLElement | null);
  const video = r.outputs.video
    ? h(
        'video.wt-video',
        { controls: true, preload: 'metadata', src: fileUrl(floor, r.id, r.outputs.video), ...(r.steps[0]?.screenshot ? { poster: fileUrl(floor, r.id, r.steps[0].screenshot) } : {}) },
        r.outputs.captions ? h('track', { kind: 'captions', label: 'Steps', srclang: 'en', default: true, src: fileUrl(floor, r.id, r.outputs.captions) }) : null,
      )
    : h('p.la-note', {}, 'No video was made.');
  const seek = (ms?: number) => () => {
    if (ms === undefined || !(video instanceof HTMLVideoElement)) return;
    video.currentTime = ms / 1000;
    void video.play().catch(() => undefined);
  };
  const marks = r.kind === 'tour' && r.parts?.length ? r.parts.map((p) => ({ at: p.startMs, text: p.title, cls: '' })) : r.steps.map((s) => ({ at: s.startMs, text: `${s.n}. ${s.caption}${s.status === 'failed' ? ` — failed: ${s.why ?? ''}` : s.status === 'not-run' ? ' (not run)' : ''}`, cls: s.status }));
  const list = h('ol.wt-marks', {}, ...marks.map((m) => h('li', { class: m.cls }, h('button.wt-mark', { type: 'button', disabled: m.at === undefined, onclick: seek(m.at) }, h('span.wt-at', {}, m.at === undefined ? '–' : clock(m.at)), ' ', m.text))));
  const shots = r.steps.filter((s) => s.screenshot);
  const strip = shots.length ? h('div.wt-shots', {}, ...shots.map((s) => h('a', { href: fileUrl(floor, r.id, s.screenshot!), target: '_blank', rel: 'noopener', title: `Step ${s.n}: ${s.caption}` }, h('img', { src: fileUrl(floor, r.id, s.screenshot!), alt: `Step ${s.n}: ${s.caption}`, loading: 'lazy' })))) : null;
  const notes = r.outputs.notes.length ? h('ul.wt-notes', {}, ...r.outputs.notes.map((n) => h('li', {}, n))) : null;
  const box = h(
    'div.modal.wt-player',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Walkthrough: ${r.journey.title}` },
    h('header', {}, h('h2', {}, r.journey.title)),
    h('p', { class: `wt-evidence ${r.status}` }, evidenceLine(r)),
    video,
    h('div.wt-side', {}, h('h3', {}, r.kind === 'tour' ? 'Chapters' : 'Steps'), list),
    strip,
    notes,
    r.journey.requirement.length ? h('p.wt-small', {}, `Shows ${r.journey.requirement.join(', ')}${r.journey.file ? ` · ${r.journey.file}` : ''}`) : null,
  );
  openModal(box, { doing: `watching the walkthrough of ${r.journey.title}`, onClose: () => back?.focus?.() });
  (box.querySelector('video') ?? box.querySelector('.close'))?.focus?.();
}
