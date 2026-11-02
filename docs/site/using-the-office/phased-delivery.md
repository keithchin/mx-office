---
title: Phased delivery and the Roadmap
description: Build delivered in business-outcome phases, a foundation phase first - the team proposes them at the Build Plan gate, you approve or edit them on the Roadmap, the office records every change, checks each phase's exit criteria itself and warns softly when a phase runs over its estimate.
weight: 2.6
---

A larger app does not have to be built in one go. With **phased delivery** Build (Stage 5) is cut into **phases**, each a business outcome your users can try: a **foundation** phase first (the design system, the data model and security), then one business area at a time. Each phase ends when the journeys that prove it pass on a running app, and you see its progress, spend and changes on **Project Management › Roadmap**.

A project without phases is exactly as before: the Overview says *Stage 5 · Build*, and the Roadmap only explains that it is delivered in one go.

## How it goes

1. **The team proposes the phases at the Build Plan gate (Stage 4).** From its build plan (`architecture/build-plan.md`) the team (usually the Project Coordinator) proposes the phases with the office tool `propose_phases`: for each one its name and goal, its build-plan rows, the use cases it delivers, the **journeys** that prove it, an estimate (a dollar range, and days if it likes), and whether it stops for your **checkpoint** and **publishes** to the sandbox at its end. A row and a journey belong to one phase; later phases re-run earlier journeys as regression.
2. **You approve or edit them on the Roadmap.** While the phases wait, the Roadmap opens with the gate's editor: *Sign-off: Build Plan and proposed phases*. Open a phase's rows and use **Move to** to put a row in another phase, use **Split a phase**, **Merge phases**, **+ Add phase**, and the checkpoint and publish switches. Your edits stay on the page (marked *unsaved*) until **Approve phases and start Build**, which records them with the approval as change **C-1** and starts phase 1. **Ask for changes** sends your words to the team and keeps the proposal open for its next version.
3. **Build runs phase by phase.** The office keeps an eye on the active phase's exit criteria. When they are all met, a phase with its checkpoint on stops **at its checkpoint** for you (Go starts the next phase, Stop stops Build there, and early work on the next phase with it); a phase without one is done and the next one starts by itself. The team hears each step as a message.

No project gets phases without a proposal: the office never cuts Build by itself. If the team has not proposed any, an admin can **Set up phases from the build plan** on the Roadmap: the office's first cut from the build plan's own *Phase N* headings, which you then approve or edit like a team proposal.

## Exit criteria: recorded by the office

A phase's exit criteria are never taken from an agent. The office fills them in from what it recorded itself:

- **Journeys pass on main**: each of the phase's journeys passed on a running app at a commit on main (the newest decided result among the [test runs](testing.md) the office keeps, at any of main's recent commits).
- **Model check 0 errors**: the newest [mx check](security-baseline.md) on main found no errors.
- **No open data impact**: no [data-impact hold](live-app.md#data-impact-hold) stands without an approval.

The Roadmap shows each as a chip (✓ met, ✕ failing, ○ not yet) with the journeys' own results underneath.

## Changes during Build

Phases change. Every change is recorded on the Roadmap with an id (**C-n**), who proposed it, who decided and the reason:

- **The team proposes** with `propose_phase_change`: move rows, split, merge, reorder, a switch, an estimate, or **starting the next phase early** (an *overlap*, usually its design while the current phase is built). The proposal shows on the Roadmap's *Changes to phases* card with **Accept**, **Decline** and **Edit first** (your edits on top, saved as the accepted proposal).
- **You change them** with **Edit phases**: rename, ↑ ↓, Split, Merge ↓ and the switches, with a required reason. Rows may move out of the active phase; **done phases are locked**.
- **Ask the team for a change** sends a message to the team lead; their proposal comes back to the Roadmap.

## Spend per phase: a soft warning

Spend is shared out to the phases from the [budget ledger](budget.md): spend on a day a phase ran is that phase's; when a later phase started early, the teams working on it early book to it and the rest to the earlier one. Coordination, reviews and the office's own background calls are **Not tied to a phase** (shown under the timeline), Stages P–3 are **Discovery** and Stages 6–7 **Cutover**.

Against the team's estimate each phase gets a badge: green **In range**, amber **Pace $130** when its spend so far, at the share of its rows done, reaches the top of the range, amber **Upper half** at a checkpoint, red **Over by $5** past the top. It is a badge only: nothing pauses on a phase's estimate. The **project total keeps its auto-pause** at 100 %.

## The Roadmap

**Project Management › Roadmap** (`/lite?tab=roadmap`):

- **The summary line**: delivery, how many phases are done and active, and spent against the budget with its auto-pause.
- **The timeline**: Discovery, a lane per phase and Cutover, on a date axis with the **today line**. A done phase is green, the active one filled to its share of rows done, one at its checkpoint purple, planned ones dashed; early work is hatched, and an overlap draws a dashed band across both lanes with its dates. A diamond marks a checkpoint (filled once passed). Each lane shows spend against the estimate with its badge, and whether it publishes at its end. Dates are actual for started phases; the rest follow the team's days, re-forecast from the pace of the active phase.
- **The selected phase**: its rows done, journeys, spend and dates; the soft budget note; the exit criteria; its journeys with their results; its rows; the merges on main that name its rows. Go and Stop show at a checkpoint.
- **Sandbox and report**, and **Changes to phases**: the team's open proposals and the change history.

## The Overview's phase strip

On the Overview's Progress card a phased project's Build stage widens and says the phase in progress (*5 Build · Bookings (3 of 4)*, *2 phases done · Reports design started early*). Under the stages one line gives the phase, its share of rows done, its spend against its estimate with the badge, what overlaps it and when its checkpoint is expected, over a chip per phase; a chip opens that phase on the Roadmap.

## Coming next

Phased delivery's second part adds the New project wizard's **Delivery** step (*In one go*, the default for apps under about 40 build-plan rows and 3 business areas, or *In phases* with the publish, checkpoint and budget-envelope preferences), the office-generated **checkpoint card** in Needs you (Go / Adjust / Stop with the journey captures), **publishing to the sandbox at the end of each phase** (on a Free App the office prepares the commit and the model check and you publish with one click in Studio Pro, confirmed by watching the sandbox's revision; on a licensed node through the pipeline), team proposals as Needs-you items, and the **phase-end report** in Documents.

## For agents

The tools are `propose_phases`, `propose_phase_change` and `phases_status` on the office's MCP server, or `office-workers phases` in a shell ([office-workers](../reference/office-workers-cli.md#phases)). The plan is kept in `<data>/phases/<project>.json` and every change is in the [Audit log](audit-log.md) as `phases.*`.
