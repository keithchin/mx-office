---
title: Toolkit versions
description: Each project runs on its own pinned commit of the mxcli-project-toolkit; the Toolkit line shows how far behind the fork it is, Update toolkit previews the gate changes before moving the pin, and how to sync the fork with Maurits' repository.
weight: 2.7
---

Every project runs on **its own pinned commit** of the [mxcli-project-toolkit](../integrations/toolkit.md), not on whatever the shared clone (`agent-spike\mendix-toolkit`) happens to be on. A new commit in the fork, or a `git pull` of the shared clone, no longer reaches a project halfway through a stage: you move a project to a newer toolkit yourself, with **Update toolkit**, after seeing what it would change.

## Why

The toolkit's session-start ritual (written into every project's `CLAUDE.local.md` by its `init-project.sh` and `sync-project.sh`) starts with `git -C <toolkit> pull --ff-only`. Every agent session ran it, so the shared clone moved whenever the fork did, and every project, mid-stage or not, was suddenly checked by new gate rules. Pinning stops that:

- A project's toolkit is a **pin**: a read-only, detached checkout of one commit at `agent-spike\mendix-toolkit-pins\<sha>` (next to the clone, one folder per commit, shared by every project on that commit).
- The project's instruction files (`CLAUDE.local.md`'s Wiring table and ritual, the wiring block in `CLAUDE.md` and `AGENTS.md`, the routing table, `docs/progress/RESUME.md`, `.claude/agents/`) name the pin, and the ritual's pull becomes `git -C <pin> rev-parse --short HEAD`. An **Agent Office block** above the ritual says the toolkit is pinned, never to pull, fetch or check out in that folder, and that a newer toolkit only comes through Update toolkit.
- The team's Playbooks and the Discovery brief say the same, and point their toolkit skills at the pin.
- Even an agent following old wording can't move it: a pull in a detached checkout fails.
- The office's own gate-check runs (the setup panel's verdicts, **🔄 Re-check gates**, the wizard) run from the project's pin, with no fetch.
- The floor's machine-local `.claude/toolkit.env` gets `MXTK_ROOT=<pin>`, which the toolkit's own scripts use to find the toolkit.

## Where the version is recorded

| Where | What | Who reads it |
|---|---|---|
| `agent-office.project.json` (committed) | `toolkit`: the commit, when and by whom, the fork's URL, and the history (create, pin, update, rollback) | Agents, any office that clones the project, Roll back |
| `PROJECT.md` (committed) | `Toolkit commit: <sha>`, the toolkit's own acknowledgement line that gate-check's protocol-freshness check compares against | The toolkit |
| `<office data>\toolkit-pins.json` | Floor → pin, and when the fork was last fetched | The office (no git needed) |

## The Toolkit line

The **🧰 Project setup** panel has a Toolkit line, and the progress bar ends with a small 🧰 chip (it stays after the setup panel goes away):

> 🧰 toolkit 7b4b4cf (2026-10-08) · 3 newer commits available (fix/new/gate-rule changes) · 📌 pinned

Each newer commit is classed **fix** (`fix:`, `fix(…):`, `Windows:`), **new** (`new:`, `feat:`) and **gate rule** when it touches what decides a stage verdict: `bin/gate-check.sh`, its tables in `bin/lib/` (artifact and obligation checks, entry mode, closeout), `skills/conversion-runbook.md` or `skills/checkpoints/`. Click the line or the chip for the **Toolkit** window: the commit and where it runs from, every newer commit with its kind, the previous pin, when the fork was last fetched and **🔄 Check now**.

The office fetches the fork **off the page and off its main thread, at most every six hours** (and when someone clicks Check now, at most once a minute). Opening a page never fetches; the line is answered from a cache.

A project made before pins shows **≈ &lt;sha&gt; · not pinned**: the office worked its commit out from `PROJECT.md`'s `Toolkit commit:` line, or else from the scripts the toolkit copied into its `bin/` (the newest toolkit commit whose version of each matches). With neither, it says *toolkit version unknown — pin now*.

## Update toolkit (admins)

From the Toolkit window:

