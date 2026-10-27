---
title: Developer view
description: Developer in the top-right switch - the project for the people building it - an explorer of the app on the left, its Model preview (or the live app) in the middle, and the coordinator chat docked on the right, where you ask for changes, see where each one is and answer what the team needs. The Developer | Project Management switch at the top right of every project page goes back and forth without losing your place.
weight: 1.5
aliases: [using-the-office/app-workspace]
---

The **Developer view** (**Developer** in the **Developer | Project Management** switch at the top right of every project page, `/lite?floor=<project>&ws=dev`) shows a project the way the people building it look at it: an **explorer** of its pages, data and logic on the left, the **canvas** in the middle (the page's Model preview, drawn from the model, or the live app), and the **coordinator chat** docked on the right: the main way to ask for a change, see where each change is, answer the team's decisions and try what's done. It's a second way to look at the same project, not a second project: the same records, the same status, the same permissions as the rest of the office, which is called **Project Management** (the Overview, Board, Agents, Live app, Approvals, Settings and every other page, with the navigation).

## The switch

**Developer | Project Management** sits at the top right of every project page, in the top bar, in the same place and at the same size in both views, in Portal Light and Dark, the classic themes and on a phone (where it reads **Dev | PM**). The view you're in is the one drawn filled in.

- **Developer** opens the Developer view.
- **Project Management** goes back to the page you came from, or the Live app page.

The page doesn't reload, so you stay on the same project and the same running version. From the keyboard, Tab to the switch and press ← (Developer) or → (Project Management).

Switching changes what you see, never what you may do: every button in the Developer view goes to what the office already does, with that page's own checks (starting the app, answering a decision, cancelling a change). Anyone signed in can open it.

## What's on screen

At the top: the project's name and the canvas's two views, **Model preview** and **Live preview**. Under it, the explorer on the left, the canvas in the middle and the [coordinator chat](#the-coordinator-chat) docked on the right. On a phone the explorer is a drawer and the chat a bottom sheet.

### The canvas

**Model preview** is the default. It shows the page open in the explorer, drawn from the model at the revision the explorer reads ([The Model preview](#the-model-preview)); until you pick one, the app's own first page (one with an address first; Marketplace pages left out). Nothing on this path needs the app to be running.

**Live preview** is the running app, when you ask for it: the tab says why while nothing serves: **Live preview · build failed** after a failed build (the line over the canvas and the chat's header then say *Preview not running: the last build failed at 1a2b3c4: CE1613 … (details on the Live app page)*, with a link there), **· stopped by itself** after a crash, **· starting**, or **· not running** when it was simply stopped or never started (*it was stopped by Pat*, *the app hasn't been started yet*). While the [live app](live-app.md) runs, it's shown in the Live app page's viewer, under a line that names the **running version** (*Running version 7d3f0b1 · ready since 10:31*): the version that actually answers, never one it's still updating to. **Open in a new tab ↗** is always there. Some parts of an app only work in a tab of their own, and the office can't tell from here which, so if a page doesn't work in the canvas, open it in a new tab. Under the app are the version's [guided checks](#guided-validation).

When nothing runs there is **no frame** at all, never an empty one: the Live preview says why (*Not started*, *Starting*, *Stopped (crashed at 10:27)*), which version ran last and until when, and **Start the app**, which opens Project Management's Live app page where it's started.

### The explorer

A sidebar on the left of the canvas shows the app the way a file explorer shows a folder, in plain words. It reads the **project's repository at one revision**: by default **main's newest commit**. It never needs the app to be running, so stopping the app, a failed start or a slow restart doesn't change what you can explore.

The line under **Explorer** says which revision it reads (`main · 7d3f0b1`) and where the live app is, as information only: *Live app runs 6a1f09c, 3 commits behind main*, or *Live app isn't running (last ran 6a1f09c, main's newest)*. When the live app is on another revision, the menu there lets you read that one instead. While a change is with the team and has a candidate, the menu also offers **Candidate of DC-n (not merged) · c0ffee1**: the tree, the Model preview and Select element then read that commit on `dev/DC-n`, which isn't merged and isn't in the live preview (the menu's tooltip says so). A request made while reading it names that revision. When the candidate goes (merged, cancelled), the explorer goes back to main.

| Group | What's in it | Clicking an item |
| --- | --- | --- |
| **Pages** | The app's screens by module, with the **folders of the model** inside each module. Each page shows its own **title** (*My inspections*), with its technical name (`Module.Page`) and folder in the tooltip and in the selected item's details line. Modules from the **Marketplace** are folded into one **Marketplace modules** group; a module counts as Marketplace when the model says it came from the Marketplace (its Marketplace flag, id or version), never because of its name | The page's **Model preview (from the model, not the running app)**: drawn from the model at the revision shown, with sample data. A page click never opens the live app |
| **Data** | The kinds of records each module keeps; modules without any aren't listed | The module's data diagram, read-only, with the record picked |
| **Logic** | What the app does when something happens, in plain names, by module and folder; the tooltip names it and says whether it runs on the server or in the browser | Its step-by-step diagram, read-only |
| **Documents**, **Process map**, **Design** | The project's documents at the revision shown, Documents by team section, with how they relate (below); Process map and Design only when the project has them | The document's card |

**Counts say what they count.** A group's number is the app's own content (pages, kinds of records, logic in the app's own modules); a muted **+15** next to it is what Marketplace modules add, and the tooltip says both and the total. Modules and folders without content of that kind are left out, so they never inflate a count.

**Find…** searches the whole tree at once, folded Marketplace modules and folders you haven't opened included, by title or technical name, and documents by title or path. Select an item and its bar shows the details line, **Open in the live app** for a page with an address (only while the app runs: the one, explicit way to see a page running), **Request a change** with the item as its context (for a page: the page in the model, or the widget picked on its preview, and the revision shown; see [Select element](#select-element)), and, for admins, **Change this** where the Model page offers it. Opening an item shows it in the Model preview view; **Live preview** above the canvas goes to the app, which isn't reloaded meanwhile. Opening an item also puts it in the chat's composer as a chip ([Context chips](#context-chips)).

#### The Model preview

A page opens as its **Model preview**: the page drawn from the model at the revision the explorer reads, inside its layout, with its snippets, in a sandboxed frame. It needs neither the app nor the network, and it says plainly that it isn't the running app.

What it shows, and how it stays honest:

- **Sample data, clearly synthetic.** Values come from the attributes' names (*Jane Doe*, *24 Oct 2026*, *NLD-26-0042*); the bar says *sample data*.
- **Lists are bounded.** A list's template is drawn once per sample row: 3 rows at the top level, 2 inside another list, 1 deeper, and the rest is said (*… 2 more rows (sample)*). A page has a widget budget too: past it, what's left is one box saying how many widgets weren't drawn. A page with five levels of nested lists stays a few screens long instead of tens of thousands of pixels.
- **Layout as the app lays it out.** The layout grid's columns, Atlas's common classes (flex rows, alignment, spacing, cards, badges) and the **project's own layout classes**, read cheaply from its theme (`themesource/<module>/web/main.scss` of the app's own modules: display, grid and flex placement, gaps, padding and borders; colours stay the preview's own), so tiles, filter bars and card grids sit side by side. A gallery uses its desktop column count.
- **Conditions are read, never worked out.** A part with `Visible:` gets a small *Shown when Status is Draft* tag. Siblings that pick between cases of one value (a status chip per status) are drawn once, the first case, tagged *+3 other cases* with the others named in its tooltip. Empty-state blocks say *Empty state · shown when …*.
- **Nothing disappears silently.** A widget the preview can't draw is a labelled box with its type (*Not drawn · fileuploader*, *pluggable LanguageSelector*), its contents inside when it has any. The line under the bar lists what was left out or tagged.
- **Pop-up pages** are drawn as a dialog with their title bar over a dimmed page.
- **No claims about the running app**: not about behaviour, access rules, data or how it responds at other widths. The **Desktop / Tablet / Phone** switch only sets the frame's width.

#### Select element

**⌖ Select element** on the Model preview's bar lets you point at a widget:

- Hovering outlines a widget (every copy of it in the sample rows) with its plain label (*Save button*, *Filter card*, *“Today’s visitors” heading*).
- A click selects it. The chip above the preview shows *Today’s visitors › Check in button*, with ✕ to clear it, and **Request a change to this**, which opens the chat's composer with that chip. Without a selection the same place offers **Request a change to this page**. The chat's chip follows what you pick.
- By keyboard: **Tab** goes from widget to widget (each once), **Enter** or **Space** selects, **Esc** leaves picking and puts the focus back on the button.
- A widget inside a snippet belongs to the snippet: when other pages show it too, the chip's line says *This is in snippet Header, used on 5 pages: a change to it changes all of them.*
- The selection is kept by the widget's **name** on its page or snippet (names are unique there and survive edits; the internal id doesn't). When the preview is drawn again, at another revision or with the layout arriving, the same name is selected again; if it's gone, the chip says **no longer on this page** and a request asks about the page instead.
- Only what's drawn can be picked: the other cases of a condition and rows past the sample aren't on screen.

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

Drag the explorer's edge (or focus it and press ← →) to make it wider or narrower, and **«** collapses it to a rail of icons (**»** brings it back); both are remembered in your browser. The rail has **Find**, **Pages**, **Data**, **Logic**, **Documents**, **Process map** and **Design** (the sections the tree has) and **Show all files**, each with its name as the tooltip: a click opens the explorer at that section, its group opened and focused (Find in the search box, Show all files in the files view). Collapsing and opening read nothing again. On a phone it's a drawer: **☰ Browse the app** above the canvas opens it, and Esc or a tap beside it closes it. The tree works from the keyboard: ↑ ↓ move, → opens or goes in, ← closes or goes up, Enter opens, Home and End jump, and typing the start of a name moves to it.

#### Show all files

The **Show all files** switch (for builders and IT; remembered in your browser) swaps the business tree for the project's own files at the revision shown: folders and files, read-only, text and pictures shown in the canvas's place, big folders a few hundred rows at a time with **Show more**. File names are shown as they are. **Find…** then searches every file of that revision by path, not just the folders you opened.

Some files are **never shown**, whatever the project contains: git's own folder (`.git`), the office's data folder (`.agent-office`), environment files (`.env`, `.env.*`), keys and certificates (`*.key`, `*.pem`, `*.pfx`, `*.p12`, …), anything named `credentials*` or `secret*`, every `config.json` (the office's own holds tokens), token files and tool settings that keep tokens (`.npmrc`, `.git-credentials`, `.claude/settings.local.json`, SSH keys), and everything the project's `.gitignore` matches. The office only reads the files from the project's history at that version, never from elsewhere on the computer, and refuses any path with `..` or an absolute path.

## The coordinator chat

On the right of the Developer view is the **team-lead panel** you know from Project Management's pages, docked beside the canvas: the same agent (whoever leads the team: the Project Coordinator, a Startup team's Chief Analyst or a Solo Lead), the **same conversation** and history, Chat and Terminal. It's not a second chat. **»** folds it to a rail (**«** opens it again), as on every page; on a phone a round button opens it as a bottom sheet (✕ or Esc closes it). It shows here even if you turned the panel off for Project Management's pages in ⚙️ Settings.

### The header

Above the conversation, in a few lines:

- the project's [business status](progress-and-acceptance.md) chip (*Being built*, *Ready to try*…); when it says **Status unknown**, a note under it says why and gives one link per reason: *main's head couldn't be read* (Check the folder on Git), *the live app hasn't run since the office started* (Start the app), *milestone X isn't in the build plan* (Open Documents);
- the [revision strip](#the-revision-strip): **main @M**, **preview @S** (or *preview: not running*) and the change with the team's candidate;
- **N changes this session** (asked in the last 12 hours, or still on their way), counted by where the work is (*1 queued · 1 working · 2 implemented*), with the preview apart (*1 in the preview*, *1 held*), and each change's id with its state;
- when the project is paused, who paused it and when: *Project paused by Keith (Fri 14:02). Queued changes start when someone resumes it in Project Management (▶ Resume).*
- when the preview isn't showing the app, why: a failed build with its commit and short reason, a crash, or stopped / never started, never a bare *not running*;
- above the conversation, the lead panel's **N waiting on you** banner: the same [one count](needs-you.md#the-one-count-on-a-projects-page) as the bell and the Overview (a member sees what waits on the Project Manager apart).

### Context chips

What you select in the explorer becomes a **chip** in the composer: a page you open (📄 *My check sheets*), the widget you pick on its Model preview with Select element (*My check sheets › New check sheet button*), or another item (*Logic: Save order*). ✕ takes it off; **+ Context** puts the current selection back. **Request a change to this** anywhere in the view (the explorer's bar, the Model preview's chip bar) opens the chat, puts the chip on and focuses the box: there is no dialog in between. The old dialog is only used where there's no chat on the page.

### Ask or Request a change

Under the box, **Ask | Request a change** says what Enter does, and the line beside it says it again in words before you send (*Sends as a question (Ask)* or *Sends as a change request (DC)*, with what that means in its tooltip). **Ask** is the default. A page merely selected in the explorer leaves it on Ask: a chip only says what you're talking about. **Request a change** becomes the default only when you pick an element with **Select element**, or press a **Request a change to this** button.

- **Request a change** makes a **Developer change** (`DC-<n>`) through the one intake every entry point uses ([Change requests](#change-requests)): your words, the chip's page or widget, the **revision you were viewing** (main's head unless you picked another) and a key that makes sending again after a dropped connection the same change. It works with no lead at work and with the app stopped: the change waits in the queue. When it waits, the lead gets a short note after its turn, so it knows (it reaches the lead as its own task when it's next).
- **Ask** is a message to the lead, as on every page, with what the chip points at said first (*About: My check sheets › New check sheet button (widget btnNew on page Sheets.Overview) at revision @7d3f0b1*). It makes no change. Ask needs a lead at work.

The office doesn't guess which one you meant: the choice is yours. Once a message has gone, a line under the box says which way it went (*Sent to Alan as a question (Ask): nothing was changed or queued*, or *Sent as a change request*), and a change's message in the conversation says *Sent as: Request a change* above its receipt.

A change request that reaches a lead in the middle of other work is a note on top of it, not an instruction to stop: the lead carries on with its current task and folds the change in when it fits. When the lead says `task done` for the change, the office sends it back to the task it was on (its back-to-work nudge names that task), so a question or a small change never ends a build half way.

### What shows in the conversation

The conversation is the lead's own, with the Developer view's cards merged in by time:

- **Your request, with its receipt.** What you asked (without the context line), the chip it carried, and under it **→ DC-4 · Queued**. The receipt keeps **four facts** apart, each from its own source:
  - **Work**: where the work is (*Queued* and why, *Working*, *Working · candidate @C*, *Implemented @M*, *Needs attention*, *Abandoned*, *Cancelled*, *Superseded*);
  - **Checks**: the checks at exactly the relevant revision (the candidate, or the merge commit once merged): *Passed*, *Failed*, or **Incomplete** (none reported, a check without a verdict, or no CI: never *passed*);
  - **Preview**: *In the preview @S*, *Preview behind*, *Preview not running*, **Held: possible data impact** (with **Findings**), or *Runs main, not this candidate*;
  - **Your review**: *Looks right for @S*, *Something's wrong on @S*, or *No review yet*.

  Implemented (merged) never reads as accepted, nor as ready to try: only the preview says whether you can try it, and only your review says it looks right. The receipt also carries, when they apply, *Depends on DC-2 (not yet tried)*, commits on main *possibly related* to it (with **Confirm** / **Dismiss**), and anything that showed up after it was cancelled (*After cancellation: PR #12 merged: not counted*). Its actions sit on it: **Cancel request** (click twice), **Cancel (stops the work)** while the team has it, **Retry** when it needs attention, **Mark DC-n superseded** on a correction. In a [local-only project](../get-started/first-project.md#local-only-not-on-github), a change on a candidate also offers the Project Manager (admins) **Review and merge @abc1234**: the same confirmation and merge as the Live app tab's panel (the commit, its DC, files, checks and journeys at that commit, data impact), recording your approval of exactly that commit and merging it with `--no-ff`, so you don't have to go to Project Management. The commit is the one that actually carries the change, not whatever `dev/DC-n` holds: the office looks at `dev/DC-n`, the branch of the agent the change was handed to, a branch an agent asked to have merged for it (an escalation naming the change and a commit: *approve merge of 3e9a360 (office/carl-1)*), and branches whose commits name it. A **notes-only** branch, a **script draft** (`mdlsource/` changed but the model itself didn't, so it was never applied) and a commit with a **failed check** recorded at it are never offered. The commit an agent asked for is offered even when newer journal commits sit on top of it; otherwise the only branch with model or code work. When it isn't clear, the receipt says **Choose what to merge…**: every branch with what it is and its gate state (*✓ 2 checks passed at @abc1234*, *no checks recorded*, or why it isn't offered), nothing chosen until you pick one; with nothing that may merge it says **Why nothing to merge…**. Nothing is timed or guessed.
- **Decision needed.** Each business decision that waits on you, with its options, answered right there through the same record and path as Project Management's Approvals (Project Manager only; a question that changed meanwhile says so and sends nothing). It's still listed in Approvals.
- **Please try this.** When a change's merge is in the live preview: *Try it: …*, the version it's in, **✓ Looks right** and **Something's wrong**. **Looks right** keeps your review of that exact version (a mark, like a guided check's) and accepts nothing. **Something's wrong** asks what went wrong and sends it as a **correction**: a new change, linked to the one you tried.

### When nobody leads the team

With no lead at work (none hired, or benched), the chat still shows the cards and takes **Request a change**: the change is kept and waits in the queue until the team is started in Project Management. **Ask** is off until there's a lead.

### What moved to Project Management

The Developer view used to have five sections and a status panel. Their lists live in Project Management now, and old links land there:

| Was | Now |
| --- | --- |
| **Requirements** (`?tab=requirements`) | [Documents](deliverables.md) (the brief is there) |
| **Decisions** (`?tab=decisions`) and its Requests list | **Approvals** (decisions and the Developer changes in flight), and inline in the chat |
| **Review** (`?tab=review`) | **Testing**; the guided checks of the running version are under the Live preview |
| **Release** (`?tab=release`) | The Overview's progress bar: ✅ Accept and ↩ Reopen, unchanged |
| The status panel | The chat's header (status, revisions, this session's changes) |

## Change requests

**One record for every entry point.** Every way of asking for a change in the Developer view makes the same record, a Developer change (`DC-<n>`), through the same intake:

- the chat's **Request a change** (with the chip: the page or widget, the revision viewed);
- the dialog, where there's no chat on the page;
- a guided check's **Something's wrong** (with the check and the version);
- a **Please try this** card's **Something's wrong** (a correction linked to the change tried).

The Model page's **Change this** (Project Manager only, checked by the office) still goes straight to the member you choose, when you choose, but it now gets a **request id** too: a linked `DC-<n>` whose alias is its `MCR-<n>` (*✎ Ada has the change request MCR-3 (request DC-9)*). Its references carry entities, attributes, microflows and nanoflows as well as pages; associations, enumerations and constants are named in its own record only. It's linked, not queued: it doesn't wait for the Developer view's one change at a time. Requests made before Developer changes existed (a `CR-<n>`, an `MCR-<n>`) were linked the same way, once, by an append-only pass: their old ids and history are kept exactly as they were, and they show *Also known as CR-2*.

What a request is about is taken from the screen, never typed: **what it points at in the model** (the page, or the page and the widget picked on it: its name, its type and, as a hint only, its internal id), the chip (*Today’s visitors › Check in button*), the **revision you were viewing** (*main @7d3f0b1*) and, for a widget in a shared snippet, how many pages show it, plus the page and version of the live app when it runs. It works with the app stopped. The office checks that page and widget again by name when the change starts.

Each one becomes a **Developer change**, numbered `DC-<n>`, kept by the office at once (it survives an office restart, and sending again after a dropped connection never makes a second one). The office also notes the **source revision**: main's head when you asked. Then:

- **One change is worked on at a time** in each project. If nothing else is with the team and the team can take it, the change goes to the team lead (whoever leads the team on its shape: the Project Coordinator, a Startup team's Chief Analyst or a Solo Lead; the analyst when the lead isn't at work) as a task with a task id, after the lead's current turn. The task asks the lead to do the work on its own branch, `dev/DC-<n>`, and keep the task's `Task:` line on the PR.
- **Otherwise it waits in the queue, and says why**: another change is with the team; no team lead is at work; the project is paused; the team's daily spend cap is reached; the lead is asleep; the change with the team is merged but **held for possible data impact** (it keeps its turn until the hold is approved or cleared). It starts by itself when that changes, and the next queued change starts when the one before it is **implemented**, cancelled, superseded or otherwise settled. Nobody having tried an earlier change never holds the next one back.
- **Corrections go first.** A correction (a *Something's wrong*, linked to the change it corrects) goes to the front of the queue; an admin can turn that off (`POST /api/dev-changes/policy`).
- **Overlap is said.** When a queued change points at the same page, flow or data as an earlier change nobody has tried yet (no *Looks right*), it says **Depends on DC-k (not yet tried)** and goes ahead anyway. An admin can make such changes wait for that review instead (the same policy).
- **Just before it starts, the office checks what it's about is still there.** When a request points at a page or a widget of the model and that's gone at main's head, the change is marked **Needs clarification** and isn't started; the next one goes.
- A change that hasn't started has **Cancel request** (click it twice). One with the team has **Cancel (stops the work)**: the office first stops or isolates the worker (a message about it still waiting is taken back; a lead in the middle of a turn is stopped, its session kept, as ⏸ Pause project does; one between turns is told), marks its task cancelled and flags an open PR with a comment (nothing is closed or deleted), and only then lets the next change start. Anything that shows up for it afterwards (a new head on `dev/DC-n`, its PR merged) is shown as *after cancellation: not counted*: it never settles the change or moves the queue. Both are for whoever asked for it and for admins, and recorded in the audit log. A merged change can't be cancelled: ask for a correction.
- **A change never stays active forever.** A PR closed without merging, with the team saying the task is done, settles it as **Abandoned**. When the worker that had it has left the project and there's no PR, it says **Needs attention**, with **Cancel** and **Retry** (hand it to the lead again, from the front of the queue). A correction can mark the change it corrects **Superseded**: **Mark DC-n superseded** on the correction, by a person (whoever asked either, or an admin).

Project Management's **Approvals** shows the same changes (the one with the team and the queue behind it), with the same four facts and actions: it's one record, not a copy.

Each change shows its state, worked out each time from what the office already knows (its task, the PR list, the running app), never stored on its own:

| Work | When |
| --- | --- |
| **Queued** | It waits its turn; the line under it says what for, and its place in the queue |
| **Working** | The team lead has it; nothing saved on its branch yet |
| **Working · candidate @C** | The newest work seen on `dev/DC-<n>` (or on a PR with its `Task:` line), commit C. Not merged: the live preview runs main, not this |
| **Implemented @M** | Merged into main as commit M: its PR's merge commit, or (a project without GitHub PRs) the commit on main that brought the candidate in, found by git. Not accepted, and not necessarily in the preview: the Preview fact says |
| **Needs attention** | The worker that had it left the project and there's no PR: Cancel or Retry |
| **Abandoned** | Its PR was closed without merging and the team says the task is done |
| **Needs clarification** | The page or widget it pointed at isn't in the app any more: ask again, or cancel it |
| **Cancelled** | Cancelled before it started, cancelled while the team had it (its worker stopped first), or the team cancelled its task |
| **Superseded** | A correction replaced it, marked by a person |
| **Candidate not found** | The team says it's done or set it aside, but nothing was found on its branch or on a PR with its task line. The office says so rather than guess: ask the team lead where the work is |

The **Preview** fact is apart: *In the preview @S* (the running app contains M: its **Please try this** card shows), *Preview behind*, *Preview not running*, **Held: possible data impact** (the [data-impact guard](live-app.md#data-impact-hold) holds the candidate, env `candidate:DC-n`, or the live preview's update; **Findings** opens what it found and, for someone with the `data-impact approval` permission, Approve…), or *Runs main, not this candidate*.

**Commits on main that aren't the change's own** but touch what it points at (or what its candidate changed) are listed on it as **possibly related**; one whose message names the change (its `DC-<n>`, branch or `Task:` line) as **linked**. Neither makes the change implemented. Whoever asked (or an admin) can **Confirm** or **Dismiss** a possible one; that's recorded and audited.

Each new head the team pushes is a new **candidate**; earlier ones are kept. **Checks** are shown against a candidate only when they ran on exactly that commit (*2 checks passed on @c111111*); results on an earlier candidate are labelled as such, and a project without CI shows *No checks on this candidate*, never *passed*. Missing facts never move a change forward.

Requests and corrections made before the change queue keep their `CR-<n>` ids and are listed where they were made (a guided check shows its old correction as *Received*); each also has a linked `DC-<n>` (above).

### The revision strip

The chat's header shows one compact line of revisions, each a chip that copies the full commit on a click:

- **main @M**: main's head;
- **preview @S**: what the live app runs, with **behind main by N** when it's older than main, or **preview: not running**;
- **DC-n candidate @C**: while a change is with the team, its newest candidate (or *no candidate yet*).

It wraps in the narrow panel. How the revisions fit together is in [Revisions and Developer changes](../architecture/revisions-and-changes.md).

## Decisions

The Developer view shows only the decisions meant for you as the business owner: questions for the client, a stage to sign off, a design system for the app, and what the team escalated about the plan, the scope, the design, a milestone or a question only you can answer. The team's own matters (reviews, failing checks, merges, sign-ins, permissions, architecture, security, budget) stay in Project Management, which shows every decision, these included. A decision the office can't place (for example an escalation that says nothing about what it's about) stays in Project Management too.

**What to look at.** When the team names something that helps you answer (a page screenshot, the process map, a document, a walkthrough or a guided check), it's shown beside the question: a picture inline, a document or map to open in a new tab, a walkthrough or check in Project Management. Only what the team named is shown; the office never picks something because the question mentions it.

**Answering.** A decision with options shows them (the team's recommendation picked to start with); add a note, or write your answer when there are no options, and **Send decision**. It goes through the same path as Project Management's decision cards, Project Manager only, and is kept with the version of the question you saw. If the question changed meanwhile (someone else answered it), nothing is sent and the card says *This question changed since you opened it. Here's the new version.* with what it is now. Client questions and stage sign-offs open where they're answered today, with that page's own checks.

## Guided validation

Under the **Live preview**, the **guided checks** of the version running in the app are listed: the project's test journeys (`tests/e2e/*.journey.json`) as they are in that very version. Each one shows:

- its **result on exactly this version**: **Passed**, **Failed** or **Not run on this version**. A result recorded for another version never counts here; when a check hasn't run on this version but did on an earlier one, it says so in a note (*Passed on an earlier version (5e21c9d); that doesn't count for this one*);
- its **steps**, in the journey's own words, and where it starts (a page of the app, or a menu item);
- **Try it**: the live preview opens at the check's start page when the journey names one (else the app's home page);
- your **mark**, if you made one on this version, with who and when.

Under the summary (*1 of 3 passed, 1 failed, 1 not run on this version; 1 marked working*), a line counts the other automatic checks that ran on this version.

**Works as expected** and **Something's wrong** open a small dialog (✕ and Esc close it and put you back on the button) with a note, the check, the version and the page the canvas shows, captured for you as **Request a change** does. A mark is kept with the project and that version and recorded in the audit log (`validation.mark`). **Something's wrong** needs a note, and goes to the team as a **correction**: a Developer change (`DC-<n>`) through the same intake as [Request a change](#change-requests), queued like any other, with the check and the version in its words and the version as its source. It shows on its check (*Sent to the team as DC-5 · With the team*) and in the chat. With nobody leading the team it isn't refused: it waits in the queue. If the app moved on to another version while you looked, the mark is refused and nothing is kept: mark the new version.

Your marks are shown beside the status. They don't change it: the business status counts what was checked automatically on the version, and a mark is your evidence, not a passed check. When no version runs there are no guided checks to show.

## Accepting a version

Accepting stays in Project Management: the Overview's progress bar has **✅ Accept** and **↩ Reopen**, with the same route, permissions and checks as always. A **Looks right** in the chat is your review of one version; it accepts nothing.

## Addresses

Every address that worked before still opens the same page: `?tab=board`, `?tab=agents`, `?tab=live` and the rest open Project Management, as always. The Developer view adds:

- `&ws=dev` (or the older `&ws=app`): the Developer view (`&tab=app`);
- `&ws=pm` (or the older `&ws=eng`): Project Management;
- the old sections' addresses, `&tab=requirements|decisions|review|release` (with or without `ws`), open the Project Management page that has their list: Documents, Approvals, Testing and the Overview.

A reload keeps you in the Developer view, and changing project from the Developer view keeps you in it. The old address of this page, `/docs/using-the-office/app-workspace`, opens it too.

## What the team writes

What the team writes (a decision's question, a change's title) is shown as written, so it can still carry their words.
