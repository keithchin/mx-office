// 📦 Deliverables: what each team is expected to hand over at each toolkit stage (the catalog below,
// after the mxcli-project-toolkit's conversion runbook §2 and the Leads' Playbooks), and what the office
// found of it in the floor's project: on its main checkout, in a team member's worktree, or on an
// office/* branch not merged yet. The office scans (server/deliverables/), the team pages and the
// Command Center's setup panel show it (ui/deliverables/). Pure: the browser imports it too.

import type { RoleId, TeamId } from './roster/roles.js';

export type DeliverableStage = 'P' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
export const DELIVERABLE_STAGES: readonly DeliverableStage[] = ['P', '0', '1', '2', '3', '4', '5', '6'];
export const STAGE_TITLE: Record<DeliverableStage, string> = {
  P: 'Kickoff',
  '0': 'Triage',
  '1': 'Analysis',
  '2': 'BRDs',
  '3': 'Architecture & design',
  '4': 'Build plan',
  '5': 'Build (ongoing)',
  '6': 'Test & evidence',
};

/** How the viewer shows a file. */
export type DeliverableKind = 'html' | 'md' | 'pdf' | 'image' | 'xlsx' | 'csv' | 'json' | 'text';

/** One thing a team is expected to produce: the paths it may be at, as globs from the project root. */
export interface DeliverableSpec {
  id: string;
  team: TeamId;
  stage: DeliverableStage;
  title: string;
  owner: RoleId;
  globs: readonly string[];
  /** Paths that look like it but aren't (the toolkit's scaffold examples). */
  exclude?: readonly string[];
  /** Nice to have: missing isn't a gap. */
  optional?: boolean;
}

const ANALYST: RoleId = 'chief-analyst';
const DESIGNER: RoleId = 'lead-designer';
const DEV: RoleId = 'lead-developer';
const TESTER: RoleId = 'lead-tester';
const PM: RoleId = 'pm';

