---
title: The four views
description: The same office drawn as 1D boards, a 2D pixel office, a 3D world and a Retro 3D world - what each is for and how to switch.
weight: 3
---

The office can be drawn four ways. They all show the same floor, live. Pick one in the **view dropdown** in the top bar, next to the ☰. Your browser remembers the choice.

| View | Address | Best for |
|---|---|---|
| 🗂️ **1D** | `/lite?floor=<id>` | Daily work. Tabs for the Command Center, board, workers, team and more. Works on a phone. The default. |
| 🗺️ **2D** | `/pixel?floor=<id>` | Seeing the whole floor at once in pixel art: team zones, Jeff's glass room, benched Leads on their breaks. |
| 🏢 **3D** | `/?3d=1&view=3d` | Walking around the cartoon office, with voice, the whiteboard, the rooftop bar. |
| 👾 **Retro** | `/?3d=1&view=retro` | The 3D office in chunky 16-bit pixels. Lighter on the GPU. |

## Switching views

- The **view dropdown** in the top bar (↑/↓ and Enter work too).
- A link with `?view=1d|2d|3d|retro`.
- In 3D, the ☰ menu has the views too.

## Graphics quality (3D)

Add `?gfx=low`, `?gfx=medium` or `?gfx=high` (the default) to the 3D address. Low turns off antialiasing, shadows and outlines and caps the pixel ratio at 1. If 3D lags, try `?gfx=low` or the Retro view, or use 1D or 2D for daily work. See [Office and browser problems](../troubleshooting/office-and-browser.md).

## Color themes (1D, 2D and home)

The **🎨** button steps through **Default**, **Dark** and **Terminal** (black and phosphor green). It applies to the 1D view, the 2D view, `/home` and these docs, and stays in step across your open tabs. See [Top bar & menu](../using-the-office/top-bar-and-menu.md#color-themes). Two more, **Clean light** and **Clean dark**, are coming.
