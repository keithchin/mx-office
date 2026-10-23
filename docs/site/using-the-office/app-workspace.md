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
| **Decisions** | `?tab=decisions` | The business decisions the team needs from you, most blocking first, each with what to look at beside it when the team named something, and answered here ([Decisions](#decisions)). What else waits on someone (sign-ins, permissions, the team's own questions, other hands-on steps) is counted, with a link to the Engineering view. Under them, **Requests**: every change you asked for, with its state |
| **Review** | `?tab=review` | The status of the version running now and of each part of the plan, what is still to check, in business words, and the **guided checks** of that version: each with its result on exactly that version, its steps, **Try it**, and your own mark ([Guided validation](#guided-validation)) |
| **Release** | `?tab=release` | What you'd be accepting (the version, the latest finished version it is, its status and what's missing, the guided checks, the open corrections), **Accept this version** and **Reopen** through the [acceptance](progress-and-acceptance.md#acceptance) you know, and the deployment, which stays with people: the office doesn't deploy ([Accepting from here](#accepting-from-here)) |

### The canvas

While the [live app](live-app.md) runs, it's shown here, in the Live app page's viewer, under a line that names the **running version** (*Running version 7d3f0b1 · ready since 10:31*): the version that actually answers, never one it's still updating to. **Open in a new tab ↗** is always there. Some parts of an app only work in a tab of their own (in a frame on another address some widgets can't reach the page around them), and the office can't tell from here which, so if a page doesn't work in the canvas, open it in a new tab.

When nothing runs there is **no frame** at all, never an empty one: the canvas says why (*Not started*, *Starting*, *Stopped (crashed at 10:27)*), which version ran last and until when, and **Start the app**, which opens the Engineering view's Live app page where it's started. Before the build, or before the app has run, the canvas also shows the brief.

### The panel

| Part | What it says | Where it comes from |
| --- | --- | --- |
| **Status** | The project's [business status](progress-and-acceptance.md) (*Ready to try*, *Verification incomplete*, *Business accepted*…) with the version it's about (*v1 · running 7d3f0b1*; click to copy the full version) and the first things still missing, in business words | The same status Home, the progress bar, the Overview, the phone and the Teams digest show |
| **Current request** | Your newest change request that isn't settled, its state (*Received*, *Being worked on*, *Ready to try*, *Done*, *Needs your answer*) and the version that has it, and **Request a change** | [Change requests](#change-requests) |
| **Decision needed** | The most blocking decision that waits on you, and how many there are | Needs you |
| **Progress** | Steps done of the project's steps, and the one it's on | The progress bar |
| **Finished changes** | The newest finished changes, as the team titled them | The project's finished work |
| **Next action** | One button: **Answer the decision** when one blocks the team, else by stage (**Read the brief**, **Request a change** while the app runs, **Start the app**, **Check this version**, **See the release**) | |
| footer | The team's level of independence (*The team works at 2 Guided*), with **change** for admins | Settings › Team |

A part that has nothing yet says what will appear in it. Nothing in the workspace is a placeholder value.

### The stage

The stage line shows where the project is: **Before the build**, **Building**, **Business validation**, **Accepted** or **Released** (and **Awaiting approval**, only for a project under an approval policy). The office works it out from what it already knows: the business status, and on a toolkit project the stage before the build. Nothing new is stored. Click another stage to read what the workspace shows at that stage. The page keeps showing the project as it is now, and **Back to …** returns.

## Change requests

**Request a change** (in the panel, as the next action while the app runs, and above the Requests list) asks for a change in your own words: *what should behave differently*. You don't fill in anything else. The office takes from the screen what it's about and shows it in the dialog:

- the **project**;
- the **page** of the app the canvas shows (the address it last opened; if the app moved on to another page by itself, after a click inside it, the office can't read which, and says so);
- the **version** running there.

**Send request** makes it a task for the team, like any other work the office hands out: it gets a task id at once (before anything is typed to the team), goes to the team lead (whoever leads the team on its shape: the Project Coordinator, a Startup team's Chief Analyst or a Solo Lead; the analyst when the lead isn't at work), waits for the lead's current turn to end, and is recorded in the audit log with its task id. The lead plans the work as usual. A request the office couldn't make a task for is refused, and the dialog says why (for example, nobody leads the team yet). Anyone signed in can ask, as anyone signed in can give the team work today.

Each request then shows its state, worked out from what the office already knows about its task, never stored on its own:

| State | When |
| --- | --- |
| **Received** | The task is made and waits for the lead to finish what they're doing |
| **Being worked on** | The lead has it, or the team finished it and it's on its way to the running app |
| **Ready to try** | The running version contains the change (that version is named) |
| **Done** | A version you accepted contains the change ([business status](progress-and-acceptance.md) accepted or later) |
| **Needs your answer** | The team waits on a decision of yours for it (it's under Decisions) |
| **Stopped** | The team cancelled it |

The office links the change to the request by the task id the team puts on its work (the Playbook asks for it, with `CR-<n>`). Work the team did under another task doesn't count for the request, and a change it can't place in a version keeps the request at *Being worked on*: missing facts never move a request on.

## Decisions

The App workspace shows only the decisions meant for you as the business owner: questions for the client, a stage to sign off, a design system for the app, and what the team escalated about the plan, the scope, the design, a milestone or a question only you can answer. The team's own matters (reviews, failing checks, merges, sign-ins, permissions, architecture, security, budget) stay on the Engineering view, which shows every decision, these included. A decision the office can't place (for example an escalation that says nothing about what it's about) stays on the Engineering view too.

**What to look at.** When the team names something that helps you answer (a page screenshot, the process map, a document, a walkthrough or a guided check), it's shown beside the question: a picture inline, a document or map to open in a new tab, a walkthrough or check on the Engineering view. Only what the team named is shown; the office never picks something because the question mentions it.

**Answering.** A decision with options shows them (the team's recommendation picked to start with); add a note, or write your answer when there are no options, and **Send decision**. It goes through the same path as the Engineering view's decision cards, Project Manager only, and is kept with the version of the question you saw. If the question changed meanwhile (someone else answered it), nothing is sent and the card says *This question changed since you opened it. Here's the new version.* with what it is now. Client questions and stage sign-offs open where they're answered today, with that page's own checks.

## Guided validation

The **Review** section lists the **guided checks** of the version running in the app: the project's test journeys (`tests/e2e/*.journey.json`) as they are in that very version. Each one shows:

- its **result on exactly this version**: **Passed**, **Failed** or **Not run on this version**. A result recorded for another version never counts here; when a check hasn't run on this version but did on an earlier one, it says so in a note (*Passed on an earlier version (5e21c9d); that doesn't count for this one*);
- its **steps**, in the journey's own words, and where it starts (a page of the app, or a menu item);
- **Try it**: the App section opens, with the canvas at the check's start page when the journey names one (else the app's home page);
- your **mark**, if you made one on this version, with who and when.

Under the summary (*1 of 3 passed, 1 failed, 1 not run on this version; 1 marked working*), a line counts the other automatic checks that ran on this version.

**Works as expected** and **Something's wrong** open a small dialog (✕ and Esc close it and put you back on the button) with a note, the check, the version and the page the canvas shows, captured for you as **Request a change** does. A mark is kept with the project and that version and recorded in the audit log (`validation.mark`). **Something's wrong** needs a note, and goes to the team lead as a **correction**: a change request through the same path as [Request a change](#change-requests), with a task id, the check and the version in its words. It shows on its check (*Sent to the team as CR-5 · Being worked on*) and under **Requests** with its state. If the request can't be made (nobody leads the team yet), nothing is kept and the dialog says why. If the app moved on to another version while you looked, the mark is refused and nothing is kept: mark the new version.

Your marks are shown beside the status. They don't change it: the business status counts what was checked automatically on the version, and a mark is your evidence, not a passed check. When no version runs, Review says there is nothing to try.

## Accepting from here

The **Release** section shows what you'd be accepting: the version (*v1*), the latest finished version it is (*a4776d3*), the project's status with what's still missing, the guided checks of the version on screen and the open corrections, with their state. When the app on screen runs another version than the one being accepted, it says so.

**Accept this version** (the Project Manager only, as on the Engineering view) asks the office what it would record, lists the open corrections as still open (ticked, each with who owns it; untick what you don't want noted) and an optional line for anything else, and asks you to confirm. It's the same acceptance as the progress bar's ✅ Accept: the same route, permissions and checks (the review of what's recorded, the [security baseline](security-baseline.md) at the version, the version's and the cycle's checks), nothing added or skipped. When the office refuses, the dialog says why in plain words (*This version can't be accepted yet: the security checks haven't passed on it*, with what's missing; *Something changed while you were looking … Look at it again and confirm*), and nothing is recorded. Once a version is accepted, **Reopen for the next version** starts the next one with what it's for, as **↩ Reopen** does. The full record, with every piece of evidence, stays on the Engineering view's acceptance record.

## Switching views

**Engineering view** opens the same project in the rest of the office. The page doesn't reload, so you stay on the same project and the same running version. You land on the page you came from, or the one closest to the section you were on (App → Live app, Requirements → Documents, Decisions → Approvals, Review → Testing, Release → Overview). **General › App workspace** brings you back.

Switching changes what you see, never what you may do: every button in the workspace goes to what the office already does, with that page's own checks (starting the app, answering a decision, accepting, changing the level). Anyone signed in can open the workspace.

## Addresses

Every address that worked before still opens the same page: `?tab=board`, `?tab=agents`, `?tab=live` and the rest open the Engineering view, as always. The workspace adds:

- `&ws=app`: the App workspace, on its App section, or on the section closest to the `tab` given (`&ws=app&tab=approvals` opens Decisions);
- `&tab=app|requirements|decisions|review|release`: that section;
- `&ws=eng`: the Engineering view (`&ws=eng&tab=decisions` opens Approvals).

A reload keeps the section you're on, and changing project from the workspace keeps you in it.

## What the team writes

What the team writes (a decision's question, a change's title) is shown as written, so it can still carry their words.
