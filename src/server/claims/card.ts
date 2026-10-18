// The claims check's card in Needs you (index.ts): one per project, in the review gate's 🚦 style, listing
// each claim git doesn't back with its links (commit, branch, PR, result file), who made it, and the
// buttons "Ask <agent> to fix" (the team's durable tell, through the surfaced asks: asks/detect.ts) and
// "Hide" (until the set of mismatches changes). Pure.

import { createHash } from 'node:crypto';
import type { AskItem } from '../../shared/asks.js';
import { mismatchFix, mismatchLine, type ClaimMismatch } from '../../shared/claims.js';

export interface Links {
  commit(sha: string): string;
  branch(b: string): string;
  pr(n: number): string;
  file(sha: string, path: string): string;
}

/** GitHub's links for the repository a PR URL is in ("https://github.com/o/r/pull/3"), or undefined. */
export function linksFrom(prUrl: string | undefined): Links | undefined {
  const m = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl ?? '');
  if (!m) return undefined;
  const base = m[1];
  return { commit: (s) => `${base}/commit/${s}`, branch: (b) => `${base}/tree/${b.split('/').map(encodeURIComponent).join('/')}`, pr: (n) => `${base}/pull/${n}`, file: (s, p) => `${base}/blob/${s}/${p.split('/').map(encodeURIComponent).join('/')}` };
}

const sha7 = (s: string) => s.slice(0, 7);

/** The verdict in a few words, for the card's sentence and its evidence. */
export function verdictWords(m: ClaimMismatch): string {
  switch (m.verdict) {
    case 'no-model':
      return 'claimed applied, no model change in that commit';
    case 'branch-only':
      return `applied on ${m.holder!.branch}, not on ${m.place}`;
    case 'failing':
      return `claim says PASS; committed result shows ${m.result!.failed} failed`;
    case 'not-committed':
      return 'evidence not committed';
  }
}

/** One mismatch per claim commit and evidence: the same gap said twice in one commit is one line. */
export function distinct(ms: readonly ClaimMismatch[]): ClaimMismatch[] {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = `${m.verdict}|${m.commit}|${m.holder?.commit ?? ''}|${m.result?.file ?? ''}|${m.ignored ?? ''}|${m.verdict === 'no-model' ? m.claim.keys.join(',') : ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const joined = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Who to ask, by name: the agents who made the claims, most mismatches first. */
export function askWho(ms: readonly ClaimMismatch[]): string {
  const n = new Map<string, number>();
  for (const m of ms) n.set(m.who, (n.get(m.who) ?? 0) + 1);
  const names = [...n].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return names.length > 2 ? 'the team' : joined(names);
}

/** The Needs-you card for a project's mismatches, or undefined when there are none. */
export function claimsItem(all: readonly ClaimMismatch[], links?: Links): AskItem | undefined {
  const ms = distinct(all);
  if (!ms.length) return undefined;
  const first = ms[0];
  const n = ms.length;
  const who = askWho(ms);
  const evidence: NonNullable<AskItem['evidence']> = [];
  for (const m of ms.slice(0, 12)) {
    evidence.push({ label: `${m.who}: ${verdictWords(m)} — “${m.claim.text}”`, where: links ? links.commit(m.commit) : `commit ${sha7(m.commit)} on ${m.place}`, revision: sha7(m.commit) });
    if (m.pr !== undefined) evidence.push({ label: `PR #${m.pr}`, ...(links ? { where: links.pr(m.pr) } : {}) });
    if (m.holder) evidence.push({ label: `The model change: ${sha7(m.holder.commit)} on ${m.holder.branch} (“${m.holder.subject.slice(0, 80)}”)`, where: links ? links.commit(m.holder.commit) : m.holder.branch, revision: sha7(m.holder.commit) });
    if (m.result) evidence.push({ label: `The committed result: ${m.result.file} (${m.result.passed} passed, ${m.result.failed} failed)`, where: links ? links.file(m.result.commit, m.result.file) : m.result.file, revision: sha7(m.result.commit) });
  }
  const lines = ms.map((m) => `${mismatchLine(m, links)} Fix: ${mismatchFix(m)}.`);
  const id = createHash('sha1').update(ms.map((m) => m.id).sort().join(',')).digest('hex').slice(0, 12);
  return {
    id: `claims-${id}`,
    kind: 'claims',
    level: ms.some((m) => m.onMain) ? 'warn' : 'info',
    text: `${n} claim${n === 1 ? '' : 's'} git doesn’t back: ${first.who}, ${verdictWords(first)}${n > 1 ? ` (and ${n - 1} more)` : ''}`,
    since: Math.min(...ms.map((m) => m.at)),
    lines,
    evidence,
    acts: [{ act: 'ask-lead', label: `Ask ${who} to fix` }, { act: 'seen', label: 'Hide' }],
  };
}
