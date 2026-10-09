---
title: Top bar & menu
description: The 🏠 button, floor picker, view dropdown, 🎨 color themes, the ☰ menu, tab badges and notifications.
weight: 1
---

## The top bar

On the 1D and 2D views, from left to right:

| Part | What it does |
|---|---|
| 🔔 | *Turn on notifications*. Shown until your browser has been asked once. Desktop notifications take you to the worker that needs you. |
| 🏠 | Goes to `/home`. |
| **Floor** picker | Switches project. Each option shows `· 🙋 N` when agents there wait on you, or clone progress while a floor is cloning. Under the bar: `⎇ branch · repo/dir · 👥 N here`. |
| **View** dropdown | 🗂️ 1D, 🗺️ 2D, 🏢 3D, 👾 Retro. ↑/↓/Home/End move, Enter or Space picks, Esc closes. |
| 🎨 | Lists the color themes. |
| ☰ | The menu. |

When agents wait on another floor, buttons like **🙋 2 waiting on travel-approval →** appear under the bar. They land on that floor's Command Center.

The browser tab's title counts the workers waiting on you, so you see it from other tabs too (projects you stopped watching on Home are left out).

### In the Portal themes

The Portal themes draw the same bar as a navy portal header, the whole width of the window:

| Part | What it does |
|---|---|
| ⋮⋮⋮ launcher | A menu of where to go: **Projects** (Home), **The Firm**, the **Documentation**, **Settings**, and every project. ↑/↓ move, Enter picks, Esc closes. |
| **Mx Office** | The wordmark goes to Home (it stands in for 🏠). |
| Section | The page in capitals: **PROJECTS** on Home, **THE FIRM**, or on a project's pages its name, which is the floor picker (click to switch project). |
| Search | Finds a project, a tab of the page you're on, or an office page as you type; ↑/↓ and Enter go there, Esc clears. Everything it searches is already in the page. On a phone it folds into a 🔍 button. |
| Bell | Opens the [team phone](team-phone.md), with its count (it replaces the phone's floating button). |
| ? | The documentation. |
| Moon / sun | Dark mode: switches between Portal (Light) and Portal (Dark). |
| 🎨 | Every theme, as above. |
| Your initials | The ☰ menu. |

Everything else the bar had (the view dropdown, the budget chip, TEST MODE, Back to a floor on Home) stays in it. The bell that asks to turn notifications on is in ⚙️ Settings › Notifications instead.

## Color themes

Click **🎨** and pick one from the list:

- **Portal (Light)** and **Portal (Dark)** (the default since release 26): the look of a low-code platform's web portal. A dark navy top bar (see [In the Portal themes](#in-the-portal-themes)), white pages with slate text, Noto Sans with semibold titles, one strong blue for primary buttons and a deeper blue for underlined links, 1px light-grey lines, light-grey table heads, underline tabs, and cards with a soft shadow. Home becomes a **Projects** page (see [Home](home.md)). Like Clean, **no emoji**. Portal (Dark) keeps the navy bar and the blues on navy and charcoal surfaces. Noto Sans comes from Google Fonts once the page has loaded; without internet the system's sans-serif is used.
- **Clean (Light)** and **Clean (Dark)**: plain and quiet, like VS Code's classic light and dark themes. Neutral greys with a blue accent, a sans-serif font at 13px with a strict type scale and nothing heavier than semi-bold, 2–4px corners and 1px borders, flat buttons and VS Code-style tabs. **No emoji**: they're hidden everywhere, and buttons that were only an emoji (🔔 🏠 🎨 ☰) show line icons instead. The 2D office is barely tinted in Clean (Light) and a neutral grey night in Clean (Dark).
- **Fun**: the office's original warm, chunky light look (called Default before 2026-10-09).
- **Fun (Dark)**: the same look in dark blue-grey, easy on the eyes at night.
- **Terminal**: black and phosphor green, one monospace font, square boxes and faint scanlines. In Terminal, the project summary's *What's happening* types itself out (not if you asked your system for less motion).

The pick is kept in this browser (`agent-office.color-theme` in local storage). It applies to the 1D view, the 2D view (the office is tinted to match), `/home`, The Firm and these docs, and follows along in your other open tabs. Without a pick it's Portal: Portal (Light), or Portal (Dark) when your system is in dark mode. A pick made before (Clean, Fun…) is kept. The 3D office keeps its own look.

![The Dark theme](../images/theme-dark.png)

![The Terminal theme](../images/theme-terminal.png "Terminal: black and phosphor green")

## The ☰ menu

The same menu as in the 3D office, with what each item does from here.

| Section | Items |
|---|---|
| **Open** | 🙋 Next worker that needs you (only when someone waits) · 📌 Issues · 🔀 Pull requests · 📋 Task queue · 🌐 Services · 📝 Whiteboard · 🤝 Meeting room · 🔎 Search · 📚 Project docs · 🧱 Open in Studio Pro (Mendix projects; admin) · 🛗 Floors · 🍸 Rooftop bar (3D ↗) |
| **Together** | 🎙️ Join voice (3D ↗) · 🖥️ Share screen (3D ↗) · 🖼️ Hang a picture (3D ↗) · 👥 Invite teammates · 🔑 Accounts (admin) · 🔐 Your sign-ins |
| **Office** | ⚙️ Settings · 🏠 Home · 📖 Documentation · ⬆️ Upgrade the office (when an update is there) |

- Items marked **3D ↗** open the 3D office and run there.
- **📚 Project docs** opens the floor's own Markdown files (its README, `docs/team/*.md`, standups) on the bookshelf.
- **📖 Documentation** opens these docs.
- Red numbers are counts: open issues, open PRs, queued tasks, people waiting on other floors.
- On `/home`, the items that need a floor are left out.

> [!NOTE]
> **⚙️ Settings** in the ☰ menu opens the full Settings page, the 1D view's **⚙️ Settings** tab (`/lite?tab=settings`), from the 1D view, the 2D view and `/home` alike: it never switches to the 3D office. The 3D office keeps its own ⚙️ window (camera, character, the building) for when you're in it. See [Settings](settings.md).

## Tab badges

| Tab | Badge |
|---|---|
| 🎛️ Command Center | How many items are in Needs you. |
| 🗂 Board | Cards in 🙋 Needs a human. |
| 🤖 Workers | Workers waiting on you. |
| 📋 Standup | A dot when there's a standup you haven't seen. |
| 🌐 Live app | `!` when it failed. |
| ✅ Approvals | Items waiting for you. |
| 🧩 Team boards | Approvals plus escalations. |

## The bottom bar (1D)

**📌 Issues**, **🔀 PRs** and **📋 Queue** with their counts, and **✨ New task** to give a task to a new worker.
