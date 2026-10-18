---
title: Claims check
description: How the office compares what agents say they did ("✅ applied", "PASS 35/0") with what git actually holds, and tells you in Needs you when a claim has nothing behind it - a model change that never reached main, a committed result that shows failures, evidence kept only in a git-ignored folder.
weight: 3.43
---

Agents write down what they did: a row in `docs/BUILD-LOG.md` saying an MDL script was **✅ applied**, a journal line saying a batch was applied and proven, an evidence page saying a journey passed **35/0**. The **claims check** reads those claims and compares each one with git. When git doesn't back a claim, you see it in [Needs you](command-center.md#needs-you), with the commit, the branch and the pull request.

It was built after a real project audit. An agent logged a model batch as "✅ applied", but the commit with that log line held no model files: the model change was only on a branch that hadn't been merged, and the later "PASS" journeys had been run against that branch, not main. On the same project a committed test result showed 21 passed and 14 failed while the summary said 35 passed and 0 failed. The passing run had been kept in a git-ignored folder.

Like the [review gate](review-gate.md), the claims check uses no AI and runs nothing. It reads the commits the office already fetches from `origin` (the default branch and the agents' pushed branches, from the last 14 days), off the office's main thread, and it works out the answer again only when a branch or the pull request list changes.

## What counts as a claim

A claim has to be explicit. Every pattern lives in one module (`src/shared/claims.ts`), with tests for what matches and what doesn't.

| Kind | Where it's read | Examples |
| --- | --- | --- |
| **Applied** (a model change) | BUILD-LOG gated rows whose result says applied; commit subjects; journal lines (`docs/team/*.md`); evidence pages (`*evidence*.md`); pull request titles and descriptions | `\| 2026-10-16T15:45:28+0800 \| \`06-orders-page.mdl\` \| pass \| ✅ applied \| … \|`, `applied mdlsource/3-orders/06-orders-page.mdl`, `Apply 07c: invoice page`, `Batch 07c applied and proven` |
| **PASS** (tests or journeys) | the same places | `PASS 35/0/0`, `12/12 passed`, `35 passed, 0 failed`, `journeys 7/7`, `all journeys pass`, `order-submit: PASS` |

An applied claim must name an MDL script (`*.mdl`, or a numbered apply script such as `07c-apply.sh`) or a batch (`07c`, `batch 07c`). "Review findings applied" or "theme fixes applied" are not model claims. A PASS claim must say that nothing failed: `PASS 21/14` or `6/8 passed` is not a PASS claim.

These never count as claims:

- **Plans and hedges:** "will apply", "next: apply", "to be applied once…", "should", "pending", "awaiting".
- **Negations:** "not applied", "hasn't been applied", "could not apply", "reverted", "rolled back".
- **Drafts:** "Draft …", "Drafts 08d", a commit that starts "Journal:".
- **Rows that didn't apply:** a BUILD-LOG row whose gate failed or was blocked (❌, 🚫).

## When git doesn't back a claim

| What you see | When |
| --- | --- |
| **claimed applied, no model change in that commit** | No commit that changes the model (`*.mpr`, `mprcontents/`) backs the claim, on the claim's branch or on any other. |
| **applied on *&lt;branch&gt;*, not on main** | The model change exists, but only on a branch that isn't merged. The card names the commit that holds it. |
| **claim says PASS; committed result shows *N* failed** | A result file committed for that suite (named after it, under a path the claim gives, or changed by the claim's own commit) shows failures at the tip of the branch. |
| **evidence not committed** | The claim points at its run in a folder the `.gitignore` excludes (for example `tests/e2e/artifacts/`), and no result file was committed. Nobody else can read that run. |

**How an applied claim is backed.** It needs a commit that changes the model, made at or after the apply ran, and reachable from the claim's branch. For a BUILD-LOG row, "when the apply ran" is the row's own timestamp. Words with no timestamp of their own get a day's leeway, and a pull request gets a week before it was opened. The model commit must also be connected to the claim in one of three ways: it is in the claim's own history; it names the same script or batch (`applied mdlsource/…/07c-invoice.mdl`, `Model after batch 07c`); or it is the same author's, at most a day after the claim.

The office does **not** report "applied on a branch" when the change reached main another way: a pull request from that branch was merged after the model commit (a squash merge), or the model files on main are now identical.

The check is conservative. It only flags a definite gap. When a project changes the model often, an unrelated model commit can quietly back a claim. The office accepts that rather than raise false alarms.

## The card

There is one card per project, tagged **🚦 Claims check**: *"2 claims git doesn't back: Ada, applied on office/ada-1234, not on main (and 1 more)"*. It is a warning when a claim on the default branch is affected, otherwise information. Its decision card lists each mismatch with links: the commit with the claim, the pull request it came in by, the commit that holds the model change, and the committed result file.

- **Ask *&lt;agent&gt;* to fix** sends the team's durable tell to whoever covers Management, after their current turn. The tell lists each mismatch exactly, together with its fix:
  - merge the commit that holds the model through a reviewed pull request, then re-run the journeys on main;
  - commit the model change the apply made;
  - re-run the tests on main and commit the passing result file (outside any ignored folder);
  - or correct the claim.
- **Hide** hides the card until the set of mismatches changes.

The card clears by itself once git backs the claims: after the branch is merged, or after a passing result is committed.

## What else it changes

- **Build progress.** A build-plan row that a flagged claim on the default branch names is listed as **claimed, not evidenced**. It is never counted as built on main, in the progress bar's evidence or in its tooltip.
- **Tasks.** A finished task closed on a flagged claim (the claim's pull request is the task's, or the commit names the task with `Task: tsk_…`) reads **Claimed (unverified)** and doesn't count as delivered. The mark goes once the claim is backed.

See also: [Review gate](review-gate.md), [Progress and acceptance](progress-and-acceptance.md), [Testing](testing.md).
