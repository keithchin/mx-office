// The guided tour: one longer overview video of a build, made from the newest passing workflow video of
// each journey at that commit (never a failed one, never one of another commit): an intro card, a title
// card before each workflow, the workflows, an outro card, with a chapter per workflow and the workflows'
// captions moved to where they play. The cards are drawn by the office's headless Chromium (a page of
// plain HTML, screenshotted) and joined with ffmpeg (./media.ts). Without ffmpeg there's no tour.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManifestStep, WalkManifest } from '../../shared/walkthroughs/types.js';
import { chaptersOf, vtt } from '../../shared/walkthroughs/vtt.js';
import { fileBytes, makeTour, type Tool, type TourPiece } from './media.js';
import { launchChromium, VIEWPORT, type Browser } from './recorder.js';

export const INTRO_MS = 4000;
export const CHAPTER_MS = 2500;
export const OUTRO_MS = 3000;

/** The workflow videos a tour of `commit` is made of: the newest passing one of each journey, in journey order. */
export function tourParts(all: readonly WalkManifest[], commit: string, order: readonly string[]): WalkManifest[] {
  const pick = new Map<string, WalkManifest>();
  for (const m of all) if (m.kind === 'workflow' && m.status === 'passed' && m.app.commit === commit && m.outputs.video && !pick.has(m.journey.id)) pick.set(m.journey.id, m);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...pick.values()].sort((a, b) => rank(a.journey.id) - rank(b.journey.id) || a.journey.title.localeCompare(b.journey.title));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function cardHtml(title: string, sub: string, lines: readonly string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:#0f172a;color:#f8fafc;font-family:"Segoe UI",system-ui,sans-serif}
  .c{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0 120px;box-sizing:border-box}
  h1{font-size:52px;margin:0 0 16px} p{font-size:24px;margin:0 0 28px;color:#cbd5e1} li{font-size:22px;margin:6px 0;color:#e2e8f0}
  .f{position:absolute;bottom:28px;left:120px;font-size:16px;color:#94a3b8}
  </style></head><body><div class="c"><h1>${esc(title)}</h1><p>${esc(sub)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div><div class="f">Recorded by Mx Office · demo user and demo data</div></body></html>`;
}

export interface TourInput {
  floor: string;
  id: string;
  dir: string;
  title: string;
  commit: string;
  parts: WalkManifest[];
  /** Where each part's files are. */
  partDir(m: WalkManifest): string;
  by: string;
  tool: Tool;
  signal: AbortSignal;
  progress(line: string): void;
  launch?(): Promise<Browser>;
}

/** Draws the cards (name → PNG path). */
async function drawCards(launch: () => Promise<Browser>, dir: string, cards: { name: string; html: string }[]): Promise<Map<string, string>> {
  await mkdir(path.join(dir, 'cards'), { recursive: true });
  const out = new Map<string, string>();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = (await ctx.newPage()) as unknown as { setContent(h: string): Promise<void>; screenshot(o: { path: string; type: 'png' }): Promise<unknown> };
    for (const c of cards) {
      const file = path.join(dir, 'cards', `${c.name}.png`);
      await page.setContent(c.html);
      await page.screenshot({ path: file, type: 'png' });
      out.set(c.name, file);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return out;
}

export async function makeGuidedTour(i: TourInput): Promise<WalkManifest> {
  if (!i.tool.ffmpeg) throw new Error('a guided tour needs ffmpeg on the office’s machine');
  if (!i.parts.length) throw new Error('no passing workflow video of this build yet: record one first');
  const sha7 = i.commit.slice(0, 7);
  const uses = [...new Set(i.parts.flatMap((p) => p.journey.requirement))];
  const cards = [
    { name: 'intro', html: cardHtml(i.title, `Guided tour of the build @${sha7}`, i.parts.map((p, k) => `${k + 1}. ${p.journey.title}`)) },
    ...i.parts.map((p, k) => ({ name: `chapter-${String(k + 1).padStart(2, '0')}`, html: cardHtml(`${k + 1}. ${p.journey.title}`, p.journey.requirement.length ? `Shows ${p.journey.requirement.slice(0, 4).join(', ')}` : `${p.steps.length} steps`, []) })),
    { name: 'outro', html: cardHtml('End of the tour', `Evidence only for commit ${i.commit.slice(0, 12)}`, ['Each workflow’s own video, captions and steps are beside this one']) },
  ];
  i.progress('Drawing the tour’s cards…');
  const png = await drawCards(i.launch ?? launchChromium, i.dir, cards);
  const pieces: TourPiece[] = [{ png: png.get('intro')!, ms: INTRO_MS }];
  i.parts.forEach((p, k) => pieces.push({ png: png.get(`chapter-${String(k + 1).padStart(2, '0')}`)!, ms: CHAPTER_MS }, { video: path.join(i.partDir(p), p.outputs.video!) }));
  pieces.push({ png: png.get('outro')!, ms: OUTRO_MS });
  i.progress(`Joining ${i.parts.length} workflow${i.parts.length === 1 ? '' : 's'} into the tour…`);
  const work = path.join(i.dir, 'work');
  await mkdir(work, { recursive: true });
  const lens = await makeTour(i.tool, pieces, work, path.join(i.dir, 'tour.mp4'), i.signal);
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
  let t = lens[0];
  const parts: NonNullable<WalkManifest['parts']> = [];
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  const steps: ManifestStep[] = [];
  i.parts.forEach((p, k) => {
    const start = t;
    const body = start + lens[1 + 2 * k];
    t = body + lens[2 + 2 * k];
    parts.push({ id: p.id, journey: p.journey.id, title: p.journey.title, startMs: start, endMs: t });
    for (const s of p.steps) if (s.startMs !== undefined && s.endMs !== undefined) cues.push({ startMs: body + s.startMs, endMs: body + s.endMs, text: `${p.journey.title} · Step ${s.n} of ${p.steps.length} · ${s.caption}` });
    steps.push(...p.steps.map((s) => ({ ...s, n: steps.length + 1, caption: `${p.journey.title}: ${s.caption}`, ...(s.startMs !== undefined ? { startMs: body + s.startMs } : {}), ...(s.endMs !== undefined ? { endMs: body + s.endMs } : {}), screenshot: undefined })));
  });
  const durationMs = t + lens[lens.length - 1];
  const now = Date.now();
  const m: WalkManifest = {
    schema: 1,
    id: i.id,
    floor: i.floor,
    kind: 'tour',
    journey: { id: 'guided-tour', title: `Guided tour: ${i.title}`, file: '', requirement: uses },
    trigger: 'manual',
    by: i.by,
    app: { commit: i.commit, origin: i.parts[0].app.origin, ...(i.parts[0].app.user ? { user: i.parts[0].app.user } : {}) },
    startedAt: now,
    finishedAt: now,
    durationMs,
    status: 'passed',
    steps: steps.map((s) => {
      const { screenshot: _s, ...rest } = s;
      void _s;
      return rest;
    }),
    outputs: { video: 'tour.mp4', format: 'mp4', captions: 'captions.vtt', chapters: 'chapters.vtt', narration: i.parts.some((p) => p.outputs.narration !== 'none') ? i.parts.find((p) => p.outputs.narration !== 'none')!.outputs.narration : 'none', notes: [], bytes: await fileBytes(path.join(i.dir, 'tour.mp4')) },
    parts: [{ id: 'intro', journey: 'intro', title: 'Introduction', startMs: 0, endMs: lens[0] }, ...parts, { id: 'outro', journey: 'outro', title: 'End of the tour', startMs: t, endMs: durationMs }],
  };
  await writeFile(path.join(i.dir, 'captions.vtt'), vtt(cues));
  await writeFile(path.join(i.dir, 'chapters.vtt'), chaptersOf(m));
  return m;
}
