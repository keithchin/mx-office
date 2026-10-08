// What an ✅ Accept would record right now (the dialog's review, and the record itself): the scope agreed
// (BRDs, the build plan, the register's confirmed decisions) and delivered (deliverables per stage,
// merged work), the delivery branch's head, the test evidence the office has (gate verdicts, the PRs'
// CI rollups, the test reports among the deliverables), the documents on main at their revision, the
// gaps and failures worth carrying as exceptions, and the spend frozen now. A gap reads as a gap with
// its reason; nothing the office didn't measure is written down as a zero.

import type { AcceptanceDraft, CostSnapshot, EvidenceLine, Exception } from '../../shared/acceptance.js';
import { STAGE_TITLE as BUDGET_STAGE_TITLE, type StageId } from '../../shared/budget/types.js';
import { safeRelPath, type DeliverablesView } from '../../shared/deliverables.js';
import type { GhPull } from '../../shared/protocol.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import type { SetupView } from '../../shared/wizard.js';
import { numbersOf } from '../budget/control.js';
import type { BudgetService, FloorRef } from '../budget/service.js';
import { totalOf } from '../budget/ledger.js';
import { stageDeliverables } from '../progress/gather.js';
import { stagesFor } from '../../shared/progress.js';
import { entryOf } from '../budget/plan-source.js';

