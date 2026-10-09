---
title: URL parameters
description: Addresses you can bookmark or share - floors, tabs, teams, board filters, views, graphics and the docs.
weight: 8
---

The address always says where you are, so you can bookmark or share it.

## 1D view (`/lite`)

| Parameter | Values | Example |
|---|---|---|
| `floor` | A floor's id | `/lite?floor=travel-approval` |
| `tab` | `command`, `board`, `teams`, `workers`, `analysis`, `live`, `git`, `model`, `org`, `standup`, `approvals`, `settings`, `tests` (the [Test Mode page](../administration/test-mode-page.md), admins; `&run=<id>` opens a run) (`team` is an old name for `org`) | `&tab=standup` |
| `team` | With `tab=teams`: `management`, `design`, `development`, `testing`, `analysis` | `&tab=teams&team=testing` |
| `teams` | With `tab=board`: the team filter | `&teams=design,testing` |
| `ref`, `doc`, `type`, `changes`, `zoom` | With `tab=model`: the branch, the document on show (`Module.Name`, or the module for a domain model) and its type, `1` to mark what the branch changed, and the zoom it opens at (`100`). See [Model tab](../using-the-office/model.md) | `&tab=model&ref=office/ada-1&doc=Shop.ACT_Order_Save&type=microflow&changes=1` |

## 2D view (`/pixel`)

`/pixel?floor=<id>`.

## 3D office (`/`)

| Parameter | Values |
|---|---|
| `view` | `1d`, `2d`, `3d`, `retro` (also on the other pages, to switch) |
| `gfx` | `low`, `medium`, `high` |

## Home (`/home`)

`?tab=projects`, `?tab=stats` or `?tab=overview` (or `#overview`). The address is tidied back to `/home` once it's open.

## Docs (`/docs`)

| Address | Shows |
|---|---|
| `/docs` | The docs home |
| `/docs/<section>` | A section and its pages |
| `/docs/<section>/<page>#<heading>` | A page, at a heading |
| `/docs/search?q=<words>` | Search results |

Sign-in returns you to the page you asked for.
