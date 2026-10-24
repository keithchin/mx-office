---
title: Developer view
description: General › Developer - the project page first, for the people building it - the running app as the canvas with an explorer beside it, its status for that exact version, the decision that needs you and one next step. The Developer | Project Management switch at the top right of every project page goes back and forth without losing your place.
weight: 1.5
aliases: [using-the-office/app-workspace]
---

The **Developer view** (**General › Developer** in the Portal navigation, the **🧭 Developer** button in the other themes, **Developer** in the switch at the top right, `/lite?floor=<project>&ws=dev`) shows a project the way the people building it look at it: the **running app is the main thing on screen**, an explorer of its pages, data and logic beside it, and a panel that says where the work is, for which version, what needs you and what to do next. It's a second way to look at the same project, not a second project: the same records, the same status, the same permissions as the rest of the office, which is called **Project Management** (the Overview, Board, Agents, Live app, Approvals, Settings and every other page, with the navigation).

## The switch

**Developer | Project Management** sits at the top right of every project page, in the top bar, in the same place and at the same size in both views, in Portal Light and Dark, the classic themes and on a phone (where it reads **Dev | PM**). The view you're in is the one drawn filled in.

- **Developer** opens the section closest to the page you're on (Approvals → Decisions, Documents → Requirements, Testing → Review, anything else → App).
- **Project Management** goes back to the page you came from, or the one closest to the section you were on (App → Live app, Requirements → Documents, Decisions → Approvals, Review → Testing, Release → Overview).

The page doesn't reload, so you stay on the same project and the same running version. From the keyboard, Tab to the switch and press ← (Developer) or → (Project Management).

Switching changes what you see, never what you may do: every button in the Developer view goes to what the office already does, with that page's own checks (starting the app, answering a decision, accepting, changing the level). Anyone signed in can open it.

## What's on screen

At the top: the project's name with a small chip of its [business status](progress-and-acceptance.md) (*Ready to try*, *Verification incomplete*…; its tooltip says the full line), and the five **sections**. Then the canvas (or a section's page) and, on the right, the panel. On a phone the panel comes under the canvas.

### The sections

