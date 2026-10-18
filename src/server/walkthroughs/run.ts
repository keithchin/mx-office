// One workflow recording from start to finish: the narration first (so each step can stay on screen as long
// as its line), the recorder (./recorder.ts), a check that the live app still runs the same commit, the MP4
// with the voice (or the WebM as recorded, without ffmpeg), the captions and chapters, the manifest. A
// recording whose app moved to another commit meanwhile is an error, never evidence for either commit.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WalkManifest, WalkScript } from '../../shared/walkthroughs/types.js';
import { narrationOf } from '../../shared/walkthroughs/script.js';
import { captionsOf, chaptersOf } from '../../shared/walkthroughs/vtt.js';
import { fileBytes, makeMp4, wavMs, type Tool } from './media.js';
import { record, type Browser } from './recorder.js';
import type { Voice } from './tts.js';

export interface RunDeps {
  tool: Tool;
  voice?: Voice;
  /** The commit the live app runs now (undefined: it doesn't run). */
  commitNow(): string | undefined;
  launch?(): Promise<Browser>;
  cardMs?: number;
  stepMs?: number;
}

export interface RunInput {
  m: WalkManifest;
  dir: string;
  url: string;
  script: WalkScript;
  login: { user: string; password: string };
  narrate: boolean;
  signal: AbortSignal;
  progress(line: string): void;
  save(m: WalkManifest): Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, '0');

export async function runRecording(d: RunDeps, i: RunInput): Promise<WalkManifest> {
  const m = i.m;
  const notes = m.outputs.notes;
  const voiceDir = path.join(i.dir, 'voice');
  const lines = new Map<number, { wav: string; ms: number }>();
  if (i.narrate && d.voice) {
    i.progress('Writing the narration (local voice)…');
    await mkdir(voiceDir, { recursive: true });
    const jobs = i.script.steps.map((s) => ({ n: s.n, text: narrationOf(s), out: path.join(voiceDir, `${pad(s.n)}.wav`) }));
    try {
      await d.voice.speak(jobs, i.signal);
      for (const j of jobs) {
        const ms = wavMs(await readFile(j.out).catch(() => Buffer.alloc(0)));
        if (ms) lines.set(j.n, { wav: j.out, ms });
      }
      if (lines.size) m.outputs.narration = d.voice.engine;
    } catch (err) {
      if (i.signal.aborted) throw err;
      notes.push(`No voice: the narration didn't work (${(err as Error).message.slice(0, 160)}); captions only.`);
    }
  } else if (i.narrate) notes.push('No voice: Kokoro (local text-to-speech) isn’t set up on the office’s machine; captions only.');
  const res = await record({
    url: i.url,
    script: i.script,
    outDir: i.dir,
    login: i.login,
    holdMs: (s) => (lines.get(s.n)?.ms ?? 0) + 300,
    signal: i.signal,
    progress: i.progress,
    ...(d.launch ? { launch: d.launch } : {}),
    ...(d.cardMs !== undefined ? { cardMs: d.cardMs } : {}),
    ...(d.stepMs !== undefined ? { stepMs: d.stepMs } : {}),
  });
  m.steps = res.steps;
  m.durationMs = res.durationMs;
  m.status = res.status;
  if (res.failure) m.failure = res.failure;
  if (m.status !== 'cancelled' && d.commitNow() !== m.app.commit) {
    m.status = 'error';
    m.failure = { why: `the live app ${d.commitNow() ? `moved to ${d.commitNow()!.slice(0, 7)}` : 'stopped'} during the recording: it isn't evidence for either build` };
  }
  if (res.video) {
    if (d.tool.ffmpeg) {
      i.progress('Making the MP4…');
      const out = path.join(i.dir, 'walkthrough.mp4');
      const placed = [...lines.entries()].flatMap(([n, l]) => {
        const at = res.steps[n - 1]?.startMs;
        return at !== undefined && res.steps[n - 1].status !== 'not-run' ? [{ wav: l.wav, atMs: at }] : [];
      });
      try {
        await makeMp4(d.tool, res.video, out, placed, res.durationMs, i.signal);
        await rm(res.video, { force: true });
        m.outputs.video = 'walkthrough.mp4';
        m.outputs.format = 'mp4';
        if (!placed.length && m.outputs.narration !== 'none') m.outputs.narration = 'none';
      } catch (err) {
        if (i.signal.aborted) throw err;
        notes.push(`The MP4 failed (${(err as Error).message.slice(0, 160)}): kept the WebM, without voice.`);
      }
    } else notes.push('ffmpeg isn’t installed on the office’s machine: the video is the WebM as recorded, without voice.');
    if (!m.outputs.video) {
      await rename(res.video, path.join(i.dir, 'walkthrough.webm'));
      m.outputs.video = 'walkthrough.webm';
      m.outputs.format = 'webm';
      m.outputs.narration = 'none';
    }
    m.outputs.bytes = await fileBytes(path.join(i.dir, m.outputs.video));
  }
  m.outputs.captions = 'captions.vtt';
  m.outputs.chapters = 'chapters.vtt';
  await writeFile(path.join(i.dir, 'captions.vtt'), captionsOf(m));
  await writeFile(path.join(i.dir, 'chapters.vtt'), chaptersOf(m));
  if (m.durationMs > 60_000 && m.status === 'passed') notes.push(`Longer than a minute (${Math.round(m.durationMs / 1000)} s): a shorter journey makes a better workflow video.`);
  await rm(voiceDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(path.join(i.dir, 'video-tmp'), { recursive: true, force: true }).catch(() => undefined);
  m.finishedAt = Date.now();
  await i.save(m);
  return m;
}
