---
title: App Factory documentation
description: Everything about Agent Office, the AI Taskforce Labs App Factory, where teams of Claude Code agents build Mendix apps and you run them as their Project Manager.
---

Agent Office is a web app that runs on your laptop. **Claude Code agents** work at desks in it, on **GitHub repositories**. Our fork turns it into an **App Factory for Mendix**:

- every project (one Mendix app in its own repo) is a **floor** of the building;
- every floor has a **team**: a Project Coordinator and four Leads, each with Claude Code subagents;
- the agents build the app with **mxcli** and follow the **mxcli-project-toolkit**;
- **you are the Project Manager**: you approve what matters and answer escalations.

![The Command Center of a project](images/command-center.png "The Command Center: what needs you, the project summary and the Project Coordinator console")

## Start here

| If you want to… | Read |
|---|---|
| Run the office and give a team its first task, in 15 minutes | [Quick start](get-started/quick-start.md) |
| Create a new Mendix project with the wizard | [Create your first project](get-started/first-project.md) |
| Learn your way around the screens | [A tour of the office](get-started/tour.md) |
| Understand floors, workers, worktrees and views | [Concepts](concepts/_index.md) |
| Know who the agents are and when they need you | [Teams & Agents](teams-and-agents/_index.md) |
| Look up a command, a setting or an API route | [Reference](reference/_index.md) |
| Fix something that went wrong | [Troubleshooting](troubleshooting/_index.md) and the [FAQ](faq.md) |

## What's in these docs

- **Get Started**: the quick start, the new-project wizard, and a tour.
- **Concepts**: the building, floors, workers, worktrees, the four views, and how work flows from an issue to a merged PR.
- **Using the Office**: one page for every screen, from `/home` and the Command Center to the Git tab, Settings, the [Audit log](using-the-office/audit-log.md) with its [Incidents](using-the-office/incidents.md), and [The Firm](using-the-office/the-firm.md).
- **Teams & Agents**: the team model, autonomy levels, escalations, the review loop, benching, Playbooks, models and costs.
- **Automation**: Jeff · Router, skills and gates, and the subagent track record.
- **Integrations**: GitHub, mxcli, the toolkit, and the CI pipeline on every pull request.
- **Administration**: running and restarting the office, tokens and security, where data lives, test offices.
- **Reference**: the `office-workers` CLI, MCP tools, API endpoints, settings, environment variables, keyboard shortcuts, URL parameters and the glossary.
- **Troubleshooting** and the **FAQ**: what to do when something goes wrong, and answers to the questions people ask.
- **Release notes**: what changed, release by release, from `CHANGELOG.md`.

> [!NOTE]
> These docs sit behind the office's sign-in, like the rest of the office, because they name token files, folders and ports. They are Markdown files in the repository under `docs/site/`. Change one, run `npm run build`, and the page here changes too. See [Writing these docs](administration/writing-docs.md).
