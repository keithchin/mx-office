// The "Your deliverables" section of each role's Playbook (playbooks.ts): the files that role hands over
// per toolkit stage, at the exact paths the office's 📦 Deliverables view looks for
// (shared/deliverables.ts), how to make them with what's on this machine, and, when the floor's
// `earlyDrafts` setting is on, the small marked drafts Design, Development and Testing make while the
// Chief Analyst is still on Stages 0–2. Short on purpose: Playbooks are prompts, and the toolkit
// skills hold the how-to.

import { DRAFT_BANNER } from '../../shared/deliverables.js';
import { teamLabel } from '../../shared/roster/card-team.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import type { EntryMode } from '../../shared/wizard.js';

/** What every Lead can use to make its files, on the office's machine. */
const TOOLING = [
  '- `office-workers export-pdf <in.html> <out.pdf>` and `office-workers screenshot <in.html> <out.png> [--width 1280 --height 800]` render an HTML file of your worktree in the office\'s headless Chromium (no network; a Mermaid script from a CDN is served from the office). Don\'t install Playwright in the project for this.',
  '- Python is `py` (openpyxl, pandas, matplotlib, pypdf, PIL); not python-docx or python-pptx, and `python` is the Store stub. Diagrams are Mermaid blocks in Markdown (no mmdc here).',
];

/**
 * Where the knowledge base and the BRDs go, per entry mode, as the pinned toolkit has it. bin/gate-check.sh
 * resolves ONE knowledge base (analysis/<name>/knowledge-base when there is one, else analysis/knowledge-base)
 * and its Stage 2 reads only that one's brd/; a migration's extraction writes analysis/<source>/knowledge-base/
 * (skills/migration-pipeline.md), so a BRD put in analysis/knowledge-base/brd/ is read by every script but
 * gate-check (a migration project, release 56: Stage 2 PENDING over a signed BRD; shared/brd-path.ts flags it).
 */
const KB_LINE = '{{kb}}';
const BRD_LINE = '{{brd}}';
/** The process map's lines (shared/process-map.ts): only when the project's toolkit has its skill, else left out. */
const MAP2_LINE = '{{map2}}';
const MAP3_LINE = '{{map3}}';
const MAP_LINES: Record<string, string> = {
  [MAP2_LINE]:
    "- Stage 2 close, the process map (pass 1; optional, but gated once its model exists): when the BRDs carry more than about ten open questions or ASSUMED decisions, or more than one role touches the same record, write `design/process-model.json` and `design/question-anchors.json` and generate `design/process-map.html` with the toolkit's `process-map.js` (`skills/process-map.md`; nested layout: `analysis/<name>/design/`). `bin/brd-report.sh` then opens `analysis/brd-report.html` with it. A skip is one line in PROJECT.md.",
  [MAP3_LINE]:
    "- Stage 3, when `design/process-model.json` exists: pass 2 of `design/process-map.html` (`skills/process-map.md`: set `page` on the steps that gained a wireframe, re-run `anchor` and `build`). Rebuild it after any change to the model, the anchors or a wireframe: gate-check's Stage 3 fails a map older than any of them, and the Documents page shows it as stale.",
};
const BRD_TAIL = "(`brd-generation.md`, validated per `brd-validation.md`) and `analysis/brd-report.html` (the toolkit's `bin/brd-report.sh <project>`)";

/** The Chief Analyst's Stage 1 and Stage 2 lines for an entry mode (undefined: not recorded). */
export function kbLines(entry: EntryMode | undefined): { kb: string; brd: string } {
  if (entry === 'migration')
    return {
      kb: '- Stage 1: `analysis/source-ledger.html` (`bin/source-ledger.sh report`), the knowledge base the extraction writes under `analysis/<source>/knowledge-base/` (one folder per legacy source, named after it; never a second `analysis/knowledge-base/` beside it) with `extraction-report.html` (`bin/extraction-report.sh`).',
      brd: `- Stage 2: \`analysis/<source>/knowledge-base/brd/F{NNN}-<feature>.brd.json\`, in that same knowledge base: gate-check's Stage 2 reads BRDs only from the knowledge base it resolves, which is the per-source one, so a BRD in \`analysis/knowledge-base/brd/\` reads as Stage 2 PENDING ${BRD_TAIL}.`,
    };
  return {
    kb: '- Stage 1: `analysis/source-ledger.html` (`bin/source-ledger.sh report`), the knowledge base under `analysis/<source>/knowledge-base/` (or `analysis/knowledge-base/` for a docs-ready corpus converted with `bin/html-to-md.sh`) with `extraction-report.html` (`bin/extraction-report.sh`).',
    brd: `- Stage 2: \`brd/F{NNN}-<feature>.brd.json\` inside that same knowledge base (\`analysis/<source>/knowledge-base/brd/\`, or \`analysis/knowledge-base/brd/\` only when there is no per-source one: gate-check's Stage 2 reads only the knowledge base it resolves, and a per-source one wins) ${BRD_TAIL}.`,
  };
}

