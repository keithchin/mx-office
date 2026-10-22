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

The status pill says what is actually there: *not started* (nobody started it since the office started), *building…*, *starting…* (mxcli said the runtime is starting), *running*, *updating to 1a2b3c4…*, *running · update failed*, *stopping…*, *stopped*, *build failed at 10:27*, or *stopped (crashed at 10:27)* when it was running and stopped by itself. Beside it is the **served** commit (the one actually running and answering) against main, *main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed* (or *· up to date*), and when that build came up. The same words are on the tab's chip, the Overview's **Live app** row and **View App**.

The office keeps two revisions apart: the **served** one, which counts only from the moment its build answers on its port and stops counting the moment that runtime stops, and the **target**, the commit it's getting, building or starting. While they differ, a line beside the pill says which is which:

- *Running abc1234 · updating to def5678…*: the old build still answers while main is fetched.
- *Updating to def5678… · nothing running (abc1234 stopped for the build)*: the old build was stopped so the new one can build (see [How it works](#how-it-works)).
- *Update to def5678 failed · still running abc1234*: the update failed before the old build was stopped (main couldn't be fetched into the live checkout), so the old build keeps serving. Needs you has a row for it, and the office doesn't retry that commit by itself every minute: **⟳ Restart** does.
- *Update to def5678 failed · nothing running*: the new build failed after the old one was stopped. *Build of def5678 failed · nothing running* is the same for a ▶ Start.
- *Nothing running · last ran abc1234 until 10:27*: stopped, or the office restarted.

Everything that means "what's running" uses the served commit only: readiness and its test evidence, Design gallery captures, the readiness news, the desktop app's **Show here** line (*Order list · running abc1234 · shown by the desktop app*) and Home's *Live app running abc1234*. Whether the work in it is ready is the project's [business status](progress-and-acceptance.md#business-status), which the Live app chip shows after the commit (*🌐 Live app: running · abc1234 · Verification incomplete*).

A crashed app shows when it stopped, on which commit, mxcli's last lines and **⟳ Restart**; a toast says so, and Needs you has a row that Teams and phone push send once per crash.

Live apps don't start by themselves when the office starts, and an office restart doesn't bring back the one that ran: after a restart the tab says *not started*, no commit is called running, and nothing runs until an admin clicks **▶ Start**. What served last is kept in `<office data>/live/<project>.served.json` and shown only as *Nothing running · last ran abc1234 until 10:27*; if the office ended without shutting down, *until* is only when that build came up.

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
- **Only while it's running**, the office has the project's folder fetch `main` every 60 seconds (and follows any other fetch that lands there). When `main` moves (a merge), it **updates and restarts** the app by itself. When the fetch fails, the tab and Needs you say *Live app can't check for updates: (git's reason) (running main @dd960bd from 16 Oct 23:36)*. A stopped, failed or crashed app follows nothing: it stays on its old commit (or none) until someone starts it.
- An update first fetches the new commit into the live checkout's git (the old app keeps serving meanwhile; if that fetch fails, it keeps serving and the tab says *Update to … failed · still running …*). Then it **stops the old app before it builds the new one**, because the build runs in the same folder against the same database, so the app is down for the whole build and the tab says *nothing running*. Keeping the old app up on a second checkout until the new one answers is a possible follow-up, not built.
- When `main` moved, it clears the stale build folders under `deployment/` (keeping `deployment/data`) first. When a build stops before the app comes up, it clears them and tries **once** more; if that fails too, the app is *build failed* and the office doesn't try again by itself.
- The app counts as **running** the first time its port answers an HTTP request with a status below 500. The office doesn't ask again after that: a crash is noticed when the mxcli process exits, but an app whose process stays up and stops answering still shows *running*.
- The log is `<office data>/live/<project>.log`.

Settings such as the port range, the database and the mxcli path are environment variables `AGENT_OFFICE_LIVE_*`. See [Environment variables](../reference/environment-variables.md#live-app).

## Signing in

Without a Mendix licence the app keeps only 6 sessions open at once, and a closed window keeps its session for about 15 minutes. When the app refuses one (*The current license does not allow more users to sign in.*), the tab says why and what to do: sign out in windows you don't need, wait, or **⟳ Restart**. See [Live app problems](../troubleshooting/live-app.md#the-current-license-does-not-allow-more-users-to-sign-in--sign-in-failed). The office itself holds none: its checks that the app is up are plain requests, and a Design gallery capture ends the session its page opened.

## When it fails

The tab shows *build failed at …* or *stopped (crashed at …)* with the reason and the log's last lines, the **🌐** item appears in Needs you, and the tab gets a `!` badge. See [Live app problems](../troubleshooting/live-app.md).