/** The toolkit's deliverables by stage and team. Globs are case-insensitive; `**\/` is any folder or none. */
export const DELIVERABLES: readonly DeliverableSpec[] = [
  { id: 'intake', team: 'management', stage: 'P', title: 'Intake answers', owner: PM, globs: ['intake.md'] },
  { id: 'project-record', team: 'management', stage: 'P', title: 'Project record (decisions, scope)', owner: PM, globs: ['PROJECT.md'] },
  { id: 'triage', team: 'analysis', stage: '0', title: 'Source triage', owner: ANALYST, globs: ['triage.md', '**/triage.html'] },
  { id: 'assessment', team: 'analysis', stage: '0', title: 'Assessment', owner: ANALYST, globs: ['assessment.md', '**/assessment.md'], optional: true },
  { id: 'source-sufficiency', team: 'analysis', stage: '0', title: 'Source sufficiency', owner: ANALYST, globs: ['**/source-sufficiency.html'] },
  { id: 'source-ledger', team: 'analysis', stage: '1', title: 'Source ledger', owner: ANALYST, globs: ['**/source-ledger.html'] },
  { id: 'extraction-report', team: 'analysis', stage: '1', title: 'Extraction report', owner: ANALYST, globs: ['**/knowledge-base/extraction-report.html'] },
  { id: 'knowledge-base', team: 'analysis', stage: '1', title: 'Knowledge base', owner: ANALYST, globs: ['**/knowledge-base/*.md', '**/knowledge-base/share/*.md'] },
  { id: 'brd-json', team: 'analysis', stage: '2', title: 'BRDs (F{NNN}.brd.json)', owner: ANALYST, globs: ['**/F[0-9][0-9][0-9]*.brd.json'] },
  { id: 'brd-report', team: 'analysis', stage: '2', title: 'BRD report', owner: ANALYST, globs: ['**/brd-report.html'] },
  { id: 'brd-validation', team: 'analysis', stage: '2', title: 'BRD validation report', owner: ANALYST, globs: ['reports/validation-report.md'] },
  { id: 'brd-pdf', team: 'analysis', stage: '2', title: 'BRD as PDF (for the client)', owner: ANALYST, globs: ['docs/requirements/BRD-*.pdf'], optional: true },
  { id: 'use-cases', team: 'analysis', stage: '2', title: 'Use-case workbook', owner: ANALYST, globs: ['docs/requirements/use-cases.xlsx', 'docs/requirements/use-cases.csv'], optional: true },
  { id: 'process-flow', team: 'analysis', stage: '2', title: 'Process flow (Mermaid)', owner: ANALYST, globs: ['docs/requirements/process-flow*.md'], optional: true },
  { id: 'insights', team: 'analysis', stage: '5', title: 'Weekly insight memos', owner: ANALYST, globs: ['docs/insights/*.md'], optional: true },
  { id: 'brand', team: 'design', stage: '3', title: 'Brand decisions', owner: DESIGNER, globs: ['design/brand*.md'] },
  { id: 'ds-css', team: 'design', stage: '3', title: 'Design tokens (ds.css)', owner: DESIGNER, globs: ['design/ds*.css'] },
  { id: 'design-system', team: 'design', stage: '3', title: 'Design system showcase', owner: DESIGNER, globs: ['design/design-system*.html'] },
  { id: 'wireframes', team: 'design', stage: '3', title: 'Wireframes (one per screen)', owner: DESIGNER, globs: ['design/wireframes/**/*.html'] },
  { id: 'storyboard', team: 'design', stage: '3', title: 'Storyboard', owner: DESIGNER, globs: ['design/storyboard*.html', 'design/storyboard/**/*.png'], optional: true },
  { id: 'components', team: 'design', stage: '3', title: 'Component notes', owner: DESIGNER, globs: ['design/components*.md'], optional: true },
  { id: 'blueprint', team: 'development', stage: '3', title: 'Architecture blueprint', owner: DEV, globs: ['architecture/blueprint*.md', 'architecture/blueprint*.html'] },
  { id: 'domain-model', team: 'development', stage: '3', title: 'Domain model (Mermaid)', owner: DEV, globs: ['architecture/domain-model*.md'] },
  { id: 'adr', team: 'development', stage: '3', title: 'Decision records', owner: DEV, globs: ['architecture/adr/*.md'], optional: true },
  { id: 'fit-gap', team: 'development', stage: '3', title: 'Fit-gap', owner: DEV, globs: ['fit-gap.md', 'architecture/fit-gap*.md'] },
  { id: 'module-design', team: 'development', stage: '3', title: 'Module design', owner: DEV, globs: ['**/module-design.html', 'architecture/modules/*.md'], optional: true },
  { id: 'build-plan', team: 'development', stage: '4', title: 'Build plan', owner: DEV, globs: ['architecture/build-plan*.md', '**/build-plan.html'] },
  { id: 'module-briefs', team: 'development', stage: '4', title: 'Module briefs', owner: DEV, globs: ['architecture/modules/*/module-brief.md', 'modules/*/module-brief.md'] },
  { id: 'coverage-ledger', team: 'development', stage: '4', title: 'Coverage ledger', owner: DEV, globs: ['architecture/coverage-ledger.md', 'architecture/modules/*/coverage-ledger.md'] },
  { id: 'test-plan', team: 'testing', stage: '4', title: 'Test plan', owner: TESTER, globs: ['tests/test-plan*.md'] },
  { id: 'journeys', team: 'testing', stage: '6', title: 'E2E journeys', owner: TESTER, globs: ['tests/e2e/**/*.journey.json'], exclude: ['tests/e2e/example.journey.json'] },
  { id: 'ui-reviews', team: 'testing', stage: '6', title: 'UI review reports', owner: TESTER, globs: ['design/ui-reviews/*.html'] },
  { id: 'test-report', team: 'testing', stage: '6', title: 'Test report / e2e evidence', owner: TESTER, globs: ['**/test-report.html', '**/e2e-evidence*.html', 'reports/testing/e2e-evidence*'], optional: true },
  { id: 'standups', team: 'management', stage: '5', title: 'Standup pages', owner: PM, globs: ['docs/standups/*.md'] },
  { id: 'status', team: 'management', stage: '5', title: 'Client status pages', owner: PM, globs: ['docs/status/*.md'], optional: true },
];

