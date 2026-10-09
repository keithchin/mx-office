# Configuration

Back to the [README](../README.md).

## Where the office keeps things

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The building's map is in `~/agent-office/.agent-office/map.json`, and maps of your own go in `~/agent-office/.agent-office/maps/` (see [Maps](maps.md)). The list of floors is `~/agent-office/.agent-office/floors.json`, and each account's own Claude and GitHub sign-ins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again. An admin can take that project off the building in the elevator like any other floor.

## The new-project wizard

**✨ New project** (on the home page and in the elevator) creates a project repository and sets it up with the mxcli project toolkit instead of only cloning one. Only admins can run it. It needs these on the office's machine, each found where it usually is unless an environment variable says otherwise:

| What | Variable | Default |
| --- | --- | --- |
| The toolkit clone | `AGENT_OFFICE_TOOLKIT_DIR` | `~/agent-spike/mxcli-project-toolkit` |
| Git Bash, which runs the toolkit's scripts | `AGENT_OFFICE_BASH` | `C:\Program Files\Git\bin\bash.exe` |
| mxcli (put first on the scripts' PATH) | `AGENT_OFFICE_MXCLI` | `~/agent-spike/bin/mxcli.exe` |
| The folder jq is in | `AGENT_OFFICE_JQ_DIR` | winget's `jqlang.jq` package folder |
| Python, written into `.claude/toolkit.env` | `AGENT_OFFICE_PYTHON` | the newest `%LOCALAPPDATA%\Python\pythoncore-*` |
| Where Studio Pro versions are installed (each `<version>\modeler` with `mxbuild` and `mx`; the newest 11.12 is the default) | `AGENT_OFFICE_MENDIX_DIR` | `C:\Program Files\Mendix` |
| The organization new repositories go in | `AGENT_OFFICE_PROJECT_ORG` | `AI-Taskforce-Labs` |
| The admin token's file | `AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` | `~/.agent-office-admin-gh-token` |

**The admin token.** The agents' GitHub token can't create repositories, on purpose. Repository creation uses a second token, read from its file only when `gh repo create` runs and passed to that one command as `GH_TOKEN`: never to a worker, never into a log or a browser. Make it a fine-grained token with the organization as resource owner, access to all its repositories, and **Administration: Read and write** plus **Contents: Read and write**, and save it as the file's only line. Without one, the wizard explains this and offers **I created the repository myself on GitHub**: it then clones the repository you made and carries on.

**What it does**, a step at a time, each step checking first what's already done so a failed one can be retried: create the repository, clone it as a floor, write `.claude/toolkit.env` (git-ignored), create the Mendix app for a new project (Studio Pro's `mx create-project --app-name <Name> --output-dir <repo>`, a blank `<Name>.mpr` at the repository's root where the toolkit looks for it, about 15 seconds; `mxcli new` when that Studio Pro has no `mx`; Mendix's generated files go into `.gitignore`), run the toolkit's `init-project.sh` (a few minutes on Windows; after the app, so it names the `.mpr`), install its pre-commit hook, write the intake answers and the kickoff decisions (entry mode, size tier, Mendix version, interview mode) into `intake.md` and `PROJECT.md`, save the client, operators and roles in `agent-office.project.json` at the repository's root (committed with the project), refresh the gate dashboard, commit and push (the scaffold and the app in one commit), optionally open a "Discovery" issue for the Chief Analyst, hire the ticked roles on the new floor the Team tab's way (the Project Coordinator and the Leads, each on its role's model, but the Chief Analyst on the Discovery dropdown's model when it's handed the issue; one already at work isn't hired again), and queue the Discovery issue for an agent, or hand it to the Chief Analyst as its first task when it's on the team. The interview mode is the toolkit's own word (`steering`, `assist` or `auto`, what `interview-mode.sh` reads from `PROJECT.md`); intake Q9 says attended or unattended alongside it. Every command runs with stdin closed and a time limit. A step whose command has gone without its end reaching the office is run once more by itself ("try 2 of 2" in its log) before it stops for **Retry**. Setups are kept in the office's `.agent-office/wizard/`, so one the office stopped in the middle of carries on with **Retry**. **Changes to an existing app** skips the repository and the app (it only reports which Studio Pro the `.mpr` was saved with, and the wizard preselects that version when the repository is a floor already) and runs the toolkit's existing-app path on a repository that's already there.

Until a toolkit project's build plan (Stage 4) is confirmed, its board on the 1D view has a **🧰 Project setup** panel: the stages from kickoff to build plan with gate-check's verdicts, what's next, the open questions, and buttons back into the wizard to change the answers (which writes them again and commits them, and hires any role ticked since, unless the floor has had it in any state: at work, benched or sent home). **🔄 Re-check gates** (admins only) runs the toolkit's `gate-check.sh` over the floor's checkout in the background, about a minute: it rewrites the project's `index.html` dashboard and the "Current stage" line in `PROJECT.md` (left uncommitted for the next commit), so the panel's verdicts are fresh. It changes nothing else and decides nothing; the panel says the same in **What does Re-check gates do?**.

