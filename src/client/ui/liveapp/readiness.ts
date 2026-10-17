// The live app's readiness card on the 🌐 Live app tab: "Live app: not ready for the PackTrack Line 7 demo.
// Has: … Missing: …", then each milestone of the build plan with where its rows are (in the running build,
// merged but not in it yet, in an open PR, not built) and whether its journeys passed against this build.
// Everything comes from the office (server/liveapp/readiness.ts); this only draws it.

import type { LiveAppState } from '../../../shared/protocol';
import type { MilestoneState } from '../../../shared/liveapp/readiness';
import { h } from '../dom';
import './readiness.css';

/** The tag before each milestone (words, not emoji: the Clean and Portal themes redraw emoji). */
const TAG: Record<MilestoneState, string> = { ready: 'Ready', unverified: 'Not verified', refresh: 'Restart', branch: 'In a PR', partial: 'Partly', 'not-built': 'Not built' };
const WORD: Record<MilestoneState, string> = { ready: 'ready', unverified: 'built, not yet verified', refresh: 'merged, not in the live app yet', branch: 'on a branch', partial: 'partly built', 'not-built': 'not built' };

/** The card, or null before the office has read anything. */
export function readinessCard(s: LiveAppState): HTMLElement | null {
  const r = s.readiness;
  if (!r) return null;
  const phases = r.milestones.filter((m) => m.id !== 'all');
  const list = phases.length
    ? h(
        'ul.lr-list',
        {},
        ...phases.map((m) => h('li', { class: `lr-m ${m.state}`, title: WORD[m.state] }, h('span.lr-tag', {}, TAG[m.state]), h('span.lr-line', {}, m.line.replace(/^Ready: /, '')))),
      )
    : null;
  const where = [r.plan ? `${r.plan} at main @${r.main?.slice(0, 7) ?? '?'}` : '', 'row evidence from commit subjects and BUILD-LOG notes (not the plan’s State column)', 'journeys from the test runs of this exact build'].filter(Boolean).join('; ');
  return h(
    'section.lr',
    { class: `lr ${r.ready ? 'ready' : 'not-ready'}`, 'aria-label': 'Is the live app ready?' },
    h('p.lr-head', {}, r.headline),
    r.note ? h('p.lr-note', {}, r.note) : null,
    list,
    h('p.lr-src', {}, `Read from ${where}.`),
  );
}
