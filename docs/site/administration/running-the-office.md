---
title: Running the office
description: Start the office from the desktop shortcut or the launcher, sign in on port 4600, keep the laptop awake while agents work (lid closed too), restart it safely on Windows, and update it.
weight: 1
---

## Start

Pick one:

- **The Mx Office shortcut** on the desktop or in the Start menu (`scriptsinstall-shortcut.ps1` makes it). It runs `scriptsstart-office.ps1`: when an office already answers on its port it only opens the browser, otherwise it starts one.
- **By hand**, in PowerShell in the office's folder: `.scriptsstart-office.ps1` (`-OfficeHome <folder>`, `-Port <n>`, `-NoBrowser`; anything else goes to the office as it is, like `--city Berlin`).

The office opens in your browser already signed in. Press **Ctrl+F5** after an update. Setting up a new machine is on [Set up on a new machine](../get-started/new-machine.md).

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

While any worker on any floor is working, or a queued task, a Firm audit or a gate-check is running, the office asks Windows not to sleep, and lets go once everything has been idle for 10 minutes. The screen still turns off. It's on by default; switch it off or change the minutes in **⚙️ Settings → 🤖 Workers → Keep awake while agents work**, which also says what it's doing (*Keeping this computer awake: 3 agents working*).

How: a small hidden PowerShell process calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` and waits; it exits when the office tells it to, when the office's process is gone, or with the office's window. No native dependency, and it never changes your power settings. (macOS uses `caffeinate -i`, Linux `systemd-inhibit`.)

> [!IMPORTANT]
> Keep-awake stops **idle** sleep only. To keep agents working with the **lid closed**, Windows' *When I close the lid* must be **Do nothing** when plugged in: Control Panel → Hardware and Sound → Power Options → **Choose what closing the lid does** (or run `control /name Microsoft.PowerOptions /page pageGlobalSettings`), set **Plugged in** to *Do nothing*, and **Save changes**. Leave *On battery* as it is. If the setting is greyed out, your company manages it: ask IT. Keep a closed laptop plugged in and somewhere it can breathe.

If PowerShell can't load the power API (some locked-down machines block `Add-Type`), Settings shows why and the office tries again a minute later; the office itself carries on.

## Stop

Close the **Agent Office** PowerShell window (or press Ctrl+C in it). This stops the office **and every running agent**.

## Restarting

> [!WARNING]
> On Windows, workers are child processes of the office server. **Restarting the office stops all running agents**, even mid-task. Check the board first, or use [🔁 Restart safely](#releasing-and-restarting-safely), which waits for agents to finish their turn.

Their sessions are saved in each floor's `workers.json`. When the office comes back, it resumes the agents that were **mid-turn** (working, or asking something) from their saved sessions, with a prompt to carry on that reminds them their escalations are still open. The rest stay asleep (💤), sessions kept, and wake when prompted (by you, or by the office with an answer, a relay or a standup) or when you press **R** at their desk: a restart no longer starts a session for every desk. If a resume fails, a fresh session starts and a toast says so. What the office still had to pass on to the Project Coordinator and the Leads is kept in the roster file, so it isn't lost either.

## Releasing and restarting safely

Before a release, a migration, or anything else that restarts the office, stop the work cleanly:

- **One project:** the run-state control beside its budget chip (**▶ Running** → **⏸ Pause project**). Every agent finishes its turn, writes a handoff note and sleeps, and the office's own prompts to that floor are held. Afterwards, **▶ Resume project** wakes the agents that have work waiting. See [Resume and pause](../using-the-office/resume-and-pause.md).
- **The whole office:** **⚙️ Settings › 🤖 Workers › 🔁 Restart safely** (admins; the 1D view's Settings tab, `/lite?tab=settings&section=workers`), or `POST /api/office/restart` from a script (a signed-in cookie, JSON body: `{ "action": "start", "build": true, "timeoutMin": 10 }`; `action` can also be `wait`, `anyway` or `cancel`).

🔁 Restart safely does this:

1. **Pauses every project** that isn't already paused, using ⏸ Pause project. It writes the floors it paused to `<office data>/restart-pending.json`. Floors a person had already paused aren't included.
2. **Waits** until every agent on every floor is idle, asleep or asking something in its terminal. Settings shows who it's still waiting on, for example *Waiting on 2: Anita mid-turn, Hedy handing off*. After the timeout (10 minutes by default, 1 to 120) you choose: **Keep waiting**, **Restart anyway** (interrupts only the agents still working; the audit log names them), or **Cancel** (resumes the projects it paused).
3. **Builds first, if asked.** When the office's own checkout has commits it isn't running yet, **Restart on the latest build** runs `npm run build`. If the build fails, the restart stops, the log is shown, and the office keeps running the version it has. **Cancel** then resumes the paused projects.
4. **Restarts.** The office shuts down gracefully (workers' terminals are kept for the next office, as with a `SIGTERM`) and exits with code **75**. The launcher starts it again on that code.
5. **On the next start**, the office runs ▶ Resume project for exactly the floors in `restart-pending.json`, with the preview's defaults (wake the agents with work, 2 at a time, about 45 seconds apart), then deletes the file. A floor a person paused stays paused.

The audit log and Team chatter record `restart.requested`, `restart.waiting`, `restart.exiting` and `restart.resumed`, plus `restart.cancelled` or `restart.failed` when the restart doesn't go through.

### The restart loop

The office can't reliably respawn itself on Windows, so the launcher has to loop: it runs the office again whenever it exits with code 75. The launcher also sets `AGENT_OFFICE_LAUNCHER_LOOP=1`, so the office knows that exiting will bring it back. Without that variable, the button reads **⏸ Pause, wait, then exit**, and Settings says *start-office.ps1 needs the restart loop*. The office then pauses, waits, and exits with code 0, and you start it again by hand. The next start still resumes the floors it paused.

Open pages tell you which happened. During a restart through the loop they show **Restarting… reconnecting**, and reload by themselves once the office is back. When the office exits without the loop (or you press Ctrl+C), they show **The office has stopped. Start it again with start-office.ps1**. They also show that when the office disappears without saying why (a crash) and doesn't answer the page's next few reconnects. Either way, the page reloads by itself as soon as the office is back.

In `start-office.ps1`, wrap the line that runs the office:

```powershell
$env:AGENT_OFFICE_LAUNCHER_LOOP = '1'
do {
  node "$PSScriptRoot\agent-office-src\bin\agent-office.js" @officeArgs
  $code = $LASTEXITCODE
} while ($code -eq 75)
```

Keep the rest of the launcher (the token, the password, `PATH`) above the loop, so a restart inherits it.

## Update

The office runs from our fork's source build in `agent-spike\agent-office-src`, branch `main`:

1. Pull the new `main` (feature branches are merged through `staging/integration` and tried on a [test office](test-offices.md) first).
2. `npm run build`.
3. Restart the office with **🔁 Restart safely** (see [Releasing and restarting safely](#releasing-and-restarting-safely)), or by hand after pausing the projects. Then press **Ctrl+F5** in the browser.

## Helper scripts

In `agent-spike\`: `queue-runs.mjs` (queue issues on a floor with a model), `add-floor.mjs` (add a repository as a floor) and `token-check.mjs` (what the agents' token can reach; it never prints the token).
