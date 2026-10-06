---
title: Phone version
description: The office on your iPhone - what needs you, the project channels, DMs, activity and each project's status, as a home-screen app with push notifications for red items.
weight: 3.6
---

The **phone version** is the [team phone](team-phone.md) full screen, made for a phone: open **`/m`** on the office's address. From outside the office's network that's the address [📱 Phone access](../administration/phone-access.md) gives you, for example `https://x7k2m9p-4600.euw.devtunnels.ms/m` (scan the QR code on its card).

## The tabs

Along the bottom:

- **🔴 Needs you** (it always opens here): everything that needs you on this floor, most urgent first, with its buttons. **Reply**, **Approve** and **Reject** answer an escalation; **Open terminal** shows the agent's terminal; a PR opens with **Open PR on GitHub** and **Merge…**; merges waiting on you have their own row with **Merge…**; a spend cap reached has **Raise cap…**. The red number on the tab is the same as the team phone's badge.
- **# Projects**: a channel per floor with its team chatter, threads and a composer (a message goes to the floor's Project Coordinator, `@Name` to one agent, `@team` to every Lead).
- **💬 DMs**: the floor's agents, what each is doing, and a DM with each. **🖥️** shows its terminal.
- **⚡ Activity**: every floor's chatter as one stream.
- **📊 Status**: a card per project: who's working, asking or asleep, its open escalations, today's spend against its daily team cap, the toolkit stage or gate it's at, and **Raise cap**, **Hire** (on the floor you're on) and **Pause / Resume** (coming with the Pause project feature).

The floor picker is at the top; **⚙** opens the phone's settings.

## What the phone can and can't do

- **Risky actions are confirmed twice**: merging a PR, hiring, raising a cap and approving an escalation about the merge order (or a security, data-loss or budget-overrun one) show what will happen, need a second tap, and ask for your password again unless you signed in within the last 10 minutes. The office checks the same on its side.
- **Merging happens on GitHub**: after the confirmation, the PR opens on GitHub, signed in as you, where you merge it.
- **Terminals are read-only.** An agent's terminal shows as its conversation (the Chat view: prompts, replies, tool calls, what it's asking). Nothing is typed into a terminal from the phone; to answer an agent, message it.
- Pausing and resuming a project, the setup panel's sign-offs, the live app and Git are on a computer.

## Install it on an iPhone

1. Open the address in **Safari** (not inside Teams or another app's browser).
2. Tap **Share** (the square with the arrow) at the bottom.
3. Tap **Add to Home Screen**, then **Add**.
4. Open **Agent Office** from the home screen: it runs full screen, like an app.

On Android or a desktop browser, use the browser's menu → **Install app** (or **Add to Home screen**).

## Push notifications

The office can buzz your phone when something red needs you, even with the app closed: an agent stopped on a question or a permission, an escalation, a PR's checks failing, the spend cap reached, a Firm report in, a toolkit gate to sign off, Studio Pro changes to commit. The same red items as the [Teams cards](../integrations/teams-notifications.md); never a turn the office started itself.

1. Install it on the home screen first (iPhones only allow push for home-screen apps, iOS 16.4 or later, and only over https: through Phone access, or on `localhost`).
2. Open it from the home screen, tap **⚙ → 🔔 Turn on notifications**, and allow them.
3. **Send a test** checks it works.

Each phone keeps its own **🌙 Do not disturb** (1 hour, until 9:00, or on) and **🗞 Digest** (bundle what isn't blocking every 15, 30 or 60 minutes), the same settings as the team phone's alerts. **Tapping a notification** opens the phone version on that item, lit up.

**📱 Your phones** in ⚙ lists every phone signed up on your account, each with **Remove**. Turning notifications off on a phone, or removing it, stops them at once. A phone whose subscription the push service drops (an uninstalled app) is forgotten by itself.

How it works: the office signs each push with its own key (VAPID), made once the first time a phone turns notifications on; the private half is kept encrypted in [🔌 Connections](../administration/connections.md), never shown. Pushes are encrypted for each phone (RFC 8291) and go through Apple's, Google's, Mozilla's or Microsoft's push service; the office sends to nowhere else.

## Offline

The app keeps a small copy of itself, so it opens even when the office can't be reached: it says *Reconnecting…* and carries on once the office is back. Nothing about your projects is kept on the phone.