const DOCS_MAX = 40;
const LIST_MAX = 30;
const pad = (n: number) => String(n).padStart(2, '0');
/** A day, or a day and a time, on the office's clock. */
const day = (ms?: number) => (ms ? `${new Date(ms).getFullYear()}-${pad(new Date(ms).getMonth() + 1)}-${pad(new Date(ms).getDate())}` : undefined);
const stamp = (ms: number) => `${day(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
const gitLoc = (commit: string | undefined, p: string) => (commit && safeRelPath(p) ? `git:${commit}:${p}` : undefined);

/** Who owns a stage's open work, by the toolkit's lanes (for a suggested exception's owner). */
const STAGE_OWNER: Record<string, string> = { P: 'Project Manager', '0': 'Chief Analyst', '1': 'Chief Analyst', '2': 'Chief Analyst', '3': 'Lead Developer', '4': 'Lead Developer', '5': 'Lead Developer', '6': 'Lead Tester', '7': 'Project Manager' };

export interface DraftInput {
  floor: string;
  version: string;
  setup?: SetupView;
  deliverables?: DeliverablesView;
  pulls: readonly GhPull[];
  head: { branch?: string; commit?: string };
  budget: { b: BudgetService; ref: FloorRef };
  admin: boolean;
  now: number;
}

/** The stages this project runs and didn't waive: missing deliverables elsewhere are no gap (a greenfield project has no BRDs to deliver). */
function stagesRun(i: DraftInput): Set<string> {
  const verdicts = i.setup?.verdicts ?? [];
  const run = i.setup?.toolkit ? stagesFor(entryOf(i.setup.entry), verdicts).map((s) => s.id) : ['P', '0', '1', '2', '3', '4', '5', '6', '7'];
  return new Set(run.filter((id) => verdicts.find((v) => v.id === id)?.status.toUpperCase() !== 'WAIVED'));
}

function scopeOf(i: DraftInput): AcceptanceDraft['scope'] {
  const agreed: EvidenceLine[] = [];
  const v = i.deliverables;
  const run = stagesRun(i);
  const brd = v?.items.find((x) => x.id === 'brd-json');
  const brds = brd?.files.filter((f) => f.status === 'present') ?? [];
  // BRDs are Stage 2's and the build plan Stage 4's: a project whose entry mode skips them has nothing missing there.
  const wantsBrds = run.has('2') || brds.length > 0;
  if (wantsBrds && !v) agreed.push({ label: 'BRDs', status: 'unknown', detail: "the deliverables couldn't be scanned" });
  else if (wantsBrds && !brds.length) agreed.push({ label: 'BRDs', status: 'missing', detail: 'no BRD files (F###.brd.json) on main' });
  for (const f of brds.slice(0, LIST_MAX)) agreed.push({ label: `BRD ${f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.brd\.json$/i, '')}`, status: 'present', locator: gitLoc(i.head.commit, f.path) });
  if (brd?.more || brds.length > LIST_MAX) agreed.push({ label: 'More BRDs', status: 'present', detail: `${brds.length - LIST_MAX + (brd?.more ?? 0)} more not listed` });
  const plan = v?.items.find((x) => x.id === 'build-plan');
  if (plan && (run.has('4') || plan.status === 'present')) agreed.push({ label: 'Build plan', status: plan.status === 'present' ? 'present' : 'missing', detail: plan.status === 'present' ? plan.files[0]?.path : `not on main (${plan.status})`, locator: plan.status === 'present' && plan.files[0] ? gitLoc(i.head.commit, plan.files[0].path) : undefined });
  for (const r of (i.setup?.decisions ?? []).filter((d) => /^confirmed/i.test(d.status)).slice(0, LIST_MAX)) agreed.push({ label: `Decision, Stage ${r.stage}: ${r.decision}`, status: 'present', detail: r.status });
  const delivered: EvidenceLine[] = [];
  if (v) {
    for (const c of stageDeliverables(v).filter((x) => run.has(x.stage))) delivered.push({ label: `Stage ${c.stage} deliverables`, status: c.present === c.expected ? 'present' : c.present ? 'pending' : 'missing', detail: `${c.present} of ${c.expected} on main${c.branch ? `, ${c.branch} on a branch` : ''}${c.draft ? `, ${c.draft} draft` : ''}` });
  } else delivered.push({ label: 'Deliverables', status: 'unknown', detail: "the deliverables couldn't be scanned" });
  const merged = i.pulls.filter((p) => p.state === 'MERGED');
  delivered.push(merged.length ? { label: 'Merged pull requests', status: 'present', detail: `${merged.length}${merged.length >= 40 ? '+' : ''} (the office keeps the latest 40)` } : { label: 'Merged pull requests', status: 'unknown', detail: 'none seen on this floor (GitHub not connected, or nothing merged)' });
  if (brds.length) delivered.push({ label: 'BRDs built', status: 'unknown', detail: "which BRDs are built isn't recorded: compare the agreed list with the merged work" });
  return { agreed, delivered };
}

const GATE: Record<string, EvidenceLine['status']> = { PASS: 'pass', FAIL: 'fail', PENDING: 'pending', MANUAL: 'pending', WAIVED: 'present' };

function testsOf(i: DraftInput): EvidenceLine[] {
  const out: EvidenceLine[] = [];
  const verdicts = i.setup?.verdicts ?? [];
  const when = i.setup?.checkedAt ? `checked ${stamp(i.setup.checkedAt)}` : 'from the committed dashboard';
  if (!verdicts.length) out.push({ label: 'Gate checks', status: 'missing', detail: 'gate-check has not rendered a dashboard for this project' });
  for (const g of verdicts) out.push({ label: `Gate ${g.id} · ${g.title}`, status: GATE[g.status.toUpperCase()] ?? 'unknown', detail: `${g.status}${g.status.toUpperCase() === 'WAIVED' ? ' (waived)' : ''}${g.detail ? `: ${g.detail}` : ''} · ${when}`, locator: i.head.commit ? `git:${i.head.commit}:index.html` : undefined });
  const merged = i.pulls.filter((p) => p.state === 'MERGED');
  const last = merged[0];
  if (!i.pulls.length) out.push({ label: 'CI', status: 'unknown', detail: 'no pull requests seen on this floor, so no CI results' });
  else if (last) out.push({ label: `CI on the last merged PR #${last.number}`, status: last.checks === 'none' ? 'unknown' : last.checks, detail: last.checks === 'none' ? 'no CI checks reported on it' : `${last.title}${last.headRefOid ? ` @ ${last.headRefOid.slice(0, 8)}` : ''}` });
  for (const p of i.pulls.filter((x) => x.state === 'OPEN' && (x.checks === 'fail' || x.checks === 'pending')).slice(0, 10)) out.push({ label: `CI on open PR #${p.number}`, status: p.checks === 'fail' ? 'fail' : 'pending', detail: p.title });
  for (const id of ['test-plan', 'journeys', 'ui-reviews', 'test-report']) {
    const it = i.deliverables?.items.find((x) => x.id === id);
    if (!it) continue;
    out.push({ label: it.title, status: it.status === 'present' ? 'present' : 'missing', detail: it.status === 'present' ? `${it.files.length + (it.more ?? 0)} file${it.files.length + (it.more ?? 0) === 1 ? '' : 's'} on main` : it.status === 'missing' ? 'not found' : `only ${it.status === 'branch' ? 'on a branch' : 'as a draft'}`, locator: it.status === 'present' && it.files[0] ? gitLoc(i.head.commit, it.files[0].path) : undefined });
  }
  return out;
}

