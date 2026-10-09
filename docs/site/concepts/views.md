---
title: The four views
description: The same office drawn as 1D boards, a 2D pixel office, a 3D world and a Retro 3D world - what each is for and how to switch.
weight: 3
---

The office can be drawn four ways. They all show the same floor, live. On the 1D view **Go to Office** in the top bar opens the 2D view of the same project, and on the 2D view **Go to Board** comes back. Your browser remembers the choice.

| View | Address | Best for |
|---|---|---|
| 🗂️ **1D** | `/lite?floor=<id>` | Daily work. Tabs for the Command Center, board, workers, team and more. Works on a phone. The default. |
| 🗺️ **2D** | `/pixel?floor=<id>` | Seeing the whole floor at once in pixel art: team zones, Jeff's glass room, benched Leads on their breaks. |
| 🏢 **3D** | `/?3d=1&view=3d` | Walking around the cartoon office, with voice, the whiteboard, the rooftop bar. |
| 👾 **Retro** | `/?3d=1&view=retro` | The 3D office in chunky 16-bit pixels. Lighter on the GPU. |

## Switching views

- **Go to Office** (1D → 2D) and **Go to Board** (2D → 1D) in the flat views' top bar. The 3D and Retro views are no longer offered there.
- A link with `?view=1d|2d|3d|retro`.
- In 3D, the ☰ menu has the views too.

## Graphics quality (3D)

Add `?gfx=low`, `?gfx=medium` or `?gfx=high` (the default) to the 3D address. Low turns off antialiasing, shadows and outlines and caps the pixel ratio at 1. If 3D lags, try `?gfx=low` or the Retro view, or use 1D or 2D for daily work. See [Office and browser problems](../troubleshooting/office-and-browser.md).

## Color themes (1D, 2D and home)

The **🎨** button picks a theme: **Clean (Light)** and **Clean (Dark)** (the default), **Fun**, **Fun (Dark)** and **Terminal** (black and phosphor green). It applies to the 1D view, the 2D view, `/home` and these docs, and stays in step across your open tabs. See [Top bar & menu](../using-the-office/top-bar-and-menu.md#color-themes). The Clean pair looks like VS Code and shows no emoji.
