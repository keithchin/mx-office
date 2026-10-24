---
title: URL parameters
description: Addresses you can bookmark or share - projects, tabs and their old names, Settings sections, teams, board filters, the Model tab, incidents, test runs, Home, The Firm, Clients, the phone version, sign-in and the docs.
weight: 8
---

The address always says where you are, so you can bookmark or share it. The parameter for a project is called `floor` (an internal name kept so old links work); its value is the project's id.

## Project pages (`/lite`)

| Parameter | Values | Example |
|---|---|---|
| `floor` | A project's id | `/lite?floor=acme-orders` |
| `tab` | The page. Without it a project opens on its Overview (the Command Center), or on the tab that browser tab showed last. See [Tab ids](#tab-ids) | `&tab=standup` |
| `ws` | `dev` (old name `app`): the [Developer view](../using-the-office/developer-view.md), on the section closest to `tab`; `pm` (old name `eng`): Project Management, an App section in `tab` mapped to its page there | `&ws=dev&tab=approvals` (opens Decisions) |
| `section` | With `tab=settings`: the Settings section. See [Settings sections](#settings-sections) | `&tab=settings&section=notify` |
| `team` | With `tab=teams`: `management`, `design`, `development`, `testing`, `analysis` | `&tab=teams&team=testing` |
| `teams` | With `tab=board`: the team filter, comma-separated | `&tab=board&teams=design,testing` |
| `incident` | With `tab=audit`: opens the Incidents sub-tab on that incident (Needs you and Teams cards link this way) | `&tab=audit&incident=<id>` |
| `run` | With `tab=tests`: opens that run on the [Test Mode page](../administration/test-mode-page.md) (admins) | `&tab=tests&run=<id>` |
| `ref`, `doc`, `type`, `changes`, `zoom` | With `tab=model`: the branch, the document on show (`Module.Name`, or the module for a domain model) and its type, `1` to mark what the branch changed, and the zoom it opens at (`100`). See [Model tab](../using-the-office/model.md) | `&tab=model&ref=office/ada-1&doc=Shop.ACT_Order_Save&type=microflow&changes=1` |
| `open` | `studio`: once the project is open, asks to open it in Studio Pro (the same checks and confirmation as the Overview's button), then takes itself out of the address. Home's project card ⋯ › Edit in Studio Pro links this way | `&open=studio` |

### Tab ids

| `tab=` | Page (Portal navigation group) |
|---|---|
| `command` | Overview (General). The default |
| `org` (old name `team`) | Team (General) |
| `teams` | Team boards (General) |
| `documents` (old name `deliverables`) | Documents (General) |
| `app`, `requirements`, `decisions`, `review`, `release` | The [Developer view](../using-the-office/developer-view.md)'s sections (General › Developer opens `app`; the others are in its own section bar) |
| `board` | Board (Project Management) |
| `approvals` | Approvals (Project Management) |
| `questions` | [Questions](../using-the-office/questions.md) (Project Management) |
| `design` | [Design gallery](../using-the-office/design-systems.md) (Project Management) |
| `standup` | Standup (Project Management) |
| `analysis` | Analysis (App Insights) |
| `budget` | Budget (App Insights) |
| `audit` | Audit log (App Insights) |
| `testing` | [Testing](../using-the-office/testing.md) (App Insights) |
| `security` | [Security baseline](../using-the-office/security-baseline.md) (App Insights) |
| `git` | Git (Repository) |
| `model` | Model (Repository) |
| `live` | [Live app](../using-the-office/live-app.md) (Deployment) |
| `walkthroughs` | [Walkthroughs](../using-the-office/walkthroughs.md) (Deployment) |
| `workers` (or `agents`) | Agents (Monitoring) |
| `tests` | Tests, the [Test Mode page](../administration/test-mode-page.md) (Monitoring; shown to admins only) |
| `settings` | [Settings](../using-the-office/settings.md) (under the rule at the bottom) |

An id that isn't one of these opens the project as if no tab were asked. A link to a page only admins see in the navigation still opens it for anyone; the server still refuses what that person may not do.

### Settings sections

`&tab=settings&section=` takes `you`, `workers` (Agents), `team`, `jeff` (Jeff · Router), `notify` (Notifications), `budget`, `connections` (admins), `portfolio` (Client), `deliverables` (Documents), `incidents`, `stuck` (Stuck detection), `studio`, `appearance`, `advanced`, `testing` (admins), `verification` (admins) and `danger` (Danger zone, admins). See [Settings](../using-the-office/settings.md). The list hides the admin sections from others, but a link to one still shows it (its actions stay admin-only).

## 2D Office view (`/pixel`)

`/pixel?floor=<id>`.

## Home (`/start`) and old links (`/`)

`/start` is Home. It takes no parameters and tidies any away. A bare `/` (or `/index.html`) goes to Home. `/?floor=<id>` opens that project's 1D view, and any other old 3D-view link (`/?view=3d`, `/?gfx=low`) opens the 1D view (the 3D and Retro views are gone).

## Projects page (`/home`)

| Parameter | Values |
|---|---|
| `tab` (or a bare `#<tab>`) | `projects`, `stats`, `overview`, `audit`, `budget` or `agents`. `?tab=portfolios` (Clients' old home) goes to `/clients` |
| `profile` | With `tab=agents`: opens that [agent profile](../using-the-office/agents.md) (`prf_…`) |
| `new` | Opens the new-project wizard (where First-run setup's last step sends you) |

The address is tidied back to `/home` once it's open; this browser remembers the tab.

## Clients, The Firm and the phone

| Address | Opens |
|---|---|
| `/clients?client=<id>` | That client's page |
| `/firm?report=<id>` | One of [The Firm](../using-the-office/the-firm.md)'s reports |
| `/firm?audit=<project id>` | The Call an audit wizard for that project, straight away |
| `/firm?floor=<project id>` | The project the Call an audit wizard picks when you open it |
| `/m?floor=<id>&item=<id>` | The [phone version](../using-the-office/phone-version.md) on that project's Needs you, with that item lit up (where a push notification goes) |

## Signing in

| Address | What |
|---|---|
| `/login?next=<page>` | Sign in, then go back to that page (Home, Projects, a project, the 2D view, the docs or the phone version) |
| `/login#key=<key>` | A one-time sign-in link from the office's terminal |
| `/join#<token>` | An invite link: make your own account |
| `/claim?t=<token>` | A one-time password reveal (the token works once) |
| `/setup` | [First-run setup](../get-started/new-machine.md); takes no parameters |

## Docs (`/docs`)

| Address | Shows |
|---|---|
| `/docs` | The docs home |
| `/docs/<section>` | A section and its pages |
| `/docs/<section>/<page>#<heading>` | A page, at a heading |
| `/docs/search?q=<words>` | Search results |

Sign-in returns you to the page you asked for.

## What stays the same

Links from Teams cards, phone push, the desktop tray, the docs and bookmarks use the ids above, so they keep working. A regrouped navigation is being considered (see [Proposals](../architecture/proposals.md)); it is a **proposal**, not current behaviour, and it would keep every id and old name on this page.
