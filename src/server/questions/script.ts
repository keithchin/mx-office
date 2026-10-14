// The toolkit's bin/open-questions.sh <dir> --json, run as the office runs the toolkit's other scripts
// (Git Bash on Windows, the floor's toolkit.env laid over the office's toolkit environment, the pinned
// toolkit's own copy), started off the event loop (offloop/exec.ts) with a time limit. Exit 1 (questions
// block a gate) and 3 (nothing examined) are answers, not failures; anything else, or output that isn't
// the JSON it promises, is a failure the caller says out loud (it never reads as "no questions").

import { execFileOff } from '../offloop/exec.js';
import { isQState, type QState } from '../../shared/questions.js';

/** One question as the script prints it. */
export interface ScriptQuestion {
  state: QState;
  id: string;
  /** The file it came from; "sme-questions.md + F003-x.brd.json" when the script collapsed a pair. */
  origin: string;
  stage?: number;
  question: string;
  assumption?: string;
  reason?: string;
  rawStatus?: string;
}

export interface ScriptJson {
  examined: { brdFiles: number; smeQuestionFiles: number; nothingExamined: boolean };
  counts?: Record<string, number>;
  blocking?: number;
  questions: ScriptQuestion[];
}

export type ScriptOutcome = { ok: true; json: ScriptJson } | { ok: false; why: string };

/** Runs the script at `script` over `dir` (a folder of the floor at `floorDir`). */
export type ScriptRunner = (script: string, dir: string, floorDir: string) => Promise<ScriptOutcome>;

/** The script's output, checked: undefined when it isn't the --json shape. */
export function parseScriptJson(out: string): ScriptJson | undefined {
  try {
    const v = JSON.parse(out) as ScriptJson;
    if (!v || typeof v !== 'object' || !Array.isArray(v.questions) || !v.examined) return undefined;
    const questions = v.questions.filter((q) => q && typeof q.id === 'string' && isQState(q.state)).map((q) => ({ ...q, origin: String(q.origin ?? ''), question: String(q.question ?? '') }));
    return { ...v, questions };
  } catch {
    return undefined;
  }
}

/** The BRD file a script row is from (the .brd.json part of its origin), else its first file. */
export function originFile(origin: string): string {
  const parts = origin.split('+').map((s) => s.trim()).filter(Boolean);
  return parts.find((p) => p.endsWith('.brd.json')) ?? parts[0] ?? '';
}

export interface BashRunnerOptions {
  /** Git Bash (or bash). */
  bash: string;
  /** The environment for a floor: the office's toolkit env with the floor's toolkit.env over it. */
  env(floorDir: string): Promise<Record<string, string>>;
  timeoutMs?: number;
}

/** A Windows path as Git Bash spells it (C:\a\b → /c/a/b). */
const bashPath = (p: string) => {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
};

/** The real runner: bash <script> <dir> --json, off the event loop. */
export function bashRunner(o: BashRunnerOptions): ScriptRunner {
  return async (script, dir, floorDir) => {
    const env = await o.env(floorDir);
    return new Promise<ScriptOutcome>((resolve) => {
      execFileOff(o.bash, [bashPath(script), bashPath(dir), '--json'], { cwd: dir, env, timeout: o.timeoutMs ?? 90_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        const code = err ? err.code : 0;
        if (err && err.killed) return resolve({ ok: false, why: `open-questions.sh took longer than ${Math.round((o.timeoutMs ?? 90_000) / 1000)}s and was stopped` });
        if (err && code !== 1 && code !== 3) return resolve({ ok: false, why: `open-questions.sh failed (exit ${code ?? '?'}): ${(stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}` });
        const json = parseScriptJson(stdout);
        resolve(json ? { ok: true, json } : { ok: false, why: `open-questions.sh printed no JSON${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}` });
      });
    });
  };
}
