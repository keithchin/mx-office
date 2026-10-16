---
title: Progress bar and acceptance
description: The thin line above the tabs that shows where a project is, measured stage by stage, and the acceptance record the Project Manager signs when a delivery is done.
weight: 2.5
---

Every project has a **progress bar**: a thin line between the project's top row (its branch, budget chip and ▶ / ⏸ state) and the tabs of the 1D view, and under the top bar of the [2D view](2d-view.md). It's the same on every tab. [Home](home.md)'s project cards show a small version of it.

## What it shows

The bar has one segment per **phase**:

- The toolkit's stages, from **P Kickoff** to **7 Cutover**, without the ones the project's entry mode doesn't run. A greenfield project shows P, 0, 5 and 6. A requirements-driven project or an existing-app change shows P to 6. A migration shows every stage. If a skipped stage has work in it after all (a greenfield project that wrote a build plan), it comes back, because it still needs signing off.
- **Handover**. The office doesn't record a handover yet, so this always says *unknown*.
- **Accepted**: whether the Project Manager has accepted this version.

A project that isn't set up with the toolkit (or uses it for assurance only) has a single **Delivery** phase, marked unknown, before Handover and Accepted.

The colour of a segment comes from what the office measured:

| Colour | Meaning |
|---|---|
| Green | Passed: gate-check says PASS |
| Grey | Waived (by the entry mode, or by hand with a reason) |
| Amber | Waiting on someone: a ✋ gate has its work done but no CONFIRMED decision yet, or a MANUAL stage that is in play (every stage before it passed) wants your sign-off. A MANUAL stage that isn't in play yet (Stage 5 on a new project) is grey, *not started*: the toolkit checks it by hand once the stages before it have passed. A CONFIRMED Decisions row for it shows it done |
| Red | Failing: gate-check found something wrong |
| Blue | In progress: no verdict yet, but some of the stage's deliverables exist |
| Dashed | Not started |
| Striped | Unknown: gate-check hasn't written a verdict for it |

The segment with the orange outline is the current phase: where the work is. That is the first stage after the latest one that passed, was waived or is signed off in `PROJECT.md` (a CONFIRMED Decisions row that says it was signed off). A paperwork gap in an early stage doesn't pull a project whose build plan is signed off back to Kickoff: that gap keeps its own colour, and the office says it doesn't add up (see below). The line on the right says where the project is, for example "Stage 5 · Build". After acceptance it says "v1 accepted · 2026-10-08".

The bar never shows a percentage or a count that nobody measured. If the office doesn't know something, it says *unknown*.

### Where the stage comes from

The stage is the office's own, never just what a file says. `PROJECT.md`'s **Current stage** line and the committed gate dashboard (`index.html`) are written only when someone runs the toolkit's gate-check, so they go out of date as soon as a later sign-off merges. Instead, whenever the project's default branch moves (the office fetches it every minute and a half or so), the office runs the project's pinned toolkit gate-check itself, on a temporary checkout of that branch that it deletes afterwards. It never writes to the project's folder or the agents' worktrees, and never commits. It keeps the result for that commit, so nothing runs again until the branch moves (or an admin presses **🔄 Re-check gates**). At most one check runs per project, a couple across the office, and each is given up on after five minutes.

Under the bar, a line says how fresh that is:

- *checked on main @abc1234, 3 min ago*: the office's check of the branch's latest commit;
- *checking…*: a check is running now (the bar looks again shortly);
- *couldn't check at 14:02: …*: the check failed. The office says why, keeps showing the last good check, marks it *stale* with its time, and tries again ten minutes later;
- *from the dashboard committed on main @abc1234; the office hasn't checked it yet*: just after the office starts, before its first check is back.

The same line, with the stage, is on the Overview's summary, the setup panel, the phone's project status and the Teams daily digest.

### When the register and gate-check disagree

The office also says when things don't add up, as an ℹ️ note under the bar and an info card in Needs you (shown, not counted as waiting on you):

- **Signed off, but gate-check still fails an earlier stage.** For example: *Stage 3 and 4 are signed off in PROJECT.md, but gate-check still reports Stage 0 failing: 'Confirmed by:' still holds the shipped placeholder*. This is usually paperwork: unanswered intake sections, the triage sign-off line. The card's **Ask the lead to fix the paperwork** tells the team lead (after their current turn, through the team's usual durable message) what gate-check reports, and asks them to fix the files, re-run gate-check and commit.
- **The stage line is out of date.** For example: *PROJECT.md's stage line is out of date: it says Stage 2; gate-check on main says Stage 5*. The office doesn't edit the project. It suggests that the lead re-runs gate-check and commits the line it rewrites.

The office raises these only from a check of the branch's latest commit, never from an old or committed dashboard. How the toolkit decides a gate doesn't change, and a MANUAL stage still asks for your sign-off only once every stage before it has passed.

### Milestones

The marks on a segment are its milestones:

- **✋** is a hard gate (stages 0, 3, 4 and 7). It needs a CONFIRMED decision in `PROJECT.md`. It shows bright once confirmed, with a glow while it's waiting, and faded before the stage is reached.
- **✓**, **~** and **…** are the other rows of the decision register for that stage: confirmed, assumed, or still open.

### Hover and click

Hover over a segment to see:

