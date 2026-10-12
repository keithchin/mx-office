---
title: Testing
description: App Insights › Testing - the project's test runs, each bound to the app revision it tested, the revision its tests came from and where its report is kept, and per BRD use case its coverage, latest result and freshness, read-only.
weight: 16.5
---

The **Testing** page (**App Insights › Testing** in the Portal navigation, `/lite?tab=testing`) shows the project's test evidence and what it really proves. It never changes the repository or GitHub. Admins can set the verification policy and give waivers (see [Verification policy and waivers](#verification-policy-and-waivers)); everything else is read-only.

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

## Verification

The **Verification** panel, under the header, answers a different question from the rest of the page: did a merged task's required checks pass on the commit that actually landed on the default branch? A check that passed on the pull request's head proves nothing about the merge commit, so the two are kept apart.

- **Policy in force**: the checks this project requires, and whether that's the default or who set it.
- **Newest integrated revision**: the merge commit of the newest merged pull request, and each required check's state on it.
- **Merged tasks not verified**: the team's merged tasks that are *Merged, not verified* or *Passed on PR head, integrated revision not checked*, each with its pull request, merge commit, PR head and what's missing or failed.

A merged task is in one of three states:

| State | When |
|---|---|
| **Done (verified)** | Every required check passed, or was waived, on the merge commit. Only this counts as delivered. |
| **Merged, not verified** | A required check failed, is missing or was skipped on the merge commit. The office asks you once in [Needs you](command-center.md#needs-you), with what failed or is missing and the options. |
| **Passed on PR head, integrated revision not checked** | The pull request's head passed, and the merge commit has no results yet. Never counted as verified; no Needs you item. |

Where merge-commit results come from: on each look at the pull requests (the Board's poll, never more often), the office also reads the default branch's newest pr-checks runs and the check runs on its newest commit, with two `gh` calls started off the main thread. A merged pull request's merge commit comes from the same pull-request list. Nothing is ever written to GitHub. A test office never starts its own `gh` for this.

If your pr-checks workflow only runs on pull requests, merge commits never get results, and merged tasks stay *Passed on PR head, integrated revision not checked*. Run the workflow on pushes to the default branch too, or waive.

## Verification policy and waivers

The **verification policy** is the list of checks a merged task needs on its merge commit. Admins set it per project in [⚙️ Settings › ✅ Verification](/lite?tab=settings&section=verification), a short list of checkboxes:

- **pr-checks run**, its overall conclusion;
- the pr-checks scorecard rows: **Studio Pro mx check**, **Lint**, **Unit tests**, **E2E tests**;
- **E2E journeys for the task's linked acceptance criteria**: applies only when the task's pull request says `Covers: AC-…`. Each criterion needs a test result on the merge commit that names it or one of its journeys.

With nothing set, the default applies: **the pr-checks conclusion on the merge commit is required**, plus the linked-criteria rule for tasks that have linked criteria. A single task can have its own policy (`POST /api/testing/verification` with `action: "task-policy"`), which beats the project's. Every change is recorded in the audit log as `testing.policy`.

Each required check on a revision is **passed**, **failed**, **missing** (it never ran on that revision), **skipped**, or **waived**. Missing and skipped never count as passed.

A **waiver** accepts a check that didn't pass on one revision. It needs a named person and a reason, is recorded in the audit log as `testing.waive`, and is shown everywhere with who and why. Admins give one in the Verification panel: pick the check, write why, **Waive**. It counts for that check on that commit only.

When a task is *Merged, not verified*, its Needs you item offers:

- **Re-run checks**: re-run the pr-checks workflow on GitHub yourself (or ask the agent to). The office never re-runs anything; it picks up the new run on its next look.
- **Waive (with a reason)**: in the Verification panel, as above.
- **Send back for rework**: your answer goes to the agent as its next prompt.

The office raises it once per task and merge commit, and never nudges the agent about it.

## Test first

Two light prompts, nothing blocks:

- When the build plan (Stage 4) has passed and Stage 5 isn't confirmed yet, Needs you shows **N acceptance criteria have no linked test**. It's raised once and its count is kept up to date.
- The Playbooks ask the Tester Lead to write or extend a task's test first and name the criteria it covers, and developers to run the task's tests before opening a pull request and to put `Covers: AC-xx, BRyyy` in its description. The office reads that line as a **recorded** link.

## Acceptance

When the Project Manager accepts a delivery, the acceptance record also keeps the Testing summary at the accepted commit: the coverage, result and freshness counts, and the verification policy's evaluation there. Records from before this change are left as they were.

## Not in this release

Per-task usage, task and attempt ids, and changes to the Board come in later releases.
