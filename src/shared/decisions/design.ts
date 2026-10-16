// The design system's ✋ card (server/design/): "Adopt Acme Design System v1 in <project>?", one per project at
// most, with what the scan found the theme would override. Adopt applies it on a branch of its own; Keep
// existing design changes nothing (and is the default: nothing happens until a button is pressed). Pure.

import type { DesignNeedView } from '../design/views.js';
import { ADOPT_AFTER } from '../design/words.js';
import type { NeedItem } from '../needsyou.js';
import type { Candidate } from './candidates.js';

export function designCandidates(v: DesignNeedView | undefined, floor: string | undefined): Candidate[] {
  const p = v?.proposal;
  if (!v || !p || !floor || v.floor !== floor) return [];
  const s = p.scan;
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
