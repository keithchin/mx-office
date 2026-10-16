// The design system's ✋ card (server/design/): "Adopt Acme Design System v1 in <project>?", one per project at
// most, with what the scan found the theme would override. Adopt applies it on a branch of its own; Keep
// existing design changes nothing (and is the default: nothing happens until a button is pressed). Once Adopt
// ran, the same card says where the adoption is: failed at a stage (Retry / Discard), or a candidate on its
// branch waiting to be merged (shown, not counted as waiting on you; the project isn't bound to it yet). Pure.

import type { DesignNeedView } from '../design/views.js';
import { ADOPT_AFTER, adoptionWords } from '../design/words.js';
import type { NeedItem } from '../needsyou.js';
import type { Candidate } from './candidates.js';

export function designCandidates(v: DesignNeedView | undefined, floor: string | undefined): Candidate[] {
  const p = v?.proposal;
  if (!v || !p || !floor || v.floor !== floor) return [];
  const s = p.scan;
  const a = v.adoption && v.adoption.digest === p.digest ? v.adoption : undefined;
  if (a && a.status !== 'running') return [adoptionCard(v, floor, a)];
  const text = `Adopt ${p.name} v${p.n} in this project?`;
  const need: NeedItem = {
    key: `design-${floor}`,
    kind: 'design',
    icon: '🎨',
    text,
    since: p.since,
    level: 'warn',
    action: v.admin ? `Adopt ${p.name} v${p.n}` : 'View',
    target: { to: 'design', floor, act: v.admin ? 'adopt' : 'open' },
    ...(v.admin ? { alt: { action: 'Keep existing design', target: { to: 'design', floor, act: 'keep' } } } : {}),
  };
  const evidence = [
    ...s.overrides.slice(0, 6).map((o) => ({ label: `${o.name} would be overridden by the theme`, where: `${o.file}:${o.line}` })),
    ...s.custom.slice(0, 3).map((f) => ({ label: 'custom rules stay, outside the theme’s blocks', where: f })),
    ...s.modules.slice(0, 3).map((m) => ({ label: 'a theme module of its own stays as it is', where: m })),
  ];
  return [
    {
      need,
      source: { id: `design:${floor}:${p.digest.slice(0, 12)}`, type: 'other', label: 'the design system', text, target: need.target },
      keys: [],
      kind: 'decision',
      prio: 4,
      body: {
        question: text,
        detail: `${p.name} v${p.n} (digest ${p.digest.slice(0, 12)}) was proposed by ${p.by}. The app starts from ${s.noTheme ? 'no theme folder' : s.start === 'atlas' ? 'plain Atlas' : s.start === 'custom' ? 'styling of its own' : s.start.replace('mxcli:', 'mxcli theme ')}.${evidence.length ? '' : ' Nothing of its own would be overridden.'}${v.failed ? ` The last attempt failed: ${v.failed.detail}` : ''}`,
        options: [`Adopt ${p.name} v${p.n}`, 'Keep existing design'],
        recommendation: 'Keep existing design unless you have looked at what changes',
        evidence,
        blocks: [],
        owner: 'the Project Manager',
        after: ADOPT_AFTER,
        notes: ['Design-direction adoption only: it approves nothing about the app’s requirements.'],
      },
    },
  ];
}

/** An adoption that ran: failed (Retry carries on from the stage it stopped at; Discard keeps the existing design) or a candidate waiting to be merged. */
function adoptionCard(v: DesignNeedView, floor: string, a: NonNullable<DesignNeedView['adoption']>): Candidate {
  const text = adoptionWords(a);
  const failed = a.status === 'failed';
  const need: NeedItem = {
    key: `design-${floor}`,
    kind: 'design',
    icon: '🎨',
    text,
    since: a.updatedAt,
    level: failed ? 'warn' : 'info',
    action: failed && v.admin ? 'Retry' : 'View',
    target: { to: 'design', floor, act: failed && v.admin ? 'adopt' : 'open' },
    ...(v.admin ? { alt: { action: 'Discard', target: { to: 'design', floor, act: 'keep' } } } : {}),
  };
  return {
    need,
    source: { id: `design:${floor}:${a.digest.slice(0, 12)}`, type: 'other', label: 'the design system', text, target: need.target },
    keys: [],
    kind: 'decision',
    prio: 4,
    body: {
      question: failed ? `Retry adopting ${a.name} v${a.n}?` : `Merge ${a.branch} to adopt ${a.name} v${a.n}`,
      detail: `${text}${a.preserved ? ` The branch had ${a.preserved} commit${a.preserved === 1 ? '' : 's'} of its own: kept as they are.` : ''}`,
      options: failed ? ['Retry', 'Discard'] : ['Merge the branch (or open a pull request)', 'Discard'],
      recommendation: failed ? 'Retry once the cause is fixed; it carries on from the stage that failed' : 'Review and merge the branch like any other change',
      evidence: [...(a.branch ? [{ label: 'branch', where: a.branch }] : []), ...(a.commit ? [{ label: 'candidate commit', where: a.commit.slice(0, 12) }] : [])],
      blocks: [],
      owner: 'the Project Manager',
      after: 'Retry carries on from the stage that failed (the branch and its commits are kept). Discard keeps the existing design: the branch is deleted only when the office alone made it and never pushed it. Agents keep the project’s current design until the branch is merged.',
      notes: ['Design-direction adoption only: it approves nothing about the app’s requirements.'],
    },
  };
}
