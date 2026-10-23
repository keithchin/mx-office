---
title: App workspace
description: General › App workspace - the project for a business owner, page first - the running app as the canvas, its status for that exact version, the decision that needs you and one next step, in business words. Switch to the Engineering view and back without losing your place.
weight: 1.5
---

The **App workspace** (**General › App workspace** in the Portal navigation, the **🧭 App workspace** button in the other themes, `/lite?floor=<project>&ws=app`) shows a project the way a business owner looks at it: the **running app is the main thing on screen**, and beside it a panel that says where the work is, for which version, what needs you and what to do next. It's a second way to look at the same project, not a second project: the same records, the same status, the same permissions as the rest of the office, which in the workspace is called the **Engineering view**.

It uses plain business words. The pages you know from the Engineering view (agents, the board, Git, pull requests, terminals, settings) are one click away, through the switch.

## What's on screen

At the top: the project's name, the five **sections** and the **App view | Engineering view** switch. Under them, the **stage** the project is at. Then the canvas (or a section's page) and, on the right, the panel. On a phone the panel comes under the canvas.

### The sections

| Section | Address | What it shows |
| --- | --- | --- |
| **App** | `?tab=app` | The running app, with the panel |
| **Requirements** | `?tab=requirements` | The approved brief: its goal, the areas of the app, the open questions, and a link to the whole file in [Documents](deliverables.md) |
| **Decisions** | `?tab=decisions` | The decisions the team needs from you, most blocking first, each with **Answer**, which opens it where it's answered today ([Needs you](needs-you.md), [Questions](questions.md)). What else waits on someone (sign-ins, permissions, other hands-on steps) is counted, with a link to the Engineering view |
| **Review** | `?tab=review` | The status of the version running now and of each part of the plan, and what is still to check, in business words |
| **Release** | `?tab=release` | The acceptance record ([Progress and acceptance](progress-and-acceptance.md)) and the deployment, which stays with people: the office doesn't deploy |

### The canvas

While the [live app](live-app.md) runs, it's shown here, in the Live app page's viewer, under a line that names the **running version** (*Running version 7d3f0b1 · ready since 10:31*): the version that actually answers, never one it's still updating to. **Open in a new tab ↗** is always there. Some parts of an app only work in a tab of their own (in a frame on another address some widgets can't reach the page around them), and the office can't tell from here which, so if a page doesn't work in the canvas, open it in a new tab.

When nothing runs there is **no frame** at all, never an empty one: the canvas says why (*Not started*, *Starting*, *Stopped (crashed at 10:27)*), which version ran last and until when, and **Start the app**, which opens the Engineering view's Live app page where it's started. Before the build, or before the app has run, the canvas also shows the brief.

### The panel

| Part | What it says | Where it comes from |
| --- | --- | --- |
| **Status** | The project's [business status](progress-and-acceptance.md) (*Ready to try*, *Verification incomplete*, *Business accepted*…) with the version it's about (*v1 · running 7d3f0b1*; click to copy the full version) and the first things still missing, in business words | The same status Home, the progress bar, the Overview, the phone and the Teams digest show |
| **Current request** | *Coming with change requests*: the change you asked for and its state will show here | Not built yet (C4) |
| **Decision needed** | The most blocking decision that waits on you, and how many there are | Needs you |
| **Progress** | Steps done of the project's steps, and the one it's on | The progress bar |
| **Finished changes** | The newest finished changes, as the team titled them | The project's finished work |
| **Next action** | One button: **Answer the decision** when one blocks the team, else by stage (**Read the brief**, **Try the app**, **Start the app**, **Check this version**, **See the release**) | |
| footer | The team's level of independence (*The team works at 2 Guided*), with **change** for admins | Settings › Team |

A part that has nothing yet says what will appear in it. Nothing in the workspace is a placeholder value.

### The stage

The stage line shows where the project is: **Before the build**, **Building**, **Business validation**, **Accepted** or **Released** (and **Awaiting approval**, only for a project under an approval policy). The office works it out from what it already knows: the business status, and on a toolkit project the stage before the build. Nothing new is stored. Click another stage to read what the workspace shows at that stage. The page keeps showing the project as it is now, and **Back to …** returns.

## Switching views

**Engineering view** opens the same project in the rest of the office. The page doesn't reload, so you stay on the same project and the same running version. You land on the page you came from, or the one closest to the section you were on (App → Live app, Requirements → Documents, Decisions → Approvals, Review → Testing, Release → Overview). **General › App workspace** brings you back.

Switching changes what you see, never what you may do: every button in the workspace goes to what the office already does, with that page's own checks (starting the app, answering a decision, accepting, changing the level). Anyone signed in can open the workspace.

## Addresses

Every address that worked before still opens the same page: `?tab=board`, `?tab=agents`, `?tab=live` and the rest open the Engineering view, as always. The workspace adds:

- `&ws=app`: the App workspace, on its App section, or on the section closest to the `tab` given (`&ws=app&tab=approvals` opens Decisions);
- `&tab=app|requirements|decisions|review|release`: that section;
- `&ws=eng`: the Engineering view (`&ws=eng&tab=decisions` opens Approvals).

A reload keeps the section you're on, and changing project from the workspace keeps you in it.

## What's coming

The workspace is the first slice of the App workspace proposal. **Change requests** (asking for a change from here, each with its state, and decisions shown beside the drawing or test result they're about) and **guided validation** (the scenarios to try on a version, findings, and accepting from here) come next. Their places are marked *Coming with change requests* and *Coming with guided validation*. Until then, accept a version on the Engineering view's progress bar.

What the team writes (a decision's question, a change's title) is shown as written, so it can still carry their words.
