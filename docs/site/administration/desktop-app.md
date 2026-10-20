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

The exe, its taskbar button, the window and the tray show the office's Mx mark (the same tile as the browser tab's icon), from `desktop/assets/`: `icon.ico` with every Windows size, `icon.png` at 512 px, and `tray.png`/`tray@2x.png` at the tray's own sizes. They're committed, so packing needs nothing extra; when the mark (`src/client/public/favicon.svg`) changes, run `node desktop/scripts/make-icons.mjs` and commit what it writes. The app identifies itself to Windows as `com.mxoffice.desktop`, so its taskbar button and notifications group together; a shortcut pinned before the icon changed may keep the old one until you unpin it and pin the app again.

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
| | `MX_OFFICE_DESKTOP_TEST=1` | For automated checks (`desktop/scripts/e2e.mjs`): the window opens off-screen without taking focus, notifications are recorded instead of shown, questions are answered by the check instead of shown, and port 4600 is refused |
| `-- <office options>` | | Passed to the office as they are, such as `-- --city Berlin` |

A [test office](test-offices.md) in the app, never touching the real one:

```powershell
npm run desktop:dev -- --port 4791 --home C:\Users\<you>\agent-spike\scratch\test-offices\desktop --user-data C:\Users\<you>\agent-spike\scratch\test-offices\desktop\app -- --test-mode --password test-only-123 --agent C:\path\fake-agent.cmd
```

## Same office as the launcher

The app starts `bin\agent-office.js` directly, without `start-office.ps1`, and sets none of the launcher's variables. It doesn't need to: the office makes those choices itself, so an office the app starts behaves exactly like one the launcher starts.

| The launcher used to set | What the office does without it |
| --- | --- |
| `PATH` with `agent-spike\tools\mxcli` first, `AGENT_OFFICE_LIVE_MXCLI`, `AGENT_OFFICE_MXCLI` | Uses the mxcli picked in 🚀 First-run setup, else the workspace's `tools\mxcli\mxcli.exe`, before any `mxcli` on `PATH`, for the live app, the Model tab, Testing and the wizard, and puts its folder first on the agents' `PATH` ([mxcli](../integrations/mxcli.md)) |
| `AGENT_OFFICE_TOOLKIT_DIR` | The toolkit picked in 🔌 Connections › Paths, else `mendix-toolkit` (or `agent-spike\mendix-toolkit`) in your home folder |
| `AGENT_OFFICE_HOME`, `AGENT_OFFICE_PROJECTS` | The app's `--home` (default `%USERPROFILE%\agent-office`); new projects go in the home |
| `GH_TOKEN` / `GITHUB_TOKEN` from `~/.agent-office-gh-token`, `AGENT_OFFICE_JEV_KEY_FILE` | [🔌 Connections](connections.md), else the same dot-files, read by the office itself |
| `AGENT_OFFICE_PASSWORD` from `~/.agent-office-password` | 🔌 Connections, else that file's first line, read by the office itself (never in test mode) |
| `AGENT_OFFICE_LAUNCHER_LOOP` | Set by the app, so 🔁 Restart safely is offered |

A variable you set yourself still wins, as with the launcher. The office prints the mxcli it uses at start (`mxcli:` in `desktop-office.log`); no secret is ever logged.

## What it does

