---
title: API endpoints
description: Every HTTP route of the office server - method, path, whether it needs the sign-in, admin-only actions, and what it's for.
weight: 3
---

The office's HTTP routes, in the order the server tries them (`src/server/http/routes/`). **Public** routes answer anyone. **Session** routes need a signed-in browser: without one, `/api/*` gets `401` and pages redirect to `/login`. Most real-time traffic goes over the WebSocket at `/ws` instead.

## Sign-in and health (public)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Sign in |
| GET | `/api/login` | Which sign-in fields exist |
| POST | `/api/join` | Accept an invite |
| GET / POST | `/api/claim` | Check / claim a generated password with its token |
| POST | `/api/link` | One-time sign-in link key |
| POST | `/api/logout` | Sign out |
| any | `/api/health` | `{ ok: true }` when the office is up |
| any | `/assets/*` | The client bundle's files |
| any | `/login`, `/claim`, `/join`, `/favicon.svg` | Pages |

## The office (session)

| Method | Path | Purpose |
|---|---|---|
| any | `/api/whoami` | The signed-in person, with the admin flag |
| GET | `/api/agents/<provider>/models` | A provider's model list |
| GET | `/api/image` | An image file |
| any | `/api/whiteboard/file` | A whiteboard file |
| any | `/api/term/drop` | A file dropped onto a terminal |
| any | `/api/changes/file` | A changed file's content |
| GET | `/api/docs`, `/api/docs/*` | The floor's own Markdown (the bookshelf) |
| GET | `/api/search` | Search the chat and terminals |
| GET | `/api/services` | Workers' web servers (port forwards) |
| GET | `/api/gh/pull`, `/api/gh/issue`, `/api/gh/labels`, `/api/gh/pull/diff` | GitHub PR and issue windows |
| GET | `/api/git` | The branch map |
| GET | `/api/analysis` | The analysis report (`?scope=global`, `?floor=`, `&by=effort`) |
| POST | `/api/analysis/backfill` | Re-record every worker (admin) |
| GET | `/api/judge` | Jeff · Router's summary for a floor |
| GET | `/api/summary` | The project summary |
| GET | `/api/ranking` | The A–F worker ranking (`?floor=`, or all) |
| GET | `/api/home/stats` | The office's totals |
| GET | `/api/home/overview` | Every floor, for the 2D Overview |
| GET | `/api/pr-shots` | A PR's CI scorecard and screenshots |
| GET | `/api/pr-shots/file` | One screenshot |
| GET | `/api/roster` | The floor's team |
| GET | `/api/roster/standup` | One standup with its page |
| POST | `/api/roster/action` | Team actions (see below) |
| GET | `/api/studio` | `?floor=`: whether the floor has a Mendix project (`hasMpr`, `mpr`, `version`), whether Studio Pro can be opened from here, the agents mid-turn, and Studio mode (`state`: `open`, `since`, `pid`, `staleLock`, `mcp`, `uncommitted`); changes come over the WebSocket as `studio.state` |
| POST | `/api/studio/open` | `{ floor }`: opens the floor's .mpr in Studio Pro on the office's computer (admin) |
| GET | `/api/teams/page` | A team's page, with its 📦 deliverables |
| GET | `/api/deliverables`, `/api/deliverables/*` | 📦 Deliverables: `?floor=<id>[&team=<team>][&fresh=1]` lists every expected and extra deliverable with its status and where it is (main, which is `origin/<default>` when the project has a remote, a team member's worktree, an office branch), with `main` and `checkout` saying what main was and where the folder is; `/file?floor=&src=main\|wt:<worker>\|ref:<branch>&path=[&download=1]` serves one (HTML self-contained under a no-network CSP for a sandboxed frame, PDF, pictures, text); `/table?…` a CSV's first 200 rows. Only catalog paths, only places the scan listed, size-capped |
| POST | `/api/teams/labels` | Create missing `team:` labels (admin) |
| GET / POST | `/api/connections` | [Connections](../administration/connections.md) (admin): GET `/api/connections` (statuses and masked tails, never a value) and `/api/connections/tools` (the git / gh check); POST `/api/connections/save`, `remove`, `test` (`{ id }`, plus `value` to save), `import`, `mendix-floor` (`{ floor, on }`), `paths` (`{ which, dir }`), `git-identity`, `sweep` (`{ on }`), `sweep/run` |
| GET / POST | `/api/wizard/*` | The new-project wizard: GET `info`, `job`, `setup`, `answers`, `app-version` (`?repo=`: the Studio Pro an existing floor's `.mpr` was saved with); POST `recheck`, `start`, `retry`, `edit` (admin) |
| GET | `/api/chatter` | Team chatter: `?floor=<id>&since=<ms>&limit=<n>&cursor=…&who=<name>` (with `as=<kind>` to tell a person from an agent of the same name) or `&with=agents\|me` |
| GET | `/api/audit` | The audit log: `?floor=<id>\|all\|_office&since=&until=&actor=human,agent&action=worker.hire,github&q=&limit=&cursor=`, with counts, the chain check and a histogram |
| GET | `/api/audit/export` | Every matching event as a download, `&format=csv\|jsonl` (admin) |
| POST | `/api/audit/settings` | `{ promptText }`: log the first 80 characters of prompts, or not (admin) |
| GET | `/api/notify/teams` | [Teams notifications](../integrations/teams-notifications.md): the settings (never the webhook URL, only a hint), the last error, the last card, what's waiting and held, and the floors |
| POST | `/api/notify/teams` | `{ url?, floors?, level?, quiet?, pauseMinutes?, publicUrl? }`: change them; `url: ''` removes the webhook (admin) |
| POST | `/api/notify/teams/test` | Post a test card now (admin) |
| GET | `/api/keep-awake` | Keep-awake: the setting, the idle minutes, whether the office is holding the computer awake and what's running |
| POST | `/api/keep-awake` | `{ on?, idleMinutes? }` (admin) |
| GET | `/api/project-run` | `?floor=`: [Resume and pause](../using-the-office/resume-and-pause.md): the floor's pause (`by`, `at`, `why`, who's `waiting` on you), its latest resume or pause run with each agent's status, and its pacing |
| GET | `/api/project-run/preview` | `?floor=`: ▶ Resume project's dry run: each asleep or benched agent's reasons, safety checks, default action and options in waking order; who's awake; `blocked` (the spend cap) and warnings (Studio mode). Wakes nobody |
| POST | `/api/project-run` | `{ floor \| all: true, action: resume\|pause\|cancel\|hold\|continue\|pacing, choice?: { mode: work\|all\|pick, picks? }, pacing?: { concurrent, gapSec } }` (admin) |
| GET | `/api/office/restart` | [🔁 Restart safely](../administration/running-the-office.md#releasing-and-restarting-safely): its phase, who it's waiting on, whether there's a restart loop and new commits to build, a failed build's log |
| POST | `/api/office/restart` | `{ action?: start\|wait\|anyway\|cancel, build?, timeoutMin? }` (admin; a script may send JSON with its cookie and no Origin) |
| GET | `/api/flows` | The [workflow](../automation/workflows.md) runs, newest first: id, workflow, status, step, why it stopped, floor, tries. `?floor=<id>`, `?workflow=<id>`. Never a run's state |
| GET | `/api/firm` | The Firm's people, its engagements (newest first) and the floors an audit can be called on |
| GET | `/api/firm/engagement` | `?id=`: one engagement with its whole transcript |
| GET | `/api/firm/status` | `?floor=`: the floor's running audit and alerts, for its 1D view |
| GET | `/api/firm/defaults` | `?floor=`: the audit wizard's starting configuration and its estimate |
| POST | `/api/firm/estimate` | `{ config }`: what a configuration would cost, as an estimate |
| GET | `/api/firm/report` | `?id=`: a delivered report; `&format=md\|json` downloads it (admin) |
| POST | `/api/firm/action` | `{ action: start \| cancel \| models, … }`: call or cancel an audit, set reviewers' models (admin, the Project Manager) |

### /api/roster/action

Actions: `hire`, `bench`, `rename`, `model`, `settings`, `standup`, `decide`, `escalation`, `skill`, `subagent`, `subagent-decide`. All are **admin-only** except `standup`. POSTs must come from the office's own pages (same origin).

## Pages (session)

| Path | Page |
|---|---|
| `/`, `/index.html` | The 3D office |
| `/home` | Home |
| `/lite` | The 1D view |
| `/pixel` | The 2D view |
| `/firm` | The Firm (`?report=<id>` opens a report) |
| `/docs`, `/docs/*` | These docs; `/docs/site.json` is their bundle, `/docs/images/*` their pictures |
| `/*` | Anything else in the client bundle, or 404 |

## The hook server (workers only)

A separate loopback server, whose port is in `<office data>/hook-port`, answers the workers: `/office/workers` (and `/home`, `/tell`, `/pr`, `/escalate`, `/subagent`), `/office/queue`, `/office/studio` (the Studio mode hook saying it held an mxcli write, for the audit log) and Claude Code's `/hooks/*`. Each worker has its own token.