| Section | Address | What it shows |
| --- | --- | --- |
| **App** | `?tab=app` | The running app, with the panel |
| **Requirements** | `?tab=requirements` | The approved brief: its goal, the areas of the app, the open questions, and a link to the whole file in [Documents](deliverables.md) |
| **Decisions** | `?tab=decisions` | The business decisions the team needs from you, most blocking first, each with what to look at beside it when the team named something, and answered here ([Decisions](#decisions)). What else waits on someone (sign-ins, permissions, the team's own questions, other hands-on steps) is counted, with a link to Project Management. Under them, **Requests**: every change you asked for, with its state |
| **Review** | `?tab=review` | The status of the version running now and of each part of the plan, what is still to check, in plain words, and the **guided checks** of that version: each with its result on exactly that version, its steps, **Try it**, and your own mark ([Guided validation](#guided-validation)) |
| **Release** | `?tab=release` | What you'd be accepting (the version, the latest finished version it is, its status and what's missing, the guided checks, the open corrections), **Accept this version** and **Reopen** through the [acceptance](progress-and-acceptance.md#acceptance) you know, and the deployment, which stays with people: the office doesn't deploy ([Accepting from here](#accepting-from-here)) |

### The canvas

While the [live app](live-app.md) runs, it's shown here, in the Live app page's viewer, under a line that names the **running version** (*Running version 7d3f0b1 · ready since 10:31*): the version that actually answers, never one it's still updating to. **Open in a new tab ↗** is always there. Some parts of an app only work in a tab of their own (in a frame on another address some widgets can't reach the page around them), and the office can't tell from here which, so if a page doesn't work in the canvas, open it in a new tab.

When nothing runs there is **no frame** at all, never an empty one: the canvas says why (*Not started*, *Starting*, *Stopped (crashed at 10:27)*), which version ran last and until when, and **Start the app**, which opens Project Management's Live app page where it's started. Before the build, or before the app has run, the canvas also shows the brief.

### The explorer

On the App section a sidebar on the left of the canvas shows the app the way a file explorer shows a folder, in plain words and **at the running version** (so it matches what you click through in the canvas):

| Group | What's in it | Clicking an item |
| --- | --- | --- |
| **Pages** | The app's screens, by part of the app (the app's own parts first, ready-made Marketplace parts after) | A page with an address of its own opens **running in the canvas** at that address. A page that only opens from another page (it needs a record passed to it) shows a **preview with sample data** instead, with a note saying so |
| **Data** | The kinds of records each part of the app keeps | The part's data diagram (records, their fields and how they relate), read-only, with the record picked |
| **Logic** | What the app does when something happens, in plain names (*Visitor new edit*); the tooltip says whether it runs on the server or in the browser | Its step-by-step diagram, read-only |
| **Documents**, **Process map**, **Design** | The project's documents from [Documents](deliverables.md); Process map and Design only when the project has them | The Documents viewer |

**Find…** filters the tree (a page in a part you haven't opened is found too). Select an item and its bar shows **Request a change**, which opens the usual [Request a change](#change-requests) with the item as its context (*About: Page: Visitor list*), and, for admins, **Change this** where the Model page offers it (pages, records, logic). Anything opened in the canvas's place has **← Back to the running app**; the running app isn't reloaded meanwhile.

When the running version changes (a [hot reload](live-app.md) or a restart), the explorer reads the parts you have open again at the new version, without reloading the page, and marks what that update changed with a small dot. If the page on screen in the canvas changed, it's opened again on the new version, and only once that version answers. Nothing is polled.

Drag the explorer's edge (or focus it and press ← →) to make it wider or narrower, and **«** hides it to a slim strip (**»** brings it back); both are remembered in your browser. On a phone it's a drawer: **☰ Browse the app** above the canvas opens it, and Esc or a tap beside it closes it. The tree works from the keyboard: ↑ ↓ move, → opens or goes in, ← closes or goes up, Enter opens, Home and End jump, and typing the start of a name moves to it.

#### Show all files

The **Show all files** switch (for builders and IT; remembered in your browser) swaps the business tree for the project's own files at the running version: folders and files, read-only, text and pictures shown in the canvas's place, big folders a few hundred rows at a time with **Show more**. File names are shown as they are.

Some files are **never shown**, whatever the project contains: git's own folder (`.git`), the office's data folder (`.agent-office`), environment files (`.env`, `.env.*`), keys and certificates (`*.key`, `*.pem`, `*.pfx`, `*.p12`, …), anything named `credentials*` or `secret*`, every `config.json` (the office's own holds tokens), token files and tool settings that keep tokens (`.npmrc`, `.git-credentials`, `.claude/settings.local.json`, SSH keys), and everything the project's `.gitignore` matches. The office only reads the files from the project's history at that version, never from elsewhere on the computer, and refuses any path with `..` or an absolute path.

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

The Developer view shows only the decisions meant for you as the business owner: questions for the client, a stage to sign off, a design system for the app, and what the team escalated about the plan, the scope, the design, a milestone or a question only you can answer. The team's own matters (reviews, failing checks, merges, sign-ins, permissions, architecture, security, budget) stay in Project Management, which shows every decision, these included. A decision the office can't place (for example an escalation that says nothing about what it's about) stays in Project Management too.

**What to look at.** When the team names something that helps you answer (a page screenshot, the process map, a document, a walkthrough or a guided check), it's shown beside the question: a picture inline, a document or map to open in a new tab, a walkthrough or check in Project Management. Only what the team named is shown; the office never picks something because the question mentions it.

**Answering.** A decision with options shows them (the team's recommendation picked to start with); add a note, or write your answer when there are no options, and **Send decision**. It goes through the same path as Project Management's decision cards, Project Manager only, and is kept with the version of the question you saw. If the question changed meanwhile (someone else answered it), nothing is sent and the card says *This question changed since you opened it. Here's the new version.* with what it is now. Client questions and stage sign-offs open where they're answered today, with that page's own checks.

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

**Accept this version** (the Project Manager only, as in Project Management) asks the office what it would record, lists the open corrections as still open (ticked, each with who owns it; untick what you don't want noted) and an optional line for anything else, and asks you to confirm. It's the same acceptance as the progress bar's ✅ Accept: the same route, permissions and checks (the review of what's recorded, the [security baseline](security-baseline.md) at the version, the version's and the cycle's checks), nothing added or skipped. When the office refuses, the dialog says why in plain words (*This version can't be accepted yet: the security checks haven't passed on it*, with what's missing; *Something changed while you were looking … Look at it again and confirm*), and nothing is recorded. Once a version is accepted, **Reopen for the next version** starts the next one with what it's for, as **↩ Reopen** does. The full record, with every piece of evidence, stays on Project Management's acceptance record.

## Addresses

Every address that worked before still opens the same page: `?tab=board`, `?tab=agents`, `?tab=live` and the rest open Project Management, as always. The Developer view adds:

- `&ws=dev` (or the older `&ws=app`): the Developer view, on its App section, or on the section closest to the `tab` given (`&ws=dev&tab=approvals` opens Decisions);
- `&tab=app|requirements|decisions|review|release`: that section;
- `&ws=pm` (or the older `&ws=eng`): Project Management (`&ws=pm&tab=decisions` opens Approvals).

A reload keeps the section you're on, and changing project from the Developer view keeps you in it. The old address of this page, `/docs/using-the-office/app-workspace`, opens it too.

## What the team writes

What the team writes (a decision's question, a change's title) is shown as written, so it can still carry their words.
