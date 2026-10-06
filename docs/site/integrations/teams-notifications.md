---
title: Teams notifications
description: Get an Adaptive Card in a Microsoft Teams channel when something needs you (an agent asking, an escalation, the spend cap, failing checks, a Firm report, a gate, Studio Pro changes), plus an optional daily digest per floor. One-way, through a Teams Workflows webhook, with no admin consent.
weight: 5
---

The office can post to a **Microsoft Teams channel** whenever something needs a person, so you can follow it from the Teams app on your phone. It uses a Teams **Workflows** webhook: a workflow you add to your own channel, which gives you a URL the office posts to. It's one-way (Teams can't send anything back), needs no Teams app, bot or admin consent, and works wherever the office can reach the internet.

> [!NOTE]
> Classic Office 365 connectors ("Incoming Webhook") are being retired by Microsoft. The office targets the **Workflows** format instead: a POST of `{ "type": "message", "attachments": [ { "contentType": "application/vnd.microsoft.card.adaptive", "content": <Adaptive Card 1.4> } ] }`.

## Set it up

### 1. Create the webhook in Teams

You need to be a member of the team and allowed to use the Workflows app (most company tenants allow it; no admin consent is needed).

1. In Teams, go to the **team and channel** where the cards should appear (a private channel just for you works well, e.g. *Agent Office*).
2. Hover over the channel name and click **⋯ More options**, then **Workflows**. *(A panel opens listing workflow templates for this channel.)*
3. Search for **webhook** and pick **Post to a channel when a webhook request is received** (on some tenants it's called **Send webhook alerts to a channel**). *(A wizard opens with the template's name at the top.)*
4. Give it a name (e.g. *Agent Office*), check that the account shown is yours, and click **Next**. *(The second step shows the Team and Channel it will post to.)*
5. Check the **Team** and **Channel**, and click **Add workflow**. *(After a few seconds: "Workflow added successfully!" with a box holding a long URL.)*
6. Click the **copy** icon next to the URL and **Done**. The URL looks like `https://prod-…logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?…&sig=…` or `https://….environment.api.powerplatform.com/powerautomate/automations/direct/workflows/…&sig=…`.

> [!IMPORTANT]
> Treat the URL like a password: its `sig=` part lets anyone who has it post to your channel. If it leaks, delete the workflow (Teams → **Workflows** app → **⋯** next to it → **Delete**) and make a new one.

The workflow belongs to you, not to the channel. If you leave the company or the team, add a co-owner in the Workflows app so it keeps working.

### 2. Paste it into the office

1. Open **☰ → ⚙️ Settings → 🔔 Notifications** on the 1D view (or go straight to `/lite?tab=settings&section=notify`; the 3D office's ⚙️ window has it too). The **Microsoft Teams** card is under *Team notifications (Slack / Discord)*. *(An empty card with a URL box and an orange Save button.)*
2. Paste the URL and click **Save** (admins only). It's kept encrypted in [🔌 Connections](../administration/connections.md) (the **💬 Microsoft Teams webhook** card, where you can also paste or remove it). The box is a password field, and once saved the URL is never shown again: the card says *Posting to Teams (prod-12.westeurope.logic.azure.com/…voke)*, who set it and when.
3. Click **📨 Send a test card**. A card *"🔔 &lt;your name&gt; connected &lt;the office&gt; to this channel"* appears in the channel within a few seconds. If it doesn't, the card in Settings says why (for example *Teams answered 401*, or *Couldn't reach Teams*).
4. Pick **which floors post** (all, or tick the ones you want), **what's posted** (*Needs you only*, or *Needs you + daily digest*), and optionally **quiet hours**.
5. Fill in the **Public office address** if your phone can reach the office. [📱 Phone access](../administration/phone-access.md) fills it in by itself with its tunnel's address when the tunnel comes up (an address you typed yourself is left alone). Each card then gets an **Open** button to that floor's 1D view. Leave it empty while the office is only reachable on the laptop: cards then have no button.

## What's posted

### Red items

The same rules as the Command Center's **Needs you** strip (`src/shared/needsyou.ts`, shared by the browser and the server), limited to what only a person can unblock:

