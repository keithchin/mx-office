---
title: Live app problems
description: The live app won't start, a port is taken, a stale build fails, symlink privileges on Windows, or mxcli can't be found.
weight: 2
---

Open the **🌐 Live app** tab for its status and note. The full log is `<office data>/live/<floor>.log`.

## "Address already in use"

Another process holds a port. The office picks three free ports from **8110–8199** for each app; click **⟳ Restart** and it picks again. If you need other ports, set `AGENT_OFFICE_LIVE_PORTS`.

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

The live app uses the local PostgreSQL (`127.0.0.1:5432`, database `<floor>_live`). Check the PostgreSQL service is running. Change the host, user or password with `AGENT_OFFICE_LIVE_DB_*`.

## It shows an old version

It updates within about a minute of a merge to `main`. If it doesn't, click **⟳ Restart**. Auto-update can be turned off with `AGENT_OFFICE_LIVE_POLL_SECONDS=0`.

## It didn't start after a restart of the office

That's by design: live apps don't start by themselves. Click **▶ Start** (admin).
