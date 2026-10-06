---
title: Running the office
description: Start the office from the desktop shortcut or the launcher, sign in on port 4600, restart it safely on Windows, and update it.
weight: 1
---

## Start

Pick one:

- **The Agent Office icon** on the desktop or the taskbar. It runs `agent-spike\open-agent-office.ps1`: if the office doesn't answer on `http://127.0.0.1:4600/api/health`, it starts the launcher in a new PowerShell window, waits up to 90 seconds, and opens your browser.
- **Ask Claude Code**: *"Run Agent Office"*.
- **By hand**, from Git Bash:

```bash
cmd //c start "Agent Office" powershell -NoExit -ExecutionPolicy Bypass -File "C:/Users/<you>/agent-spike/start-office.ps1"
```

Then open `http://127.0.0.1:4600`, sign in with the office password, and press **Ctrl+F5** after an update.

## What the launcher does

`agent-spike\start-office.ps1`:

1. Reads the agents' GitHub token from `~/.agent-office-gh-token` (it refuses one that isn't fine-grained) and sets it as `GH_TOKEN` for the office only, so every worker inherits it.
2. Reads the office password from `~/.agent-office-password` into `AGENT_OFFICE_PASSWORD`.
3. Sets `AGENT_OFFICE_JEV_KEY_FILE` to the *path* of `~/.agent-office-jev-key` (never its contents).
4. Puts `agent-spike\tools\mxcli` (`agent-spike\bin` before the layout change) on `PATH` and sets `AGENT_OFFICE_LIVE_MXCLI` to mxcli.
5. Runs the source build, `agent-office-src\bin\agent-office.js`, on the mx-spike floor's folder (so the office data is in `mx-spike\.agent-office\`).

The office listens on port **4600** (`--port` or `PORT` to change it).

## When it comes up

- Saved workers come back and **resume their sessions** by themselves.
- **Live apps don't start by themselves.** Open the 🌐 Live app tab and click ▶ Start.

## Stop

Close the **Agent Office** PowerShell window (or press Ctrl+C in it). This stops the office **and every running agent**.

## Restarting

> [!WARNING]
> On Windows, workers are child processes of the office server. **Restarting the office stops all running agents**, even mid-task. Check the board first, and avoid restarting while agents are in the middle of something.

Their sessions are saved in each floor's `workers.json`. When the office comes back, it resumes the agents that were **mid-turn** (working, or asking something) from their saved sessions, with a prompt to carry on that reminds them their escalations are still open. The rest stay asleep (💤), sessions kept, and wake when prompted (by you, or by the office with an answer, a relay or a standup) or when you press **R** at their desk: a restart no longer starts a session for every desk. If a resume fails, a fresh session starts and a toast says so. What the office still had to pass on to the Project Coordinator and the Leads is kept in the roster file, so it isn't lost either.

## Update

The office runs from our fork's source build in `agent-spike\agent-office-src`, branch `main`:

1. Pull the new `main` (feature branches are merged through `staging/integration` and tried on a [test office](test-offices.md) first).
2. `npm run build`.
3. Restart the office (see the warning above), then **Ctrl+F5** in the browser.

## Helper scripts

In `agent-spike\`: `queue-runs.mjs` (queue issues on a floor with a model), `add-floor.mjs` (add a repository as a floor) and `token-check.mjs` (what the agents' token can reach; it never prints the token).
