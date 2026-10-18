---
title: Walkthroughs
description: Deployment › Walkthroughs - short captioned videos of the app's workflows, recorded by the office by itself from the project's test journeys at each passing build, against its own throwaway copy of the app.
weight: 8.2
---

The **🎬 Walkthroughs** page (**Deployment › Walkthroughs** in the Portal navigation, `/lite?tab=walkthroughs`) has short videos of the app's workflows. Each one plays a test journey (`tests/e2e/*.journey.json`) against the app and films it. They serve as demo videos, as acceptance evidence for the exact build they recorded, and as handover docs once they're in the project's repo.

You don't have to start anything. The office records them by itself, against **its own copy of the app**, never your [Live app](live-app.md).

## When videos are made

- **Automatically** (on by default, one **Record automatically** switch per project): when a build on main passes its journeys (test evidence lands for main's newest commit with journeys that passed against it), or a milestone becomes ready in the live app, each journey that passed against that commit is recorded. Once per commit: a journey recorded automatically at a commit isn't recorded again for it. A journey that failed, or a milestone that is only built (*not yet verified*), records nothing. Automatic recordings are labelled *Auto* (and the milestone's name).
- **By hand** (admins): **● Record** records one journey of main's newest commit, **⟳ Re-record all** every journey of it. With no videos yet, **● Record now** does the same.
- **Make guided tour** joins the newest passing video of each workflow of one build into one longer video, with an intro card, a title card per workflow, an outro card and chapter markers.

## How a recording runs

A **batch** is the journeys of one commit. For each batch the office:

1. copies that commit into its own work folder (`<office data>/testing/work/<project>/instance-rec`, from the project's git objects; nothing in the project's folder changes);
2. starts the app there with `mxcli run --local`, as the live app does (the same mxcli and PostgreSQL settings, three free ports from the live apps' range), on a **fresh database of its own** (`<project>_rec_<random>`), never the live app's `<project>_live`. Journeys that need a clean database, or can't be run twice, work;
3. plays the journeys one after another, in file order, on that one database;
4. stops the app, drops its database and wipes the folder. A database an earlier run left behind (the office stopped mid-way) is dropped before the next batch.

One batch runs at a time in the office; the others wait in line. The page shows where it is: *Queued*, *Starting the app* (a cold build takes a minute or two), *Recording 2 of 5* with the step it's on, *Finishing*. **Cancel** (admins) stops a batch, and the app with it. A recording stops by itself after 3 minutes.

The app, mxbuild, the browser, ffmpeg and the voice are processes of their own; the office only coordinates. The database password is given to mxcli as the live app gives it and never written to a log, a manifest or the page.

## Who it signs in as

A recording signs in the way the toolkit's journey runner does, as the identity the journey was written for:

1. the journey's own `TEST_USER=<account>` line in its `$comment` (or a `user` field);
2. a `role` or `persona` that names one of the accounts in `tests/e2e/project.config.js`'s `roles`;
3. otherwise the journey runner's default identity: `credentials()` in `tests/e2e/project.config.js` (its `DEFAULT_USER`);
4. otherwise the **demo user** of the Walkthroughs settings (`demo_test_user`).

The office reads `project.config.js` at the recorded commit without loading it into itself: a copy is loaded in a separate Node process with nothing of the office's environment, with Node's permission model allowing it to read only that copy (no writes, no programs), for ten seconds at most. Where that can't run it reads the file's defaults off its text. An admin account (`MxAdmin`, `admin`…) is never used.

The page says who recordings sign in as by default. Each recording's evidence line says who it signed in as and why. If the app doesn't let the account in, the recording fails with that reason (*couldn't sign in as demo_clerk: still on the sign-in page*), not as a failed first step.

## Honest by construction

- A **failed step stops the recording**. The failure is captioned on screen, the card says *Failed at step 2* with the reason, and the steps after it are *not run*. When it fails, the card also shows what the journey's `$comment` says it needs (a time window, the start state, which journey runs before it).
- A video is **evidence only for the commit it recorded** (`@abc1234` on the card and in its `manifest.json`). A failed, cancelled or unfinished recording is never evidence, and can't be saved to the repo.
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
- Settings are environment variables. See [Environment variables](../reference/environment-variables.md#walkthrough-videos).
