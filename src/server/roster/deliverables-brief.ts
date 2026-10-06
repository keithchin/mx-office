// The "Your deliverables" section of each role's Playbook (playbooks.ts): the files that role hands over
// per toolkit stage, at the exact paths the office's 📦 Deliverables view looks for
// (shared/deliverables.ts), how to make them with what's on this machine, and, when the floor's
// `earlyDrafts` setting is on, the small marked drafts Design, Development and Testing make while the
// Chief Analyst is still on Stages 0–2. Short on purpose: Playbooks are prompts, and the toolkit
// skills hold the how-to.

import { DRAFT_BANNER } from '../../shared/deliverables.js';
import { teamLabel } from '../../shared/roster/card-team.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';

/** What every Lead can use to make its files, on the office's machine. */
const TOOLING = [
  '- `office-workers export-pdf <in.html> <out.pdf>` and `office-workers screenshot <in.html> <out.png> [--width 1280 --height 800]` render an HTML file of your worktree in the office\'s headless Chromium (no network; a Mermaid script from a CDN is served from the office). Don\'t install Playwright in the project for this.',
  '- Python is `py` (openpyxl, pandas, matplotlib, pypdf, PIL); not python-docx or python-pptx, and `python` is the Store stub. Diagrams are Mermaid blocks in Markdown (no mmdc here).',
];

const LISTS: Record<RoleId, string[]> = {
  'chief-analyst': [
    '- Stage 0: `triage.md` (project root) + `analysis/triage.html` (`bin/triage-report.sh`), `analysis/source-sufficiency.html`; `assessment.md` when the runbook asks for it.',
    '- Stage 1: `analysis/source-ledger.html` (`bin/source-ledger.sh report`), the knowledge base under `analysis/knowledge-base/` with `extraction-report.html` (`bin/extraction-report.sh`).',
    '- Stage 2: `analysis/knowledge-base/brd/F{NNN}-<feature>.brd.json` (`brd-generation.md`, validated per `brd-validation.md`) and `analysis/brd-report.html` (the toolkit\'s `bin/brd-report.sh <project>`).',
    '- For the client, once a BRD is confirmed: `docs/requirements/BRD-<feature>.pdf` (`office-workers export-pdf analysis/brd-report.html docs/requirements/BRD-<feature>.pdf`), `docs/requirements/use-cases.xlsx` (a short `py` + openpyxl script over the BRD JSON: one row per use case with id, actor, steps, rules, sourceRef) and `docs/requirements/process-flow.md` (the main flow as a Mermaid `flowchart`).',
    '- Weekly: `docs/insights/YYYY-Www.md`, with charts as PNGs next to it made with `py` + matplotlib.',
    '- Reports: the toolkit\'s own (`reports/validation-report.md` from `brd-validation.md`, `reports/summary.md`, `reports/gaps-report.md`) stay where the toolkit writes them; any other report of yours goes in `reports/analysis/`.',
  ],
  'lead-designer': [
    '- Stage 3 (`design-artifacts.md`): `design/brand.md`, `design/ds.css` (the tokens), `design/design-system.html` (a component showcase linking `ds.css`), `design/wireframes/<screen>.html` (one per screen, each linking `../ds.css`) and `design/components.md` (the components and where they are used).',
    '- `design/storyboard.html`: the wireframes in journey order, each a screenshot (`office-workers screenshot design/wireframes/<screen>.html design/storyboard/<nn>-<screen>.png`) with a line on what the user does there.',
    '- Stage 6 with the Lead Tester: `design/ui-reviews/ui-review-<YYYY-MM-DD>.html` per review pass.',
    '- Any other report of yours (a design review, an accessibility check) goes in `reports/design/`.',
  ],
  'lead-developer': [
    '- Stage 3 (architect lane, `architecture-blueprint.md`): `architecture/blueprint.md` with Mermaid diagrams (layers, wiring, workflow, cross-persona journeys) and its render `architecture/blueprint.html`; `architecture/domain-model.md` (a Mermaid `erDiagram`); `architecture/adr/NNN-<decision>.md` for each real decision; `architecture/fit-gap.md`.',
    '- Stage 4 (`brd-to-build-plan.md`, `module-brief.md`, `coverage-ledger.md`): `architecture/build-plan.md`, `architecture/modules/<Module>/module-brief.md` (the first one now, the rest just in time), `architecture/coverage-ledger.md`.',
    '- Any other report of yours (a build or layering review, a performance check) goes in `reports/development/`.',
  ],
  'lead-tester': [
    '- Stage 4: `tests/test-plan.md` (what is tested, how, by whom, the journeys and their data).',
    '- Stage 6: `tests/e2e/<journey>.journey.json` per journey (`journey-proof.md`), `design/ui-reviews/ui-review-<YYYY-MM-DD>.html` with the Lead Designer, and the evidence report (`e2e-evidence-report.md`) as `reports/testing/e2e-evidence-<YYYY-MM-DD>.html`, also as a PDF via `office-workers export-pdf` when the client wants one.',
    '- Your other reports (test runs, monkey runs, audits) go in `reports/testing/` too; the toolkit\'s `reports/test-report.html` stays where it writes it.',
  ],
  pm: ['- The standup pages (`docs/standups/<date>.md`, the office drafts them). Optional: `docs/status/<YYYY-MM-DD>.md`, a one-page status for the client (progress per stage, what is next, what needs a decision), written after a standup when the Project Manager asks for it.', '- Any other report of yours goes in `reports/management/`. A report someone left straight under `reports/` that is no analyst report shows as Unsorted on your team page: ask its author to move it into their `reports/<team>/`.'],
};

