---
title: Running the office
description: Start the office from the desktop shortcut or the launcher, sign in on port 4600, keep the laptop awake while agents work (lid closed too), restart it safely on Windows, and update it.
weight: 1
---

## Start

Pick one:

- **The Mx Office shortcut** on the desktop or in the Start menu (`scriptsinstall-shortcut.ps1` makes it). It runs `scriptsstart-office.ps1`: when an office already answers on its port it only opens the browser, otherwise it starts one.
- **By hand**, in PowerShell in the office's folder: `.scriptsstart-office.ps1` (`-OfficeHome <folder>`, `-Port <n>`, `-NoBrowser`; anything else goes to the office as it is, like `--city Berlin`).

- **On macOS (preview)**, in Terminal: `bash scripts/start-office.sh` (`--office-home <folder>`, `--port <n>`, `--no-browser`, `--no-build`, `--dry-run`; anything after `--` goes to the office), or the **Mx Office** launcher in `~/Applications` that `scripts/install-shortcut.sh` makes. It does what the PowerShell launcher does below, with `~/mx-office` as the default office home, and runs in macOS's own bash 3.2. See [Set up on a new machine › macOS](../get-started/new-machine.md#macos-preview).

The office opens in your browser already signed in. Press **Ctrl+F5** after an update (**Cmd+Shift+R** on a Mac). Setting up a new machine is on [Set up on a new machine](../get-started/new-machine.md).

## What the launcher does

`scriptsstart-office.ps1` (Windows PowerShell 5.1 and PowerShell 7):

1. Picks the office home: `-OfficeHome`, else `AGENT_OFFICE_HOME`, else `%USERPROFILE%mx-office`. The office keeps its data in `<home>.agent-office` and clones new projects into the home (unless `AGENT_OFFICE_PROJECTS` says otherwise).
2. Checks Node.js is 22.5 or newer, runs `npm install` and `npm run build` when the checkout has no `node_modules` or `dist` yet, and stops with a clear message when the port is taken by another program.
3. Reads the office's own settings (`office-settings.json`, nothing secret): the mxcli picked in the first-run setup goes first on `PATH`.
4. Runs `binagent-office.js` in a loop that starts it again when it exits with code 75 (**🔁 Restart safely**), with `AGENT_OFFICE_LAUNCHER_LOOP=1` so the office offers that restart, and `AGENT_OFFICE_NO_WELCOME=1` so a new office asks its questions in the browser's [first-run setup](../get-started/new-machine.md#step-3-the-first-run-setup) instead of the terminal.

It reads no token or password file: the office keeps those itself, encrypted, in [🔌 Connections](connections.md), and still falls back to the old dot-files. An environment variable that is already set wins over everything the launcher would pick, so an older launcher script (one that sets `GH_TOKEN`, `AGENT_OFFICE_PASSWORD`, `AGENT_OFFICE_HOME` or `AGENT_OFFICE_MXCLI` itself) keeps working unchanged.

The office listens on port **4600** (`--port` or `PORT` to change it).

## When it comes up

- Saved workers come back and **resume their sessions** by themselves.
- **Live apps don't start by themselves.** Open the 🌐 Live app tab and click ▶ Start.

## Keep it awake (and the lid)

While any worker on any project is working, or a queued task, a Firm audit or a gate-check is running, the office asks Windows not to sleep, and lets go once everything has been idle for 10 minutes. The screen still turns off. It's on by default; switch it off or change the minutes in **⚙️ Settings → 🤖 Workers → Keep awake while agents work**, which also says what it's doing (*Keeping this computer awake: 3 agents working*).

