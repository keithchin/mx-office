---
title: Security & tokens
description: The office password and who is admin, the agents' and admin GitHub tokens, the Jev key, what workers can and can't see, and why the docs are behind the sign-in.
weight: 2
---

## Secret files

| File | What | Read by |
|---|---|---|
| `~/.agent-office-password` | The office password | The launcher, into `AGENT_OFFICE_PASSWORD` |
| `~/.agent-office-gh-token` | The **agents' GitHub token** | The launcher, into `GH_TOKEN` / `GITHUB_TOKEN` for the office and its workers |
| `~/.agent-office-admin-gh-token` | The **admin GitHub token** | The server only, just before the wizard's `gh repo create` (`AGENT_OFFICE_ADMIN_GH_TOKEN_FILE` to move it) |
| `~/.agent-office-jev-key` | Jeff's **Jev key** | The server, by path (`AGENT_OFFICE_JEV_KEY_FILE`) |

> [!CAUTION]
> Never print, paste, commit or screenshot these files. Refer to them by path only. If one leaks, revoke it on GitHub (or TypeSafe) and write a new file.

## Who is admin

Anyone who signs in with the **shared office password** is an admin, that is, the Project Manager. Admin-only actions: hiring and benching team members, approvals and escalation answers, settings, the live app's start and stop, creating projects, changing team labels, re-analysing.

People can also have their own accounts (**☰ → 🔑 Accounts**, admin only), with their own Claude and GitHub sign-ins.

## The agents' token

- **Fine-grained**, owner **AI-Taskforce-Labs**, **all repositories**, with **Contents**, **Issues** and **Pull requests** read and write.
- It can't create or delete repositories, or change the organization.
- Covering all repositories means a new project needs no token change.

## The admin token

- Fine-grained, owner the organization, all repositories, **Administration** and **Contents** read and write.
- The server reads it just before use and doesn't keep it. It's passed only to the one `gh repo create` process, never put in the office's environment, and blanked out of logs and errors (as is anything that looks like a GitHub token).
- The wizard page only checks *that* the file exists; it never sees the token.

## What workers can't see

The office removes from every worker's environment: the Jev key variables (`TYPESAFE_API_KEY` and all `AGENT_OFFICE_*` settings), and, for workers that run as a signed-in person, the office's own GitHub token.

## The Firm's reviewers can't write

The Firm's Reviewer Agents get no GitHub tokens, SSH agent or credential manager, work in a clone with no remote, and have deny rules for `git push`, GitHub writes, `gh api`, and reading `~/.agent-office*` and `~/.ssh`. See [The Firm → Isolation](../using-the-office/the-firm.md#isolation-no-shared-context-no-bias).

## The audit log

The [audit log](../using-the-office/audit-log.md) records sign-ins, settings changes, hires, escalations, approvals, GitHub actions and The Firm's steps, hash-chained so an edit shows. It never records token values; prompt text only when an admin turns it on. Exporting it is admin-only and is itself logged.

## The docs are behind the sign-in

`/docs` uses the same sign-in as the rest of the office, because these pages name token files, folders and ports. The original upstream docs in the repository (`docs/*.md`) stay readable on GitHub.

## The office is local

By default the server listens on `127.0.0.1` only. To share it, see the upstream guides in the repository (`docs/self-hosting.md`, `docs/tunnel.md`): HTTPS, a reverse proxy, or a tunnel.
