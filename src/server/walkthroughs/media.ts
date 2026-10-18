// Turning what the recorder filmed into the files people watch: ffmpeg (a child process, started off the
// event loop) makes an MP4 of the WebM, with the narration's lines placed at each step's start when there
// are any; without ffmpeg the WebM stays as it is, without voice, and the manifest says so. A guided tour is
// made here too: an intro card, a title card before each workflow, the workflows' videos, an outro card,
// each made into the same shape (1280×720, 25 fps, H.264, AAC) and joined. Compressed for screen content:
// about 1–3 MB a minute.

import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnOff } from '../offloop/exec.js';
import { resolveCommand } from '../workers/process.js';

export interface Tool {
  ffmpeg?: string;
  ffprobe?: string;
}

/** ffmpeg from AGENT_OFFICE_FFMPEG, else on PATH; ffprobe beside it. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): Tool {
  const set = env.AGENT_OFFICE_FFMPEG?.trim();
  if (set === 'off') return {};
  const ffmpeg = set && existsSync(set) ? set : (resolveCommand('ffmpeg') ?? undefined);
  if (!ffmpeg) return {};
  const probe = path.join(path.dirname(ffmpeg), `ffprobe${path.extname(ffmpeg)}`);
  return { ffmpeg, ...(existsSync(probe) ? { ffprobe: probe } : {}) };
}

/** Runs a program off the event loop; rejects with its last stderr lines. Killed on `signal` or after `timeout`. */
export function runTool(file: string, args: string[], o: { signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnOff(file, args, { windowsHide: true, ...(o.env ? { env: o.env } : {}), ...(o.cwd ? { cwd: o.cwd } : {}) });
    let out = '';
    let err = '';
    const kill = () => child.kill();
    const timer = setTimeout(kill, o.timeout ?? 5 * 60_000);
    o.signal?.addEventListener('abort', kill, { once: true });
    child.on('stdout', (d: string) => (out = (out + d).slice(-200_000)));
    child.on('stderr', (d: string) => (err = (err + d).slice(-8000)));
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', kill);
      if (code === 0) resolve(out);
      else reject(new Error(o.signal?.aborted ? 'cancelled' : `${path.basename(file)} exited ${code}: ${err.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
    });
  });
}

/** A WAV file's length in milliseconds, from its header (PCM). */
export function wavMs(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let at = 12;
  let rate = 0;
  let block = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      rate = buf.readUInt32LE(at + 12);
      block = buf.readUInt16LE(at + 20);
    } else if (id === 'data') return rate && block ? Math.round((Math.min(size, buf.length - at - 8) / block / rate) * 1000) : 0;
    at += 8 + size + (size % 2);
  }
  return 0;
}

/** A mono 16-bit PCM WAV (the fake voice of the tests: a soft tone, `ms` long). */
export function toneWav(ms: number, rate = 24000): Buffer {
  const n = Math.round((ms / 1000) * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 2000), 44 + i * 2);
  return b;
}

const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-r', '25'];
const AENC = ['-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2'];

/** The recorded WebM as an MP4, with each narration line at its moment (ms from the start). */
export async function makeMp4(t: Tool, raw: string, out: string, lines: readonly { wav: string; atMs: number }[], durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!t.ffmpeg) throw new Error('no ffmpeg');
  const args = ['-y', '-v', 'error', '-i', raw];
  for (const l of lines) args.push('-i', l.wav);
  if (lines.length) {
    const f: string[] = [];
    lines.forEach((l, k) => {
      const ms = Math.max(0, Math.round(l.atMs));
      f.push(`[${k + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${k}]`);
    });
    f.push(`${lines.map((_, k) => `[a${k}]`).join('')}amix=inputs=${lines.length}:normalize=0:duration=longest,apad,atrim=duration=${(durationMs / 1000).toFixed(3)}[a]`);
    args.push('-filter_complex', f.join(';'), '-map', '0:v', '-map', '[a]', ...ENC, ...AENC);
  } else args.push('-map', '0:v', ...ENC, '-an');
  args.push('-movflags', '+faststart', out);
  await runTool(t.ffmpeg, args, { signal, timeout: 10 * 60_000 });
}

/** A video file's length in ms (ffprobe), or undefined. */
export async function videoMs(t: Tool, file: string): Promise<number | undefined> {
  if (!t.ffprobe) return undefined;
  const out = await runTool(t.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 30_000 }).catch(() => '');
  const s = Number(out.trim());
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : undefined;
}

/** One segment of a tour: a still card (PNG) for `ms`, or a video. */
export type TourPiece = { png: string; ms: number } | { video: string };

/** Joins the pieces into one MP4 (each made the same shape first, silent audio where there's none). Returns each piece's length. */
export async function makeTour(t: Tool, pieces: readonly TourPiece[], dir: string, out: string, signal?: AbortSignal): Promise<number[]> {
  if (!t.ffmpeg) throw new Error('no ffmpeg');
  const norm: string[] = [];
  const lens: number[] = [];
  const VF = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,fps=25,format=yuv420p';
  for (const [k, p] of pieces.entries()) {
    const seg = path.join(dir, `seg-${String(k).padStart(2, '0')}.mp4`);
    if ('png' in p) {
      const s = (p.ms / 1000).toFixed(3);
      await runTool(t.ffmpeg, ['-y', '-v', 'error', '-loop', '1', '-t', s, '-i', p.png, '-f', 'lavfi', '-t', s, '-i', 'anullsrc=r=48000:cl=stereo', '-vf', VF, ...ENC, ...AENC, '-shortest', seg], { signal });
    } else {
      const hasAudio = t.ffprobe ? (await runTool(t.ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', p.video], { timeout: 30_000 }).catch(() => '')).trim().length > 0 : false;
      const inputs = ['-i', p.video, ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'])];
      const maps = hasAudio ? ['-map', '0:v', '-map', '0:a'] : ['-map', '0:v', '-map', '1:a', '-shortest'];
      await runTool(t.ffmpeg, ['-y', '-v', 'error', ...inputs, ...maps, '-vf', VF, ...ENC, ...AENC, seg], { signal });
    }
    norm.push(seg);
    lens.push((await videoMs(t, seg)) ?? ('ms' in p ? p.ms : 0));
  }
  const list = path.join(dir, 'tour-list.txt');
  await writeFile(list, norm.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  await runTool(t.ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal });
  return lens;
}

export const fileBytes = async (f: string) => (await stat(f).catch(() => undefined))?.size ?? 0;
