---
title: Agents and GitHub
description: Agents that stop, hang or wait on a setup prompt, benched or asleep Leads, commits that hang, token problems, and CI emails.
weight: 1
---

## An agent waits on a setup prompt (trust / login)

**Symptom:** the agent shows as waiting, and its terminal asks whether to *trust this folder*, or to log in.

**Fix:** open its terminal and answer the prompt once.

The office trusts the projects it manages by itself, so this should be rare: when the new-project wizard clones a floor it marks the folder trusted in the office's own Claude Code config (`~/.claude.json`, or `<CLAUDE_CONFIG_DIR>/.claude.json` when the office runs with `CLAUDE_CONFIG_DIR`), and before every Claude worker starts it marks the floor trusted in the config that worker uses (the office's, or the hiring account's own under *Your sign-ins*). Claude Code looks a worktree's trust up by the project it belongs to, so the floor's folder covers every worker's worktree. Only the `hasTrustDialogAccepted` entry for that floor is written (nothing else in the file changes, and nothing is written when it's already there); a config file that isn't valid JSON is left alone, and the prompt shows as before. Test offices never touch a real config. If it still asks, the floor is outside what the office manages (a folder you opened by hand), or the config couldn't be read.

A Claude worker is only flagged when the prompt is actually on its screen. A project with a slow `SessionStart` hook (a toolkit project's `mxcli init --sync-skills` and `mxcli run --setup`) just shows the worker as starting for longer, up to 5 minutes before its desk is let go to idle; and once its session is up, the *Waiting on a setup prompt* line goes away. Other agents (Codex, Grok, Muse, Pi) can't be read like that, so they're still flagged when they haven't said they're up 12 seconds after starting.

## Hiring fails with "Filename too long"

**Symptom:** hiring an agent (or the wizard's *Hire the project team* step) fails with `Could not create a git worktree: … Filename too long`.

**Cause:** a Mendix app's `javascriptsource` holds npm packages with deep `node_modules` folders; inside a worker's worktree under `<floor>/.agent-office/worktrees/` those paths pass Windows' 260 characters.

**Fix:** none needed any more: the office sets `core.longpaths true` in the project's own git config on Windows when the wizard clones it, and before it makes any worker's worktree. On an older office, run `git config core.longpaths true` in the floor's folder once.

## A Haiku agent keeps asking permission

Haiku can't use Claude Code's auto mode, so the office starts Haiku workers in *accept edits* mode: file edits don't ask. Shell commands still follow the project's permission settings, so a `git` or `gh` command may still ask; allow those in the project's `.claude/settings.json` if you want them to run unattended. See [Models and costs](../teams-and-agents/models-and-costs.md#haiku-runs-in-accept-edits-mode).

## An agent stopped after a restart

**Cause:** on Windows, restarting the office stops every running agent.

**Fix:** the office resumes them from their saved sessions when it comes back. An agent shown asleep (💤) wakes when you open it, or click **⏰ Wake** on its card. See [Running the office](../administration/running-the-office.md#restarting).

## A Lead is benched

**Cause:** you (or idle benching, if you turned it on) benched it. Idle benching is **off by default**.

**Fix:** click **🤝 Hire again** on its card in the Org chart. It starts fresh from its handoff note. See [Benching and handoffs](../teams-and-agents/benching-and-handoffs.md).

## An agent seems idle but says it's waiting on me

It may have asked in its last message without raising an escalation. Open its terminal (it's in **Needs you** as *finished, not looked at yet*) and answer there. To catch these automatically, switch Jeff's **Waiting on you** judgement to **On**. By default he only raises it when the end of its message really asks you something. See [Jeff · Router](../automation/jeff-router.md#when-he-escalates).

## Hiring is refused

- **💸 Spend cap reached: office prompts paused**: the floor's daily cost cap is spent. No new hires, and no nudges, scheduled standups, relays or agent-to-agent tells until it lifts; your own answers and typing still go through. Raise it in Settings, or wait for midnight (Singapore time). See [Models and costs](../teams-and-agents/models-and-costs.md).
- Only admins can hire team members.

## Commits hang in a toolkit project

**Cause:** the upstream toolkit's pre-commit hook looped on Windows paths.

**Fix:** use our copy of the toolkit (fixed), in `agent-spike\mxcli-project-toolkit`. In scripts, run git with stdin closed.

## Worktree deleted outside the office

**Symptom:** 🌿 *&lt;name&gt;'s worktree was deleted outside agent-office* in Needs you.

**Fix:** click **Fix** to open that worker. Send it home to free its desk and hire again, or tell it to recreate its worktree and branch.

## The wizard can't create the repository

- Check that `~/.agent-office-admin-gh-token` exists. The wizard's first page says when it's missing, and what token to create: fine-grained, owner the organization, all repositories, **Administration** and **Contents** read and write.
- Or create the repository by hand and tick **I created this repository myself**.

## Agents can't push or open PRs

The agents' token (`~/.agent-office-gh-token`) must be fine-grained, owner **AI-Taskforce-Labs**, **all repositories**, with Contents, Issues and Pull requests read and write. `agent-spike\token-check.mjs` shows what it can reach, without printing it. After changing the file, restart the office.

## GitHub emails about failed runs

The office's own fork runs its full test suite on every push to `main`. An email means something broke there. It never publishes releases. Project repositories send emails when their **pr-checks** fail on a PR. See [CI pipeline](../integrations/ci-pipeline.md).
