---
title: Live app problems
description: The live app (or the walkthroughs' recording app) won't start, a port is taken, a stale build fails, symlink privileges on Windows, or mxcli can't be found.
weight: 2
---

Open the **🌐 Live app** tab for its status and note. The full log is `<office data>/live/<project>.log`.

## "Address already in use"

Another process holds a port. The office picks three free ports from **8110–8199** for each app, and a fourth for the Console's recording proxy while it runs; click **⟳ Restart** and it picks again. If you need other ports, set `AGENT_OFFICE_LIVE_PORTS`.

## "An error occurred while loading page … broken widget" / "Blocked a frame … cross-origin frame"

**Cause:** the app was shown in a frame inside another page (the tab's **Preview here**, or an older office's built-in viewer). Mendix's pluggable widgets, such as Data grid 2, read the top window, which the browser refuses across origins, so the page fails to load. The Console's Runtime log shows it as a *Client* error.

**Fix:** use **↗ Open live app**, which shows the app in a window of its own, or in the desktop app **Show here**, which shows it top-level in the tab. The app itself is fine.

## "The current license does not allow more users to sign in." / "Sign in failed."

**Cause:** the live app runs without a Mendix licence, and an unlicensed Mendix app keeps only **6 sessions** open at once. It counts sessions, not people: every sign-in holds one (the same account signed in twice holds two), and in an app with guest access every window that opens the app holds an anonymous one too. Closing a window doesn't end its session: it ends when someone signs out, about 15 minutes after its window was closed (the 10-minute session timeout, then the runtime's cleanup), or when the app restarts. Each browser holds its own (the desktop app's Live app window and **Show here** share one). The Mendix client says *The current license does not allow more users to sign in.*; Mendix's own sign-in page (`login.html`) says only *Sign in failed.* Either way the Runtime log says *Maximum number of sessions exceeded! (You are currently using a trial license)*, and the Live app tab shows a hint saying so.

**Fix:** sign out in windows of the app you don't need, or wait a few minutes, or **⟳ Restart** (a restart ends every session). There is no runtime setting that lifts the cap for a local run: only a Mendix licence does.

## The Console's Network is empty

Requests are recorded only when the app is opened with **↗ Open live app** (or the Overview's **View App**), which go through the office's recording proxy. A tab opened on the app's own port, or a link copied before the proxy was up, isn't recorded. If the note under **Open live app** says the proxy isn't up, **⟳ Restart** the app.

## "initial build failed: Object reference not set…" after an update

**Cause:** stale build output in the live clone's `deployment/` folder.

**Fix:** the office clears the build folders under `deployment/` (keeping `deployment/data`) and retries once, by itself. If it still fails, **■ Stop** and **▶ Start** again.

## "A required privilege is not held by the client"

**Cause:** `mxcli run --local` wants to create a symbolic link, which needs extra rights on Windows.

**Fix:** create the directory **junction** mxcli names in the error instead:

```bat
cmd /c mklink /J <link> <target>
```

Or turn on Windows **Developer Mode**, which allows symbolic links.

## "mxcli not found"

Set `AGENT_OFFICE_LIVE_MXCLI` to mxcli's full path. The launcher sets it to `agent-spike\bin\mxcli.exe`; check that the file is there.

## The database can't be reached

The live app uses the local PostgreSQL (`127.0.0.1:5432`, database `<project>_live`). Check the PostgreSQL service is running. Change the host, user or password with `AGENT_OFFICE_LIVE_DB_*`.

## It shows an old version

It updates within about a minute of a merge to `main`. The commit line says how far behind it is (*2 commits behind main @f790bed*); click **⟳ Restart** to catch up at once. Auto-update can be turned off with `AGENT_OFFICE_LIVE_POLL_SECONDS=0`.

It runs `main` only: work still in an open PR isn't in it (the readiness card and the *main is behind the work* banner say which).

## "Live app can't check for updates: …"

**Cause:** the project's folder couldn't fetch `main` from GitHub (the reason is git's own: no credentials, no network). The app keeps running the commit named.

**Fix:** make sure the office's git can reach the repository (`gh auth setup-git` on the office's machine, so a fetch in the project's folder works), then **⟳ Restart**.

## "stopped (crashed at 10:27)"

**Cause:** the Mendix runtime stopped under a running app, and mxcli exited rather than stay up over a dead app. The note shows mxcli's last lines; the full log is `<office data>/live/<project>.log`, the runtime's own `.mxcli/runtime.log` in the live clone.

**Fix:** **⟳ Restart** (admin).

## It didn't start after a restart of the office

That's by design: live apps don't start by themselves. Click **▶ Start** (admin).

## Walkthroughs: "the recording app didn't start"

The [Walkthroughs](../using-the-office/walkthroughs.md) page records against the office's own copy of the app, started the way the live app is. Every card of the batch says which phase failed, after how long, why, and what to do; the full output is `<office data>/testing/work/<project>/instance-rec.log`.

- **"bundling the web client timed out after 5m0s"**: a cold web client bundle on a busy machine, most often while a live app was building at the same moment. The office already waits for a building live app and tries once more by itself; when the card says it failed twice, record again once the machine is quieter. The workspace is kept between batches, so the next start is warm (seconds, not minutes). A newer mxcli that takes `--web-client-timeout` is given 15 minutes.
- **"port 8110 was taken by something else on this machine"** (the runtime's *No Runtime Jetty server available. Please call update_appcontainer_configuration*): something bound the app's port between the office picking it and the runtime starting. The office tries once more on other ports; if that fails too, find what listens there (`netstat -ano | findstr :8110`) and stop it.
- **"the app didn't answer on port … within 8 min"**: mxcli was still working when the office gave up (it waits longer while mxcli is bundling). Raise the limit with `AGENT_OFFICE_LIVE_READY_SECONDS` if the machine is always this slow.
- **A build error** (*initial build failed: …*): the model doesn't build at that commit; it isn't tried again. The next start clears the workspace's build first.
