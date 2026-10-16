---
title: Clients
description: Group a client's projects and point their agents at the same curated company brain - knowledge organisation, not access control - with what each session was offered recorded, and a Needs-you card when the brain changes.
weight: 2.2
aliases: [/docs/using-the-office/portfolios, /docs/portfolios, /docs/clients]
---

A **client** (the company or organisation you build for, not a browser or an API client) groups that company's projects, so their agents are pointed at the same **company brain**: the toolkit's curated folder of that company's accepted conventions, terminology, snippets and approved components. Clients are optional. A project without a client works exactly as it always has.

> **Clients organise knowledge; they aren't access control.** A client isn't a boundary between companies. Agents on the office's computer can still read any folder by path, including other clients' brains, other projects and their `sources/` folders. The office points each project's agents at its own client's brain and records what it offered them; it does not stop an agent from reading anything else. The office says so wherever clients are shown.

## The Clients page

**Clients** is a page of its own at `/clients`, next to Projects: in the top bar's launcher (⋮⋮⋮ › **Clients**), in the search, and as **🗂️ Clients** on Home's bar in the other looks. Old links to Home's former Clients tab (`/home?tab=portfolios`) open it.

It shows every client as a card in the same grid as the Projects page: its letters, its name, how many projects it has and which, and its brain's state (*No brain connected*, *Connected @a1b2c3d*, *Connected · not versioned*, or *Brain unavailable*). **Search by client name** finds a client by its name or one of its projects' names. Admins make one with **＋ New client**: a name is enough (at most 80 characters, not the same as another client's in any case). A client can exist without a brain and get one later.

Click a client's card (or its ⋯ › **Open client**) for its page, `/clients?client=<id>`:

- its name with **Rename**, **＋ Add project** (only projects without a client are offered) and **🧠 Connect a brain** or **Disconnect brain** (admins);
- **Projects**: the client's projects drawn with the Projects page's own cards (progress, status, spend, 👁, pin and ⋯), with a warning for any project whose wiring is incomplete;
- **Company brain**: its folder, its snapshot (the brain's git commit), when and by whom it was connected, the files its `ROUTING.md` routes to (by path and size: the office keeps hashes, never the brain's text), what's left out and why, and a warning when `ROUTING.md` has more than 40 rows or is over 8 KB (it's read before every terminology or convention answer, so keep it short).

## Rename a client

**Rename** on a client's page (or ⋯ › **Rename…** on its card) opens a small dialog with the current name. Change it and press **Enter** or **Rename**; a refusal (no name, a name another client has) is said in the dialog. Only the name changes: the client's id, its projects, its company brain and the projects' wiring stay as they are, so links keep working. Hires from then on get the new name in their brain line. The rename is in the audit log as `portfolio.rename`, with the old and the new name.

## Connect a brain

**Connect a brain** asks for the brain's folder on the office's computer. The office checks it:

