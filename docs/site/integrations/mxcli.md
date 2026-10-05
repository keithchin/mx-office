---
title: mxcli
description: Mendix Labs' command-line tool - how agents read and change the Mendix model with MDL, the one-writer rule, and how the live app uses mxcli run.
weight: 2
---

**mxcli** (Mendix Labs, nightly build) lets agents read and change a Mendix app's `.mpr` model through **MDL** scripts, the Mendix Definition Language.

## Where it is

`C:\Users\<you>\agent-spike\bin\mxcli.exe`. The launcher puts it on `PATH` and sets `AGENT_OFFICE_LIVE_MXCLI` to it for the live app. The wizard uses `AGENT_OFFICE_MXCLI`.

It's validated on Mendix **11.6.x**; our projects use **11.6.4**.

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

Only the **Lead Developer** applies changes to the `.mpr`. Developers draft MDL and check it; designers and testers review. This avoids two agents editing the binary model at once. To build two apps in parallel, use two floors.

## Lessons

Hard-won lessons (reserved names, MDL pitfalls, Windows limits) are kept in `.ai-context/skills/mxcli-field-lessons/SKILL.md` in each project. Leads add to it when they're benched.

## The live app

The **🌐 Live app** tab runs `mxcli run --local` on a separate clone of `main`. See [Live app](../using-the-office/live-app.md) and [Live app problems](../troubleshooting/live-app.md).
