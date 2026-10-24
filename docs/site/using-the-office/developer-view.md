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

At the top: the project's name with a small chip of its [business status](progress-and-acceptance.md) (*Ready to try*, *Verification incomplete*…; its tooltip says the full line), the [revision strip](#the-revision-strip) (main, the live preview, the change with the team), and the five **sections**. Then the canvas (or a section's page) and, on the right, the panel. On a phone the panel comes under the canvas.

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

On the App section a sidebar on the left of the canvas shows the app the way a file explorer shows a folder, in plain words. It reads the **project's repository at one revision**: by default **main's newest commit**. It never needs the app to be running, so stopping the app, a failed start or a slow restart doesn't change what you can explore.

The line under **Explorer** says which revision it reads (`main · 7d3f0b1`) and where the live app is, as information only: *Live app runs 6a1f09c, 3 commits behind main*, or *Live app isn't running (last ran 6a1f09c, main's newest)*. When the live app is on another revision, the menu there lets you read that one instead.

| Group | What's in it | Clicking an item |
| --- | --- | --- |
| **Pages** | The app's screens by module, with the **folders of the model** inside each module. Each page shows its own **title** (*My inspections*), with its technical name (`Module.Page`) and folder in the tooltip and in the selected item's details line. Modules from the **Marketplace** are folded into one **Marketplace modules** group; a module counts as Marketplace when the model says it came from the Marketplace (its Marketplace flag, id or version), never because of its name | The page's **Model preview (from the model, not the running app)**: drawn from the model at the revision shown, with sample data. A page click never opens the live app |
| **Data** | The kinds of records each module keeps; modules without any aren't listed | The module's data diagram, read-only, with the record picked |
| **Logic** | What the app does when something happens, in plain names, by module and folder; the tooltip names it and says whether it runs on the server or in the browser | Its step-by-step diagram, read-only |
| **Documents**, **Process map**, **Design** | The project's documents at the revision shown, Documents by team section, with how they relate (below); Process map and Design only when the project has them | The document's card |

**Counts say what they count.** A group's number is the app's own content (pages, kinds of records, logic in the app's own modules); a muted **+15** next to it is what Marketplace modules add, and the tooltip says both and the total. Modules and folders without content of that kind are left out, so they never inflate a count.

**Find…** searches the whole tree at once, folded Marketplace modules and folders you haven't opened included, by title or technical name, and documents by title or path. Select an item and its bar shows the details line, **Open in the live app** for a page with an address (only while the app runs: the one, explicit way to see a page running), **Request a change** with the item as its context (*About: Page: Visitor list*), and, for admins, **Change this** where the Model page offers it. Anything opened in the canvas's place has **← Close** (**← Back to the live app** while it runs); the live app isn't reloaded meanwhile.

**When main moves.** Main's newest commit is checked when the project opens, when the live app's revision changes and when you come back to the window (nothing is polled). If it moved, the tree isn't swapped under you: a note says *Main moved to 9e1c2d3 since this was read (showing 7d3f0b1)* with **Show it**, which reads the new revision, keeps what you had open and marks what changed with a small dot.

**When the model can't be read** at a revision (no Mendix project in that commit, a commit the repository doesn't have), the explorer says so specifically: *Couldn't read the model at abc1234: …*. That answer isn't kept, so the next look tries again.

#### Documents and how they relate

The documents come from git at the revision shown, never from the project folder on disk, and every card names that revision (*From the repository at 7d3f0b1*). Each file shows the **last commit that touched it at that revision**: date, author and commit. A file's time on disk is never used, because a checkout resets it.

Every document is in one entry, and the card says how it relates to others:

| Relationship | When | How it shows |
| --- | --- | --- |
| **Versions of the same document** | The same name in the same folder and of the same kind once a version, date or round is taken off (`brand-v1.md` and `brand-v2.md`, `gate-check-2026-10-16.md` and `-18.md`), files named only by a date (`standups/2026-10-23.md`), or a file git renamed | One entry with every version, listed by what the names say |
| **Other representations** | The same document in two formats (`blueprint.md` and `blueprint.html`), and the storyboard frame, wireframe and prototype route of the same screen (by name and `PAGE-MAP.tsv`), the storyboard and the prototype of the whole app | Side by side, each labelled; none hides another |
| **Supporting files** | Design tokens and stylesheets, the page map, and images and files a document links in its own text | Listed on the documents that use them, and still entries of their own |
| **Related documents** | BRD source data and the BRD report, the knowledge base and its extraction report, a dated review report and that day's captures, documents that link each other | Links between the entries |
| **Review rounds** | Screenshots in dated folders (`ui-reviews/shots/2026-10-18-r2/`) | One entry with every round, newest name first |
| **No known relationship** | Anything else | Its own entry, findable like any other |

**What's never inferred.** No document is called newer, older, outdated or replaced because of its date or its format. A prototype doesn't replace the wireframes, an HTML report doesn't hide its BRD source data, and design tokens stay listed.

**Status** (*draft*, *approved*, *current*) is a badge that names its source, shown only where one exists:
- the document's own front matter, Status line or status tag;
- the toolkit's *DRAFT —* banner, or *draft* in the file name;
- `PAGE-MAP.tsv`, which marks the wireframe a page is mapped to as current;
- an acceptance record that cites the file.

A newer date never makes a document approved.

Drag the explorer's edge (or focus it and press ← →) to make it wider or narrower, and **«** hides it to a slim strip (**»** brings it back); both are remembered in your browser. On a phone it's a drawer: **☰ Browse the app** above the canvas opens it, and Esc or a tap beside it closes it. The tree works from the keyboard: ↑ ↓ move, → opens or goes in, ← closes or goes up, Enter opens, Home and End jump, and typing the start of a name moves to it.

