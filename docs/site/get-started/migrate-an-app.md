---
title: Migrate an app
description: Rebuild an app from another platform as a Mendix app with ✨ New project's Migrate an app - attach its source folder, keep the project off GitHub, set a budget cap, and what the Chief Analyst's Discovery runs.
weight: 3
---

**Migrate an app** is the New project card for rebuilding an existing app (a Next.js site, an OutSystems or Oracle Forms app, an older Mendix version) as a Mendix app. It runs the same flow as [Create your first project](first-project.md), with four differences: the app's code comes in as a **source folder**, the project can stay **off GitHub**, the budget asks for a **cap**, and Discovery runs the toolkit's **migration track**.

## 1. Describe it and attach the source folder

Pick **Migrate an app**, describe where the app runs today, what it does and what must keep working, and say whether you want a **slice** first (for example *rebuild the orders area as a first slice*). Attach documents with **+** › **Upload files…** as usual.

Then **+** › **Add a source folder…**: paste the folder's full path on the office's machine and click **Check folder**. Before anything is copied the dialog says what will be, for example *212 files, 9 MB; skipped: node_modules, 2 secrets-like files*. Dependency and build folders (`node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `.turbo`, `__pycache__`), files over 5 MB and secrets-like files (`.env*`, `*.pem`, `*.key`, `*.pfx`) are never copied; a folder over 200 MB or 20,000 files after that is refused, and so are system folders, your home folder and the office's own folders. The details are under [A source folder](first-project.md#a-source-folder).

> [!IMPORTANT]
> The source folder is **stored locally** and **never published to GitHub**: it is imported into the project's git-ignored `sources/legacy/<name>/` folder, with `sources/legacy/<name>.manifest.json` recording exactly what was imported (paths, sizes, sha256). It is **not** kept from the hosted model: the Chief Analyst drafts the brief from your description, your documents and the folder's **file index** only (paths and sizes, never the code), but after setup the team's agents read the code and send what they read to Claude, through Anthropic's API, to work on it. Earlier releases said the folder *stays on the office's machine*; that described the stored copy, not the agents' work. If the client doesn't allow its code to be processed by a hosted model, don't attach it.

## 2. Where the code lives

The app can live on **Mendix Team Server** from the first day (the default when 🔌 Connections has a Mendix token): the office creates it in the Mendix Portal and pushes main there, and nothing goes to GitHub unless you pick the mirror. See [On Mendix Team Server](first-project.md#on-mendix-team-server). Otherwise a migration with a source folder gets the usual **private** GitHub repository (Public isn't offered, because the analysis documents the team writes will quote the client's code). The imported source itself is git-ignored and never pushed (a **Retry** of the setup step imports it again as it is now; see [A source folder](first-project.md#a-source-folder)). If the client won't allow a private GitHub repository, pick **Mendix Team Server** or **Local only** under **Team & budget** › **Advanced** › *Where the code lives*: there is no GitHub repository, nothing is pushed to GitHub, and the Discovery brief is a file in the project. What that costs (no pull requests, PR checks or PR-based task outcomes, and the only copy is on this machine) is under [Local only (not on GitHub)](first-project.md#local-only-not-on-github).

## 3. Set a cap

The Team & budget card shows the planner's estimate with *Migrations have run over this estimate; set a cap*, and a **Budget cap (USD)** field filled in with the level's budget. The project pauses at 100% of the cap and tells you.

## 4. What Discovery runs

Instead of the generic *Run Stages P → 4* line, a migration's Discovery brief (the GitHub issue, or `docs/discovery-brief.md` for a local-only project) sends the Chief Analyst through the toolkit's migration track from `skills/conversion-runbook.md` (Entry Modes: **Migration**), with `skills/migration-pipeline.md` and `skills/migrate-general.md`:

1. **Stage 0, source sufficiency first**: `bin/source-sufficiency.sh init . --sources` with the absolute path of `sources/legacy/<name>`, then every dimension and `report`.
2. **Stage 0, assess-migration**: mxcli's bundled `.ai-context/skills/assess-migration.md`, written to `assessment.md` at the project root, an input to `skills/source-triage.md`'s coverage matrix; then `triage.md`.
3. **CAC-1**, the first scope check (`skills/checkpoints/checkpoint-scope.md`): where the slice is picked when you asked for one (a slice is an ordering, not an exclusion).
4. **Stage 1, Path A extraction** from the legacy source (the stack's source skill, such as `skills/source-node-express-react.md`), Path B for documents, Path C for the SME, closed by **CAC-1b** and `bin/source-ledger.sh check`.
5. Stages 2 → 4 as usual. The ✋ gates 0, 3 and 4 still stop for you, and Discovery still stops before Stage 5 (build).

The brief names the legacy source by its absolute path and marks it confidential. **Change an existing app** keeps its own wording.
