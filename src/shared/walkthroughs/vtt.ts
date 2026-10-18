// The text files beside a walkthrough video: WebVTT captions (one cue per step), WebVTT chapters (one cue
// per chapter: the workflow, or each workflow of a guided tour), and the repo's docs/walkthroughs/index.md
// listing every walkthrough with the commit it is evidence for. Pure.

import type { WalkManifest } from './types.js';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 00:01:02.345 */
export function vttTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}

const clean = (s: string) => s.replace(/-->/g, '→').replace(/\s+/g, ' ').trim();

/** Cues as a WebVTT file. */
export function vtt(cues: readonly { startMs: number; endMs: number; text: string }[]): string {
  const out = ['WEBVTT', ''];
  cues.forEach((c, i) => {
    if (c.endMs <= c.startMs) return;
    out.push(String(i + 1), `${vttTime(c.startMs)} --> ${vttTime(c.endMs)}`, clean(c.text), '');
  });
  return out.join('\n');
}

/** One caption per step that ran ("Step 2 of 5 · Click New request"; a failed one says so). */
export function captionsOf(m: Pick<WalkManifest, 'steps'>): string {
  const total = m.steps.length;
  return vtt(m.steps.filter((s) => s.startMs !== undefined && s.endMs !== undefined).map((s) => ({ startMs: s.startMs!, endMs: s.endMs!, text: `Step ${s.n} of ${total} · ${s.caption}${s.status === 'failed' ? ` — failed: ${s.why ?? 'see the manifest'}` : ''}` })));
}

/** The chapters: each part of a tour, or the workflow as one chapter. */
export function chaptersOf(m: Pick<WalkManifest, 'journey' | 'parts' | 'durationMs' | 'steps'>): string {
  if (m.parts?.length) return vtt(m.parts.map((p) => ({ startMs: p.startMs, endMs: p.endMs, text: p.title })));
  const end = m.durationMs ?? Math.max(0, ...m.steps.map((s) => s.endMs ?? 0));
  return vtt([{ startMs: 0, endMs: end, text: m.journey.title }]);
}

const dur = (ms?: number) => (ms === undefined ? '' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** docs/walkthroughs/index.md from the manifests in the repo's walkthrough folders (`dir` is each one's folder name). */
export function indexMd(items: readonly { dir: string; m: WalkManifest }[]): string {
  const sorted = [...items].sort((a, b) => (a.m.kind === b.m.kind ? a.m.journey.title.localeCompare(b.m.journey.title) : a.m.kind === 'tour' ? -1 : 1));
  const rows = sorted.map(({ dir, m }) => {
    const video = m.outputs.video ? `[${m.kind === 'tour' ? 'Guided tour' : cell(m.journey.title)}](${dir}/${m.outputs.video})` : cell(m.journey.title);
    const uses = m.journey.requirement.length ? cell(m.journey.requirement.join(', ')) : '';
    const steps = m.kind === 'tour' ? `${m.parts?.length ?? 0} workflows` : `${m.steps.filter((s) => s.status === 'passed').length}/${m.steps.length} passed`;
    return `| ${video} | ${uses} | \`${m.app.commit.slice(0, 7)}\` | ${steps} | ${dur(m.durationMs)} | ${m.milestone ? cell(m.milestone.title) : ''} | [captions](${dir}/${m.outputs.captions ?? 'captions.vtt'}) · [steps](${dir}/steps/) · [manifest](${dir}/manifest.json) |`;
  });
  return [
    '# Walkthroughs',
    '',
    "Short videos of the app's workflows, recorded by Mx Office from the project's test journeys against the live app, with captions and step screenshots. Each video is evidence only for the commit it recorded (its `manifest.json` says which, and which steps passed). Demo users and demo data only.",
    '',
    '| Walkthrough | Use cases | Commit | Steps | Length | Milestone | Files |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