- what was measured, for example "Gate: PASS" or "3 of 7 documents on main";
- each expected deliverable and where it is;
- the gates and decisions, with their dates;
- the days spend was booked to that stage;
- planned against actual spend, from the [budget](budget.md). If some agents can't be priced, the bar says so, because the actual spend is then only part of the cost.

Click a segment to open the right place:

- stages P to 4 open the [Project setup](command-center.md#project-setup) panel;
- stages 5 to 7 open the [Documents](deliverables.md) page;
- Handover, Accepted and the line on the right open the acceptance record.

### Folding it

The **▾** at the left folds the bar into a thin coloured line, and **▸** opens it again. Your browser remembers the choice.

### When it updates

The bar doesn't poll. It refreshes when you:

- open a project;
- see a pull request merge (main moved);
- come back to the tab after a minute away;
- accept or reopen a delivery;
- (while the office's gate-check runs) once more, twenty seconds later.

## Acceptance

A delivery is accepted only when the Project Manager says so with **✅ Accept**. A merge never counts as acceptance. Each delivery has a version: **v1**, then **v1.1**, **v2** and so on.

### Accepting a delivery

Open the acceptance record (click Accepted or the line on the right of the bar), then click **✅ Accept v1…**. The dialog shows what will be recorded:

- **Scope agreed**: the BRDs on main, the build plan, and the confirmed decisions in the register.
- **Scope delivered**: the deliverables on main for each stage, and the merged pull requests. The office can't tell which BRDs have been built, so that line says *unknown*.
- **The delivery branch's head**: the commit being accepted. You can add a build or deploy reference. Without one, the record lists the gap.
- **Test evidence**: gate verdicts at the delivery commit (the dashboard the office's gate-check rendered from that very commit, with when it was checked, else the committed dashboard; Stage P can also come from the committed intake), CI on the last merged pull request and on open pull requests with failing checks, and the committed test plan, journeys, UI reviews and test report. Anything missing is shown as a gap, never as zero. PR checks describe the named PR revision, not necessarily the accepted delivery commit.
- **Documents**: each deliverable on main at the accepted commit.
- **Spend**: what was spent, by stage, against the plan and the budget. The record freezes it at the moment you confirm (agents still at work may add a little while you read). The budget ledger keeps counting afterwards.

Add the **exceptions** that are still open, each with an owner. The dialog suggests gaps and failures it found (a failing gate, a missing deliverable, failing CI), and **+ owner** adds one to your list. Then tick the confirmation and click **✅ Accept**.

Documents, the decision register and gate files are read at one immutable commit: the locally fetched `origin/<default>` revision, or committed `HEAD` when there is no remote default branch. Uncommitted files are never accepted as evidence, and a dashboard the office rendered in memory is recorded as a dated check, not as a file in Git. Acceptance does not force a network fetch, so check the displayed revision against the delivery you intend to approve.

If the delivery revision, the reviewed evidence (documents, gates, CI), the budget or plan, or the delivery cycle changes before you confirm, nothing is recorded: the dialog shows the evidence as it is now, keeps your version, notes and exceptions, and asks you to tick the confirmation again. Spend that agents add while you read, and the day's exchange rate, don't count as a change; going over the budget does. A project needs a readable commit to be accepted. Existing records remain unchanged; this safeguard does not repair historical records.

API clients must GET `/api/acceptance/draft?floor=<id>` and send its `reviewToken` with `action: "accept"` and `confirm: true` to POST `/api/acceptance`. Missing or stale tokens return HTTP 409 with `stale: true`. Tokens bind the reviewed draft and cycle; they do not replace sign-in, admin permission or same-origin checks.

### Reading the record

The acceptance record lists every version, newest first. Each one shows:

- who accepted it and when;
- the commit;
- the scope, tests, documents and exceptions;
- the frozen spend.
- the decision revisions it accepts as implemented as decided, when the acceptance names them (`decisions` on the record, set through `POST /api/acceptance`; the dialog has no picker for them yet). That is the only thing that makes a decision's task link read **Implemented as decided**: see [Task ids and linked work](../teams-and-agents/escalations.md#task-ids-and-linked-work).

If the delivery branch has moved past the accepted commit, or the deliverables on main have changed, the record and the bar say **Changed since acceptance**. This is worked out each time you look. The record itself stays as it was.

### Reopening

**↩ Reopen** starts the next version (v1.1 is suggested, but you can choose another) and asks what it's for. The accepted version keeps its record, and nothing is erased. The bar starts afresh for the new version: Accepted is pending again, and each stage's spend counts from the reopen.

### Who can do what

- Everyone signed in can see the bar and the record.
- Only the Project Manager (an admin) can accept or reopen. Through [Phone access](../administration/phone-access.md), these actions ask for the password again.

### Where it's kept

The records are kept in `<office data>/acceptance/<project>.jsonl`:

- One line per accept or reopen.
- The file is append-only and hash-chained like the [Audit log](audit-log.md), so an edited or removed line shows. If the chain doesn't hold, the record view warns you.
- Each accept and reopen is in the Audit log as `acceptance.accept` or `acceptance.reopen`, under the **Acceptance** filter.
- The record also keeps the [Testing](testing.md#acceptance) summary at the accepted commit: the coverage, result and freshness counts and the verification policy's result there. Verification policy changes and waivers (`testing.policy`, `testing.waive`) are under the same filter.
- The evidence trace (`/api/evidence/trace`) lists each record, with references to the documents and gate dashboard at the accepted commit.
