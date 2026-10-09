---
title: Model tab
description: The Mendix app as Studio Pro shows it - the App Explorer, domain models, microflows and nanoflows - on main or any branch, and what a branch changed.
weight: 9.5
---

The **📐 Model** tab shows the floor's Mendix app the way Studio Pro does, without opening Studio Pro. You can look at `main`, or at any worker's branch or open pull request. It is read-only.

## The layout

- **App Explorer** (left): the app's tree, as in Studio Pro's left panel. It holds the app's settings, navigation and security, then each module with its domain model, folders and documents, each with its icon.
  - Click a folder to open or close it. Click a document to show it.
  - Type in the filter box (or press **Ctrl+F**) to find a document by name.
  - With the tree focused, **↑ ↓** move, **→ ←** open and close, and **Enter** shows the document.
- **The document** (middle), drawn like Studio Pro's editors:
  - A module's **domain model**:
    - Entities sit where the developer put them: persistable in blue, non-persistable in yellow, view in green, external in purple.
    - Each entity lists its attributes and their types, with markers for validation rules, calculated values and event handlers.
    - A specialization shows its generalization in a blue label on top.
    - Associations show their name, the **1** and **\*** multiplicity at each end, a dot on the owner's end, and an arrow towards the other end (no arrow when both own it).
    - Annotations sit where they were put.
  - A **microflow** or **nanoflow**:
    - A green start, red ends, blue activity boxes with the action's icon, orange decisions and merges.
    - Parameters are yellow, with their name and (in blue) their type underneath.
    - The variable an activity creates appears under its box.
    - Decision outcomes appear in small label boxes on the flow lines.
    - Loops, annotations and error-handler flows are drawn too.
    - Nanoflows look like microflows, as in Studio Pro. Their activity outlines have a faint purple tint so you can tell them apart.
  - Any other document (a page, an enumeration, a constant…) shows as its MDL.
- **Details** (right): click an element to see what it is and does:
  - for an activity: its action, condition, variable and its lines of MDL;
  - for an entity: its attributes and associations;
  - for an association: its owner, type and multiplicity.

  With nothing selected, the panel describes the document itself.

**Pan and zoom:**
- Pan: drag (one finger on a phone).
- Zoom: the mouse wheel (pinch on a phone), or the **− / + / Fit** buttons.
- Keyboard: **+**, **−** and **0** (fit) also work.

Long flows open at their start.

The diagram uses Studio Pro's colours: its light canvas on the light themes, its dark canvas on the dark ones (Dark, Terminal, Clean dark).

On a phone, the App Explorer is a drawer: open it with **☰ Explorer**.

## Branches and "what did the agent change"

The picker at the top left chooses what to look at: `main`, or a branch. Branches are listed with their worker and pull request when they have one.

On a branch, tick **Changes in this branch** to see what the branch changed against where it left `main`:

- **In the tree:** documents the branch added (**+**) or changed (**●**) are marked. Folders and modules with changes inside get a dot.
- **In the diagram:** elements the branch added are ringed in green, and elements it changed in orange.
- **In the details panel:** the branch's changed documents are listed (click one to show it). The panel also names anything the branch removed from the document on show.

A pull request's window has a **📐 View in Model** button that opens its branch here, with its changes marked.

## Where it comes from

The office reads the app with [mxcli](../integrations/mxcli.md), never Studio Pro. It reads only and never writes to the project.

**What it reads:**
- It reads each commit from a copy taken out of the floor's git history into the office's data folder (`.agent-office/model/`).
- So it never reads the floor's checkout, and it doesn't matter if Studio Pro has the project open.
- Positions and sizes come from the project itself, so diagrams keep the developer's layout and nothing is auto-arranged.

**When it reads:**
- Only while the tab is open.
- The first look at a commit takes a few seconds. After that, each document is kept per commit and opens straight away.
- A merge or a new commit on a branch is picked up a few seconds after the board or workers change.

The tab finds mxcli the same way the [Live app](live-app.md) does: `AGENT_OFFICE_LIVE_MXCLI`, then `AGENT_OFFICE_MXCLI`, then the workspace's `tools/mxcli`, then `PATH`. Without mxcli, the tab says so.

The address keeps what's on show, so you can share it: `/lite?floor=<id>&tab=model&ref=<branch>&doc=<Module.Name>&type=microflow&changes=1` (`&zoom=100` opens at 100%).
