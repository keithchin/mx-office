---
title: Walkthroughs
description: Deployment › Walkthroughs - short captioned videos of the app's workflows, recorded by the office by itself from the project's test journeys at each passing build, against its own throwaway copy of the app.
weight: 8.2
---

The **🎬 Walkthroughs** page (**Deployment › Walkthroughs** in the Portal navigation, `/lite?tab=walkthroughs`) has short videos of the app's workflows. Each one plays a test journey (`tests/e2e/*.journey.json`) against the app and films it. They serve as demo videos and as handover docs once they're in the project's repo. Each shows the exact build it recorded, but they are presentation, **not acceptance evidence**: [acceptance](progress-and-acceptance.md#acceptance) never looks at walkthroughs, and a recording's result doesn't change the [Live app](live-app.md)'s readiness or the [Testing](testing.md) page.

You don't have to start anything. The office records them by itself, against **its own copy of the app**, never your [Live app](live-app.md).

## When videos are made

- **Automatically** (on by default, one **Record automatically** switch per project): when a build on main passes its journeys (test evidence lands for main's newest commit with journeys that passed against it), or a milestone becomes ready in the live app, each journey that passed against that commit is recorded. Once per commit: a journey recorded automatically at a commit isn't recorded again for it, **whatever came of that recording**. An automatic recording that failed, errored, was cancelled or was cut off by an office restart counts as done for that commit and isn't tried again by itself; use **● Record** or **⟳ Re-record all**, or wait for the next commit. A journey that failed, or a milestone that is only built (*not yet verified*), records nothing. Automatic recordings are labelled *Auto* (and the milestone's name).
- **By hand** (admins): **● Record** records one journey of main's newest commit, **⟳ Re-record all** every journey of it. With no videos yet, **● Record now** does the same.
- **Make guided tour** joins the newest passing video of each workflow of one build into one longer video, with an intro card, a title card per workflow, an outro card and chapter markers.

## How a recording runs

