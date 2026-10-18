// Narration: local text-to-speech only. Kokoro (hexgrad/Kokoro-82M), the way the office's demo-video
// pipeline does it: KPipeline, the am_echo voice, 24 kHz 16-bit WAV, one Python process per recording for
// all its lines (the model loads once). HF_HUB_OFFLINE keeps it to the model already on the machine:
// nothing is fetched and nothing leaves it. Python is AGENT_OFFICE_KOKORO_PYTHON (a venv's python with
// kokoro installed), else py / python / python3 when one of them can import kokoro. No Kokoro: no voice,
// captions only, and the page says so. There is no cloud voice.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTool, toneWav } from './media.js';

export interface Voice {
  engine: 'kokoro' | 'fake';
  /** Writes each line's WAV to its `out`. */
  speak(lines: readonly { text: string; out: string }[], signal?: AbortSignal): Promise<void>;
}

const PY = String.raw`import json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np, soundfile as sf
from kokoro import KPipeline
voice = os.environ.get("WT_VOICE") or "am_echo"
p = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for job in json.load(open(sys.argv[1], encoding="utf-8")):
    text = job["text"].replace("mxcli", "M X C L I")
    chunks = [np.asarray(a, dtype="float32") for _, _, a in p(text, voice=voice, speed=1.0)]
    audio = np.concatenate(chunks) if chunks else np.zeros(2400, dtype="float32")
    sf.write(job["out"], audio, 24000, subtype="PCM_16")
    print("ok", job["out"], flush=True)
`;

const offline = (env: NodeJS.ProcessEnv) => ({ ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONIOENCODING: 'utf-8' });

let found: Promise<{ python: string; args: string[] } | undefined> | undefined;

/** The Python that can import kokoro, looked for once per office (importing torch takes a few seconds). */
export function findKokoro(env: NodeJS.ProcessEnv = process.env): Promise<{ python: string; args: string[] } | undefined> {
  if (env.AGENT_OFFICE_KOKORO === 'off') return Promise.resolve(undefined);
  found ??= (async () => {
    const set = env.AGENT_OFFICE_KOKORO_PYTHON?.trim();
    const tries: { python: string; args: string[] }[] = set ? [{ python: set, args: [] }] : [{ python: 'py', args: ['-3'] }, { python: 'python', args: [] }, { python: 'python3', args: [] }];
    for (const t of tries) {
      const ok = await runTool(t.python, [...t.args, '-I', '-c', 'import kokoro, soundfile, numpy; print("kokoro")'], { env: offline(env), timeout: 180_000 }).then(
        (out) => out.includes('kokoro'),
        () => false,
      );
      if (ok) return t;
    }
    return undefined;
  })();
  return found;
}

/** Kokoro through `py`, all of a recording's lines in one run. */
export function kokoroVoice(py: { python: string; args: string[] }, env: NodeJS.ProcessEnv = process.env): Voice {
  return {
    engine: 'kokoro',
    async speak(lines, signal) {
      if (!lines.length) return;
      const dir = await mkdtemp(path.join(os.tmpdir(), 'ao-tts-'));
      try {
        const script = path.join(dir, 'speak.py');
        const jobs = path.join(dir, 'lines.json');
        await writeFile(script, PY);
        await writeFile(jobs, JSON.stringify(lines));
        await runTool(py.python, [...py.args, '-I', script, jobs], { env: { ...offline(env), ...(env.AGENT_OFFICE_KOKORO_VOICE ? { WT_VOICE: env.AGENT_OFFICE_KOKORO_VOICE } : {}) }, signal, timeout: 10 * 60_000 });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/** The tests' voice: a tone as long as the line would take to say (about 15 characters a second). */
export const fakeVoice: Voice = {
  engine: 'fake',
  async speak(lines) {
    for (const l of lines) await writeFile(l.out, toneWav(Math.min(6000, 400 + l.text.length * 60)));
  },
};