- it must have `README.md` and `ROUTING.md` (the toolkit's `init-company-brain.sh` makes one);
- a brain that is a **git repository** of its own gives each session a snapshot (its commit). A plain folder is allowed, and shown as **not versioned**: sessions record no snapshot, and corrections can only be noticed from the files' contents.

Then each of the client's projects is wired with the toolkit's own `wire-company-brain.sh`: a short pointer block (between `COMPANY-BRAIN` markers) in each instruction file the project has (`CLAUDE.local.md`, `CLAUDE.md`, `AGENTS.md`, and the other tools' rules files where present). The office writes the brain's path in Windows form (`C:/…`), never runs the script inside a shared toolkit pin's write paths, and always passes the contributing clone's leak-guard deny list. The office runs no harvest of lessons; the toolkit's `harvest-learnings.sh` must always be given `--to <brain>/inbox` so nothing lands in a shared pin.

The toolkit's script says nothing when it skips a file, so the office **checks the result itself**: exactly one marked block in every instruction file the project has, naming a `ROUTING.md` that exists. Anything less (a skipped file, two blocks, a brain that moved) is an error on the dialog, *wiring incomplete* on the client page, and a [Needs you](command-center.md#needs-you) card on the project with **Wire again** and **Dismiss**. The check runs again on every five-minute look.

The pointer is in the project's folder. Agents working in a worktree see it once it's committed; the office does not commit it for you. Every hire gets the brain line in its first message either way (below).

## Add a project to a client

From the client page (**＋ Add project**) or the project's **⚙️ Settings › 🗂️ Client** (**Add to client**). From a project, the dialog also has **＋ New client**: name a client that doesn't exist yet, and it's made and picked for you (with no client yet, the button reads **Add to a new client**). Before anything is added, the office shows what the project already has: its instruction files, any company brain block already in them (and the brain it names), and whether it was offered a brain before (its context manifests).

- A project can belong to one client, and only projects **without** a client can be added. A project that belongs to another client is refused: *moving a project between clients isn't available*. So is a project that was offered another client's brain before: what it was offered can't be taken back.
- If the client has a brain, the project is wired straight away and checked.

A **new project** can join a client from ✨ New project (*Advanced › Client*; admins see it even before the first client, with **＋ New client…** at the end of the list to name one there). The setup adds it after the toolkit's `init-project.sh` and the pin instructions, then wires and checks it; it never uses `init-project.sh --company`, which wires before `CLAUDE.md` and `AGENTS.md` exist. Incomplete wiring stops the step with the problems listed; **Retry** wires again.

## What each hire is told

At every hire on a project whose client has a brain, the hire's first message gets **one line** (at most 300 characters, a pointer, never the brain's content):

*Company brain Acme @a1b2c3d: before answering terminology or convention questions, read C:/Clients/acme-brain/ROUTING.md. Don't search other company folders.*

If the brain can't be read (moved, deleted, no longer a brain), the line is *Company brain unavailable this session: don't assume its conventions.* The hire goes ahead, and the client page shows *Brain unavailable* with why. Projects without a client, or whose client has no brain, get no line at all: their first message is byte-for-byte what it was before clients.

## Context manifests: what each session was offered

At each hire the office appends a **context manifest** to `<data>/context-manifests/<project>.jsonl`: the project, the role, the hire's worker id, when it was prepared, the client (as `portfolioId`), and the brain: its folder, snapshot (or none), whether it had uncommitted changes, the **routed files with their sha256 and size**, and what was **left out and why** (`inbox` candidates, `handoffs`, `proposals`, `patches`, a routed file that is missing, files nothing routes to), with the brain's status (`ok`, `unversioned` or `unavailable`).

A manifest records **what was offered, not what was read or obeyed**. Agents don't always follow the pointer (in the Phase 0 probe, one session in six read `ROUTING.md` first; the rest searched the folder). Manifests are only ever appended: corrections, withdrawals and disconnecting keep the old ones.

## When the brain changes

On every five-minute look (and at each hire) the office reads each connected brain, off the event loop, and compares what it routes now with each project's latest manifests. When a member of a project's team is working in a session prepared before a change, the project gets **one** Needs-you card:

*Company brain changed: 1 corrected, 1 withdrawn since Ada's session was prepared*

with the changed files as its evidence. *Corrected* is a routed file whose contents changed; *withdrawn* is one no longer routed (or gone); *added* is a newly routed one.

- **Rehire for a fresh session** benches each of those members (they write their handoff note first) and hires each again once benched: the fresh session gets the brain as it is now, and a new manifest.
- **Dismiss** leaves the sessions as they are, until the brain changes again.

Nothing restarts by itself. Withdrawing an item doesn't take it out of a session that already has it, or out of code and documents already written.

## Disconnect

**Disconnect** takes the company brain block out of each project's instruction files (the toolkit's `--unwire` when its script has one; otherwise the office deletes the block between its markers, leaving each file as it was before wiring). The context manifests are kept. Disconnecting can't take anything back from sessions already running, code or documents already written, or logs.

## Rollback

Clients live in one file, `<data>/portfolios.json` (its name from the feature's first version), written only once someone creates a client. With no `portfolios.json` the office behaves exactly as before clients: no brain lines, no manifests, no cards. To roll back, disconnect each brain (so the pointer blocks come out of the projects), then stop the office and delete `portfolios.json`. The `context-manifests/` folder can stay as a record, or be deleted too.

## Who can do what

Everyone signed in can see clients. Only an admin can create or rename one, add a project, connect or disconnect a brain, or press a brain card's buttons; the office checks this itself, and every change is in the [Audit log](audit-log.md). Its action names keep the feature's first name, `portfolio`: `portfolio.create`, `portfolio.rename`, `portfolio.add`, `portfolio.connect`, `portfolio.wire`, `portfolio.wire-incomplete`, `portfolio.disconnect`, `portfolio.brain-changed`, `portfolio.rehire`, `portfolio.dismiss`.