function docsOf(i: DraftInput): { docs: EvidenceLine[]; more?: number } {
  if (!i.deliverables) return { docs: [{ label: 'Documents', status: 'unknown', detail: "the deliverables couldn't be scanned" }] };
  const files = i.deliverables.items.filter((x) => x.stage).flatMap((x) => x.files.filter((f) => f.status === 'present').map((f) => ({ x, f })));
  if (!files.length) return { docs: [{ label: 'Documents', status: 'missing', detail: 'no catalog deliverables on main' }] };
  const docs: EvidenceLine[] = files.slice(0, DOCS_MAX).map(({ x, f }) => ({ label: f.path, status: 'present', detail: `${x.title}${f.mtime ? ` · ${day(f.mtime)}` : ''}`, locator: gitLoc(i.head.commit, f.path) }));
  return { docs, ...(files.length > DOCS_MAX ? { more: files.length - DOCS_MAX } : {}) };
}

function suggestionsOf(i: DraftInput): Exception[] {
  const out: Exception[] = [];
  const run = stagesRun(i);
  for (const g of i.setup?.verdicts ?? []) if (g.status.toUpperCase() === 'FAIL') out.push({ text: `Gate ${g.id} (${g.title}) is failing${g.detail ? `: ${g.detail}` : ''}`, owner: STAGE_OWNER[g.id] ?? 'Project Manager' });
  for (const it of i.deliverables?.items ?? []) if (it.stage && run.has(it.stage) && !it.optional && it.status !== 'present') out.push({ text: `${it.title} (Stage ${it.stage}) is ${it.status === 'missing' ? 'missing' : `not on main (${it.status})`}`, owner: (it.owner && ROLE_BY_ID.get(it.owner)?.title) || STAGE_OWNER[it.stage] || 'Project Manager' });
  for (const p of i.pulls.filter((x) => x.state === 'OPEN' && x.checks === 'fail')) out.push({ text: `PR #${p.number} has failing CI: ${p.title}`, owner: 'Lead Developer' });
  return out.slice(0, 12);
}

/** The spend now, frozen into the record; the ledger itself keeps reconciling afterwards. */
export function costSnapshot(b: BudgetService, ref: FloorRef, now: number): CostSnapshot {
  const f = b.file(ref);
  const n = numbersOf(b, ref);
  const days = Object.values(f.ledger.days);
  const planned = n.plan.lines.reduce((s, l) => s + l.usd, 0);
  const fx = b.fx();
  return {
    at: now,
    spent: Math.round(totalOf(f.ledger) * 100) / 100,
    estimated: Math.round(days.reduce((s, d) => s + d.est, 0) * 100) / 100,
    unmeteredCalls: days.reduce((s, d) => s + d.unmetered, 0),
    ...(f.settings.total ? { budget: f.settings.total } : {}),
    ...(planned > 0 ? { planned: Math.round(planned * 100) / 100 } : {}),
    byStage: n.variance.map((v) => ({ stage: v.stage, label: v.stage === '—' ? 'No stage' : `Stage ${v.stage} · ${BUDGET_STAGE_TITLE[v.stage as StageId]}`, actual: v.actual, ...(v.planned > 0 ? { planned: v.planned } : {}) })),
    ...(fx.currency && fx.currency !== 'USD' && fx.rate ? { fx: { currency: fx.currency, rate: fx.rate } } : {}),
  };
}

/** The draft an Accept would record now. */
export function draftOf(i: DraftInput): AcceptanceDraft {
  const { docs, more } = docsOf(i);
  const gaps = [...(i.head.commit ? [] : ["the delivery branch's head couldn't be read"]), "no build reference: the office doesn't record builds (type one in if there is)", "no deploy reference: the office doesn't record deployments (type one in if there is)"];
  return {
    floor: i.floor,
    version: i.version,
    scope: scopeOf(i),
    source: { ...i.head, gaps },
    tests: testsOf(i),
    docs,
    ...(more ? { docsMore: more } : {}),
    suggestions: suggestionsOf(i),
    cost: costSnapshot(i.budget.b, i.budget.ref, i.now),
    admin: i.admin,
  };
}
