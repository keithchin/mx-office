# Configuration

Back to the [README](../README.md).

## Where the office keeps things

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The building's map is in `~/agent-office/.agent-office/map.json`, and maps of your own go in `~/agent-office/.agent-office/maps/` (see [Maps](maps.md)). The list of floors is `~/agent-office/.agent-office/floors.json`, and each account's own Claude and GitHub sign-ins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again. An admin can take that project off the building in the elevator like any other floor.

## The new-project wizard

**✨ New project** (on the floors page and in the elevator) creates a project repository and sets it up with the mxcli project toolkit instead of only cloning one. Only admins can run it. It needs these on the office's machine, each found where it usually is unless an environment variable says otherwise:

| What | Variable | Default |
| --- | --- | --- |
| The toolkit clone | `AGENT_OFFICE_TOOLKIT_DIR` | `~/agent-spike/mxcli-project-toolkit` |
| Git Bash, which runs the toolkit's scripts | `AGENT_OFFICE_BASH` | `C:\Program Files\Git\bin\bash.exe` |
| mxcli (put first on the scripts' PATH) | `AGENT_OFFICE_MXCLI` | `~/agent-spike/bin/mxcli.exe` |
| The folder jq is in | `AGENT_OFFICE_JQ_DIR` | winget's `jqlang.jq` package folder |
| Python, written into `.claude/toolkit.env` | `AGENT_OFFICE_PYTHON` | the newest `%LOCALAPPDATA%\Python\pythoncore-*` |
| Where Studio Pro versions are installed | `AGENT_OFFICE_MENDIX_DIR` | `C:\Program Files\Mendix` |
| The organization new repositories go in | `AGENT_OFFICE_PROJECT_ORG` | `AI-Taskforce-Labs` |
| The admin token's file | `AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` | `~/.agent-office-admin-gh-token` |

**The admin token.** The agents' GitHub token can't create repositories, on purpose. Repository creation uses a second token, read from its file only when `gh repo create` runs and passed to that one command as `GH_TOKEN`: never to a worker, never into a log or a browser. Make it a fine-grained token with the organization as resource owner, access to all its repositories, and **Administration: Read and write** plus **Contents: Read and write**, and save it as the file's only line. Without one, the wizard explains this and offers **I created the repository myself on GitHub**: it then clones the repository you made and carries on.

**What it does**, a step at a time, each step checking first what's already done so a failed one can be retried: create the repository, clone it as a floor, write `.claude/toolkit.env` (git-ignored), run the toolkit's `init-project.sh` (a few minutes on Windows), install its pre-commit hook, write the intake answers and the kickoff decisions (entry mode, size tier, Mendix version, interview mode) into `intake.md` and `PROJECT.md`, save the client, operators and roles in the floor's `.agent-office/project.json`, refresh the gate dashboard, commit and push, and optionally open a "Discovery" issue for the Chief Analyst and queue it. Every command runs with stdin closed and a time limit. Setups are kept in the office's `.agent-office/wizard/`, so one the office stopped in the middle of carries on with **Retry**. **Changes to an existing app** skips the repository and runs the toolkit's existing-app path on a repository that's already there.

Until a toolkit project's build plan (Stage 4) is confirmed, its board on the 1D view has a **🧰 Project setup** panel: the stages from kickoff to build plan with gate-check's verdicts, what's next, the open questions, and buttons back into the wizard to change the answers. **🔄 Re-check gates** runs gate-check over the project for fresh verdicts.

`AGENT_OFFICE_WIZARD_OFFLINE=<folder>` is for a test office: repositories are local bare git repositories in that folder, issues are files there, and nothing is queued, so the whole setup runs for real without touching GitHub.

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