| Item | When |
|---|---|
| 🙋 An agent asking | An agent stopped on a permission prompt or a question in its terminal. A new question from the same agent is a new card. |
| 🚩 An escalation | An open escalation to the Project Manager that isn't FYI. |
| 💸 The spend cap | A floor's daily team cap is spent: office prompts are paused. |
| ❌ Failing checks | An open, ready pull request whose checks fail. |
| 📑 A Firm report | The Firm's audit report on the floor is ready. |
| ✋ A gate | A toolkit stage waits for your sign-off. |
| 🧱 Studio Pro changes | Studio Pro closed with model changes nobody committed. |

Not posted: finished turns (the office's own quiet turns end the same way, so these stay on the Command Center), lost worktrees, proposals, the live app, a stale folder, other floors' counts and the Firm's budget warning.

Each item in a card shows the **project**, **who** (the agent, whoever escalated, the PR's author, *The Firm*…), a **one-line summary**, its **urgency**, how long it has **waited**, **Jeff's priority** rank when he ranked it, and an **Open** button when there's a public office address.

*Picture: a white card titled "🔴 3 things need you in Shop", then one tinted block per item (red for blocking, amber for worth a look), each with "Shop · Byte" in bold, the line "Wants permission: Bash(npm install stripe)", the facts Urgency: Blocking and Waiting: 3 min, and an Open button.*

### How often

- **One card per item, ever.** The office remembers what it posted (`notify-teams-state.json`), so a restart doesn't post the same items again. An item that goes away and comes back much later (30 minutes or more) is new.
- **Batched.** Items raised within **60 seconds** of each other share one card. One answered within that minute never posts.
- **Held back** during **quiet hours** (on the office computer's clock, e.g. 22:00 to 07:00) or while **paused** (⏸️ 1 h / 4 h / 12 h in Settings). When the hold lifts, one **catch-up** card says how many items came up and lists the ones still open. Held items survive a restart.

*Picture: "🌅 While notifications were held (quiet hours): 5 items came up", "2 still need you; 3 were handled or sorted themselves out.", then the two open items and an "Open the office" button.*

### Daily digest

With **Needs you + daily digest**, each posting floor gets one summary a day, right after its morning standup is compiled (the standup schedule in the floor's Team settings), or 30 minutes after the standup time when no standup ran that day:

- PRs merged in the last 24 hours,
- how many Needs you items are open (and how many are red),
- spend today against the floor's cap,
- toolkit stage progress (gates passed, the next step, stages waiting for sign-off),
- the top three open escalations in **Jeff's priority** order, and any other red items.

*Picture: "📋 Daily digest: Shop", a fact list (Merged (last 24 h): 2, Needs you now: 4 (3 red), Spend today: $3.42 of $10.00 cap, Stages (gates): 3 of 6 passed · next: Sign off Stage 3), the merged PRs, the top escalations numbered #1, #2, and an Open button.*

## Failures and the audit log

A post that fails with a dropped connection, a 429 or a 5xx is tried again up to four times with backoff (2 s, 4 s, 8 s, honouring Teams' `Retry-After`). A batch that still fails waits five minutes and tries again, without the items that were handled meanwhile. Posting never holds up the office.

Every post is in the [Audit log](../using-the-office/audit-log.md) as `notify.teams.sent` or `notify.teams.failed`, with the kind of card, how many items, the floors, the tries and Teams' status code, never the URL or the card's text. Changing the settings is a `settings.change` (whether a webhook is set, not the URL).

## Limits

- Teams limits a message to 28 KB and about 4 requests a second: a card lists at most 10 items (then "…and N more").
- Cards are one-way: answering happens in the office (the Open button), not in Teams.
- Quiet hours use the office computer's clock, not your phone's.
- The URL is kept in [🔌 Connections](../administration/connections.md), encrypted with Windows DPAPI. An office that had it in `.agent-office/notify-teams.json` moves it there once at its next start and takes it out of that file. Without Connections (a CLI command, a test) it stays in that file, readable only by the office's user.
- The Slack / Discord webhook above it is separate and keeps working as before.

See also: [Settings reference](../reference/settings-reference.md#office-settings-teams-and-keep-awake), [API endpoints](../reference/api-endpoints.md).
