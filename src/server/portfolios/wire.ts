// Wiring a project to a company brain with the toolkit's own script, then checking the result ourselves.
//
// - `wire-company-brain.sh <project> <brain>` writes a short pointer block (between COMPANY-BRAIN markers)
//   into every instruction surface the project has. It is run AFTER init-project.sh and the pin
//   instructions, never through `init-project.sh --company` (which wires before CLAUDE.md and AGENTS.md
//   exist: phase-0 findings §1, conflict 1).
// - The script exits 0 on a missing brain and on a skipped surface, so its exit code proves nothing: the
//   office's completion check (checkWiring) wants exactly one marked block per surface that exists, naming
//   a ROUTING.md that resolves.
// - The script writes Git Bash paths (/c/…); the office rewrites them, inside the markers only, to the
//   Windows form (C:/…) the agents' tools resolve best (§7.2).
// - Always with MXTK_LEAKGUARD_DENYFILE set to the contributing clone's deny list (as the wizard's init
//   does), so nothing is ever written into a shared toolkit pin. The office runs no harvest; if it ever
//   does, it passes `--to <brain>/inbox` for the same reason.
// - Disconnecting uses the toolkit's `--unwire` when its script has one, else deletes each marked block.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bashPath, runCommand } from '../wizard/run.js';
import { windowsForm } from '../../shared/portfolios.js';
import { quietGitEnv } from './brain.js';

export const BRAIN_BEGIN = '<!-- COMPANY-BRAIN:BEGIN -->';
export const BRAIN_END = '<!-- COMPANY-BRAIN:END -->';
/** Every instruction surface the toolkit's script writes to, when the project has it. */
export const SURFACES = ['CLAUDE.local.md', 'CLAUDE.md', 'AGENTS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'] as const;

export interface WireEnv {
  /** Git Bash. */
  bash: string;
  /** The project's toolkit (its pin, or the shared clone): only its script is run, it writes nothing there. */
  toolkitDir: string;
  /** The contributing clone's .leakguard-deny (never a pin's). */
  denyFile: string;
  /** The office's environment (tests pass a fake HOME and no tokens). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface WiringCheck {
  ok: boolean;
  problems: string[];
  /** Surfaces the project has. */
  surfaces: string[];
}

const count = (s: string, sub: string) => s.split(sub).length - 1;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The surfaces a project has (CLAUDE.local.md first). */
export const surfacesOf = (dir: string): string[] => SURFACES.filter((f) => existsSync(path.join(dir, f)));

/** The brain path a block names (`… wired at \`<path>\` …`), in Windows form. */
export function blockBrain(text: string): string | undefined {
  const i = text.indexOf(BRAIN_BEGIN);
  const j = text.indexOf(BRAIN_END, i);
  if (i < 0 || j < 0) return undefined;
  const m = /wired at `([^`]+)`/.exec(text.slice(i, j));
  return m ? windowsForm(m[1]) : undefined;
}

/** Rewrites Git Bash spellings of `brain` to its Windows form, inside the marked block only. */
export function windowsFormBlock(text: string, brain: string): string {
  const i = text.indexOf(BRAIN_BEGIN);
  const j = text.indexOf(BRAIN_END, i);
  if (i < 0 || j < 0) return text;
  const win = windowsForm(brain).replace(/\/+$/, '');
  const msys = bashPath(win);
  const block = text.slice(i, j).replace(new RegExp(esc(msys), 'gi'), win);
  return text.slice(0, i) + block + text.slice(j);
}

/** Takes the marked block out (and the blank line the script put before it). */
export function removeBlock(text: string): string {
  // The script appends "\n<block>\n" to the file: taking exactly that out gives the file back as it was.
  return text.replace(new RegExp(`\\r?\\n?${esc(BRAIN_BEGIN)}[\\s\\S]*?${esc(BRAIN_END)}[ \\t]*(\\r?\\n)?`, 'g'), '');
}

/** The office's own completion check: exactly one marked block per surface that exists, naming a ROUTING.md that resolves. */
export async function checkWiring(dir: string, brain: string): Promise<WiringCheck> {
  const surfaces = surfacesOf(dir);
  const problems: string[] = [];
  if (!surfaces.includes('CLAUDE.local.md')) problems.push('CLAUDE.local.md is missing: the project was not scaffolded by the toolkit');
  const want = windowsForm(brain).replace(/\/+$/, '');
  const routing = `${want}/ROUTING.md`;
  if (!existsSync(routing)) problems.push(`${routing} does not resolve`);
  for (const f of surfaces) {
    const text = await readFile(path.join(dir, f), 'utf8').catch(() => undefined);
    if (text === undefined) {
      problems.push(`${f} can't be read`);
      continue;
    }
    const b = count(text, BRAIN_BEGIN);
    const e = count(text, BRAIN_END);
    if (b === 0) problems.push(`${f} has no company brain block`);
    else if (b > 1 || e > 1) problems.push(`${f} has ${b} company brain blocks`);
    else if (e === 0) problems.push(`${f} has a BEGIN marker but no END`);
    else if ((blockBrain(text) ?? '').toLowerCase() !== want.toLowerCase()) problems.push(`${f} points at ${blockBrain(text) ?? 'no path'}, not ${want}`);
  }
  return { ok: !problems.length, problems, surfaces };
}