const LISTS: Partial<Record<RoleId, string[]>> = {
  'chief-analyst': [
    '- Stage 0: `triage.md` (project root) + `analysis/triage.html` (`bin/triage-report.sh`), `analysis/source-sufficiency.html`; `assessment.md` when the runbook asks for it.',
    KB_LINE,
    BRD_LINE,
    MAP2_LINE,
    '- For the client, once a BRD is confirmed: `docs/requirements/BRD-<feature>.pdf` (`office-workers export-pdf analysis/brd-report.html docs/requirements/BRD-<feature>.pdf`), `docs/requirements/use-cases.xlsx` (a short `py` + openpyxl script over the BRD JSON: one row per use case with id, actor, steps, rules, sourceRef) and `docs/requirements/process-flow.md` (the main flow as a Mermaid `flowchart`).',
    '- Weekly: `docs/insights/YYYY-Www.md`, with charts as PNGs next to it made with `py` + matplotlib.',
    '- Reports: the toolkit\'s own (`reports/validation-report.md` from `brd-validation.md`, `reports/summary.md`, `reports/gaps-report.md`) stay where the toolkit writes them; any other report of yours goes in `reports/analysis/`.',
  ],
  'lead-designer': [
    '- Stage 3 (`design-artifacts.md`): `design/brand.md`, `design/ds.css` (the tokens), `design/design-system.html` (a component showcase linking `ds.css`), `design/wireframes/<screen>.html` (one per screen, each linking `../ds.css`) and `design/components.md` (the components and where they are used).',
    MAP3_LINE,
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

/**
 * The Playbook's "Your deliverables" section for `roleId`; `earlyDrafts` adds the early-drafts rule for Design,
 * Development and Testing. `also`: the roles whose teams it covers besides its own (shared/roster/coverage.ts),
 * whose deliverables are its too, each under its team's heading. `entry`: the project's entry mode, when it's
 * recorded (where the knowledge base and the BRDs go differs: kbLines). `processMap`: the project's toolkit
 * has skills/process-map.md (toolkit-pin/features.ts), so the Chief Analyst and the Lead Designer are told
 * about the map; an older pin's team isn't sent after a skill its copy lacks.
 */
export function deliverablesBrief(roleId: RoleId, earlyDrafts: boolean, also: readonly RoleId[] = [], entry?: EntryMode, processMap = false): string[] {
  const role = ROLE_BY_ID.get(roleId)!;
  const where = kbLines(entry);
  const listOf = (r: RoleId) => (LISTS[r] ?? []).flatMap((l) => (l === KB_LINE ? [where.kb] : l === BRD_LINE ? [where.brd] : MAP_LINES[l] !== undefined ? (processMap ? [MAP_LINES[l]] : []) : [l]));
  const own = listOf(roleId);
  const out = [
    '## Your deliverables',
    'The office\'s 📄 Documents page (and your team\'s page) checks these paths per stage, so write them exactly there. Keep them on your branch and open a pull request for them ' +
      `(\`gh pr create --label ${teamLabel(role.team)}\`): the view shows branch work as "not merged", and only what lands on main counts. The toolkit skills named say how; don't copy them here.`,
    ...own,
    ...also.flatMap((r) => {
      const team = ROLE_BY_ID.get(r)!.team;
      // Its files only: where its other reports go is said in the heading, to keep the Playbook short.
      const files = listOf(r).filter((l) => !/^- (Any other report|Your other reports|Reports:)/.test(l));
      return [`- **${team[0].toUpperCase()}${team.slice(1)}** (you cover it; PRs \`--label ${teamLabel(team)}\`, other reports in \`reports/${team}/\`):`, ...files.map((l) => `  ${l}`)];
    }),
    ...TOOLING,
  ];
  const draft = DRAFTS[roleId];
  if (!draft) return [...out, ''];
  if (!earlyDrafts) return [...out, '- Start your Stage 3+ deliverables only once the stage before them is closed (its gate run and confirmed).', ''];
  return [
    ...out,
    '',
    '### Early drafts (on for this project)',
    `While the Chief Analyst is still on Stages 0–2, make ${draft}. Rules:`,
    `- Mark every draft: \`-draft\` in its file name, and \`${DRAFT_BANNER}\` as the first line (a heading or an HTML banner). The Documents page lists them as Draft.`,
    '- A draft never claims a gate: don\'t tick a stage, run its gate as done, or call it approved.',
    '- Keep it small: at most three files and about 30 minutes of work, no high-fidelity design, no MDL. Read the sources and the knowledge base; don\'t interview anyone for it.',
    '- Once the BRDs are confirmed (Stage 2 gate), revise each draft into the real deliverable (drop the `-draft` and the banner) or delete it, and say which in your journal.',
    '',
  ];
}