How: a small hidden PowerShell process calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` and waits; it exits when the office tells it to, when the office's process is gone, or with the office's window. No native dependency, and it never changes your power settings. (macOS uses `caffeinate -i -w <office>`, which ends with the office; Linux `systemd-inhibit`.) On a MacBook, closing the lid still sleeps it unless it's plugged in with an external display, keyboard and mouse (clamshell mode): keep the lid open, or use the desktop app on a plugged-in Mac with a display.

> [!IMPORTANT]
> Keep-awake stops **idle** sleep only. To keep agents working with the **lid closed**, Windows' *When I close the lid* must be **Do nothing** when plugged in: Control Panel → Hardware and Sound → Power Options → **Choose what closing the lid does** (or run `control /name Microsoft.PowerOptions /page pageGlobalSettings`), set **Plugged in** to *Do nothing*, and **Save changes**. Leave *On battery* as it is. If the setting is greyed out, your company manages it: ask IT. Keep a closed laptop plugged in and somewhere it can breathe.

If PowerShell can't load the power API (some locked-down machines block `Add-Type`), Settings shows why and the office tries again a minute later; the office itself carries on.

## Stop

Close the **Mx Office** PowerShell window (or press Ctrl+C in it; on a Mac, the Terminal window running `start-office.sh`). This stops the office **and every running agent**.

## Restarting

> [!WARNING]
> On Windows, workers are child processes of the office server. **Restarting the office stops all running agents**, even mid-task. Check the board first, or use [🔁 Restart safely](#releasing-and-restarting-safely), which waits for agents to finish their turn.

Their sessions are saved in each project's `workers.json`. When the office comes back, it resumes the agents that were **mid-turn** (working, or asking something) from their saved sessions, with a prompt to carry on that reminds them their escalations are still open. The rest stay asleep (💤), sessions kept, and wake when prompted (by you, or by the office with an answer, a relay or a standup) or when you press **R** at their desk: a restart no longer starts a session for every desk. If a resume fails, a fresh session starts and a toast says so. What the office still had to pass on to the Project Coordinator and the Leads is kept in the roster file, so it isn't lost either.

## Releasing and restarting safely

Before a release, a migration, or anything else that restarts the office, stop the work cleanly:

- **One project:** the run-state control beside its budget chip (**▶ Running** → **⏸ Pause project**). Every agent finishes its turn, writes a handoff note and sleeps, and the office's own prompts to that project are held. Afterwards, **▶ Resume project** wakes the agents that have work waiting. See [Resume and pause](../using-the-office/resume-and-pause.md).
- **The whole office:** **⚙️ Settings › 🤖 Workers › 🔁 Restart safely** (admins; the 1D view's Settings tab, `/lite?tab=settings&section=workers`), or `POST /api/office/restart` from a script (a signed-in cookie, JSON body: `{ "action": "start", "build": true, "timeoutMin": 10 }`; `action` can also be `wait`, `anyway` or `cancel`).

🔁 Restart safely does this:

1. **Pauses every project** that isn't already paused, using ⏸ Pause project. It writes the projects it paused to `<office data>/restart-pending.json`. Projects a person had already paused aren't included.
2. **Waits** until every agent on every project is idle, asleep or asking something in its terminal. Settings lists who it's still waiting on (for example *Anita: mid-turn*, *Hedy: handing off*) with a countdown to the time limit (10 minutes by default, 1 to 120), and **Restart anyway** (interrupts only the agents still working; the audit log names them) and **Cancel** (resumes the projects it paused) are there the whole time. Past the limit it also offers **Keep waiting**; if nobody chooses, it goes on by itself once nobody is busy. Every page shows the same as a banner to admins (*Restart under way, not done yet: waiting on 1: Dylan: mid-turn. It asks what to do in 6:05.*), so you see it without Settings open. If the computer sleeps under it (a closed lid), nothing moves; the restart notes it (`restart.slept`) and Settings says when.
3. **Builds first, if asked.** When the office's own checkout has commits it isn't running yet, **Restart on the latest build** runs `npm run build`. If the build fails, the restart stops, the log is shown, and the office keeps running the version it has. **Cancel** then resumes the paused projects.
4. **Restarts.** The office shuts down gracefully (workers' terminals are kept for the next office, as with a `SIGTERM`) and exits with code **75**. The launcher starts it again on that code.
   Before it exits, it checks the build it will start: when that build is older than the office's answer dispatch records (it predates durable dispatch, like release 47) and some of them are unsettled, it stops with *The build on disk (release 47 (…)) predates durable dispatch … settle them in Needs you* and keeps running. See [Rolling back to an older build](#rolling-back-to-an-older-build).
5. **On the next start**, the office runs ▶ Resume project for exactly the projects in `restart-pending.json`, with the preview's defaults (wake the agents with work, 2 at a time, about 45 seconds apart), then deletes the file. A project a person paused stays paused.

The audit log and Team chatter record `restart.requested`, `restart.waiting`, `restart.exiting` (with the build it left) and `restart.resumed` (with the build it runs now), plus `restart.slept`, `restart.cancelled` or `restart.failed` when the restart was held up or didn't go through.

### Which version is running

The office says which build it runs, so a restart that didn't happen can't go unnoticed:

- **⚙️ Settings › 🤖 Workers › 🔁 Restart safely** starts with *Running release 45 (aaf30a5), started 08:32*. `npm run build` writes the commit, the release and the build time to `dist/public/build-info.json`; the office reads it as it starts. A build with changes past the last release (entries under *Unreleased* in the changelog, as on `staging/integration`) reads *release 45+*.
- **`GET /api/health`** says it too, without a sign-in: `sha`, `release`, `builtAt` and `startedAt`, plus `newerBuild` when one is ready. After a release, check that `release` and `startedAt` changed.
- **A newer build is ready.** When `npm run build` ran after the office started, admins see *A newer build is ready (release 46). Restart safely to use it.* on every page.
- **A page newer than the office.** Pages load the newest build from disk at once, but the office runs what it started with until it restarts. A page from a newer build says so (*This page is from release 46, but the office server still runs release 45 (started 11:35): new actions fail until it restarts*), and a request the older office can't answer says why instead of *Unknown action*. A page older than the office (restarted, not reloaded) offers **Reload**.
- **Restarted.** Only the new office says the office restarted: once it answers, the page shows *Restarted: now running release 46 (b46b46b), started 20:25*. Until then Settings says *Not restarted yet* with what it's waiting for.

### The restart loop

The office can't reliably respawn itself on Windows, so the launcher has to loop: it runs the office again whenever it exits with code 75. The launcher also sets `AGENT_OFFICE_LAUNCHER_LOOP=1`, so the office knows that exiting will bring it back. Without that variable, the button reads **⏸ Pause, wait, then stop the office**, and Settings says the office can't restart by itself and that *start-office.ps1 needs the restart loop*. The office then pauses, waits, and exits with code 0, and you start it again by hand. The next start still resumes the projects it paused.

Open pages tell you which happened. During a restart through the loop they show **Restarting… reconnecting**, and reload by themselves once the office is back. A connection that only dropped (the computer waking from sleep, say) shows **Reconnecting to Mx Office…**, never *restarting*: only the office says it is restarting. When the office exits without the loop (or you press Ctrl+C), they show **The office has stopped. Start it again with start-office.ps1**. They also show that when the office disappears without saying why (a crash) and doesn't answer the page's next few reconnects. Either way, the page reloads by itself as soon as the office is back.

The launchers that come with the office, `scripts/start-office.ps1` and `scripts/start-office.sh`, already run it in this loop and set the variable. If you start the office with a launcher of your own, run it the same way:

```powershell
$env:AGENT_OFFICE_LAUNCHER_LOOP = '1'
do {
  node <office folder>\bin\agent-office.js @officeArgs
  $code = $LASTEXITCODE
} while ($code -eq 75)
```

Keep the rest of your launcher (the environment, `PATH`) above the loop, so a restart inherits it.

## Rolling back to an older build

Your answers and the attempts to send them are kept in `<office data>/answers/` and `<office data>/dispatch/`. A build from before them (release 47 and older) ignores those files, so going back while an attempt is unsettled could leave an answer's outcome unknown for good. What the office guarantees is **durable intent plus reconciliation, and no automatic replay of an ambiguous attempt**. It does not promise that an answer is delivered exactly once. Before you roll back:

1. Run `node bin/agent-office.js dispatch status` in the office's folder (the one holding `.agent-office`; or pass it: `dispatch status <dir>`, `--json` for a script). It lists every unsettled attempt (prepared, in flight, held for an agent's turn, outcome unknown, a proposal's issue) and exits **1** while there is one, **0** when there is none.
2. Settle each: let the office reconcile it (it does at start), or settle it in **Needs you** (**Send again**, **It went through**, **Abandon**; for an issue **Check GitHub**, **Create it**, **It exists**). A held answer settles once the agent's turn ends and it goes in.
3. Run `dispatch status` again. Only when it exits 0, check out and build the older release, then restart.

🔁 **Restart safely** makes the same check before it exits (see step 4 above): `npm run build` writes the dispatch schema the build knows into `build-info.json`, and a build on disk without it (or with an older one) is refused while anything is unsettled. Without a `build-info.json` (a dev checkout), the office can't tell and doesn't refuse: use `dispatch status`. The check can't stop a manual checkout and start of an old build, which is why the procedure above comes first.

What the older build sees is still safe: an escalation is resolved only after its answer was typed, so it's either still open (safe to answer) or resolved as delivered, never marked *owed* for an attempt that may have gone in. A proposal whose issue is unclear is *approved* without an issue, so it isn't offered for approval again. A question **Send** whose outcome is unknown stays ready to send, as today. A held answer keeps the release 47 format (its dispatch id is an extra field release 47 ignores), so it's typed once there.

## Update

The office runs from a build of its own checkout, on branch `main`: the folder you installed it into (`%USERPROFILE%\mx-office-app` on Windows or `~/mx-office-app` on a Mac with the one-line installer, unless you chose another), or wherever you cloned it. `main` moves only when a release is made; changes are merged into `staging/integration` first and tried on a [test office](test-offices.md).

1. In that folder, get the new `main`: `git pull --ff-only` (or run the one-line installer again: it pulls when the office is already there).
2. `npm ci`, then `npm run build`.
3. Restart the office with **🔁 Restart safely** (see [Releasing and restarting safely](#releasing-and-restarting-safely)), or by hand after pausing the projects. Then press **Ctrl+F5** in the browser.

The installer and `git pull` take `main`'s newest commit; to stay on a particular release, check out its commit (each [release](../release-notes.md) names it) instead.

## Helper scripts

The repository's `scripts/` folder holds the installers (`get-mx-office.ps1`, `get-mx-office.sh`), the launchers (`start-office.ps1`, `start-office.sh`), the shortcut installers (`install-shortcut.ps1`, `install-shortcut.sh`) and the docs screenshot and test scripts. `node bin/agent-office.js --help` lists the office's own commands (see [Server CLI](../reference/server-cli.md)).
