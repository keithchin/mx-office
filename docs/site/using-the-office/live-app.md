---
title: Live app
description: Run the Mendix app from the project's default branch on this laptop with mxcli run --local, click through what the agents built, and read what its readiness card does and doesn't prove.
weight: 8
---

The **🌐 Live app** tab runs the project's Mendix app from its default branch (`main` on most projects; this page says main), on this laptop. **Open live app** shows it in a window of its own, and the tab's **Console** shows the runtime's log and the requests the app makes, like Studio Pro's Console.

![The live app](../images/live-app.png)

## Start, restart, stop

Only admins can start or stop it. Everyone else watches.

| Button | Does |
|---|---|
| **▶ Start** | Clones or updates the live checkout, builds and starts the app. |
| **⟳ Restart** | Stops and starts it again. |
| **■ Stop** | Stops it. |

The status pill says what is actually there: *not started* (nobody started it since the office started), *building…*, *starting…* (mxcli said the runtime is starting), *running*, *updating to 1a2b3c4…*, *running · update failed*, *running · update held* (see [Data-impact hold](#data-impact-hold)), *stopping…*, *stopped*, *build failed at 10:27*, or *stopped (crashed at 10:27)* when it was running and stopped by itself. Beside it is the **served** commit (the one actually running and answering) against main, *main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed* (or *· up to date*), and when that build came up. The same words are on the tab's chip, the Overview's **Live app** row and **View App**.

The office keeps two revisions apart: the **served** one, which counts only from the moment its build answers on its port and stops counting the moment that runtime stops, and the **target**, the commit it's getting, building or starting. While they differ, a line beside the pill says which is which:

- *Running abc1234 · updating to def5678…*: the old build still answers while main is fetched.
- *Updating to def5678… · nothing running (abc1234 stopped for the build)*: the old build was stopped so the new one can build (see [How it works](#how-it-works)).
- *Update to def5678 failed · still running abc1234*: the update failed before the old build was stopped (main couldn't be fetched into the live checkout), so the old build keeps serving. Needs you has a row for it, and the office doesn't retry that commit by itself every minute: **⟳ Restart** does.
- *Merged on main at def5678; not applied to the live preview: data-impact hold · still running abc1234*: the data-impact guard holds the new commit because it may drop or convert stored data; the old build keeps serving until someone with the data-impact approval permission approves it (see [Data-impact hold](#data-impact-hold)).
- *Update to def5678 failed · nothing running*: the new build failed after the old one was stopped. *Build of def5678 failed · nothing running* is the same for a ▶ Start.
- *Nothing running · last ran abc1234 until 10:27*: stopped, or the office restarted.

Everything that means "what's running" uses the served commit only: readiness and its test evidence, Design gallery captures, the readiness news, the desktop app's **Show here** line (*Order list · running abc1234 · shown by the desktop app*) and Home's *Live app running abc1234*. Whether the work in it is ready is the project's [business status](progress-and-acceptance.md#business-status), which the Live app chip shows after the commit (*🌐 Live app: running · abc1234 · Verification incomplete*).

A crashed app shows when it stopped, on which commit, mxcli's last lines and **⟳ Restart**; a toast says so, and Needs you has a row that Teams and phone push send once per crash.

Live apps don't start by themselves when the office starts (unless the project has **Keep warm** on, see [Faster updates](#faster-updates)), and an office restart doesn't bring back the one that ran: after a restart the tab says *not started*, no commit is called running, and nothing runs until an admin clicks **▶ Start**. What served last is kept in `<office data>/live/<project>.served.json` and shown only as *Nothing running · last ran abc1234 until 10:27*; if the office ended without shutting down, *until* is only when that build came up.

## Faster updates

Before an update touches the running app, the office looks at what changed between the served commit and the new one: the files, and the model's units (each page, microflow, domain model and so on, read straight out of git in a few hundred milliseconds at most). That picks one of three ways:

| What changed | What the office does | How long (measured, see below) |
|---|---|---|
| **No app files**: only docs, journals, evidence, `.claude/` and the like | Nothing restarts: the running build is that commit's app already. The served commit moves on, and the tab says which build it is (*build of abc1234*). | About 1 to 2 s |
| **Pages and logic**: pages, snippets, layouts, building blocks, microflows, nanoflows, rules, folders, texts, the theme | With **Hot reload** on (the default), the new files go into the running app's folder and mxcli's watch builds and applies them in place (`mxcli run --watch`). With it off, a restart. | Hot reload: about 9 to 12 s. A restart: about 45 s |
| **Anything else**: a domain model, an enumeration, security, module or project settings, navigation, constants, Java or JavaScript actions, widgets, `resources/`, or a file the office doesn't know | A restart, as before: stop, build, start. | About 45 s on a quiet machine. With hot reload on, about the same on a moderately busy one and up to about 30 s more on a very busy one (see below) |

When the office can't tell (the model can't be read, or the commits can't be compared), it restarts.

**A hot reload counts only once it worked.** The served commit moves only when mxcli says it applied the change *and* the app then answers its home page. Anything else is a hot reload that didn't confirm: the watch build failed, mxcli exited, nothing happened within 20 seconds, or the build didn't finish within 90. Then the old commit stops being called running at that moment (a failed watch build leaves the app answering *404*, so nothing serves honestly), and the office restarts the app on the new commit by itself. The tab says *hot reload didn't confirm, restarting…*, and afterwards *Updated in 48 s (restart: hot reload didn't confirm (…), so it restarted)*.

Domain-model and enumeration changes never go the hot way. On Windows, mxcli's watch fails them with a file lock (*deployment\web is being used by another process*) and leaves the app answering 404 until mxcli is restarted, so the office restarts straight away.

**Merges in a row go in once.** When main moves again while an update is running, the office doesn't start one update per merge. When the current one is done, one more update takes the newest main and says how many commits it brought in (*· 3 commits in one go*; hovering lists them). The check before the move always finishes first (the running app isn't touched until it has); its two reads, the files and the model units, run at the same time, and the commits it brings in are counted meanwhile. What's read after an update (the readiness card, the business status) runs beside the next update, never in front of it.

**Where the time goes.** Beside the buttons, the tab says how the last start or update went and why: *⚡ Updated in 9 s (hot reload)*, *⚡ Updated in 41 s (restart: domain model changed)*, *⚡ Updated in 0.8 s (no restart: no app files changed)*, *⚡ Started in 62 s (cold start)*. Hovering shows each phase: *fetch* (the new commit into the live checkout), *classify*, then for a hot reload *apply* (mxcli's watch picking the change up, building and reloading) and *first answer*, or for a restart *stop*, *build* and *runtime start*. The same line, with the phases, goes into the log (`<office data>/live/<project>.log`).

### Hot reload and Keep warm

Two settings per project, for admins, on the Live app tab beside the timing line. Each change is in the audit log.

- **Hot reload** (on by default): page and logic changes go in by hot reload, as above; data-model changes still restart. The tab says *Hot reload: on (default)* for a project nobody set, *on* or *off* for one an admin set, and admins get the switch beside it (each change is audited). A project's explicit off stays off; one that never chose, new or from before hot reload was the default, has it on. To turn it off for every project on the office, set `AGENT_OFFICE_LIVE_HOT_RELOAD=0` or `"hotReload": false` in `live-app.json`: the tab then says *off (for every project on this office)* and the switch can't turn it back on.

  A change takes effect at the next **▶ Start** or **⟳ Restart**, because mxcli has to be started with `--watch`: the first start after the office is upgraded already uses it. A running app keeps the way it started until then, and the tab says so beside the setting (*this run keeps hot reload until its next start*, *this run restarts for every change: hot reload starts with the next start*).

  **Memory.** Under `--watch`, mxcli keeps its incremental web bundler running beside the app (about 1.3 GB of the 1.5 to 2 GB a live app holds). So when the app starts with less than 2.5 GB of memory free, that run starts without `--watch` and restarts for every change instead, and the tab says why (*this run restarts for every change: only 1.8 GB of 16.0 GB memory free, and a hot-reload app needs about 2.0 GB*); the next start looks again.

  **What it still costs.** It relies on the words mxcli's watch prints (*Change detected…*, *applied via reload…*), which mxcli doesn't promise to keep: should they change, every hot try would wait 20 seconds and then restart, and after two such misses in a row the office stops trying until the next start or restart. And a restart under `--watch` starts the incremental bundler beside the runtime: about as fast as a restart without it on a moderately busy machine, up to about 30 s slower on a very busy one (below). The office can't avoid that with today's mxcli, which has no way to arm the watch after a start; it is on the list of asks for mxcli.
- **Keep warm** (off by default): the office starts the live app by itself shortly after the office starts, so nobody waits for a cold start (one to two minutes). Projects with it on start one at a time, each only when the computer has at least 2.5 GB of memory free: a running live app (mxcli, mxbuild, the Mendix runtime and the web bundler) holds about 1.5 to 2 GB, and uses up to two and a half cores while it builds. One that doesn't fit says so on its tab (*Keep warm didn't start it: 1.8 GB of 16.0 GB memory free…*); **▶ Start** still starts it. Nothing in the office stops a live app for being idle: once up, it runs until someone stops it or the office closes.

### Measured

On the office's Windows laptop (Intel i9, 64 GB, Studio Pro 11.12's mxbuild, local PostgreSQL, mxcli nightly-20261003, with other work running), the office's own update loop against a copy of a sample app (18 entities, 104 microflows, 13 pages): from the merge landing in the project's folder until the new commit serves, medians (n in brackets). *Before* is the office without this, which restarted for every update.

| Change | Before | Hot reload off | Hot reload on |
|---|---|---|---|
| Page | 47 s (3) | 45 s (2) | 12 s (5) |
| Microflow | 44 s (3) | 45 s (1) | 9 s (4) |
| Entity or attribute | 45 s (2) | 43 s (3) | 66 s (5) |
| Docs only | a restart | 1.7 s (2) | 2.5 s (2) |
| Three merges a second apart, until the last serves | 109 s (1): two restarts, the second after the next auto-refresh | 131 s (1): two restarts | 24 s (2): two hot reloads, the second taking both later merges |

Every page change's new text was in the served page bundle once the office said it served it. All 13 hot reloads confirmed, including the first after a cold start. Where a hot reload's time goes: fetch 0.5–0.9 s, classify 0.1–0.4 s, apply 6.4–11.6 s (about 3 s of that is mxcli's watch noticing the change, the rest its build and reload), first answer under 0.1 s. A restart's is almost all build (40–42 s, or 52–71 s with `--watch`). Cold starts took 78 to 212 s across the runs, with the machine's load. The three-merges row shows how much load moves a restart (45 to 63 s here); what grouping saves for certain is the wait for the next auto-refresh (up to a minute): the office without this also built only the newest main after an update, but not before its next look.

**With hot reload on by default (23 October).** The same loop and sample app, the office as it was (hot reload off by default) against the office with it on by default and no setting stored for the project, run back to back. Medians, n in brackets:

| Change | Quiet machine: off | Quiet machine: on (default) | Busy machine: off | Busy machine: on (default) |
|---|---|---|---|---|
| Page | 41 s (3) | 9 s (3) | 103 s (3) | 17 s (3) |
| Microflow | 44 s (3) | 8 s (3) | 269 s (3) | 11 s (3) |
| Entity or attribute | 39 s (2) | 35 s (2) | 91 s (2) | 85 s (2) |

The first start used hot reload with nothing set and no extra restart, and every hot reload confirmed with the page's new text in the served bundle. A data-model change was no slower with hot reload on in these runs; the 66 s against 45 s of 22 October didn't come back. mxcli alone (stop, one entity change, start, three in a row each way) shows why it varies: on a moderately busy machine a restart with `--watch` took 74 s against 82 s without, because mxcli starts its incremental bundler beside the runtime; on a very busy one 127 s against 94 s, because that bundler then competes with the runtime's start. Not clearing the last build made no difference. The office can't remove that remaining cost with today's mxcli (it has no way to arm the watch on an app that is already up), so it is on the list of asks for mxcli.

### Antivirus

A build writes thousands of small files, and real-time antivirus scanning can slow it down. The office doesn't change antivirus settings, and you shouldn't without your IT department's OK. If they agree to measure it, this is how:

1. **The folders.** The live checkout, `<office data>/live/<project>` (above all its `deployment/` and `.mxcli/` folders); mxcli's cache, `%USERPROFILE%\.mxcli` (its `mxbuild` and `runtime` folders); the project's Studio Pro, `C:\Program Files\Mendix\<version>` (read only); and the JDK the runtime runs on. Leave the office's own data folder and the project folders alone.
2. **Before.** With the antivirus as it is, start the live app and let it settle. Make five small page changes and five microflow changes on main (one merge each, a minute apart), then one entity change, and note the *⚡ Updated in …* line after each (or copy the `✔ Updated in …` lines, with their phases, from `<office data>/live/<project>.log`). Then **⟳ Restart** three times and note *Restarted in …*.
3. **After.** Have IT add exclusions for the folders in step 1 (some IT departments prefer process exclusions: `mxcli.exe`, `mxbuild.exe`, the runtime's `java.exe` and the web bundler's `node.exe`), and repeat step 2 the same way, at a similar time of day and load.
4. **Compare** the medians per kind, phase by phase: *build* and *apply* are the phases scanning slows. A difference of a few seconds is within the noise of a busy laptop. Have IT remove the exclusions again if they don't help.

## Data-impact hold

Some model changes can drop or convert data the app already stored, and the runtime applies them to the database (its schema sync) the moment it restarts on them. So before the live app applies a new commit (an update after a merge, a **⟳ Restart**, or a **▶ Start** over the database an earlier build used), the office compares the domain models at the revision the database last ran and at the new commit, read straight out of git. It holds the commit when it finds:

- a persistent entity, attribute or association that is removed, renamed or no longer stored (an entity made non-persistable, an attribute made calculated);
- an attribute type change (a string made shorter counts; a longer one doesn't), or a reference changed to a reference set;
- a changed delete behaviour;
- an enumeration value removed or renamed while a persistent attribute uses that enumeration;
- a changed generalization.

When the office can't read a model (a unit it can't decode, no project file, no `node:sqlite`), it holds as *data impact unknown* rather than guess.

While a commit is held, **nothing of it is applied**: no hot reload, no restart onto it, and **⟳ Restart** keeps the running build. The app keeps serving the commit it ran, and the tab says *running · update held* and *Merged on main at def5678; not applied to the live preview: data-impact hold · still running abc1234*. If the app was stopped, **▶ Start** builds nothing and says *start held (data impact)*. Merged on main and applied to the live preview are separate facts: the hold never reads as the preview running that commit. Needs you has a ✋ row (Teams and phone push send it once), and the tab shows a card with each finding (the unit, the element and a plain line such as *may drop data in Sales.Order.Notes*, with how many rows have data there when the database answers), what the check doesn't cover, other ways than approving (keep the attribute and deprecate it, migrate the data first, apply it in a maintenance window), and who may approve.

**Who may approve.** Approving needs the **data-impact approval** permission: office admins have it by default, and an admin can name other accounts through the policy (`POST /api/data-impact` with `action: policy`). Nobody gets it for owning or running a project. Everyone else sees the card and who can approve.

**What an approval needs.** **Approve…** asks for:

- a **recovery step**: either **Take a database dump now** (the office runs `pg_dump` of the live preview's database into `<office data>/data-impact/dumps/<project>/`, checks it with `pg_restore --list`, and records its path, size and sha256; the app keeps running meanwhile), or the explicit statement *No data to keep: I accept that data in these elements may be lost*;
- a **reason**.

The approval is bound to all four of: the environment (the live preview), the revision it runs (the starting baseline), the commit it takes, and the recovery evidence. If any of them changes (a new commit on main, a different baseline, the dump file changed or gone), the approval is void, the change is looked at again, and it holds again if it still touches data. Once approved, the live app restarts onto the commit. The hold, each dump, the approval and a voided approval are in the [audit log](audit-log.md) with all four.

**What it doesn't do.** Detection is a model diff: migration microflows, Java actions and the runtime's own schema sync aren't analysed, and the card says so. It doesn't restore a dump for you (restore one with `pg_restore` into a database of your choice), and it doesn't yet pass on mxcli's own warnings, because the office doesn't capture the output of the mxcli runs the agents make. It guards against mistakes by people and agents; it is not a security boundary against an agent that deliberately works around the office (agents run as the same Windows user).

## Is it ready?

Under the buttons, a card says whether the app is ready, from evidence only:

> **Live app: not ready for Sample check-sheet demo (Checksheet).** Has: Prerequisites (no journey evidence yet), Frame, domain and skeleton (not yet verified) (rows 4, 6–8). Missing: Save, submit and My check sheets (PR #6, open, not merged); Approval, history and demo data (PR #6, open, not merged; row 24 not built).

Then one line per milestone, tagged **Ready**, **Not verified**, **No journeys**, **Restart**, **In a PR**, **Partly** or **Not built**.

![The readiness card](../images/live-app-ready.png)

- **Milestones** are the phases of the project's build plan (`architecture/build-plan.md`, the `### Phase N — …` headings over the numbered row tables), each with the **BUILD** rows it needs; the whole plan is the last milestone, named from the plan's title.
- **Which rows are built** comes from what the team wrote as it worked, never the plan's State column (agents don't update it): commit subjects naming the row (*Row 16: sheet form page applied*, *Rows 19-21: …*) on a commit that changed build files or says applied / proven / done / PASS, merged PR titles (*rows 4-14*), and `### <date> — Row N` notes in `docs/BUILD-LOG.md`. A *Draft row 16* or *Journal: row 3* commit only mentions it.
- For the served commit (the build actually answering, never the one being built or updated to), a milestone's rows are **in the running build**, **merged to main but not in it yet** (⟳ Restart picks them up), **in a PR** (only on an unmerged branch, with its PR from GitHub's list), or **not built**.
- **Ready** means every BUILD row is in the running build **and** the milestone has at least one journey, every one of which passed against that very build: a `tests/e2e/*.journey.json` whose `requirement` names one of its rows (`build-plan row 10`), with a test-run record in **App Insights › Testing** whose tested revision is the running commit. Journeys that name no row belong to the whole plan; broken controls (`…-broken`) don't count. Built but not yet passed is *built, not yet verified*, and built with no journey at all is *built, no journey evidence yet*: neither is ever ready.
- Nothing is ready while no build serves, including while an update has stopped the old build to build the new one.

### What Ready does and doesn't prove

The card mixes evidence from different places and revisions:

- **The plan and the journeys are read at main's newest commit**, not at the commit the app runs. A journey added or retied on main after the running build counts for the running build too.
- **Test results must match the served commit** (the first 7 or more characters of the revision). Results for any other commit, including the one it's updating to, don't count.
- **A report file's tested revision is whatever the file says** (`appRevision`, `testedRevision`, or `project.gitCommit` in the toolkit's `docs/report.json`; see [Testing](testing.md#three-revisions-per-run)). The office doesn't check it against the run.
- **Ready isn't acceptance.** [Acceptance](progress-and-acceptance.md#acceptance) is a separate act on main's head; it doesn't read this card, the running commit or the walkthroughs.

The office doesn't show the running commit, the test evidence's commit and a recording's commit side by side: only the running commit against main is on the status line.

When a milestone becomes ready in the running app you get a toast, an FYI row in Needs you for a day (not counted as waiting on you), and a Teams, phone push and desktop alert, once per milestone, even across restarts of the office. A milestone told ready that the running app no longer has is said too.

The card is read again when the app starts, stops or crashes, when a fetch lands in the project's folder, and when test evidence lands; never on a timer of its own.

See also [State and sources of truth](../architecture/state-and-truth.md): where the running commit, readiness and test evidence come from, and what survives a restart.

## Walkthroughs

Videos of the app's workflows are on a page of their own, [🎬 Walkthroughs](walkthroughs.md). The office records them by itself at each passing build, against its own copy of the app (never this one, and never its database). Under the readiness card, **🎬 Walkthroughs →** leads there, and a ready milestone with a video of the running build has a **▶ Walkthrough** link that opens it.

## Main behind the work

When an agent's branch or an open PR has commits main hasn't and changes the model (`.mpr`, `mprcontents/`, `mdlsource/`), this tab and the [Model](model.md) tab show a banner: *main is 75 commits behind Sophie's branch, which has model changes (PR #6, open, not reviewed)*. The live app runs main, so it shows none of that until it merges. **View it in the Model tab** opens the Model tab, which can show the branch; **Ask Katherine to review** (admins) tells the team lead, after their turn, to have the PR reviewed per the [review gate](review-gate.md). The review state is the gate's: *reviewed by X* once a complete `Review:` by someone other than the opener is on the PR; *review not checked yet* while the office hasn't read the PR's comments, which the board reads for merged PRs only.

In a [local-only project](../get-started/first-project.md#local-only-not-on-github) there are no pull requests, so under the banner each team branch ahead of main has the Project Manager's merge: **Approve at @abc1234** (a review of exactly that head), **Ask for changes**, and **Merge into main** once its head is approved. It merges with `--no-ff` into the local main, as the office, without force, recorded and audited, and the live app follows main as usual.

## Open live app

When the app runs, **↗ Open live app** opens it in a window of its own: a browser window (or tab), or in the [desktop app](../administration/desktop-app.md) a separate *Live app* window. There the app is the page itself, so every widget works. **Copy link** copies its address.

Why not in the tab itself: inside the office's page the app would be a frame on another origin (its own port), and Mendix's pluggable widgets, such as Data grid 2, read the top window, which the browser refuses across origins. Those pages fail to load (*An error occurred while loading page …*). **Preview here** still shows the app in a frame on the tab, with that warning; use it for a quick look, not to judge whether a page works.

The window opens through the office's **recording proxy** for the app, so the Console sees its requests. To the app, that address is simply where it lives: its login and cookies work as usual. The office's own sign-in is never passed to the app (see [How it works](#how-it-works)).

In the desktop app the Live app window's menu is its toolbar: **Back** (Alt+←), **Forward** (Alt+→), **Reload** (F5), **Hard reload** (Shift+F5), **Home**, **Copy address**, **Open in browser** and **Developer tools** (F12). It has its own browser session, so it shares no cookies with the office window. In a browser you use the browser's own Back, Forward and Reload.

### Show here (desktop app)

In the [desktop app](../administration/desktop-app.md#what-it-does) the tab's button is **Show here** instead of Preview here: the app appears in the tab itself, but top-level (the desktop app lays its own view over the tab, not a frame), so every widget works there too. The toolbar above it is the app's: **Back** and **Forward** step through the app's real history, the address shows the page the app is on (Enter goes to another page of the app), **Reload** (Shift: hard reload), **Home**, **Desktop / Tablet / Phone** and **Fit / 100%**, **Copy link**, **Open ↗** (your browser), **🛠 Tools** (the app's developer tools) and **Full screen**. Its requests go through the recording proxy, so the Console lists them.

It needs the proxy: when the note under Open live app says the proxy isn't up, Show here says it can't show the app; use **↗ Open live app**. The view steps aside (the placeholder shows instead) while anything of the office is over it (a dialog, a menu, a toast), when another tab shows or it's scrolled out of view, and it closes when you leave the project or the app stops.

## Console

Under the app's status, the **Console** has two tabs. It streams only while the Live app tab is in view.

**Runtime log**: the Mendix runtime's log (`.mxcli/runtime.log` in the live checkout), newest at the bottom.

- Each entry shows its time, level, who logged it (*Client*, *Core*, *ConnectionBus*, *M2EE*…) and the message. Errors from the app's web client, such as a page that failed to load in the browser, are logged by *Client* and marked.
- A stack trace or *Caused by* is folded under its entry: **▸** shows it, **▾** folds it. **⧉** copies the whole entry.
- **Error** / **Warning** / **Info** / **Debug** show or hide each level, with the error and warning counts (Debug is off at first). The search box also searches the stack traces.
- **⏸ Pause** holds new entries back while you read; **▶ Resume (n new)** shows them. **⤓ Auto-scroll** keeps the newest entry in view; scrolling up turns it off. **⌫ Clear** clears the view only, not the log.
- The tab's red badge counts the errors since the last Clear.

**Network**: the requests the app made through the recording proxy (the last 500), newest at the bottom.

- Each row shows the method, status, name, type, size and time. Mendix `xas/` calls are named by their action, such as *xas · retrieve_by_xpath Orders.Order* or *xas · executeaction Orders.ACT_Save*. Requests with no answer or a 4xx/5xx status are red and counted on the tab's badge.
- Click a row to open it: the address, status and timing, the request and response headers, and the first 8 KB of the bodies, with JSON laid out. Bodies are kept for the app's own calls and for errors; images and other binary content, and the app's static files, are only noted.
- **All** / **XHR** (the app's own calls: `xas/`, fetch, WebSockets) / **Errors**, a filter box, **⏸ Pause** and **⌫ Clear** (view only).
- Cookie values, `Authorization` and CSRF tokens are redacted, and password and token fields in bodies are masked. Requests are kept in the office's memory only, never written to disk, and are gone when the app stops.

## How it works

- The office keeps a **separate clone** of the repository at `<office data>/live/<project>`, on the branch it picked at the first ▶ Start since the office started (the default branch at that moment). It is cloned from the project's folder and fetches from it, never from GitHub itself: the project's folder fetches main with the office's own git setup, so a private repository works. Agents' worktrees are never touched.
- It runs `mxcli run --local` with three free ports from **8110–8199** (app, admin and serve) and a database named `<project>_live` in the local PostgreSQL.
- While the app runs, the office runs its **recording proxy** on a fourth port from the same range, on the office's own bind address (never the office's port). It passes every request and WebSocket on to the app's port on this machine and to nothing else, and records them for the Console. The browser sends the office's session cookie to every port of the same host (cookies ignore ports), so the proxy removes it from every request before passing it on, and drops any cookie the app tries to set under the office's name: the app can neither read nor replace your office sign-in. **Open live app** and the Overview's **View App** use the proxy's address; the app's own port still answers too, unrecorded.
- The Console reads the runtime log only while someone has it open, from where it stopped (a first read takes the last 256 KB).
- **Only while it's running**, the office has the project's folder fetch `main` every 60 seconds (and follows any other fetch that lands there). When `main` moves (a merge), it **updates** the app by itself: without a restart when no app files changed or (with hot reload on) only pages and logic did, else with one (see [Faster updates](#faster-updates)). Merges that land while an update runs wait and go in together with the next one. When the fetch fails, the tab and Needs you say *Live app can't check for updates: (git's reason) (running main @dd960bd from 16 Oct 23:36)*. A stopped, failed or crashed app follows nothing: it stays on its old commit (or none) until someone starts it.
- An update first fetches the new commit into the live checkout's git (the old app keeps serving meanwhile; if that fetch fails, it keeps serving and the tab says *Update to … failed · still running …*), then classifies what changed. When it has to restart, it **stops the old app before it builds the new one**, because the build runs in the same folder against the same database, so the app is down for the whole build and the tab says *nothing running*. Keeping the old app up on a second checkout until the new one answers is a possible follow-up, not built.
- When `main` moved, it clears the stale build folders under `deployment/` (keeping `deployment/data`) first. When a build stops before the app comes up, it clears them and tries **once** more; if that fails too, the app is *build failed* and the office doesn't try again by itself.
- The app counts as **running** the first time its port answers an HTTP request with a status below 500. The office doesn't ask again after that: a crash is noticed when the mxcli process exits, but an app whose process stays up and stops answering still shows *running*.
- The log is `<office data>/live/<project>.log`.

Settings such as the port range, the database and the mxcli path are environment variables `AGENT_OFFICE_LIVE_*`. See [Environment variables](../reference/environment-variables.md#live-app).

## Signing in

Without a Mendix licence the app keeps only 6 sessions open at once, and a closed window keeps its session for about 15 minutes. When the app refuses one (*The current license does not allow more users to sign in.*), the tab says why and what to do: sign out in windows you don't need, wait, or **⟳ Restart**. See [Live app problems](../troubleshooting/live-app.md#the-current-license-does-not-allow-more-users-to-sign-in--sign-in-failed). The office itself holds none: its checks that the app is up are plain requests, and a Design gallery capture ends the session its page opened.

## When it fails

The tab shows *build failed at …* or *stopped (crashed at …)* with the reason and the log's last lines, the **🌐** item appears in Needs you, and the tab gets a `!` badge. See [Live app problems](../troubleshooting/live-app.md).
