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
| GET | `/api/teams/page` | A team's page |
| POST | `/api/teams/labels` | Create missing `team:` labels (admin) |
| GET / POST | `/api/wizard/*` | The new-project wizard: GET `info`, `job`, `setup`, `answers`; POST `recheck`, `start`, `retry`, `edit` (admin) |

### /api/roster/action

Actions: `hire`, `bench`, `rename`, `model`, `settings`, `standup`, `decide`, `escalation`, `skill`, `subagent`, `subagent-decide`. All are **admin-only** except `standup`. POSTs must come from the office's own pages (same origin).

## Pages (session)

| Path | Page |
|---|---|
| `/`, `/index.html` | The 3D office |
| `/home` | Home |
| `/lite` | The 1D view |
| `/pixel` | The 2D view |
| `/docs`, `/docs/*` | These docs; `/docs/site.json` is their bundle, `/docs/images/*` their pictures |
| `/*` | Anything else in the client bundle, or 404 |

## The hook server (workers only)

A separate loopback server, whose port is in `<office data>/hook-port`, answers the workers: `/office/workers` (and `/home`, `/tell`, `/pr`, `/escalate`, `/subagent`), `/office/queue` and Claude Code's `/hooks/*`. Each worker has its own token.
