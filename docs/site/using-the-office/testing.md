---
title: Testing
description: App Insights › Testing - the project's test runs, each bound to the app revision it tested, the revision its tests came from and where its report is kept, and per BRD use case its coverage, latest result and freshness, read-only.
weight: 16.5
---

The **Testing** page (**App Insights › Testing** in the Portal navigation, `/lite?tab=testing`) shows the project's test evidence and what it really proves. It's read-only: it never changes the repository, GitHub or any task.

![The Testing page](../images/testing.png "The Testing page: main and the Stage 6 gate, the three counts, the test plan, a row per use case and the runs")

## Three revisions per run

Every test run the office records keeps three revisions apart:

| Revision | What it is |
|---|---|
| **Tested app** | The commit the app under test was built from. |
| **Tests from** | The commit the tests themselves were taken from. |
| **Evidence** | Where the report is kept: a repository commit, a CI run, or the office's own store. |

A report file committed at commit B proves nothing about B. Unless the file says what it tested, its tested revision is shown as **unknown**, and it counts as evidence for no commit.

Where the records come from (nothing new is asked of GitHub):

- **pr-checks runs.** The Board's check results on a pull request's head commit, and the pr-checks run the Board fetches when you hover a PR card. The run's head commit is both the tested and the tests-from revision. The evidence is the CI run.
- **Report files** on main: the JSON reports under `reports/testing/` and the toolkit's `docs/report.json`. The evidence revision is the commit that last added or changed the file. The tested revision comes only from the file itself (`appRevision`, `testedRevision`, or `project.gitCommit` in `docs/report.json`), the tests-from revision from `testRevision`. Otherwise both are unknown.
- **The office's own gate-check** of main, which the setup panel runs when main moves. The commit gate-check read is both revisions. The evidence is the office's store.

Reading the same run or report again never records it twice. The records are kept in `<data>/testing/<project>.jsonl`, append-only and hash-chained like the audit log.

## The header

- **main at** the commit main is on. **Stale** shows when no run has tested that commit yet.
- **Stage 6 gate**: gate-check's verdict for Test, from the office's own run on main, or else the committed `index.html` (which may be older than main).
- **Runs on main**: each suite that ran on exactly main's commit, and its result.
- Three counts, kept apart: **Coverage** (per acceptance criterion), **Results** (per use case, latest run) and **Freshness** (per use case, against main).

## Coverage, result and freshness

These are three separate questions, and each column answers only its own:

- **Coverage**: is there a linked test definition? *Linked*, *Inferred only* or *No linked test* for a criterion; *Full*, *Partial*, *Inferred only* or *None* for a use case.
- **Latest result**: what did the newest linked run say? *Passed*, *Failed*, *Not run (skipped)* or *No result*. A criterion with no linked test always shows *No result*, never *Failed*.
- **Freshness**: did that run test the commit main is on? *Current*, *Stale* (an older commit), *Revision unknown*, or *No run*. Freshness follows the tested app revision, not the tests-from revision.

This is **declared** coverage: a linked passing test doesn't prove that every path in the use case ran, and a failing one doesn't say which step broke.

## Links: recorded or inferred

Every link says how the office knows it:

- **recorded**: a file says so. The acceptance-criteria table (`architecture/acceptance-criteria.md`, AC → journey), a test or journey file naming UC, BR or AC ids or pointing into a BRD (`F001#/useCases/0`), or a report's own `requirement`, `covers` or `journey` field.
- **inferred**: the office worked it out from an id in a test's name, a pull request's title or a report's file name. The rule that matched is shown with it, for example *business rule id in the PR title*.

## The panels

- **Test plan**: the toolkit's `tests/test-plan*.md` (or `docs/test-plan*.md`) on main, with its own *Status:* line and the commit that last changed it. Open it to read it, rendered like the Documents page does. Without a plan the panel says so.
- **Functional domains**: one row per use case in the BRDs (`analysis/knowledge-base/brd/*.brd.json`), grouped by feature, with its business rules, acceptance criteria, linked tests, coverage, latest result and freshness. Click a row to see its criteria (each with its own three states), the linked tests and the runs with all three revisions. Criteria that belong to no use case are listed after the features.
- **Test runs**: the newest runs first, each with its source, branch or PR, its counts, freshness and all three revisions. **Flaky** marks a test that passed and failed on the same tested revision.

The page loads when you first open it and again when you come back to it (at most every 20 seconds), when you switch projects, or on **⟳ Refresh**. A new run on an unchanged commit shows at once.

## Not in this release

Verification policies, "Done (verified)", waivers, per-task usage and changes to the Board come in later releases.
