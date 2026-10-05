---
title: Agents and GitHub
description: Agents that stop, hang or wait on a setup prompt, benched or asleep Leads, commits that hang, token problems, and CI emails.
weight: 1
---

## An agent waits on a setup prompt (trust / login)

**Symptom:** the agent shows as waiting, and its terminal asks whether to *trust this folder*, or to log in.

**Fix:** open its terminal and answer the prompt once. Claude Code asks this the first time it runs in a new folder (a new worktree).

## An agent stopped after a restart

**Cause:** on Windows, restarting the office stops every running agent.

**Fix:** the office resumes them from their saved sessions when it comes back. An agent shown asleep (💤) wakes when you open it, or click **⏰ Wake** on its card. See [Running the office](../administration/running-the-office.md#restarting).

## A Lead is benched

**Cause:** you (or idle benching, if you turned it on) benched it. Idle benching is **off by default**.

**Fix:** click **🤝 Hire again** on its card in the Org chart. It starts fresh from its handoff note. See [Benching and handoffs](../teams-and-agents/benching-and-handoffs.md).

## An agent seems idle but says it's waiting on me

It may have asked in its last message without raising an escalation. Open its terminal (it's in **Needs you** as *finished, not looked at yet*) and answer there. To catch these automatically, switch Jeff's **Waiting on you** judgement to **On**. See [Jeff · Router](../automation/jeff-router.md).

## Hiring is refused

- **💸 Hiring is paused**: the floor's daily cost cap is spent. Raise it in Settings, or wait for midnight (Singapore time). See [Models and costs](../teams-and-agents/models-and-costs.md).
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
