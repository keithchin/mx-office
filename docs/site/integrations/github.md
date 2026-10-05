---
title: GitHub
description: The AI-Taskforce-Labs organization, the agents' and admin tokens, team labels, and how issues and pull requests flow through the office.
weight: 1
---

## The organization

Project repositories live in the **AI-Taskforce-Labs** organization (private repos). The wizard creates new ones there by default; set `AGENT_OFFICE_PROJECT_ORG` to use another organization.

## Two tokens

| Token | File | Who uses it | Can |
|---|---|---|---|
| **Agents' token** | `~/.agent-office-gh-token` | The office and every worker (as `GH_TOKEN`) | Fine-grained, owner **AI-Taskforce-Labs**, all repositories: Contents, Issues and Pull requests read and write. Can't create or delete repos. |
| **Admin token** | `~/.agent-office-admin-gh-token` | Only the server, only for `gh repo create` in the wizard | Fine-grained, owner the org, all repositories: Administration and Contents read and write. |

Because the agents' token covers *all* repositories of the org, a new project needs no token change.

> [!IMPORTANT]
> Neither token is ever printed. The launcher refuses an agents' token that isn't fine-grained (`github_pat_…`). The admin token is read just before use, passed only to that one `gh` process, and blanked out of every log and error. See [Security & tokens](../administration/security-and-tokens.md).

## Team labels

Each card belongs to a team through its label: `team:design`, `team:development`, `team:testing`, `team:analysis`, `team:management`.

- Leads add `--label team:<team>` on `gh pr create`. A Lead's PR without one gets it from the office.
- Approved standup proposals become issues with their team's label.
- Admins can change a card's team in its hover preview.
- Jeff can label unlabelled issues (when triage is On).
- The office creates any missing `team:` labels in the repository when asked.

## Issues and pull requests in the office

- The board reads the floor's issues and PRs with `gh`, and shows checks, reviews and the CI scorecard.
- **☰ → 📌 Issues** and **🔀 Pull requests** open them in full in the office.
- An issue moves to **In progress** the moment a worker has it.
- A worker that opens its own PR shows it at its desk. When the office can't tell, an agent links it with `office-workers pr <number>`.

## Your own GitHub account

People with their own office account can sign in to GitHub under **☰ → 🔐 Your sign-ins**. Workers they hire then run as them, and the office's token is removed from those workers' environment.
