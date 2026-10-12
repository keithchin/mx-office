// The Testing tab's Quality header (Testing release 1b), drawn from GET /api/testing?part=quality: the six
// mxcli report scores and the overall score, each from one commit and one mxcli version, a small trend
// over the last recorded commits (inline bars, no chart library), lint counts by severity with the top
// rules, and the rules that could not run, shown as such (missing findings, never zero). Stale when main
// has moved since. An admin starts the office's own mxcli runs from here: the microflow tests on main and
// a quality run, each one at a time, in the office's work folder.

import type { QualityPart, QualityView, ScoreCell } from '../../../shared/testing/quality';
import { h } from '../dom';
import { rev, when, type Tone } from './words';
import './quality.css';

const pill = (word: string, tone: Tone, title?: string) => h('span.tst-pill', { 'data-tone': tone, ...(title ? { title } : {}) }, word);

/** A score's tone: the word is the number itself; the tone only repeats how good it is. */
export const scoreTone = (n: number | undefined): Tone => (n === undefined ? 'muted' : n >= 80 ? 'good' : n >= 60 ? 'warn' : 'bad');

const fmt = (n: number | undefined) => (n === undefined ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const secs = (ms: number | undefined) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`);

/** The last few commits' scores as inline bars, newest right; each bar says its commit and score. */
function trend(points: { commit: string; score: number }[], label: string): HTMLElement | null {
  if (points.length < 2) return null;
  return h(
    'span.tst-trend',
    { role: 'img', 'aria-label': `${label} over the last ${points.length} scored commits: ${points.map((p) => fmt(p.score)).join(', ')}` },
    ...points.map((p) => h('span.tst-tbar', { 'data-tone': scoreTone(p.score), style: `height:${Math.max(6, Math.min(100, p.score))}%`, title: `${rev(p.commit)}: ${fmt(p.score)}` })),
  );
}

function cell(c: ScoreCell): HTMLElement {
  return h('div.tst-score', { 'data-tone': scoreTone(c.score) }, h('span.tst-score-n', {}, fmt(c.score)), h('span.tst-score-l', {}, c.name), trend(c.trend, c.name));
}

/** The header itself (no buttons): scores, lint, rules that could not run. */
export function qualityHeader(v: QualityView): HTMLElement {
  const l = v.latest;
  if (!l)
    return h('div.tst-q-empty', {}, h('p.tst-empty', {}, v.totalRecords ? 'The last quality run gave no scores (see the note on its run).' : 'No quality scores yet. The office works them out (mxcli report and lint) once for each new main commit, in its own work folder; an admin can also score main now.'));
  const stale = v.stale ? pill('Stale', 'warn', `main is at ${rev(v.stale.main)}; these scores are from ${rev(v.stale.scored)}`) : pill('Current', 'good', 'Scored on the commit main is at');
  const id = h('p.tst-q-id', {}, h('span.tst-k', {}, 'Scored '), h('code.tst-sha', { title: l.commit }, rev(l.commit)), ' ', stale, h('small.tst-from', {}, ` mxcli ${l.mxcliVersion}${l.catalogSchema ? ` · catalog schema ${l.catalogSchema}` : ''}${l.mendixVersion ? ` · Mendix ${l.mendixVersion}` : ''} · ${when(l.finishedAt)} · ${l.trigger === 'auto' ? 'new main commit' : `asked by ${l.trigger}`}`));
  const overall = h('div.tst-score.tst-score-all', { 'data-tone': scoreTone(l.overall) }, h('span.tst-score-n', {}, fmt(l.overall)), h('span.tst-score-l', {}, 'Overall'), trend(l.overallTrend, 'Overall'));
  const scores = h('div.tst-scores', { role: 'group', 'aria-label': `Report scores for ${rev(l.commit)}` }, overall, ...l.scores.map(cell));
  const lint = l.lint
    ? h(
        'div.tst-lint',
        {},
        h('p.tst-gate', {}, h('span.tst-k', {}, 'Lint: '), pill(`${l.lint.bySeverity.errors} errors`, l.lint.bySeverity.errors ? 'bad' : 'muted'), pill(`${l.lint.bySeverity.warnings} warnings`, l.lint.bySeverity.warnings ? 'warn' : 'muted'), pill(`${l.lint.bySeverity.infos} info`, 'muted'), l.lint.bySeverity.hints ? pill(`${l.lint.bySeverity.hints} hints`, 'muted') : null),
        l.lint.topRules.length ? h('ol.tst-rules', { 'aria-label': 'Top lint rules' }, ...l.lint.topRules.map((r) => h('li', { title: r.example ?? '' }, h('code', {}, r.ruleId), ` ×${r.count} `, h('small.tst-from', {}, r.severity)))) : h('p.tst-muted', {}, 'No lint findings.'),
      )
    : h('p.tst-muted', {}, 'Lint gave no findings list on this commit.');
  const failures = l.ruleFailures.length
    ? h('div.tst-q-fail', {}, h('p.tst-gate', {}, pill(`${l.ruleFailures.length} rule${l.ruleFailures.length === 1 ? '' : 's'} could not run`, 'warn', 'Their findings are missing, not zero')), h('ul.tst-notes', {}, ...l.ruleFailures.slice(0, 8).map((f) => h('li', {}, h('code', {}, f.rule), ` (${f.from}): ${f.why}`))))
    : h('p.tst-muted', {}, 'Rules that could not run: none reported.');
  const errors = l.errors.length ? h('ul.tst-notes', {}, ...l.errors.map((e) => h('li', {}, e))) : null;
  const t = l.timings;
  const timing = h('small.tst-from', {}, `Took ${secs(t.total)}: checkout ${secs(t.checkout)}, report ${secs(t.report)}, lint ${secs(t.lint)}, catalog ${secs(t.catalog)}`);
  return h('div.tst-q', {}, id, scores, lint, failures, errors, timing);
}

export type RunAsk = (what: 'tests' | 'quality') => Promise<string | undefined>;

/** The whole Quality card: the header, plus the office's mxcli runs and their buttons. */
export function qualityPanel(p: QualityPart, ask: RunAsk): HTMLElement {
  const r = p.runs;
  const note = h('small.tst-from', { role: 'status' });
  const button = (what: 'tests' | 'quality', label: string, running: boolean) => {
    const b = h('button.btn.small', { type: 'button', disabled: running || !r.available }, running ? `${label}…` : label) as HTMLButtonElement;
    b.onclick = async () => {
      b.disabled = true;
      note.textContent = 'Starting…';
      const err = await ask(what);
      note.textContent = err ?? 'Started: it runs in the office’s work folder; this card updates when it ends.';
      if (err) b.disabled = false;
    };
    return b;
  };
  const line = (title: string, s: { running: boolean; since?: number; commit?: string; last?: string; deferred?: string }) =>
    h('li', {}, h('span.tst-k', {}, `${title}: `), s.running ? pill(`Running on ${rev(s.commit)}`, 'info') : s.deferred ? pill('Waiting', 'muted', s.deferred) : null, s.last ? h('span', {}, ` ${s.last}`) : !s.running ? h('span.tst-muted', {}, ' not run since the office started') : null);
  const runs = h(
    'div.tst-q-runs',
    {},
    h('ul.tst-q-runlist', {}, line('Microflow tests', r.tests), line('Quality scores', r.quality)),
    !r.available ? h('p.tst-muted', {}, `The office can’t run mxcli here: ${r.why ?? 'not available'}`) : null,
    p.admin
      ? h('div.tst-q-btns', {}, button('tests', 'Run microflow tests on main', r.tests.running), button('quality', 'Score main now', r.quality.running), note)
      : h('p.tst-muted', {}, 'An admin can run the microflow tests on main (mxcli test --local --require-assertions) and score main now.'),
  );
  return h('section.tst-card.tst-quality', {}, h('h3.tst-h', {}, 'Quality', h('small.tst-hsub', {}, 'mxcli report and lint, per commit, in the office’s own work folder')), qualityHeader(p.quality), runs);
}
