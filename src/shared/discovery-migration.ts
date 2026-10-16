// The Discovery brief's migration track (server/wizard/brief.ts): what a Migrate an app project's Chief
// Analyst runs instead of the generic "Stages P → 4" line, in the toolkit's own names (pinned toolkit:
// skills/conversion-runbook.md "Entry Modes" and "Stage 0 — Triage & Scope ✋", skills/assess-migration.md,
// skills/migration-pipeline.md, skills/migrate-general.md, skills/checkpoints/checkpoint-scope.md and
// checkpoint-extraction.md). Stage 0 triage with assess-migration and the source sufficiency inventory over
// the legacy source's absolute path, the slice picked at CAC-1 when the person asked for one, then Stage 1
// Path A extraction from the legacy source. The gates (0, 3, 4) and "stop before Stage 5" stay in the brief
// around it. Pure: no Node imports.

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

export interface MigrationWhere {
  /** The toolkit's folder (the pin), whose bin/ the scripts run from. */
  toolkitDir: string;
  /** The legacy source's absolute path in the project (…/sources/legacy/<name>), when a source folder was attached. */
  legacyDir?: string;
  /** The person asked for a slice (their description or the brief says so). */
  slice: boolean;
}

/** Whether the person's words ask for a slice rather than the whole app. */
export const asksForSlice = (texts: string[]) => texts.some((t) => /\b(slice|vertical slice|first slice|thin slice|pilot slice|one module first)\b/i.test(t));

/** The migration track's lines, replacing the generic Stages P → 4 line. */
export function migrationTrack(w: MigrationWhere): string[] {
  const bin = `${slash(w.toolkitDir)}/bin`;
  const src = w.legacyDir ? slash(w.legacyDir) : undefined;
  return [
    "- **This is a migration: run the toolkit's migration track** from `skills/conversion-runbook.md` (Entry Modes: **Migration**, stages P, 0–7, where Path A, the code extractors, always runs), with `skills/migration-pipeline.md` and `skills/migrate-general.md` as its companions. Discovery covers **Stages P → 4** of it.",
    src
      ? `- **The legacy source (confidential)** is in \`${src}\`: the project's \`sources/legacy/\` folder, git-ignored, so only in the main checkout and never in your worktree. Read it from that path; never copy it into the repository, never quote secrets from it, and never send it to any service, site or tool beyond your own session (reading it in your session sends what you read to the model, which is how you work on it). \`${src}.manifest.json\` lists exactly the files imported (paths, sizes, sha256).`
      : "- **The legacy source isn't in the project yet:** ask the client for it at Stage 0 and put it in the project's `sources/legacy/` folder (git-ignored) before the triage.",
    `- **Stage 0 — Triage & Scope ✋, source sufficiency first:** \`${bin}/source-sufficiency.sh init . --sources ${src ?? '<the legacy source folder>'}\` from your working folder writes \`analysis/source-sufficiency.json\` (pass 1, the inventory: one row per file); fill each row as you open the file, fill every dimension, then run \`report\` and commit the rubric. Without it the gates' source ledger fails.`,
    "- **Stage 0, assess-migration:** run the migration assessment from mxcli's bundled `.ai-context/skills/assess-migration.md` (the toolkit's `skills/assess-migration.md` says what it adds): it writes `assessment.md` at the project root and is an input to `skills/source-triage.md`'s coverage matrix, never a conclusion. Then write `triage.md` at the project root (not under `analysis/`).",
    w.slice
      ? "- **The client asked for a slice: pick it at the first scope check, CAC-1** (`skills/checkpoints/checkpoint-scope.md`): present the capability map from `triage.md`, agree which slice comes first and in what order the rest follow (a slice is an ordering, not an exclusion), and record it before the Stage 0 sign-off."
      : '- **Close Stage 0 with CAC-1** (`skills/checkpoints/checkpoint-scope.md`): the scope brainstorm over `triage.md`\'s capability map, full rebuild or a slice, and the slice ordering (a slice is an ordering, not an exclusion).',
    `- **Stage 1 — Analysis, Path A extraction from the legacy source:** the code → AST extractors over ${src ? `\`${src}\`` : 'the legacy source'} (the stack's source skill, such as \`skills/source-node-express-react.md\` for a Node / React app), Path B for any attached documents, and Path C (SME) for what neither answers. Close with **CAC-1b** (\`skills/checkpoints/checkpoint-extraction.md\`) before any BRD is written, and \`${bin}/source-ledger.sh check .\` must pass.`,
    '- Then Stages 2 → 4: requirements, architecture & design, and the **build plan** (`architecture/build-plan.md`).',
  ];
}
