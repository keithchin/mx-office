---
title: The two views
description: Every project as its 1D view (the Command Center, board and tabs) and its 2D Office view (the floor from above in pixel art) - what each is for and how to go between them.
weight: 3
aliases:
  - using-the-office/3d-view
---

Every project has two views. Both show the same floor, live.

| View | Address | What it's for |
|---|---|---|
| 🗂️ **1D view** | `/lite?floor=<id>` | Where every project opens: the Command Center first, then the board, the agents, the team and the other tabs. Daily work. Works on a phone. |
| 🗺️ **2D Office view** | `/pixel?floor=<id>` | The floor from above in pixel art: team zones, Jeff's glass room, benched Leads on their breaks, every agent at its desk. |

## Going between them

- **Go to Office** in the 1D view's top bar opens the 2D Office view of the same project. It's the only way in: Home, the project switcher, the launcher, notifications and links all open the 1D view.
- **Return to Project** in the 2D Office view's top bar goes back to the 1D view of the same project, on its Command Center.

## The 3D and Retro views are gone

The office used to have a third and fourth view: a cartoon 3D office you walked around in, and Retro, the same world in chunky pixels. Both are removed, with three.js and everything only they used. Old addresses still work: `/`, `/index.html` and links like `/?view=3d`, `/?3d=1&view=retro` or `/?gfx=low` open the 1D view (of the project the link named, `?floor=<id>`, or the one you were last on; Home when there's none). An old link to the 3D view's docs page lands here.

## Color themes

The **🎨** button picks a theme: **Portal (Light)** and **Portal (Dark)** (the default), **Clean (Light)** and **Clean (Dark)**, **Fun**, **Fun (Dark)** and **Terminal** (black and phosphor green). It applies to both views, Home and these docs, and stays in step across your open tabs. See [Top bar & menu](../using-the-office/top-bar-and-menu.md#color-themes).
