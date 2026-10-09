---
title: Top bar & menu
description: The 🏠 button, floor picker, Go to Office and Return to Project, the 2D Office view's bar and toolbar, 🎨 color themes, the ☰ menu, the Portal layout's left navigation and search, tab badges and notifications.
weight: 1
---

## The top bar

On the 1D view, from left to right (the 2D Office view's bar is [below](#the-2d-office-views-top-bar)):

| Part | What it does |
|---|---|
| 🔔 | *Turn on notifications*. Shown until your browser has been asked once. Desktop notifications take you to the worker that needs you. |
| 🏠 | Goes to `/home`. |
| **Floor** picker | Switches project. Each option shows `· 🙋 N` when agents there wait on you, or clone progress while a floor is cloning. Under the bar: `⎇ branch · repo/dir · 👥 N here`. |
| **Go to Office** | Opens the project's office from above, the [2D Office view](2d-view.md): the only way there. On the 2D Office view the same place has **Return to Project**, back to the 1D view's Command Center. |
| 🎨 | Lists the color themes. |
| ☰ | The menu. |

When agents wait on another floor, buttons like **🙋 2 waiting on travel-approval →** appear under the bar. They land on that floor's Command Center.

The browser tab's title counts the agents waiting on you, so you see it from other tabs too (projects you stopped watching on Home are left out).

### In the Portal themes

The Portal themes draw the same bar as a navy portal header, the whole width of the window:

| Part | What it does |
|---|---|
| ⋮⋮⋮ launcher | A menu of where to go: **Projects** (Home), **The Firm**, the **Documentation**, **Settings**, and every project. ↑/↓ move, Enter picks, Esc closes. |
| **Mx Office** | The wordmark goes to Home (it stands in for 🏠). |
| Section | The page in capitals: **PROJECTS** on Home, **THE FIRM**, or on a project's pages the page you're on (**OVERVIEW**, **BOARD**…). The project itself is switched in the left navigation's project card (see [Portal layout](#portal-layout)); on the 2D Office view the section is **OFFICE ·** and the floor picker. |
| Search | Finds, as you type, in groups: **Projects**, the **Pages of this project**, its **Agents**, **Issues** and **Pull requests** (by title or `#number`), the **Office** pages and the **Documentation** (by title or heading). The group with the best match comes first. ↑/↓ walk the results, Enter goes there, Esc clears. Everything but the docs is already in the page; the docs' titles are fetched once, the first time you click into the search. On a phone it folds into a 🔍 button. |
| Bell | Opens the [team phone](team-phone.md), with its count (the phone's floating button is still there too). |
| ? | The documentation. |
| Moon / sun | Dark mode: switches between Portal (Light) and Portal (Dark). |
| 🎨 | Every theme, as above. |
| Your initials | The ☰ menu. |

Everything else the bar had (Go to Office, the office's budget chip, TEST MODE, Back to a floor on Home) stays in it. The bell that asks to turn notifications on is in ⚙️ Settings › Notifications instead.

### The 2D Office view's top bar

The [2D Office view](2d-view.md) has the same bar, kept short. In Portal: the launcher, **Mx Office**, **OFFICE · PROJECT ⌄** (the project switcher, opening that project's office), the search, **Return to Project** (the bar's one blue button: back to the project's 1D view, on its Command Center), the bell, help, dark mode, **🎨**, TEST MODE when the office is in test mode, and your avatar (the **☰** menu). The other themes have 🏠, **OFFICE / the project**, **Return to Project**, 🎨 and ☰.

Everything else is on the office's **toolbar**, floating over the top of the canvas:

| Part | What it does |
|---|---|
| Status (left) | What the project's up to (*6 agents working · 9 queued*) over `⎇ branch · folder · 👥 N here`. Hidden on a narrow window. |
| Project group | The project's 💰 budget chip, **● Running \| Pause** (admins pause or resume the project here) and the office's spend today; a chip opens the 1D view's Budget tab. |
| **− Fit +** (right) | Zoom out, fit the whole floor, zoom in (also **−**, **0**, **+**). |
| **⋯** | Next agent waiting on you (**N**), Chat (**T**), Fit the whole floor (**0**), and the keys. |

## Color themes

Click **🎨** and pick one from the list:

- **Portal (Light)** and **Portal (Dark)** (the default since release 26): the look of a low-code platform's web portal. A dark navy top bar (see [In the Portal themes](#in-the-portal-themes)), white pages with slate text, Noto Sans with semibold titles, one strong blue for primary buttons and a deeper blue for underlined links, 1px light-grey lines, light-grey table heads, underline tabs, and cards with a soft shadow. Home becomes a **Projects** page (see [Home](home.md)). Like Clean, **no emoji**. Portal (Dark) keeps the navy bar and the blues on navy and charcoal surfaces. Noto Sans comes from Google Fonts once the page has loaded; without internet the system's sans-serif is used.
- **Clean (Light)** and **Clean (Dark)**: plain and quiet, like VS Code's classic light and dark themes. Neutral greys with a blue accent, a sans-serif font at 13px with a strict type scale and nothing heavier than semi-bold, 2–4px corners and 1px borders, flat buttons and VS Code-style tabs. **No emoji**: they're hidden everywhere, and buttons that were only an emoji (🔔 🏠 🎨 ☰) show line icons instead. The 2D office is barely tinted in Clean (Light) and a neutral grey night in Clean (Dark).
- **Fun**: the office's original warm, chunky light look (called Default before 2026-10-09).
- **Fun (Dark)**: the same look in dark blue-grey, easy on the eyes at night.
- **Terminal**: black and phosphor green, one monospace font, square boxes and faint scanlines. In Terminal, the project summary's *What's happening* types itself out (not if you asked your system for less motion).

The pick is kept in this browser (`agent-office.color-theme` in local storage). It applies to the 1D view, the 2D view (the office is tinted to match), `/home`, The Firm and these docs, and follows along in your other open tabs. Without a pick it's Portal: Portal (Light), or Portal (Dark) when your system is in dark mode. A pick made before (Clean, Fun…) is kept.

![The Dark theme](../images/theme-dark.png)

![The Terminal theme](../images/theme-terminal.png "Terminal: black and phosphor green")

## The ☰ menu

The same menu on the 1D view, the 2D Office view and Home.

| Section | Items |
|---|---|
| **Open** | 🙋 Next worker that needs you (only when someone waits) · 📌 Issues · 🔀 Pull requests · 📋 Task queue · 🌐 Services · 📝 Whiteboard · 🤝 Meeting room · 🔎 Search · 📚 Project docs · 🧱 Open in Studio Pro (Mendix projects; admin) · 🏢 Projects |
| **Together** | 👥 Invite teammates · 🔑 Accounts (admin) · 🔐 Your sign-ins |
| **Office** | ⚙️ Settings · 🏠 Home · 📖 Documentation · ⬆️ Upgrade the office (when an update is there) |

- **📚 Project docs** opens the floor's own Markdown files (its README, `docs/team/*.md`, standups) on the bookshelf.
- **📖 Documentation** opens these docs.
- Red numbers are counts: open issues, open PRs, queued tasks, people waiting on other floors.
- On `/home`, the items that need a floor are left out.

> [!NOTE]
> **⚙️ Settings** in the ☰ menu opens the full Settings page, the 1D view's **⚙️ Settings** tab (`/lite?tab=settings`), from the 1D view, the 2D Office view and `/home` alike. See [Settings](settings.md).

### Portal layout

In a Portal theme the 1D view is laid out like a low-code platform's app pages (the other themes keep the tab row and the bottom bar):

- **The left navigation**, about 230 px wide. At the top a **project card**: the project's tile and name with **⌄**, a click opens the list of projects (it's the floor picker). Below it the pages in groups that open and close (this browser remembers which, per viewer): **General** (Overview, Team, Team boards, Documents), **Project Management** (Board, Approvals, Standup), **App Insights** (Analysis, Budget, Audit log), **Repository** (Git, Model), **Deployment** (Live app) and **Monitoring** (Agents, and Tests for admins). Under a rule: **Settings**, **View App** (the live app in a new tab, or the Live app page when it isn't running) and **Edit in Studio Pro** (Mendix projects). The page you're on is a grey pill, and its group opens by itself. Each item carries its tab's badge; a closed group shows its items' badges added up. Hovering a closed group shows its items in a flyout beside the pane. The top bar stays at the top of the window and the pane under it while the page scrolls; a pane longer than the window scrolls on its own.
- **Folding it**: the chevron on the pane's edge folds it to a rail of icons (remembered too). Hovering or clicking a group's icon shows its items in a flyout; **Esc** closes it.
- **On a phone** the navigation is a drawer: **☰** at the bar's left opens it (it also has *All projects*, *The Firm* and *Documentation*, the launcher's places). Picking a page, a tap beside it or **Esc** closes it.
- **The page header** across the top of every page: the page's name and a line about it (on the Overview the project's tile, name and what it's for), and its buttons: the page's own (**Pin project** on the Overview, **Issues**, **PRs** and **Queue** with their counts on the Board, **Call an audit** and **The Firm →** on the Audit log) and the blue **New task**.
- **The band** under it, the same on every page: the floor's line (branch, folder, who's here, the budget chip and the run state **● Running | Pause**, see [Command Center](command-center.md)) over the progress bar, on a mid dark grey. Hovering a phase of the progress bar shows its card (its measures, deliverables, gates, dates and spend) in the page's colours.

Links with `?tab=` still open the same pages (`?tab=agents` works too, for the Agents page, `?tab=workers`).

## Tab badges

| Tab | Badge |
|---|---|
| 🎛️ Command Center | How many items are in Needs you. |
| 🗂 Board | Cards in 🙋 Needs a human. |
| 🤖 Agents | Agents waiting on you. |
| 📋 Standup | A dot when there's a standup you haven't seen. |
| 🌐 Live app | `!` when it failed. |
| ✅ Approvals | Items waiting for you. |
| 🧩 Team boards | Approvals plus escalations. |

## The bottom bar (1D)

**📌 Issues**, **🔀 PRs** and **📋 Queue** with their counts, and **✨ New task** to give a task to a new agent. In a Portal theme they're in the page header instead (Issues, PRs and Queue on the Board's).