/**
 * The reports the toolkit's analyst scripts write straight under reports/, where they stay: they are
 * Analysis's. Every other team keeps its reports in reports/<team>/.
 */
export const ANALYST_REPORTS: readonly string[] = ['reports/validation-report.md', 'reports/summary.md', 'reports/gaps-report.md', 'reports/analysis/**'];

/**
 * What a team makes beyond the toolkit's list, by team, tried in this order: the first team whose globs
 * match a file not in the catalog gets it as an extra. Kept to folders deliverables live in, so the
 * client's own source documents (sources/) and the app never show up. A report straight under
 * reports/ that's none of these is unsorted (unsortedReport), for the Project Coordinator.
 */
export const EXTRAS: readonly { team: TeamId; globs: readonly string[] }[] = [
  { team: 'testing', globs: ['reports/testing/**', 'design/ui-reviews/**', 'tests/test-plan*', 'tests/e2e/**/*.md'] },
  { team: 'design', globs: ['reports/design/**', 'design/**', 'docs/design/**'] },
  { team: 'development', globs: ['reports/development/**', 'architecture/**', 'docs/architecture/**', 'docs/adr/**'] },
  { team: 'analysis', globs: [...ANALYST_REPORTS, 'docs/requirements/**', 'docs/insights/**', 'analysis/**/*.{html,md,pdf,xlsx,csv,svg,png}', 'docs/**/*.{pdf,xlsx,csv}', '*.{pdf,xlsx}', ':brd'] },
  { team: 'management', globs: ['reports/management/**', 'docs/standups/**', 'docs/status/**'] },
];

/** Never deliverables: the client's sources, tooling and the office's own folders. */
const NEVER = ['sources/**', 'node_modules/**', '**/node_modules/**', '.agent-office/**', '.claude/**', '.ai-context/**', '.git/**', 'theme/**', 'deployment/**', 'javasource/**', 'vendorlib/**', 'docs/team/**', 'analysis/knowledge-base/text/**'];

const globCache = new Map<string, RegExp>();