A **batch** is the journeys of one commit, played by a **plan** (see [Start states](#start-states) below): groups of journeys, each group on a fresh database, in the order the journeys' start states need. For each batch the office:

1. waits while a **live app is building or starting** (the project's own first, then any other project's): two cold builds at once take several times as long as one, past mxcli's own limits on a busy laptop. The page says *Waiting for the project's live app to finish building*; after 12 minutes it starts anyway;
2. gets that commit into its **recording workspace** (`<office data>/testing/work/<project>/instance-rec`, from the project's git objects; nothing in the project's folder changes). The workspace is kept between batches: the same commit is used as it is, a new commit is written over it in place (changed files rewritten, dropped files removed, the last build's leftovers cleared), and what mxcli built and bundled there stays, so the next start is warm. The uploaded files of earlier runs' databases (`deployment/data`) are cleared every time. A workspace no batch used for 14 days is removed;
3. starts the app there with `mxcli run --local`, as the live app does (the same mxcli and PostgreSQL settings, three free ports from the live apps' range), on a **fresh database of its own** (`<project>_rec_<random>`), never the live app's `<project>_live`. When the mxcli takes `--web-client-timeout` it is given 15 minutes for the web client bundle instead of its default 5;
4. plays the first group's journeys one after another on that database, then signs out. For each next group it stops the runtime, drops that database and starts the same build again in the same folder on a new one (no new copy of the commit). That costs one runtime start per group; each recording's `manifest.json` says how its database was made and how long that took (`start.db`, `start.dbMs`);
5. stops the app and drops its database (the workspace stays for the next batch). A database an earlier run left behind (the office stopped mid-way) is dropped before the next batch.

Two failures are worth **one more try**, never more: the runtime finding its port taken (*Runtime port '8110' is already in use*, after which the runtime only says *No Runtime Jetty server available. Please call update_appcontainer_configuration*: something else on the machine took the port in the minutes between the office picking it and the runtime binding it), tried again on other ports; and mxcli's web client bundle running past its limit (*web client build timed out after 5m0s*), tried again in the now warm workspace. Either way the next try gets a fresh database too, and each recording's card notes *The recording app failed to start once (…); retried.* Any other failure isn't tried again. A start that fails says, on every card of the batch, which phase failed, after how long, why, and what to do. Each recording's `manifest.json` keeps what its start took: `start.boot` with the total, the time of each phase, how the workspace was got ready (`fresh`, `reused`, `updated`), the bundle time mxcli reported and the retry, if any. The full output is in `<office data>/testing/work/<project>/instance-rec.log`.

One batch runs at a time in the office; the others wait in line. The page shows where it is: *Queued*, *Starting the app* with the boot phase and the time it has taken (*Updating the recording workspace*, *Making a fresh database*, *Building the app*, *Bundling the web client · 1 min 12 s (2 min 40 s in all)*, *Starting the Mendix runtime*), *Group 2 of 4* with the same phases for its fresh database, *Setting up* (a journey played first, not filmed), *Recording 2 of 5* with the step it's on, *Finishing*. Under it, **This batch's plan** lists the groups, their order, which journeys are only set-up plays, and what isn't recorded and why. **Cancel** (admins) stops a batch, and the app with it. The recording under way is marked *cancelled*. Journeys the batch hadn't reached yet may get no card at all (cancelled while the app was starting, they get a *cancelled* card each), so check the page before assuming every journey ran. A recording stops by itself after 3 minutes.

A recording that couldn't be made (the recording app didn't start, the office stopped mid-recording, a journey that sets up its start state didn't pass) and a recording that broke for another reason share one status, **error**; the card's reason says which. A journey whose own steps fail is **failed**, a separate status.

The app, mxbuild, the browser, ffmpeg and the voice are processes of their own; the office only coordinates. The database password is given to mxcli as the live app gives it and never written to a log, a manifest or the page.

## Start states

A journey is written for a start state: a database with only the demo seed, or the data another journey leaves behind. Played in the wrong order on one shared database, a journey fails at a step that isn't its fault. So the office reads each journey's start state and plans the batch:

- a journey that **runs after** another plays in that one's group, right after it (a chain);
- a chain whose first journey needs a **fresh database** is a group of its own;
- journeys that need **nothing in particular** share one group, ordered by their *run before* lines. A fresh-database chain that must run before one of them heads that group instead (it gets the fresh database either way, without an extra start);
- a journey that **leaves data behind** goes last in its group; one that **isn't re-runnable** is never played twice on one database;
- when you **● Record** one journey whose prerequisite you didn't pick, the prerequisite chain is played first, **not filmed**, in the same group, and the card says *Played "Submit a new request" first (not filmed) to set up its start state.*;
- a chain that goes round in a circle, or *run before* lines that contradict each other, aren't recorded: their cards say *Skipped* with the reason;
- a journey that says it must not run in a **time window** (*Do not run between 07:30-08:00 … Europe/Amsterdam*, read in the zone it names, else on the office's clock): when the batch reaches its group inside that window (or 5 minutes before it), the group moves to the end of the batch; if the window still holds then, its journeys are *Skipped* with the reason, never a silent failure;
- **templates** aren't workflows and are never recorded: the toolkit's `example` and `skeleton*` journeys, anything marked broken (a control that must fail), and a journey with `"template": true`. The plan lists them as *template — not recorded*.

Each group has one session per account, signed out at the end of the group (an unlicensed Mendix app keeps only 6 sessions). When a journey in a group doesn't pass, the journeys that run after it in its chain aren't played (their start state isn't there), and their cards say so. A journey whose own steps fail stays an honest failed recording. Folded on the page, **Recording plan (Re-record all)** shows the plan for main's newest commit before anything runs.

### Saying it in the journey

The recommended form is a structured field at the journey's top level:

```json
"startState": {
  "freshDb": true,
  "after": "submit-request",
  "before": ["reject-request"],
  "rerunnable": false,
  "leavesData": true,
  "notRunBetween": ["07:30-08:00"],
  "timeZone": "Europe/Amsterdam"
}
```

Every key is optional. `after` and `before` name journeys of the same commit by `id` (or the file name without `.journey.json`). When the field is there, it is what counts (a time window in the comment still applies when the field names none).

Without it, the office reads the journey's `$comment`, conservatively:

| The comment says | Read as |
| --- | --- |
| `START STATE: fresh DB with the demo seed only…` | needs a fresh database (what the START STATE line says first: *any DB with…* is no such need) |
| `run directly after <id>`, `run after <id>` | runs after that journey |
| `Run BEFORE <id>` | runs before it, when they share a database |
| `NOT re-runnable` | never twice on one database |
| `leaves … behind` (not *leaves no state behind*) | last in its group |
| `Do not run between 07:30-08:00 … Europe/Amsterdam` | its time window |

Only the START STATE line counts for the database and the order when there is one; without one, the whole comment does. A name that is no journey of that commit is ignored, with a note. A journey that says nothing shares a database.

## Who it signs in as

A recording signs in the way the toolkit's journey runner does, as the identity the journey was written for:

1. the journey's own `TEST_USER=<account>` line in its `$comment` (or a `user` field);
2. a `role` or `persona` that names one of the accounts in `tests/e2e/project.config.js`'s `roles`;
3. otherwise the journey runner's default identity: `credentials()` in `tests/e2e/project.config.js` (its `DEFAULT_USER`);
4. otherwise the project's **demo user** (`demo_test_user` unless changed). It isn't on the page: it can only be changed through the API (`POST /api/walkthroughs/action` with `action: "settings"`, `demoUser` and `demoPassword`; admins), and is kept in the project's `settings.json` (see [Settings](#settings)).

The office reads `project.config.js` at the recorded commit without loading it into itself: a copy is loaded in a separate Node process with nothing of the office's environment, with Node's permission model allowing it to read only that copy (no writes, no programs), for ten seconds at most. Where that can't run it reads the file's defaults off its text. An admin account (`MxAdmin`, `admin`…) is never used.

The page says who recordings sign in as by default. Each recording's evidence line says who it signed in as and why. If the app doesn't let the account in, the recording fails with that reason and what the app said (*couldn't sign in as demo_clerk: still on the sign-in page ("The username or password you entered is incorrect.")*), not as a failed first step.

An unlicensed Mendix app keeps only 6 sessions open at once, guests' included, and a closed browser doesn't end one. So a batch signs each account in once, on Mendix's own sign-in page (`login.html`, which opens no session of its own), films every journey of that account on that one session, never loads the app anywhere else, and signs each account out when the batch is done. When the app refuses a session anyway the card says so: *couldn't sign in as demo_clerk: the app says "The current license does not allow more users to sign in." (an unlicensed Mendix app keeps only 6 sessions open at once, signed-in and guest)*, or, where the sign-in page only says *Sign in failed.*, what the recording app's runtime log says.

## Honest by construction

- A **planner's fault is never a journey's**. A journey played without the start state it says it needs would fail for the wrong reason: the plan above prevents that, and the office's tests keep it so.
- A recording **plays a journey exactly as the toolkit's journey runner does**: the same actions (`nav`, `click`, `fill`, `setFiles`, `pickLanguage`, `combobox`, `dismissModal`, `wait`) with the same semantics. That includes `within` + `hasText` (the widget inside the row or card whose text matches, not the first one on the page), `settleMs` (1200 ms after each action when not given), `fill` setting the value and tabbing out with `blur`, a click that is refused when something covers the widget, and `dismissModal` closing up to three dialogs without failing. `setFiles` attaches files from `tests/e2e/fixtures` in the recorded commit's own files, never from anywhere else. The `ui` checks are the runner's (`ready` waits up to 12 s; `checks`, `textPresent` and `textAbsent` are read once). A step's `data` (OQL) and `spans` checks need the runner's database access and tracing, so they aren't run: the step says *data (OQL) checks not run in recordings*. A journey with an action the recorder doesn't know fails at that step and names it. The office's tests play one journey through both the runner's action table and the recorder and check that they leave the app in the same state.
- A **failed step stops the recording**. The failure is captioned on screen, the card says *Failed at step 2* with the reason, and the steps after it are *not run*. When the app has an error dialog, a warning or a validation message on screen, the reason starts with what the app showed (*the app showed an error: "Error — Value has an issue: …" (then: couldn't click … it is covered by …)*), so the app refusing something reads differently from the recorder not finding a widget (*couldn't find a .mx-name-ctnRow that says "…"*). The dialog is in the step's screenshot. A dialog that a `dismissModal` closed is noted beside its step, with its words. When it fails, the card also shows what the journey's `$comment` says it needs (a time window, the start state, which journey runs before it).
- A video **shows only the commit it recorded** (`@abc1234` on the card and in its `manifest.json`). A failed, cancelled or unfinished recording can't be saved to the repo.
- The browser is the office's headless Chromium, in a fresh profile that never has your office session. It may reach only the recording app's address and refuses every other request.

## Watching and keeping them

- One card per workflow: its newest recording (status, commit, when, *Auto* or *Manual*, length, MP4 or WebM, voice or captions), earlier ones under it. The guided tour is on top.
- **▶ Watch** opens the player: the video large on the left, the steps on the right. Click a step to jump there; the step playing is highlighted; a failed step is red with its reason; a step's screenshot shows when you point at it or pick it. The evidence line is under the video. On a narrow screen the steps go under the video. **Download** saves the video.
- **Save to repo** (admins) opens a pull request that adds the walkthrough to the project's repository, in `docs/walkthroughs/<workflow>/` (the video, `captions.vtt`, `chapters.vtt`, `steps/NN.png` and `manifest.json`), and rewrites `docs/walkthroughs/index.md`. It goes on a branch of its own, never straight to `main`. When the repository sends `*.mp4` to git LFS, the video goes that way; otherwise a video over 20 MB is flagged in the pull request, and one over 95 MB is refused. The card then says *In PR #N*.
- **Narrate** adds a voice that reads each step, made on this machine with Kokoro (a local text-to-speech model). Nothing is sent anywhere. Without Kokoro the videos have captions only. ffmpeg makes the MP4 and adds the voice; without it the video is the WebM as recorded.
- On the **🌐 Live app** tab, **🎬 Walkthroughs →** leads here, and a ready milestone with a video of the running build has a **▶ Walkthrough** link that opens it here.
- Working copies are kept in `<office data>/walkthroughs/<project>/` until they're saved to the repo. The office keeps the newest three automatic recordings per workflow, none older than 14 days, within 2 GB in all. Your own recordings stay until you delete them.
- Nothing here calls an AI model.

## Needs

- mxcli on the office's machine (the same one the live app uses: `AGENT_OFFICE_LIVE_MXCLI`), and the PostgreSQL the live apps use. Without mxcli the page says recordings can't start the app, and nothing is recorded automatically. In a test office nothing is recorded automatically either (an admin's Record still works), so a test never starts a real app and database by itself.
- The tools are found through environment variables (ffmpeg and the Kokoro voice). See [Environment variables](../reference/environment-variables.md#walkthrough-videos).

## Settings

Each project's Walkthroughs settings are a file, `<office data>/walkthroughs/<project>/settings.json`, not environment variables. A project without the file uses the defaults:

| Setting | Default | Set from |
|---|---|---|
| `autoRecord` | `true` (record automatically) | The page's **Record automatically** switch (admins) |
| `narrate` | `true` (a voice when one is available) | The API only. The page's **Narrate** box is for the recordings you start from that page, not saved |
| `demoUser`, `demoPassword` | `demo_test_user` and a fixed demo password | The API only (see [Who it signs in as](#who-it-signs-in-as)) |

The file is written in place, with no temporary file or flush, so a crash in the middle of a write can leave it broken; the office then uses the defaults (automatic recording back on). See [Data locations](../administration/data-locations.md).

See also [State and sources of truth](../architecture/state-and-truth.md): how walkthroughs, readiness, test evidence and acceptance stay separate.