/** The drafts each role makes early, when the floor allows them. */
const DRAFTS: Partial<Record<RoleId, string>> = {
  'lead-designer': 'low-fidelity wireframes (grey boxes and real labels, plain HTML) for the screens the sources and the knowledge base already make plain, as `design/wireframes/<screen>-draft.html`',
  'lead-developer': 'a draft domain model (`architecture/domain-model-draft.md`, a Mermaid `erDiagram` of the entities the sources name) and a one-page architecture sketch (`architecture/blueprint-draft.md`: modules and how they connect, one Mermaid diagram)',
  'lead-tester': 'a test-plan outline (`tests/test-plan-draft.md`: the journeys you expect and how each will be proven, headings and bullets only)',
};

/** The Playbook's "Your deliverables" section for `roleId`; `earlyDrafts` adds the early-drafts rule for Design, Development and Testing. */
export function deliverablesBrief(roleId: RoleId, earlyDrafts: boolean): string[] {
  const role = ROLE_BY_ID.get(roleId)!;
  const out = [
    '## Your deliverables',
    'The office\'s 📦 Deliverables view (on your team\'s page) checks these paths per stage, so write them exactly there. Keep them on your branch and open a pull request for them ' +
      `(\`gh pr create --label ${teamLabel(role.team)}\`): the view shows branch work as "not merged", and only what lands on main counts. The toolkit skills named say how; don't copy them here.`,
    ...LISTS[roleId],
    ...TOOLING,
  ];
  const draft = DRAFTS[roleId];
  if (!draft) return [...out, ''];
  if (!earlyDrafts) return [...out, '- Start your Stage 3+ deliverables only once the stage before them is closed (its gate run and confirmed).', ''];
  return [
    ...out,
    '',
    '### Early drafts (on for this floor)',
    `While the Chief Analyst is still on Stages 0–2, make ${draft}. Rules:`,
    `- Mark every draft: \`-draft\` in its file name, and \`${DRAFT_BANNER}\` as the first line (a heading or an HTML banner). The Deliverables view lists them as Draft.`,
    '- A draft never claims a gate: don\'t tick a stage, run its gate as done, or call it approved.',
    '- Keep it small: at most three files and about 30 minutes of work, no high-fidelity design, no MDL. Read the sources and the knowledge base; don\'t interview anyone for it.',
    '- Once the BRDs are confirmed (Stage 2 gate), revise each draft into the real deliverable (drop the `-draft` and the banner) or delete it, and say which in your journal.',
    '',
  ];
}
