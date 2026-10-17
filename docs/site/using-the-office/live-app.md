---
title: Live app
description: Run the Mendix app from main on this laptop with mxcli run --local, and click through what the agents built.
weight: 8
---

The **🌐 Live app** tab runs the project's Mendix app from its `main` branch, on this laptop, and shows it in the page.

![The live app](../images/live-app.png)

## Start, restart, stop

Only admins can start or stop it. Everyone else watches.

| Button | Does |
|---|---|
| **▶ Start** | Clones or updates the live checkout, builds and starts the app. |
| **⟳ Restart** | Stops and starts it again. |
| **■ Stop** | Stops it. |

The status pill says what is actually there: *not started* (nobody started it since the office started), *starting…*, *building…*, *running*, *updating to 1a2b3c4…*, *stopping…*, *stopped*, *build failed at 10:27*, or *stopped (crashed at 10:27)* when it was running and stopped by itself. Beside it is the commit it runs against main, *main @dd960bd from 16 Oct 23:36 · 2 commits behind main @f790bed* (or *· up to date*), and when the running build came up. The same words are on the tab's chip, the Overview's **Live app** row and **View App**.

A crashed app shows when it stopped, on which commit, mxcli's last lines and **⟳ Restart**; a toast says so, and Needs you has a row that Teams and phone push send once per crash.

Live apps don't start by themselves when the office starts. Open the tab and click **▶ Start**.

## Is it ready?

Under the buttons, a card says whether the app is ready, from evidence only:

> **Live app: not ready for Sample check-sheet demo (Checksheet).** Has: Prerequisites, Frame, domain and skeleton (not yet verified) (rows 4, 6–8). Missing: Save, submit and My check sheets (PR #6, open, not merged); Approval, history and demo data (PR #6, open, not merged; row 24 not built).

Then one line per milestone, tagged **Ready**, **Not verified**, **Restart**, **In a PR**, **Partly** or **Not built**.

![The readiness card](../images/live-app-ready.png)

- **Milestones** are the phases of the project's build plan (`architecture/build-plan.md`, the `### Phase N — …` headings over the numbered row tables), each with the **BUILD** rows it needs; the whole plan is the last milestone, named from the plan's title.
- **Which rows are built** comes from what the team wrote as it worked, never the plan's State column (agents don't update it): commit subjects naming the row (*Row 16: sheet form page applied*, *Rows 19-21: …*) on a commit that changed build files or says applied / proven / done / PASS, merged PR titles (*rows 4-14*), and `### <date> — Row N` notes in `docs/BUILD-LOG.md`. A *Draft row 16* or *Journal: row 3* commit only mentions it.
- For the commit the app runs, a milestone's rows are **in the running build**, **merged to main but not in it yet** (⟳ Restart picks them up), **in a PR** (only on an unmerged branch, with its PR from GitHub's list), or **not built**.
- **Ready** means every BUILD row is in the running build **and** every journey tied to the milestone passed against that very build: a `tests/e2e/*.journey.json` whose `requirement` names one of its rows (`build-plan row 10`), with a test-run record in **App Insights › Testing** whose tested revision is the running commit. Journeys that name no row belong to the whole plan; broken controls (`…-broken`) don't count. Built but not yet passed is *built, not yet verified*, never ready.
- Nothing is ready while the app isn't running.

When a milestone becomes ready in the running app you get a toast, an FYI row in Needs you for a day (not counted as waiting on you), and a Teams, phone push and desktop alert, once per milestone, even across restarts of the office. A milestone told ready that the running app no longer has is said too.

The card is read again when the app starts, stops or crashes, when a fetch lands in the project's folder, and when test evidence lands; never on a timer of its own.

## Main behind the work

When an agent's branch or an open PR has commits main hasn't and changes the model (`.mpr`, `mprcontents/`, `mdlsource/`), this tab and the [Model](model.md) tab show a banner: *main is 75 commits behind Sophie's branch, which has model changes (PR #6, open, not reviewed)*. The live app runs main, so it shows none of that until it merges. **View it in the Model tab** opens the Model tab, which can show the branch; **Ask Katherine to review** (admins) tells the team lead, after their turn, to have the PR reviewed per the [review gate](review-gate.md). The review state is the gate's: *reviewed by X* once a complete `Review:` by someone other than the opener is on the PR; *review not checked yet* while the office hasn't read the PR's comments, which the board reads for merged PRs only.

## The viewer

The app runs in a small browser in the page:

| Control | Does |
|---|---|
| **←** / **→** | Back and forward through the addresses opened here (Alt+← / Alt+→) |
| **⟳** | Reload (F5 or Ctrl+R); Shift+click or Shift+F5 reloads past the browser cache |
| **⌂** | The app's home page |
| Address | The page within the app: type a path such as `/p/approvals` and press Enter. Only the app's own address is allowed |
| **Desktop / Tablet / Phone** | The frame's width (full, 820 or 390 px), shrunk to fit or at **100%** |
| **Copy link**, **Open ↗** | The page's address, to share or to open in a browser tab |
| **⛶ Full screen** | The viewer fills the screen (F11); Esc or **✕ Exit full screen** leaves. Where the browser refuses, it covers the window instead |

The app is on another port, so another origin: the office can't read where the frame is after you click inside the app, nor drive its history. Back and Forward step through the addresses the viewer opened; a click that loads a new page shows *moved inside the app*, and the app's own page changes (most of a Mendix app's) aren't visible to the office at all. **Open ↗** gives you the browser's own Back and Forward.

## How it works

- The office keeps a **separate clone** of the repository at `<office data>/live/<project>`, always on main. It is cloned from the project's folder and fetches from it, never from GitHub itself: the project's folder fetches main with the office's own git setup, so a private repository works. Agents' worktrees are never touched.
- It runs `mxcli run --local` with three free ports from **8110–8199** (app, admin and serve) and a database named `<project>_live` in the local PostgreSQL.
- Once it's running, the office has the project's folder fetch `main` every 60 seconds (and follows any other fetch that lands there). When `main` moves (a merge), it **updates and restarts** the app by itself. When the fetch fails, the tab and Needs you say *Live app can't check for updates: (git's reason) (running main @dd960bd from 16 Oct 23:36)*.
- When `main` moved, or a first build failed, it clears the stale build folders under `deployment/` (keeping `deployment/data`) and retries once.
- The log is `<office data>/live/<project>.log`.

Settings such as the port range, the database and the mxcli path are environment variables `AGENT_OFFICE_LIVE_*`. See [Environment variables](../reference/environment-variables.md#live-app).

## When it fails

The tab shows *build failed at …* or *stopped (crashed at …)* with the reason and the log's last lines, the **🌐** item appears in Needs you, and the tab gets a `!` badge. See [Live app problems](../troubleshooting/live-app.md).
