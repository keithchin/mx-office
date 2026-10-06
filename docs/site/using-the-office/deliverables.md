---
title: Deliverables
description: What each team has produced, stage by stage - on main, on a branch not merged yet, a draft, or missing - and a viewer for HTML reports, Markdown, PDFs, pictures and CSVs.
weight: 5.5
---

Every team page on the **🧩 Team boards** tab starts with a **📦 Deliverables** panel: the files that team is expected to hand over at each toolkit stage, and what the office found of them. The Command Center's [Project setup](command-center.md#project-setup) panel shows a line of counts per stage, and **Open deliverables →** opens every team's list in one window.

## What it checks

The list comes from the toolkit's conversion runbook and the Leads' Playbooks (`src/shared/deliverables.ts`). A few examples:

| Stage | Team | Deliverables |
|---|---|---|
| 0 Triage | Analysis | `triage.md` / `analysis/triage.html`, `analysis/source-sufficiency.html`, `assessment.md` |
| 1 Analysis | Analysis | `analysis/source-ledger.html`, `analysis/knowledge-base/extraction-report.html`, the knowledge base |
| 2 BRDs | Analysis | `F{NNN}*.brd.json`, `analysis/brd-report.html`; for the client `docs/requirements/BRD-*.pdf`, `use-cases.xlsx`, `process-flow.md` |
| 3 Architecture & design | Design | `design/brand.md`, `design/ds.css`, `design/design-system.html`, `design/wireframes/*.html`, `design/storyboard.html`, `design/components.md` |
| 3 Architecture & design | Development | `architecture/blueprint.md` + `.html`, `architecture/domain-model.md`, `architecture/adr/*.md`, `fit-gap.md` |
| 4 Build plan | Development, Testing | `architecture/build-plan.md`, `architecture/modules/<M>/module-brief.md`, `architecture/coverage-ledger.md`, `tests/test-plan.md` |
| 6 Test & evidence | Testing | `tests/e2e/*.journey.json`, `design/ui-reviews/*.html`, the e2e evidence report |
| Ongoing | Management, Analysis | `docs/standups/*.md`, `docs/status/*.md`, `docs/insights/*.md` |

Files a team makes beyond that list (`docs/requirements/**`, `design/**`, `architecture/**`, its reports, PDFs, workbooks and CSVs under `docs/` or `analysis/`) show under **Beyond the toolkit**. The client's sources (`sources/`), tooling folders and the team journals never do.

### Reports

Each team has its own reports:

| Where | Whose |
|---|---|
| `reports/validation-report.md` (the Stage 2 **BRD validation report**, expected), `reports/summary.md`, `reports/gaps-report.md`, `reports/analysis/**` | Analysis: the toolkit's analyst reports stay where the toolkit writes them |
| `reports/design/**`, `reports/development/**`, `reports/testing/**`, `reports/management/**` | That team |
| `reports/test-report.html`, `reports/testing/e2e-evidence-*.html` | Testing (the test report / e2e evidence item) |
| Anything else straight under `reports/` | **Unsorted reports**, in Management's panel, for the Project Coordinator to get moved |

The Playbooks tell each Lead its folder.

## Where it looks

- **Main**: the project's default branch on GitHub, `origin/<default>` (from `origin/HEAD`, else `main` or `master`), read with `git ls-tree` and `git cat-file` after a quiet fetch at most every 90 seconds, the same one the [setup panel](command-center.md#project-setup) uses. So *On main* means merged, whatever branch the floor's folder is on. When the folder is on another branch or behind, the panel says so at the top: *This folder is on run4/discovery-p-4, 23 commits behind main; "On main" below is read from main.* Only a project with no remote uses the folder itself (tracked files, or new and not ignored).
- **Each hired team member's worktree**, uncommitted work included.
- **Every other `office/*` branch**, local or on GitHub, newest first (40 at most), with who it belongs to: the worker on it, else the team member whose name starts it (`office/barbara-stage1` is Barbara's).

The scan is read-only and kept for 20 seconds; a branch's file list is cached by its head commit.

## Statuses

| Status | Means |
|---|---|
| **On main** | It's on `origin/<default>` (or in the folder, for a project with no remote). |
| **On a branch** | Only on a branch or in a worktree: *Not merged: on office/pixel-31e0 · Pixel. It counts once its pull request lands.* Merging is the source of truth. |
| **Draft** | Only drafts so far: `-draft` or `.draft.` in the name, a `drafts/` folder, or a `DRAFT — …` banner at the top. |
| **Missing** | Nothing yet; the panel says which paths it expected. |
| **Optional** | Nice to have, and missing. |

## The viewer

Click a file to open it. **Download** saves it; HTML, PDFs and pictures also have **Open in a new tab**. When a file is in several places (main and a newer copy on a branch), pick which.

- **HTML reports** (the toolkit's triage, ledger and BRD reports, wireframes) open in a sandboxed frame with no origin and no network. The office inlines the report's own stylesheets, scripts and pictures first, and serves Mermaid from its own copy when the page asks a CDN for it.
- **Markdown** is rendered like the bookshelf, pictures included. **Mermaid** blocks are drawn as diagrams, light or dark to match your theme, with the source folded under each (**Mermaid source**); a block Mermaid can't parse stays as its source with the reason.
- **Pictures** (SVG too) show as pictures, **PDFs** in the browser's viewer, **CSV** as a table of the first 200 rows, **JSON** pretty-printed (a BRD links to the BRD report), and **Excel workbooks** as a download.

## How the Leads make them

Each Lead's Playbook has a **Your deliverables** section with the exact paths per stage, and the tools on the office machine: `office-workers export-pdf` and `office-workers screenshot` (see [office-workers CLI](../reference/office-workers-cli.md#export-pdf-and-screenshot)), `py` with openpyxl, pandas and matplotlib, and Mermaid in Markdown. Leads keep deliverables on their branch and open a pull request so they merge.

## Early drafts

**⚙️ Settings › 📦 Deliverables → Early drafts** (`/lite?tab=settings&section=deliverables`) is on by default. While the Chief Analyst is on Stages 0–2, the Lead Designer makes low-fi wireframes for screens the sources already show, the Lead Developer a draft domain model and a one-page architecture sketch, and the Lead Tester a test-plan outline. Drafts are marked, never claim a gate, stay small (three files and about half an hour at most) and are revised or deleted once the BRDs are confirmed. Turn it off and they wait for their stage. Changing it rewrites the hired Leads' Playbooks. See [Settings](settings.md).