function scriptEnv(w: WireEnv): Record<string, string | undefined> {
  return { ...quietGitEnv(w.env ?? process.env), MXTK_LEAKGUARD_DENYFILE: bashPath(w.denyFile), MXTK_NO_FETCH: '1', MXTK_NO_GUIDE: '1' };
}

/** Runs the toolkit's wiring, rewrites its paths to Windows form, and checks the result. Throws when the script can't run or the check fails. */
export async function wireProject(dir: string, brain: string, w: WireEnv): Promise<WiringCheck> {
  const script = path.join(w.toolkitDir, 'bin', 'wire-company-brain.sh');
  if (!existsSync(script)) throw new Error(`The toolkit at ${windowsForm(w.toolkitDir)} has no bin/wire-company-brain.sh`);
  const r = await runCommand(w.bash, [bashPath(script), bashPath(dir), bashPath(brain)], { cwd: dir, env: scriptEnv(w), timeoutMs: w.timeoutMs ?? 120_000, allowFail: true });
  for (const f of surfacesOf(dir)) {
    const p = path.join(dir, f);
    const text = await readFile(p, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const next = windowsFormBlock(text, brain);
    if (next !== text) await writeFile(p, next);
  }
  const check = await checkWiring(dir, brain);
  if (r.code !== 0) {
    check.ok = false;
    check.problems.push(`wire-company-brain.sh exited ${r.code}${r.tail.length ? `: ${r.tail.slice(-2).join(' ')}` : ''}`);
  }
  return check;
}

/** Whether the toolkit's script knows `--unwire` (none did at release 49). */
export async function toolkitUnwires(toolkitDir: string): Promise<boolean> {
  const text = await readFile(path.join(toolkitDir, 'bin', 'wire-company-brain.sh'), 'utf8').catch(() => '');
  return /--unwire\b/.test(text);
}

/** Removes the pointer blocks: the toolkit's `--unwire` when it has one, else the office deletes each marked block. The manifests are kept. */
export async function unwireProject(dir: string, brain: string, w: WireEnv): Promise<{ removed: string[]; by: 'toolkit' | 'office' }> {
  const unwires = await toolkitUnwires(w.toolkitDir);
  if (unwires) {
    await runCommand(w.bash, [bashPath(path.join(w.toolkitDir, 'bin', 'wire-company-brain.sh')), '--unwire', bashPath(dir), bashPath(brain)], { cwd: dir, env: scriptEnv(w), timeoutMs: w.timeoutMs ?? 120_000, allowFail: true });
  }
  const removed: string[] = [];
  for (const f of surfacesOf(dir)) {
    const p = path.join(dir, f);
    const text = await readFile(p, 'utf8').catch(() => undefined);
    if (text === undefined || !text.includes(BRAIN_BEGIN)) continue;
    await writeFile(p, removeBlock(text));
    removed.push(f);
  }
  return { removed, by: unwires && !removed.length ? 'toolkit' : 'office' };
}