/** A glob as a regular expression: `**` any folders, `*` and `?` within a name, `{a,b}` and `[0-9]`. */
export function globRe(glob: string): RegExp {
  const hit = globCache.get(glob);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else if (c === '[') {
      const end = glob.indexOf(']', i);
      re += glob.slice(i, end + 1);
      i = end;
    } else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`, 'i');
  globCache.set(glob, out);
  return out;
}

/** BRD-ish Markdown anywhere outside the never-list (the old Teams page's `*brd*.md`). */
const isBrdMd = (p: string) => /brd/i.test(p.slice(p.lastIndexOf('/') + 1)) && /\.md$/i.test(p);

export const globMatch = (glob: string, p: string) => (glob === ':brd' ? isBrdMd(p) : globRe(glob).test(p));
const anyMatch = (globs: readonly string[], p: string) => globs.some((g) => globMatch(g, p));

/** A path from git or a request: forward slashes, inside the project, nothing hidden going up. */
export function safeRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\0') || p.includes('\\')) return false;
  if (p.startsWith('/') || p.startsWith('-') || /^[a-z]:/i.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Which catalog entry a project file is, if any. */
export function specFor(p: string): DeliverableSpec | undefined {
  if (anyMatch(NEVER, p)) return undefined;
  return DELIVERABLES.find((d) => anyMatch(d.globs, p) && !(d.exclude ?? []).some((x) => x.toLowerCase() === p.toLowerCase()));
}

/** Whose extra a project file is, when it's no catalog entry. */
export function extraTeam(p: string): TeamId | undefined {
  if (anyMatch(NEVER, p) || specFor(p)) return undefined;
  return EXTRAS.find((e) => anyMatch(e.globs, p))?.team;
}

/** A file under reports/ that's no catalog entry, no analyst report and in no team's reports/<team>/: shown as Unsorted in Management's panel. */
export function unsortedReport(p: string): boolean {
  return globMatch('reports/**', p) && !anyMatch(NEVER, p) && !specFor(p) && !extraTeam(p);
}

/** Whether the office lists and serves this path as a deliverable at all. */
export const isDeliverablePath = (p: string): boolean => safeRelPath(p) && (!!specFor(p) || !!extraTeam(p) || unsortedReport(p));

export function kindOf(p: string): DeliverableKind {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  return 'text';
}

/** A draft by its name: `-draft`, `.draft.` or a drafts/ folder. A DRAFT banner at the top counts too (the scanner reads that). */
export const draftByName = (p: string): boolean => /(^|\/)drafts?\/|[-_.]draft([-_.]|$)/i.test(p);
/** The banner the Playbooks ask early drafts to start with. */
export const DRAFT_BANNER = 'DRAFT — before Stage 3 gate';
export const draftByHead = (head: string): boolean => /\bDRAFT\b\s*(—|-|–|:)/.test(head.slice(0, 3000));

/** Where a file was found. `src` names it for the file routes: `main`, `wt:<workerId>` or `ref:<branch>`. */
export interface DeliverableWhere {
  src: string;
  /** "main", "Barbara's worktree", "office/pixel-31e0". */
  label: string;
  branch?: string;
  /** Who works there: a team member's name, else the worker's, else the branch's own name. */
  who?: string;
  role?: RoleId;
}

export type FileStatus = 'present' | 'branch' | 'draft';
export type DeliverableStatus = FileStatus | 'missing';

export interface DeliverableFile {
  path: string;
  kind: DeliverableKind;
  status: FileStatus;
  size?: number;
  /** Last change, ms: the file's own on disk, else its branch's last commit. */
  mtime?: number;
  /** Everywhere it is, the best first (main, then worktrees, then branches, newest first). */
  where: DeliverableWhere[];
}

export interface DeliverableItem {
  /** A catalog id, or `extras-<team>`. */
  id: string;
  team: TeamId;
  /** Undefined for a team's extras. */
  stage?: DeliverableStage;
  title: string;
  owner?: RoleId;
  optional?: boolean;
  status: DeliverableStatus;
  files: DeliverableFile[];
  /** More files than the list carries. */
  more?: number;
}

/** What GET /api/deliverables answers. */
export interface DeliverablesView {
  floor: string;
  scannedAt: number;
  items: DeliverableItem[];
  /** The places looked in besides main, for the panel's foot. */
  sources: DeliverableWhere[];
  /** What "main" is: `origin/main` (the project's default branch on GitHub), or the floor's folder when it has no remote. */
  main?: string;
  /** The floor's folder when it's on another branch than the default one, or behind it. */
  checkout?: { branch: string; behind: number; defaultBranch: string };
}

/** An item's status from its files: anything on main that isn't a draft wins, then real work on a branch, then drafts. */
export function itemStatus(files: readonly Pick<DeliverableFile, 'status'>[]): DeliverableStatus {
  if (!files.length) return 'missing';
  if (files.some((f) => f.status === 'present')) return 'present';
  if (files.some((f) => f.status === 'branch')) return 'branch';
  return 'draft';
}

export interface StageCount {
  stage: DeliverableStage;
  expected: number;
  present: number;
  branch: number;
  draft: number;
  missing: number;
}

/** Per stage: how many expected (not optional) items are on main, only on a branch, drafts, or missing. */
export function stageCounts(items: readonly DeliverableItem[]): StageCount[] {
  const out: StageCount[] = [];
  for (const stage of DELIVERABLE_STAGES) {
    const mine = items.filter((i) => i.stage === stage && (!i.optional || i.status !== 'missing'));
    if (!mine.length) continue;
    const n = (s: DeliverableStatus) => mine.filter((i) => i.status === s).length;
    out.push({ stage, expected: mine.length, present: n('present'), branch: n('branch'), draft: n('draft'), missing: n('missing') });
  }
  return out;
}
