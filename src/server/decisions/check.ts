// After "I've done it" on a hands-on card, a harmless read-only status check where one exists, labelled as
// a check and never blocking (decision cards): `gh auth status` for a GitHub sign-in, `mxcli auth status`
// for a Marketplace sign-in, but only when the office's mxcli has that command (its `auth --help` says
// so; otherwise no check). In test mode nothing runs: the result says it was faked. It never proves the
// action worked and never changes the card: the agent re-checks either way.

import { execFileOffP } from '../offloop/exec.js';
import { findMxcli } from '../model/mxcli.js';

export type CheckKind = 'gh' | 'mxcli';

export interface CheckResult {
  kind: CheckKind;
  /** "Check: gh auth status". */
  label: string;
  ok: boolean;
  /** Its last lines, tokens masked. */
  text: string;
  at: number;
  /** Test mode: nothing ran. */
  faked?: boolean;
}

/** Which check a hands-on action's words call for, if any. */
export function checkFor(text: string): CheckKind | undefined {
  if (/\bmxcli\s+auth\b|\bmarketplace\b.*\b(sign|log)\s*-?in\b|\b(sign|log)\s*-?in\b.*\bmarketplace\b/i.test(text)) return 'mxcli';
  if (/\bgh\s+auth\b|\bgithub\b.*\b(sign|log)\s*-?in\b|\b(sign|log)\s*-?in\b.*\bgithub\b|\bgh\s+login\b/i.test(text)) return 'gh';
  return undefined;
}

const mask = (s: string) => s.replace(/\b(gh[opusr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, '****').replace(/(token:?\s*)\S+/gi, '$1****');
const tail = (s: string) => mask(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-4).join(' · ').slice(0, 400);

/** Whether this mxcli has `auth status` (its help lists it), cached per binary. */
const mxcliHasStatus = new Map<string, Promise<boolean>>();
function hasAuthStatus(bin: string): Promise<boolean> {
  let p = mxcliHasStatus.get(bin);
  if (!p) {
    p = execFileOffP(bin, ['auth', '--help'], { timeout: 15_000, windowsHide: true })
      .then(({ stdout, stderr }) => /^\s*status\b/m.test(`${stdout}\n${stderr}`))
      .catch((err: { stdout?: string; stderr?: string }) => /^\s*status\b/m.test(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}`));
    mxcliHasStatus.set(bin, p);
  }
  return p;
}

/** Runs the check (off the event loop, 20 s at most); undefined when there's none to run. */
export async function runCheck(kind: CheckKind, o: { dataDir: string; testMode: boolean; now: () => number }): Promise<CheckResult | undefined> {
  const label = `Check: ${kind} auth status`;
  if (o.testMode) return { kind, label, ok: true, text: 'Test mode: the check was not run (a fake result).', at: o.now(), faked: true };
  let bin = 'gh';
  if (kind === 'mxcli') {
    const found = findMxcli(o.dataDir);
    if (!found || !(await hasAuthStatus(found))) return undefined;
    bin = found;
  }
  try {
    const { stdout, stderr } = await execFileOffP(bin, ['auth', 'status'], { timeout: 20_000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    return { kind, label, ok: true, text: tail(`${stdout}\n${stderr}`) || 'OK', at: o.now() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { kind, label, ok: false, text: tail(`${e.stdout ?? ''}\n${e.stderr ?? ''}`) || (e.message ?? 'failed').slice(0, 200), at: o.now() };
  }
}
