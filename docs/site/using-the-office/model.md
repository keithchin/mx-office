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
    - An association whose connection points someone moved in Studio Pro is drawn exactly between those points.
    - An association nobody arranged (still at Studio Pro's default points, as agents and mxcli create them) leaves from the sides its two entities face each other with. Several lines on one side are spread along it. The line runs in straight horizontal and vertical segments around the other entities, and its name and multiplicity sit where they cover no entity when there's room.
    - Point at an association (or click it) to light it and its two entities and dim the rest: handy in a dense model.
    - Annotations sit where they were put.
  - A **microflow** or **nanoflow**:
    - A green start, red ends, blue activity boxes with the action's icon, orange decisions and merges.
    - Parameters are yellow, with their name and (in blue) their type underneath.
    - The variable an activity creates appears under its box.
    - Decision outcomes appear in small label boxes on the flow lines.
    - Loops, annotations and error-handler flows are drawn too.
    - Nanoflows look like microflows, as in Studio Pro. Their activity outlines have a faint purple tint so you can tell them apart.
  - A **page**, **snippet** or **layout** has three views, chosen in the bar (**Structure | Preview | MDL**; your browser remembers the choice), with a small **Live app ↗** link beside them that opens the Live app, where the page really runs:
    - **Structure** (the default): a wireframe laid out like Studio Pro's page editor. It shows layout grids in rows and columns, containers, data views, list views and data grids (with their columns), text and headings, buttons, inputs labelled with their attribute (`[TripTitle]`), snippets as purple labelled boxes, and the layout's placeholders. Widgets it doesn't know get a labelled box. Click a widget to see its properties and its lines of MDL in the details.
    - **Preview**: the page as the running app would show it, in an Atlas-like look of the office's own: inside its layout (top bar with the app's menu, or sidebar), its snippets filled in, form groups with a label and an input, drop-down, checkbox or date picker, data grids as tables with three sample rows, list views as cards, buttons in their styles, group boxes, tab containers and image placeholders. The values are samples made up from the attributes' names ("Customer workshop in Rotterdam", today's date, 1,250.00). **Desktop / Tablet / Phone** sets the width. It's drawn in a sealed frame (no scripts, nothing loaded from anywhere), from the page's MDL in about a millisecond; the layout, snippets and menu it needs are read only when Preview is on screen.
    - **MDL**: the text.
  - **System Overview**: the modules and how they depend on each other, as boxes and arrows (pan, zoom and Fit as for a diagram). Each arrow points from a module to one it uses and says how many references; modules nothing uses are at the top and System at the bottom, Marketplace and platform modules dashed, modules with no dependency in a row below. Click a module for its counts and what it uses and is used by, or an arrow for the kinds of reference.
  - **Navigation**: each profile (Responsive, Phone, …) with its home page, the home page per user role, its login page and its menu as a tree; every page in it opens in the tab. **MDL** shows the profiles' MDL. A profile, its home pages and its menu entries open their profile.
  - A module's **Security**: its module roles and security matrix. **User Roles** and **Demo Users** open Project Security, a setting opens Settings.
  - Any other document (an enumeration, a constant, a module role…) shows as its MDL. JavaScript actions and page templates, which mxcli can't describe, say so.
- **As in Studio Pro / Tidy layout** (in the bar, for a domain model): **As in Studio Pro** (the default) shows the developer's layout. **Tidy layout** rearranges the entities for reading: connected entities in layers, the referenced ones above the ones that reference them, and entities without associations in a grid beside them. It changes only this view, never the model, and your browser remembers the choice. When a domain model looks unarranged (entities on an even grid and lines at the default points), the bar suggests it: *Lines overlap? Try Tidy layout*.
- **Details** (right): click an element to see what it is and does:
  - for an activity: its action, condition, variable and its lines of MDL;
  - for an entity: its attributes and associations, and its **access rules**: a matrix with a column per module role and a row per attribute and association (**RW** read and write, **R** read, **–** none), the roles' create and delete rights on top, and each rule's XPath constraint underneath. Several rules for one role add up. Many roles scroll sideways inside the panel; an entity with no rules says that only System can use it;
  - for an association: its owner, type and multiplicity.

  With nothing selected, the panel describes the document itself.

  **✕** at the panel's top hides it, so the drawing gets the whole width; **‹ Details** on the drawing's edge brings it back. **‹ Wider** widens it to 60% of the tab (**› Narrower** goes back), or drag its left edge (or focus the edge and press **← →**; double-click for the usual width). Your browser remembers both, in full screen too.

**Pan and zoom:**
- Pan: drag (one finger on a phone).
- Zoom: the mouse wheel (pinch on a phone), or the **− / + / Fit** buttons.
- Keyboard: **+**, **−** and **0** (fit) also work.

Long flows open at their start.

**Full screen:** the **Full screen** button at the end of the bar (or **F**, or **Shift+F**, with the focus in the Model tab) spreads the App Explorer, the diagram and the details over the whole window; the drawing is fitted to it. **Esc** or **Exit full screen** brings it back into the page, fitted again. It uses the browser's full screen where it can, and otherwise covers the window. Pan, zoom and Fit work as usual in it, in every theme.

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

The office reads the app straight from the floor's git history, never from Studio Pro. It reads only and never writes to the project.

**What it reads:**
- Each commit's model files come out of git one by one, as they're needed. The office never reads the floor's checkout, and it doesn't matter if Studio Pro has the project open.
- Microflows, nanoflows and domain models are drawn from the model's own files, in milliseconds, without [mxcli](../integrations/mxcli.md). Positions and sizes come from the project itself, so diagrams keep the developer's layout. Only **Tidy layout** rearranges entities, and only in your view.
- mxcli is used for the rest: the App Explorer tree, the MDL beside a diagram, documents shown as MDL (a page's Page view is drawn in your browser from that same MDL, in a millisecond or so, and only while the Page view is on screen), the System Overview, the Navigation and a module's security. The MDL panel fills in a moment after the diagram ("Reading the MDL…").

**When it reads:**
- Only while the tab is open.
- Each document is kept by its content, not by commit. A new commit on main that left a document alone shows it straight away.
- The tree is kept by the app's structure. A commit that only changed what's inside documents keeps the same tree. If the structure changed, the last tree shows at once and the new one replaces it when mxcli has it, usually within a few seconds.
- Opening a document reads the rest of its module ahead. When main moves while someone used the tab in the last 15 minutes, the office reads the new tree and the changed diagrams before anyone asks.
- A merge or a new commit on a branch is picked up a few seconds after the board or workers change.

**Where it keeps things:** in `.agent-office/model/`. `docs/` holds the answers (200 MB at most, least used first out). `mpr/` holds a small copy of each version of the `.mpr`. `work/` holds three folders mxcli reads, each moved from commit to commit by the files that differ. Older offices kept a full copy of every commit in `snap/`; that folder is removed on first use.

The tab finds mxcli the same way the [Live app](live-app.md) does: `AGENT_OFFICE_LIVE_MXCLI`, then `AGENT_OFFICE_MXCLI`, then the workspace's `tools/mxcli`, then `PATH`. Without mxcli, the tab says so.

The address keeps what's on show, so you can share it: `/lite?floor=<id>&tab=model&ref=<branch>&doc=<Module.Name>&type=microflow&changes=1` (`&zoom=100` opens at 100%).