**A floor's `.claude/toolkit.env`** is laid over the office's environment for everything started for that floor: its workers (agents and shells, hired by hand, by the roster or off the queue), Re-check gates, the wizard's toolkit runs and the live app. Its keys (`MXBUILD_PATH`, `MXCLI_VERSION`, `PYTHON` …, never `PATH` or `AGENT_OFFICE_*`) win over the inherited ones, because the toolkit's own scripts let the environment win over the file: an office started with `MXBUILD_PATH` set for one Studio Pro would otherwise build every project with it. A floor without the file keeps the office's environment.

`AGENT_OFFICE_WIZARD_OFFLINE=<folder>` is for a test office: repositories are local bare git repositories in that folder, issues are files there, nobody is hired and nothing is queued, so the whole setup runs for real without touching GitHub.

## Command line

```
agent-office [dir] [options]

      --home <dir>        Where the office keeps its data without a [dir] (default ~/agent-office)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo> (default ~/agent-office;
                          also settable from ⚙️ Settings)
  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 127.0.0.1; 0.0.0.0 lets your network in)
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD)
      --no-open           Don't open the office in your browser when it starts
      --agent <cmd>       Default agent command (default "claude")
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
      --dsh-profile <n>   DeepSeek Harness profile over ACP (default "acp")
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
                          (env AGENT_OFFICE_TURN, several separated by spaces)
      --budget <usd>      Daily tracked Claude Code budget (OpenCode/Codex/Grok/Muse/DSH excluded)
      --budget-pause      ...and nobody can hire a new worker until the next day
      --max-workers <n>   Run at most n workers at once, across every floor (env AGENT_OFFICE_MAX_WORKERS)
      --webhook <url>     Post to this Slack / Discord webhook when a worker needs input or finishes
      --city <name>       Put the office in a real city: its sun and live weather (open-meteo.com)
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or fog
      --real-time-sky     Start the sky on the real clock, not a day an hour (env AGENT_OFFICE_SKY_CLOCK=real; ⚙️ Settings can switch it)

agent-office setup [--projects <dir>] [--project <owner/repo>]... [--home <dir>]

  The first-start walkthrough again: the workspace folder, GitHub sign-in and
  repositories to clone as floors. With --projects / --project it asks nothing.
  Run it while the office is stopped.

agent-office prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .agent-office/worktrees/ and their
  office/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given. A worker across several projects has worktrees of them in its
  own floor's workspace: prune each project to clear those out.

agent-office accounts [list | invite [name] [--admin] | revoke <name> | role <name> admin|member | password on|off] [-d <dir>]

  Invite, list and revoke people's own accounts, and switch the shared password
  off or on. Works while the office runs.

agent-office tunnel [office@address | url] [--port <n>] [--office-port <n>] [--name <name>] [--password <pw>] [--no-open] [--insecure] [-- <ssh options>]

  On your own computer, for an office that runs somewhere else: every web server
  a worker starts there opens on the same port here, by itself, and closes when
  the worker stops it. Given an SSH address it opens the tunnel to the office too.
  See docs/tunnel.md.
```

## The live app

The 1D view's **🌐 Live app** tab (see [Features](features.md)) runs each floor's Mendix app with `mxcli run --local`. It needs mxcli, a JDK for the project's Mendix version and a PostgreSQL the office can reach. Set any of these in the environment, or in `<data dir>/live-app.json` (the environment wins):

| Environment | `live-app.json` | Default | What |
| --- | --- | --- | --- |
| `AGENT_OFFICE_LIVE_MXCLI` | `mxcli` | `mxcli` on PATH | The mxcli to run |
| `AGENT_OFFICE_LIVE_PORTS` | `ports` | `8110-8199` | Ports to hand out; each app takes three (app, admin API, mxbuild) |
| `AGENT_OFFICE_LIVE_DB_HOST` | `dbHost` | `127.0.0.1:5432` | PostgreSQL host and port |
| `AGENT_OFFICE_LIVE_DB_USER` | `dbUser` | `postgres` | PostgreSQL user (it creates `<floor>_live` when that's missing) |
| `AGENT_OFFICE_LIVE_DB_PASSWORD` | `dbPassword` | `postgres` | Its password |
| `AGENT_OFFICE_LIVE_POLL_SECONDS` | `pollSeconds` | `60` | How often a running app asks GitHub whether main moved (`0`: never) |
| `AGENT_OFFICE_LIVE_READY_SECONDS` | `readySeconds` | `480` | How long a start may take before it counts as failed |
| `AGENT_OFFICE_LIVE_PG_BIN` | | found | The folder with `psql`, when it isn't on PATH (on Windows the newest `Program FilesPostgreSQL<v>in` is used) |

The data dir is `.agent-office` in the project the office was started in, or `~/agent-office/.agent-office`. On Windows, if mxcli stops with *A required privilege is not held by the client* while linking a Mendix runtime, make the link it names as a directory junction (`cmd /c mklink /J <link> <target>`), which needs no admin.

The PR checks on the board look for runs of `AGENT_OFFICE_PR_CHECKS_WORKFLOW` (default `pr-checks.yml`) and take screenshots from the first artifact named in `AGENT_OFFICE_PR_SHOTS_ARTIFACTS` (default `screenshots,test-results`), with the office's own `gh` sign-in.
