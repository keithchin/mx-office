// Lint baseline resets and waivers without the Project Manager's decision (the review gate; the packtrack
// audit's "gate erosion": the baseline re-set 8+ times in a day "by my call", each with self-waivers).
// The toolkit's lint gate ratchets against .claude/lint-baseline.json (project-bin/lint-gate.sh
// --update-baseline rewrites it), and gate-check --waive records a waiver as a "…-WAIVED" line in
// docs/BUILD-LOG.md and a "Waived …" line in PROJECT.md's register. A commit from the last week on any
// branch that touches the baseline, adds such a line, or says it waived something, without citing a
// decision (`Decided per ESC-<id>`), is listed on one info card. Local git only, off the event loop.

import type { AskItem } from '../../shared/asks.js';
import { BUILD_LOG, LINT_BASELINE, REGISTER } from '../../shared/review-gate.js';
import { git } from '../asks/sources.js';
import { GATE_DAYS } from './judge.js';

export interface WaiverHit {
  sha: string;
  author: string;
  at: number;
  subject: string;
  /** It rewrote the lint baseline. */
  baseline: boolean;
  /** Waiver lines it added (or 1 when only its title says it waived something). */
  waivers: number;
}

const DECIDED = /\bDecided per ESC-[A-Za-z0-9]+/;
const WAIVED_LOG = /\b[A-Z]+-WAIVED\b|\bWAIVED\b/;
const WAIVED_REGISTER = /\bWaived (stage|source|obligation)\b/i;
const SAYS_WAIVED = /\bwaive[ds]?\b/i;

/** The git log arguments (after `log`) the look runs. */
export const waiverLogArgs = (now: number) => [`--since=${new Date(now - GATE_DAYS * 86_400_000).toISOString()}`, '--branches', '--remotes=origin', '--no-merges', '--date-order', '--format=%x01%H%x00%an%x00%ct%x00%s%x00%b%x02', '-p', '--unified=0', '--no-renames', '--no-color', '--', LINT_BASELINE, BUILD_LOG, REGISTER];

/** The commits in `git log` output (waiverLogArgs) that reset the baseline or waived something without a decision. */
export function waiverHits(out: string): WaiverHit[] {
  const hits: WaiverHit[] = [];
  for (const block of out.split('\x01')) {
    const end = block.indexOf('\x02');
    if (end < 0) continue;
    const [sha, author, ct, subject, ...body] = block.slice(0, end).split('\0');
    if (!sha?.trim() || DECIDED.test(`${subject}\n${body.join('\n')}`)) continue;
    let file = '';
    let baseline = false;
    let waivers = 0;
    for (const line of block.slice(end + 1).split('\n')) {
      const d = /^diff --git a\/(.+?) b\//.exec(line);
      if (d) {
        file = d[1];
        if (file === LINT_BASELINE) baseline = true;
        continue;
      }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      if ((file === BUILD_LOG && WAIVED_LOG.test(line)) || (file === REGISTER && WAIVED_REGISTER.test(line))) waivers++;
    }
    if (!waivers && SAYS_WAIVED.test(subject ?? '')) waivers = 1;
    if (baseline || waivers) hits.push({ sha: sha.trim(), author: author ?? '', at: Number(ct) * 1000, subject: subject ?? '', baseline, waivers });
  }
  // git log (--date-order) lists newest first, never a parent before its children, and commit times are whole
  // seconds: so reversed, then sorted by time, same-second commits stay in the order they were made.
  return hits.reverse().sort((a, b) => a.at - b.at);
}

/** The week's resets and waivers without a decision, from every local branch and origin's. */
export async function lookWaivers(dir: string, now: number): Promise<WaiverHit[]> {
  const out = await git(['log', ...waiverLogArgs(now)], dir);
  return out ? waiverHits(out) : [];
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One info card for them all, or undefined when there are none. */
export function waiverItem(hits: readonly WaiverHit[], lead?: string): AskItem | undefined {
  if (!hits.length) return undefined;
  const resets = hits.filter((h) => h.baseline).length;
  const waivers = hits.reduce((n, h) => n + h.waivers, 0);
  const what = [resets ? `Lint baseline reset ${plural(resets, 'time', 'times')}` : '', waivers ? `${plural(waivers, 'waiver', 'waivers')} recorded` : ''].filter(Boolean).join(' and ');
  return {
    id: `gate-waive-${hash(hits.map((h) => h.sha).join('|'))}`,
    kind: 'gate',
    level: 'info',
    text: `${what} in the last ${GATE_DAYS} days without your decision`,
    since: hits[0].at,
    lines: [
      ...hits.map((h) => `${h.sha.slice(0, 7)} ${h.author}: ${h.subject} (${[h.baseline ? 'baseline reset' : '', h.waivers ? plural(h.waivers, 'waiver', 'waivers') : ''].filter(Boolean).join(', ')})`),
      `A reset of ${LINT_BASELINE} or a waiver needs your decision, cited in its commit (Decided per ESC-<id> rev <n>): otherwise a check that went red is just switched off.`,
    ],
    acts: [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about them` }] : []), { act: 'seen', label: 'Hide' }],
  };
}