1. **⬆ Preview update to &lt;sha&gt;** (or **📌 Preview pinning at &lt;sha&gt;** for a project that isn't pinned yet, or **↩ Preview roll back to &lt;previous&gt;**). The office checks the project's default branch out twice in temporary folders. Over one it runs the toolkit's `gate-check.sh` from the toolkit the project runs now. The other it first makes what Confirm would leave (the steps below, the toolkit's `sync-project.sh` included), then runs `gate-check.sh` from the new commit. Nothing in the project or the floor's folder is written. It takes several minutes on Windows (the sync is the slow part). It shows:
   - which stage verdicts would change, and why: *Stage 2 (Requirements) PASS → FAIL because BRD drift: rules unsynced*;
   - the commits in between, with their kinds;
   - a warning when the project's current stage is mid-way (its gate hasn't passed yet). Updating is allowed at any time, but the recommended moment is right after a stage passes.
2. **✅ Confirm**. In a temporary worktree of the default branch the office:
   - makes the new pin and points the instruction files at it (the ritual's pull stays out);
   - brings the scripts the toolkit copied into `bin/` up to the new commit, but only those the project never changed (still byte-for-byte the old commit's version). Edited ones are left for the toolkit to report;
   - runs the toolkit's own `sync-project.sh` from the new pin, which refreshes intake questions, agent stubs, routing and so on as the toolkit intends, and never overwrites edited files;
   - sets `PROJECT.md`'s `Toolkit commit:` line and the record in `agent-office.project.json`;
   - commits **`chore(toolkit): update to <sha>`** (with the commits in its message) and pushes it to the default branch. If the branch is protected or has moved, it pushes `agent-office/toolkit-<sha>-…` instead and asks you to open a pull request.

   Then the office moves the floor to the new pin, re-checks the gates, writes the hired team's Playbooks again, records `toolkit.update` in the [audit log](../using-the-office/audit-log.md) and removes pins no project uses any more.

**Roll back** is the same thing to the previous pin (kept in the record's history): **↩ Preview roll back**, then confirm. It's recorded as `toolkit.rollback`.

New projects start on the fork's newest commit: the wizard fetches the fork, pins the newest commit of its default branch (or the shared clone's HEAD, if that has commits the fork hasn't pushed), and runs `init-project.sh` from the pin. The shared clone itself is never moved.

## Syncing the fork with Maurits' repository

The shared clone's `origin` is our fork (AI-Taskforce-Labs/mxcli-project-toolkit: Maurits' commits plus our Windows fixes) and its `upstream` is Maurits' repository (MendixMau/mxcli-project-toolkit, push disabled). When the clone has an `upstream` remote, the Toolkit window shows how far the fork is behind it (and ahead, with our own fixes). The office only reads that; it never adds remotes, merges or pushes the fork. To bring Maurits' changes in:

```bash
cd ~/agent-spike/mendix-toolkit
git fetch upstream
git checkout main
git merge upstream/master        # fast-forward when we have nothing of our own; else resolve and commit
git push origin main
```

The upstream branch is `master`; our fork's default branch is `main`. Prefer a pull request on the fork when the merge isn't a fast-forward, so our Windows fixes survive review. After the fork moves, nothing changes for a running project until you update it: its Toolkit line shows the new commits, and its Update toolkit preview shows what they'd do to its gates.

## Moving the projects made before pins

Each one shows *≈ &lt;sha&gt; · not pinned*. For each: open its Toolkit window at a stage boundary, **📌 Preview pinning at &lt;sha&gt;** (stays on the commit it's effectively on) or **⬆ Preview update to the newest**, and confirm. Its instruction files then point at the pin (older projects still name `agent-spike\mxcli-project-toolkit`; that's replaced too), and its ritual stops pulling. Until then it keeps running on the shared clone, as before.

## Suggested change in the toolkit itself

The pull lives in the toolkit's templates (`bin/init-project.sh`'s `CLAUDE.local.md` heredoc and `bin/sync-project.sh` section 2b), and `sync-project.sh` appends it again to a project that lacks the ritual. The office takes it out again after every sync, but the cleaner fix belongs upstream: skip the pull when the toolkit checkout is a detached HEAD (or when `MXTK_TOOLKIT_PINNED=1`), and don't warn about not being on the default branch in that case.
