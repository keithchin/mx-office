---
title: mxcli
description: Mendix Labs' command-line tool - how agents read and change the Mendix model with MDL, the one-writer rule, and how the live app uses mxcli run.
weight: 2
---

**mxcli** (Mendix Labs, nightly build) lets agents read and change a Mendix app's `.mpr` model through **MDL** scripts, the Mendix Definition Language.

## Where it is

`C:\Users\<you>\agent-spike\tools\mxcli\mxcli.exe` (`agent-spike\bin\mxcli.exe` before the layout change). The office picks one mxcli for everything, however it was started (the launcher, the [desktop app](../administration/desktop-app.md) or `npm start`): the one chosen in 🚀 First-run setup, else `AGENT_OFFICE_MXCLI`, else that workspace one, and only then an `mxcli` on `PATH`. The live app, the Model tab, Testing and the wizard run it, and its folder goes first on the agents' `PATH`. `AGENT_OFFICE_LIVE_MXCLI` (or `mxcli` in `live-app.json`) still overrides it for the live app. The office prints the one it uses at start (`mxcli:`).

The live app tells mxcli which mxbuild to build with (`--mxbuild-path`): `MXBUILD_PATH` in the project's `.claude/toolkit.env`, else the office's `MXBUILD_PATH`, else, on Windows, the installed Studio Pro of the project's Mendix version (`C:\Program Files\Mendix\<version>\modeler\mxbuild.exe`), before any download mxcli cached. The Mendix CDN only publishes Linux mxbuild, so a cached one can't run on Windows; when mxcli still picks one, the live app says so and how to fix it (install that Studio Pro, or set the mxbuild path). An mxcli too old for `--mxbuild-path` only gets `MXBUILD_PATH` in its environment.

It's validated on Mendix **11.6.x**; earlier projects use **11.6.4**, and the new-project wizard now starts new ones on the newest **11.12** installed (11.12.4).

## What agents use

| Command | For |
|---|---|
| `mxcli check` | Check an MDL script before applying it |
| `mxcli exec` | Apply MDL to the model. **Lead Developer only** |
| `mxcli lint` | Lint the model |
| `mxcli report` | Best-practice report and score |
| `mxcli test` | Run unit tests (`tests/*.test.mdl`) |
| `mxcli run --local` | Build and run the app locally (the live app) |

## One writer per Mendix app

Only the **Lead Developer** applies changes to the `.mpr`. Developers draft MDL and check it; designers and testers review. This avoids two agents editing the binary model at once. To build two apps in parallel, use two projects.

## Lessons

Hard-won lessons (reserved names, MDL pitfalls, Windows limits) are kept in `.ai-context/skills/mxcli-field-lessons/SKILL.md` in each project. Leads add to it when they're benched.

## The live app

The **🌐 Live app** tab runs `mxcli run --local` on a separate clone of `main`. See [Live app](../using-the-office/live-app.md) and [Live app problems](../troubleshooting/live-app.md).

## The Model tab

The **📐 Model** tab reads the app with mxcli (`project-tree`, and `describe --format elk` for microflows and nanoflows) on a copy of each commit in the office's data folder, read-only. See [Model tab](../using-the-office/model.md).