#### Show all files

The **Show all files** switch (for builders and IT; remembered in your browser) swaps the business tree for the project's own files at the revision shown: folders and files, read-only, text and pictures shown in the canvas's place, big folders a few hundred rows at a time with **Show more**. File names are shown as they are. **Find…** then searches every file of that revision by path, not just the folders you opened.

Some files are **never shown**, whatever the project contains: git's own folder (`.git`), the office's data folder (`.agent-office`), environment files (`.env`, `.env.*`), keys and certificates (`*.key`, `*.pem`, `*.pfx`, `*.p12`, …), anything named `credentials*` or `secret*`, every `config.json` (the office's own holds tokens), token files and tool settings that keep tokens (`.npmrc`, `.git-credentials`, `.claude/settings.local.json`, SSH keys), and everything the project's `.gitignore` matches. The office only reads the files from the project's history at that version, never from elsewhere on the computer, and refuses any path with `..` or an absolute path.

### The panel

| Part | What it says | Where it comes from |
| --- | --- | --- |
| **Status** | The project's [business status](progress-and-acceptance.md) (*Ready to try*, *Verification incomplete*, *Business accepted*…) with the version it's about (*v1 · running 7d3f0b1*; click to copy the full version) and the first things still missing, in business words | The same status Home, the progress bar, the Overview, the phone and the Teams digest show |
| **Current request** | The change with the team (else the next queued one): its `DC-<n>`, its state (*Queued*, *With the team*, *On candidate @C*, *In preview*…) with why it waits or where it is, its branch, how many more are queued, and **Request a change** | [Change requests](#change-requests) |
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

**Send request** makes it a **Developer change**, numbered `DC-<n>`, kept by the office at once (it survives an office restart, and sending again after a dropped connection never makes a second one). The office also notes the **source revision**: main's head when you asked. Then:

- **One change is worked on at a time** in each project. If nothing else is with the team and the team can take it, the change goes to the team lead (whoever leads the team on its shape: the Project Coordinator, a Startup team's Chief Analyst or a Solo Lead; the analyst when the lead isn't at work) as a task with a task id, after the lead's current turn. The task asks the lead to do the work on its own branch, `dev/DC-<n>`, and keep the task's `Task:` line on the PR.
- **Otherwise it waits in the queue, and says why**: another change is with the team; no team lead is at work; the project is paused; the team's daily spend cap is reached; the lead is asleep. It starts by itself when that changes, and the next queued change starts when the one before it is merged, cancelled or set aside.
- **Just before it starts, the office checks what it's about is still there.** When a request points at a page or a widget of the model and that's gone at main's head, the change is marked **Needs clarification** and isn't started; the next one goes.
- A change that hasn't started has **Cancel request** (click it twice), for whoever asked for it and for admins. It's recorded in the audit log.

Project Management's **Approvals** shows the same changes (the one with the team and the queue behind it), with the same Cancel: it's one record, not a copy.

Each change shows its state, worked out each time from what the office already knows (its task, the PR list, the running app), never stored on its own:

| State | When |
| --- | --- |
| **Queued** | It waits its turn; the line under it says what for, and its place in the queue |
| **With the team** | The team lead has it; nothing saved on its branch yet |
| **On candidate @C** | The newest work seen on `dev/DC-<n>` (or on a PR with its `Task:` line), commit C. Not merged: the live preview runs main, not this |
| **Merged into main @M** | Its PR merged as commit M; whether the preview has it couldn't be told |
| **In preview** | The running app contains M: try it |
| **Preview behind** | M is on main, but the running app still runs an older version |
| **Preview not running** | M is on main and the app isn't running: start it on Project Management's Live app page |
| **Needs clarification** | The page or widget it pointed at isn't in the app any more: ask again, or cancel it |
| **Cancelled** | Cancelled before it started, or the team cancelled its task |
| **Candidate not found** | The team says it's done or set it aside, but nothing was found on its branch or on a PR with its task line. The office says so rather than guess: ask the team lead where the work is |

Each new head the team pushes is a new **candidate**; earlier ones are kept. **Checks** are shown against a candidate only when they ran on exactly that commit (*2 checks passed on @c111111*); results on an earlier candidate are labelled as such, and a project without CI shows *No checks on this candidate*, never *passed*. Missing facts never move a change forward.

Requests made before the change queue, and corrections from guided checks, are listed under **Earlier requests and corrections** with their old states (*Received*, *Being worked on*, *Ready to try*, *Done*, *Needs your answer*, *Stopped*).

### The revision strip

The header shows one compact line of revisions, each a chip that copies the full commit on a click:

- **main @M**: main's head;
- **preview @S**: what the live app runs, with **behind main by N** when it's older than main, or **preview: not running**;
- **DC-n candidate @C**: while a change is with the team, its newest candidate (or *no candidate yet*).

On a phone the strip takes a line of its own under the project's name. How the revisions fit together is in [Revisions and Developer changes](../architecture/revisions-and-changes.md).

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

**Works as expected** and **Something's wrong** open a small dialog (✕ and Esc close it and put you back on the button) with a note, the check, the version and the page the canvas shows, captured for you as **Request a change** does. A mark is kept with the project and that version and recorded in the audit log (`validation.mark`). **Something's wrong** needs a note, and goes to the team lead as a **correction**: a change request through the same path as [Request a change](#change-requests), with a task id, the check and the version in its words. It shows on its check (*Sent to the team as CR-5 · Being worked on*) and under **Requests** (in *Earlier requests and corrections*) with its state: corrections don't go through the change queue yet. If the request can't be made (nobody leads the team yet), nothing is kept and the dialog says why. If the app moved on to another version while you looked, the mark is refused and nothing is kept: mark the new version.

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
