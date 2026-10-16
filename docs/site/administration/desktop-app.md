---
title: Desktop app (preview)
description: Run Mx Office in a window of its own, with a tray icon that counts what needs you, native notifications, and restarts the app manages. It still runs the office from your checkout with your Node.js.
weight: 1.5
---

The desktop app is Mx Office in a window of its own instead of a browser tab: a tray icon that says how many things need you, a Windows notification for each new one, and the office's start, restart and stop handled by the app. It's a **preview**: there's no installer, no auto-update and no code signing yet (see [What's not there yet](#whats-not-there-yet)).

The office itself is unchanged. The app runs it the way `npm start` does, from **your own checkout and build**, with **the Node.js installed on your computer**, and keeps its data where it always is (`<office home>\.agent-office`, the office home being `AGENT_OFFICE_HOME` or `%USERPROFILE%\agent-office`). People who run the office in a browser, with `scripts\start-office.ps1` or `npm start`, notice nothing: Electron lives in its own folder (`desktop\`) and never enters the office's dependencies or build.

## Run it

You need what the office needs anyway (Node.js 22.5 or newer, the checkout, `npm install` and `npm run build` done: [Set up on a new machine](../get-started/new-machine.md)). Then, once, in the office's folder:

```powershell
npm --prefix desktop install     # Electron itself, into desktop\node_modules (about 160 MB to download)
```

and to start it:

```powershell
npm run desktop:dev
```

For a folder you can start without a terminal:

```powershell
npm run desktop:pack             # desktop\out\Mx Office-win32-x64\mx-office.exe
```

On a network that cuts long downloads, `npm --prefix desktop install` and the pack can fail fetching Electron (about 160 MB from GitHub). Download `electron-v44.4.5-win32-x64.zip` another way, check it against the release's `SHASUMS256.txt`, and set `ELECTRON_ZIP_DIR` to its folder for `npm run desktop:pack`; for `desktop:dev`, unzip it into `desktop/node_modules/electron/dist` and write `electron.exe` into `desktop/node_modules/electron/path.txt`.

Keep that folder where it is (inside the checkout), or start `mx-office.exe` with `--office-dir <checkout>`: the app looks for the office above its own folder, then asks for it (**Choose the office folder…**) and remembers your choice.

### Options

Anything after `npm run desktop:dev --`, or after `mx-office.exe`:

| Option | Environment | What |
| --- | --- | --- |
| `--office-dir <folder>` | `MX_OFFICE_DIR` | The office checkout to run |
| `--home <folder>` | `AGENT_OFFICE_HOME` | The office home (its data is `<home>\.agent-office`) |
| `--port <n>` | `MX_OFFICE_PORT`, else `PORT` | The office's port (default 4600) |
| `--node <node.exe>` | `MX_OFFICE_NODE` | The Node.js to run it with (default: the one on `PATH`) |
| `--attach ask\|always\|never` | | When an office already answers on the port: ask (default), open it, or refuse |
| `--user-data <folder>` | `MX_OFFICE_DESKTOP_DATA` | Where the app keeps its own files (window, notifications seen, cookies) |
| | `MX_OFFICE_DESKTOP_TEST=1` | For automated checks: the window opens off-screen without taking focus, and notifications are recorded instead of shown |
| `-- <office options>` | | Passed to the office as they are, such as `-- --city Berlin` |

A [test office](test-offices.md) in the app, never touching the real one:

```powershell
npm run desktop:dev -- --port 4791 --home C:\Users\<you>\agent-spike\scratch\test-offices\desktop --user-data C:\Users\<you>\agent-spike\scratch\test-offices\desktop\app -- --test-mode --password test-only-123 --agent C:\path\fake-agent.cmd
```

## What it does

- **Starts the office, or opens the one already running.** When nothing answers on the port, the app starts the office as its child, waits for `/api/health`, and opens the window **signed in** (a one-time link the office hands the app over a private channel, like the link a terminal start opens). A new office opens on its [first-run setup](../get-started/new-machine.md#step-3-the-first-run-setup). When an office **already answers** on the port (started with the launcher, say), the app asks and opens that one instead: it **never starts a second office** beside it on the same data, and it won't stop or restart an office it didn't start. A port held by another program is reported.
- **The window** remembers its size and place. Links that leave the office (GitHub, docs, Teams) open in your default browser.
- **The tray icon** says what needs you: its tooltip (*Mx Office: 3 need you*, and the build), a red badge with the count on the taskbar icon, and a menu with **Open Mx Office**, the count and the build, **Mute notifications**, **Restart office…**, **Open office log**, **About Mx Office** and **Quit Mx Office**. It counts the same red items the [Teams notifications](../integrations/teams-notifications.md) post (agents asking, escalations, decisions, a budget pause, incidents, stuck work), read every 30 seconds with the window's own sign-in (`GET /api/desktop/status`). Signed out, it says so.
- **Native notifications**: one per new item, with its project and who it's from; clicking one opens the item in the window. Each item notifies once, also across restarts of the app and of the office; the very first time, one notification says how many are already waiting. **Mute notifications** in the tray stops them (the count stays).
- **Restart office…** starts [🔁 Restart safely](running-the-office.md#releasing-and-restarting-safely) (every project paused, agents finish their turn, then the office exits for a restart) and the app starts the office again, like the launcher's loop. When a safe restart can't start (you're not an admin, not signed in, or the office isn't answering), the app offers **Restart now**, which restarts it at once: agents mid-turn are cut off and carry on when it's back.
- **When the office stops unexpectedly**, the window says why, with the last lines of its log and **Restart the office**. The office's output goes to `<office home>\.agent-office\desktop-office.log` (kept under 5 MB, the one before as `.1`).
- **Quit** (the tray, the window's ✕, Ctrl+Q) stops the office cleanly, what Ctrl+C does in a terminal: held messages and the queue are saved, and its agents stop. When agents are working, it asks first: *3 agents are working. Stop the office and quit?*, with **Keep running in the tray** to let them finish. An office the app only attached to keeps running.

If Node.js or the build is missing, the window says what to do (install Node.js, or run `npm install` and `npm run build` in the checkout) with a link to [Set up on a new machine](../get-started/new-machine.md), and **Try again**.

## What's not there yet

| Missing | What it needs |
| --- | --- |
| **An installer** (Start menu entry, uninstall) | electron-builder's NSIS or an MSIX target; MSIX needs the signing below |
| **Auto-update** | A signed build and somewhere to publish releases (GitHub Releases or an internal share) for electron-updater; until then, `git pull` and `npm run build` update the office as before, and `npm run desktop:pack` the app |
| **Code signing** | A Siemens code-signing certificate (or IT approval of the unsigned app): without it SmartScreen warns on first start and managed machines may block `mx-office.exe` |
| **Its own Node.js** | On purpose: the system Node avoids rebuilding the office's terminal library (node-pty) for Electron |
| **macOS and Linux builds** | `npm run desktop:pack` builds for the platform it runs on; only Windows is tried so far |