- **Starts the office, or opens the one already running.** When nothing answers on the port, the app starts the office as its child, waits for `/api/health`, and opens the window **signed in** (a one-time link the office hands the app over a private channel, like the link a terminal start opens). A new office opens on its [first-run setup](../get-started/new-machine.md#step-3-the-first-run-setup). When an office **already answers** on the port (started with the launcher, say), the app asks and opens that one instead: it **never starts a second office** beside it on the same data, and it won't stop or restart an office it didn't start. A port held by another program is reported.
- **The window** remembers its size and place. Links that leave the office (GitHub, docs, Teams) open in your default browser.
- **Show here** on a project's 🌐 Live app tab shows the running app inside the office window, top-level: the app draws its own view over the tab's viewer area, so Data grid 2 and the other widgets that read the top window work (in a browser the tab can only show a frame, where they fail). That view has the *Live app* window's own browser session (none of the office's cookies), runs sandboxed without Node, opens only the project's recording-proxy address (the app asks the office for it, `GET /api/desktop/liveapp`, and refuses any other), and sends links to other sites to your default browser. The tab's toolbar drives it: **Back** and **Forward** are the app's real history, the address is where the app really is, and **🛠 Tools** opens its developer tools. Because a native view always sits above the page, it steps aside while an office dialog, menu or toast is over it, while another tab shows, and when scrolled out of view, and it closes when you leave the project. The office page reaches the app only through a small bridge in the window's preload (`window.mxOfficeDesktop.embed`), which the app checks again for every message.
- **The tray icon** says what needs you: its tooltip (*Mx Office: 3 need you*, and the build), a red badge with the count on the taskbar icon, and a menu with **Open Mx Office**, the count and the build, **Mute notifications**, **Restart office…**, **Open office log**, **About Mx Office** and **Quit Mx Office**. It counts the same red items the [Teams notifications](../integrations/teams-notifications.md) post (agents asking, escalations, decisions, a budget pause, incidents, stuck work), read every 30 seconds with the window's own sign-in (`GET /api/desktop/status`). It never claims more than the last look showed: signed out, it says *Sign in to see what needs you*; when the office stops answering it says so, and a count it last confirmed earlier stays only as *2 need you · as of 14:05, office not answering* (the taskbar badge only ever shows a count the last look confirmed). When the office answers again the tray picks up where it was, without notifying again for items you were already told about. **About Mx Office** shows when the count was last confirmed.
- **Native notifications**: one per new item, with its project and who it's from; clicking one opens the item in the window. Each item notifies once, also across restarts of the app and of the office; the very first time, one notification says how many are already waiting. **Mute notifications** in the tray stops them (the count stays).
- **Restart office…** starts [🔁 Restart safely](running-the-office.md#releasing-and-restarting-safely) (every project paused, agents finish their turn, then the office exits for a restart) and the app starts the office again, like the launcher's loop. When a safe restart can't start (you're not an admin, not signed in, or the office isn't answering), the app offers **Restart now**, which restarts it at once: agents mid-turn are cut off and carry on when it's back.
- **When the office stops unexpectedly**, the window says why, with the last lines of its log and **Restart the office**. The office's output goes to `<office home>\.agent-office\desktop-office.log` (kept under 5 MB, the one before as `.1`).
- **Quit** (the tray, the window's ✕, Ctrl+Q) stops the office cleanly, what Ctrl+C does in a terminal: held messages and the queue are saved, and its agents stop. When agents are working, or the office can't say whether they are, it asks first: *3 agents are working. Stop the office and quit?*, with **Keep running in the tray** to let them finish. An office the app only attached to keeps running. Once you quit, the app is gone within a few seconds, every `mx-office.exe` with it: its Live app windows and a **Show here** view close without asking their page (a live app's sign-in page can otherwise cancel the close, and with it the quit), the tray goes, and if anything still holds on 5 seconds later the app writes what it was in `desktop-office.log` (*desktop app: quit: still running…*) and exits anyway. When Windows logs off or shuts down, the app quits without asking, stopping its own office first. Starting the app while a previous one is still on its way out replaces that one instead of handing over to it.
- **An office started elsewhere that stops answering** is shown as not answering, and the app never stops or restarts it. Only if you choose **Start the office here…** in the tray does the app start one of its own, and only after checking that nothing answers on the port (an office answering again is simply opened again; a port something still holds is reported), so there are never two offices on the same port.

If Node.js or the build is missing, the window says what to do (install Node.js, or run `npm install` and `npm run build` in the checkout) with a link to [Set up on a new machine](../get-started/new-machine.md), and **Try again**.

## Checked in CI

Every change to `desktop/` (its source, scripts, `package.json` and lockfile) runs the **desktop** job of `.github/workflows/release.yml` on Windows: `npm ci` in the office and in `desktop/` (Electron 44.4.5 from the lockfile, its download cached), the desktop core's unit tests, `npm run desktop:pack`, and then the packaged `mx-office.exe` driven by `desktop/scripts/e2e.mjs` against throwaway test offices with fake agents. It checks that the app starts the office and opens it signed in; that a Needs-you item notifies once and its click opens the item; that quitting while agents work asks, and **Keep running in the tray** keeps everything running; that a killed office shows the crash page and **Restart the office** brings it back without notifying again; that Quit stops an office the app started; that after Quit, with a Live app window and a **Show here** view open on a page that cancels its unload, no process of the app is left (its whole process tree, checked a few seconds later, in both modes: the tray's Quit with its question answered, and the window's ✕); and, for an office started outside the app, that the app attaches without starting a second one, says signed out on a 401, says *not answering* with its counts marked stale when that office disappears (and starts nothing), recovers without notifying again when it's back, and leaves it running on Quit. On that office it also checks **Show here** against a stand-in app page: refused while the office names no proxy for the project, then shown with `window.top` being the app itself (no SecurityError), its own sandboxed session without the office's cookie, real Back and Forward from the tab's toolbar, hidden under a dialog and on another tab, and gone when the window leaves the project. When the job fails, its logs (the run's output, the app's output, the offices' logs) are uploaded as `desktop-e2e-logs`.

The same check runs on your own Windows machine, never against your real office (port 4600 is refused, every office home is under a `test-offices` folder, test mode and the fake agent are forced, GitHub tokens are taken out of the environment):

```powershell
npm run build
npm run desktop:pack
node desktop/scripts/e2e.mjs --root C:\Users\<you>\agent-spike\scratch\test-offices\desktop-e2e   # --keep keeps the folder, --logs <folder> for the logs
```

It runs the app with `MX_OFFICE_DESKTOP_TEST=1`, so its window stays off-screen, notifications are recorded, and its questions (quit while agents work, Start the office here) are answered by the script. With that set the app also refuses port 4600 outright.

## What's not there yet

| Missing | What it needs |
| --- | --- |
| **An installer** (Start menu entry, uninstall) | electron-builder's NSIS or an MSIX target; MSIX needs the signing below |
| **Auto-update** | A signed build and somewhere to publish releases (GitHub Releases or an internal share) for electron-updater; until then, `git pull` and `npm run build` update the office as before, and `npm run desktop:pack` the app |
| **Code signing** | A Siemens code-signing certificate (or IT approval of the unsigned app): without it SmartScreen warns on first start and managed machines may block `mx-office.exe` |
| **Its own Node.js** | On purpose: the system Node avoids rebuilding the office's terminal library (node-pty) for Electron |
| **macOS and Linux builds** | `npm run desktop:pack` builds for the platform it runs on; only Windows is tried so far |
