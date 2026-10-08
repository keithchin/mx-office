---
title: Progress bar and acceptance
description: The thin line above the tabs that shows where a project is, measured stage by stage, and the acceptance record the Project Manager signs when a delivery is done.
weight: 2.5
---

Every project has a **progress bar**: a thin line between the floor's top row (its branch, budget chip and ▶ / ⏸ state) and the tabs of the 1D view, and under the top bar of the [2D view](2d-view.md). It's the same on every tab. [Home](home.md)'s project cards show a small version of it.

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
| Amber | Waiting on someone: a ✋ gate has its work done but no CONFIRMED decision yet, or a MANUAL check wants evidence |
| Red | Failing: gate-check found something wrong |
| Blue | In progress: no verdict yet, but some of the stage's deliverables exist |
| Dashed | Not started |
| Striped | Unknown: gate-check hasn't written a verdict for it |

The segment with the orange outline is the current phase: the first one that hasn't passed or been waived. The line on the right says where the project is, for example "Stage 3 · Architecture & Design · waiting on someone". After acceptance it says "v1 accepted · 2026-10-08".

The bar never shows a percentage or a count that nobody measured. If the office doesn't know something, it says *unknown*.

### Milestones

The marks on a segment are its milestones:

- **✋** is a hard gate (stages 0, 3, 4 and 7). It needs a CONFIRMED decision in `PROJECT.md`. It shows bright once confirmed, with a glow while it's waiting, and faded before the stage is reached.
- **✓**, **~** and **…** are the other rows of the decision register for that stage: confirmed, assumed, or still open.

### Hover and click

Hover over a segment to see:

- what was measured, for example "Gate: PASS" or "3 of 7 deliverables on main";
- each expected deliverable and where it is;
- the gates and decisions, with their dates;
- the days spend was booked to that stage;
- planned against actual spend, from the [budget](budget.md). If some agents can't be priced, the bar says so, because the actual spend is then only part of the cost.

Click a segment to open the right place:

- stages P to 4 open the [Project setup](command-center.md#project-setup) panel;
- stages 5 to 7 open the [deliverables](deliverables.md);
- Handover, Accepted and the line on the right open the acceptance record.

### Folding it

The **▾** at the left folds the bar into a thin coloured line, and **▸** opens it again. Your browser remembers the choice.

### When it updates

The bar doesn't poll. It refreshes when you:

- open a floor;
- see a pull request merge (main moved);
- come back to the tab after a minute away;
- accept or reopen a delivery.

## Acceptance

A delivery is accepted only when the Project Manager says so with **✅ Accept**. A merge never counts as acceptance. Each delivery has a version: **v1**, then **v1.1**, **v2** and so on.

### Accepting a delivery

Open the acceptance record (click Accepted or the line on the right of the bar), then click **✅ Accept v1…**. The dialog shows what will be recorded:

- **Scope agreed**: the BRDs on main, the build plan, and the confirmed decisions in the register.
- **Scope delivered**: the deliverables on main for each stage, and the merged pull requests. The office can't tell which BRDs have been built, so that line says *unknown*.
- **The delivery branch's head**: the commit being accepted. You can add a build or deploy reference. Without one, the record lists the gap.
- **Test evidence**: each gate verdict and when it was checked, CI on the last merged pull request and on open pull requests with failing checks, and the test plan, journeys, UI reviews and test report among the deliverables. Anything missing is shown as a gap, never as zero.
- **Documents**: each deliverable on main at the accepted commit.
- **Spend**: what was spent, by stage, against the plan and the budget. This is frozen at the moment of acceptance. The budget ledger keeps counting afterwards.

Add the **exceptions** that are still open, each with an owner. The dialog suggests gaps and failures it found (a failing gate, a missing deliverable, failing CI), and **+ owner** adds one to your list. Then tick the confirmation and click **✅ Accept**.

### Reading the record

The acceptance record lists every version, newest first. Each one shows:

- who accepted it and when;
- the commit;
- the scope, tests, documents and exceptions;
- the frozen spend.

If the delivery branch has moved past the accepted commit, or the deliverables on main have changed, the record and the bar say **Changed since acceptance**. This is worked out each time you look. The record itself stays as it was.

### Reopening

**↩ Reopen** starts the next version (v1.1 is suggested, but you can choose another) and asks what it's for. The accepted version keeps its record, and nothing is erased. The bar starts afresh for the new version: Accepted is pending again, and each stage's spend counts from the reopen.

### Who can do what

- Everyone signed in can see the bar and the record.
- Only the Project Manager (an admin) can accept or reopen. Through [Phone access](../administration/phone-access.md), these actions ask for the password again.

### Where it's kept

The records are kept in `<office data>/acceptance/<floor>.jsonl`:

- One line per accept or reopen.
- The file is append-only and hash-chained like the [Audit log](audit-log.md), so an edited or removed line shows. If the chain doesn't hold, the record view warns you.
- Each accept and reopen is in the Audit log as `acceptance.accept` or `acceptance.reopen`, under the **Acceptance** filter.
- The evidence trace (`/api/evidence/trace`) lists each record, with references to the documents and gate dashboard at the accepted commit.
