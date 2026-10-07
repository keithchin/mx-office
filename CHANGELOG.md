# Release notes

What changed in the App Factory (our fork of agent-office), newest first. A release is what went
live with an office restart; **Unreleased** is merged into `staging/integration` and waits for the
next one. Each entry says what you'll notice, then anything to know. Commit hashes are on `main`.

## Unreleased

### New
- **Team shapes: Solo, Startup and Enterprise**: a project's team is one Solo Lead (Sonnet, every
  subagent type) covering every team, a Chief Analyst and a Lead Developer (design and test as their
  subagents), or the Project Coordinator and four Leads as before. Each team is covered by its own
  Lead or by another member, and relays, standups, issues, subagents, skills (strictest gate wins),
  deliverables, team pages, the 2D view's signposts, the Firm's questions, ▶ Resume and the Command
  Center go to whoever covers the team. A team without a Project Coordinator now hears its relays
  instead of dropping them. The Team tab and the Command Center show a "Solo · Lean" chip, and a Solo
  or Startup team's org chart a coverage table (read-only for now).
- **The wizard recommends a team and a budget**: the Team & budget page comes after the intake and
  pre-selects a shape and level from the tier, entry mode and the answers to Q2, Q4, Q5 and Q7, with
  why. Three shape cards, each with a Lean / Balanced / Fast switch, its budget and working days;
  Customize picks the roles and every setting by hand. The team step sets the shape, then hires its
  roles. Client and Discovery moved to the page after it.

### Improved
- **⚙️ Settings** is a full page on the 1D view: every setting, sections down the left (You, Workers, Team,
  Jeff · Router, Notifications, Budget, Connections, Deliverables, Incidents, Studio, Appearance, Advanced),
  each with its own address (`/lite?tab=settings&section=workers`) for links. It has everything the 3D window
  had (default worker, worker limit, keep awake, restart safely, prompts, Slack / Discord and Teams, the map,
  holiday theme, sky, dog and workspace folder) plus the team settings, Jeff, early drafts, the budget's
  settings, the incident detection rules, Studio Pro and your color theme. Admin-only parts stay read-only or
  hidden as before; it wears all five themes. The 3D office keeps its own ⚙️ window, built from the same parts,
  with an *All settings ↗* link here. On a new office with no project yet, `/home` opens it in a window.

### Changed
- **The budget plan follows the team's shape**: a Solo or Startup project's stages cost a share of the
  Enterprise rates and say who does them. A small greenfield app is about $60 at Solo · Lean; a small
  requirements-driven one $270 at Startup · Balanced.
- Existing projects are Enterprise, with every team covering itself, and behave as before.

### Fixed
- No settings link sends you to the 3D view any more. The ☰ menu's **⚙️ Settings** on the 1D view, the 2D view
  and `/home` opened the 3D office's Settings window; it now opens the full Settings page on the 1D view
  (`/lite?tab=settings`). So do Needs you's *Spend cap reached → Settings*, the team phone's *Raise cap*, a
  Teams card's Open for it, the budget's *Team settings* suggestions and the team's Autonomy chip, each at its
  section (`&section=team`), and the docs' "3D view → ☰ → ⚙️ Settings" steps.

## 2026-10-06 · release 14 (`a208a15`)

### New
- **Risky desktop actions through Phone access ask for the password again**: on the 3D office, /lite,
  /pixel or /home opened through the phone tunnel, merging a PR, hiring, raising a team cap or a budget,
  approving a merge-order, security, data-loss or budget-overrun escalation, ▶ Resume / ⏸ Pause /
  🔁 Restart safely, changing Connections (credentials, the Teams webhook, Phone access), opening Studio
  Pro and resolving an incident need a sign-in from the last 10 minutes, like the phone version. A
  password window (✕ or Esc cancels) asks, then the action goes through. The office's own address never
  asks.
- **A sev1 incident sounds on the Team phone**: a desktop notification and its sound, held by Do not
  disturb like the phone's other red items.

### Changed
- **Test mode refuses every real agent CLI**: only the fake given with `--agent` starts, and not even
  that when it is a real CLI itself (`--agent codex` for Claude workers). A fake named `claude.cmd`
  still works when it lives in a test office's folder.
- **Test mode turns itself on only for test offices**: under `scratch/test-offices` or a folder named
  `test-office…` (plus `--test-mode` and `AGENT_OFFICE_TEST_MODE`). A plain `scratch` folder no longer
  does.
- **The incidents of 2026-10-06 go only to offices that ran that day**: their audit log has events from
  that day (UTC+8); one that only ran before or after it gets none. `AGENT_OFFICE_SEED_INCIDENTS` still
  overrides.

## 2026-10-06 · release 13 (`92d43b6`)

### New
- **⏸ Pause and ▶ Resume a project from the phone**: the Status tab's Pause runs Pause project (after a
  confirmation), and Resume… shows a short Resume preview (who has work waiting and why, the cost line,
  *Those with work* or *Everyone asleep*). Both need the fresh sign-in risky actions need. Each card
  shows the pause (*⏸ Paused by Pat · 2 waiting on you*) and a run's progress, and a safe restart in
  progress is a read-only line on top (*Restarting safely: waiting on 2*).
- **📱 Phone version** at `/m`: the team phone full screen as an app for your iPhone, with tabs for
  **Needs you** (Reply / Approve / Reject, Open terminal, Merge…, Raise cap…), **Projects** (each
  floor's channel), **DMs**, **Activity** and a compact **Status** per project (working / asleep /
  asking, escalations, spend against the cap, the toolkit stage; Pause / Resume waits for that
  feature). Agents' terminals are read-only there (their Chat view).
- **Risky actions from the phone are confirmed twice**: merging, hiring, raising a cap and approving a
  merge-order escalation need a second tap and the password again unless you signed in within the
  last 10 minutes. The office enforces it, and each phone action is `phone.*` in the audit log.
- **Installable, with push notifications**: a web app manifest, pixel icons and a service worker (the
  app opens even when the office can't be reached), *Add to Home Screen* steps for iPhone Safari, and
  Web Push for the red Needs-you items (iOS 16.4+ home-screen apps), with each phone's own Do not
  disturb and digest, never for a turn the office started. Tapping one opens `/m` on that item.
  The protocol (VAPID, RFC 8291 encryption) is the office's own; the key is kept in Connections.
- **📱 Phone access** in ⚙️ Settings → 🔌 Connections: a private tunnel to the office without
  Tailscale or a VPN. **Microsoft Dev Tunnels** (sign in with your Microsoft work account from the
  card, a persistent private tunnel, the same address every time) or **Cloudflare Tunnel with
  Cloudflare Access**; a quick trycloudflare.com tunnel only behind a big warning, for an hour. A QR
  code to scan, reconnects by itself, and is checked to be private (switched off if it isn't).
  The Teams cards' Open buttons follow its address.
- **The Teams webhook URL moved into 🔌 Connections** (a 💬 Microsoft Teams webhook card, DPAPI
  encrypted): an office that had it in `notify-teams.json` moves it once at its next start.
- **⏸ A paused project hires nobody new:** the task queue holds, the meeting room seats no meeting and
  hands out no parts, a desk takes no new agent, and the Team tab, an answered escalation and The Firm
  hire no member. Each says *Project paused: no new agents until it's resumed*. In the Team tab the
  Project Manager can still **Hire anyway** after a confirm (one hire, logged as `roster.hire-override`).
- **▶ Resume project** now counts a Lead's own team's open issues with nobody assigned as work waiting
  (never another team's), and folds the Project Coordinator's queued relays into its resume brief, so it
  gets one message instead of two.
- **🚨 Incidents**, a second sub-tab of the **🧾 Audit log** (on each project and on the home page): what
  went wrong or nearly did, each with a severity (sev1 to sev3, or near miss), a status (open, mitigated,
  resolved), its impact (spend, agents, data), a timeline, the root cause, corrective actions with links,
  and the audit events and workers it's about. Filters, counts, and a detail with everything on it. Admins
  open one by hand or from an audit row (**🚨 Create incident from this event**, **Link to incident…**), add
  notes, and resolve it with its root cause. Open sev1 and sev2 incidents show in **Needs you**, on the Team
  phone and in the Teams notifications. Every change is in the audit log (`incident.*`) and the incidents
  file is hash-chained like it.
- The office opens incidents by itself: a real agent launched in a test office, a spend spike, the spend
  cap reached, workers interrupted mid-turn by a stop, escalation answers not delivered after 30 minutes,
  worker crash loops, Studio mode holding writes again and again, failing workflows or gate-checks, worktree
  cleanup errors and repeated failed sign-ins. Each rule can be turned off and its thresholds changed under
  **⚙️ Detection rules**; a rule firing again counts into its open incident instead of opening another.
- The incidents of 2026-10-06 are recorded once, retrospectively, in an office that ran that day.
- **Test mode** (`--test-mode`, `AGENT_OFFICE_TEST_MODE=1`, and by itself when the office or a floor is under
  a `scratch` or `test-offices` folder): no real agent CLI starts, only the fake `--agent`; a refused start
  says why on the worker's card and opens a near-miss incident, and the top bar shows **TEST MODE**.
- **💰 Budget: what each project spent.** A new 💰 Budget tab on the 1D view shows a project's spend
  by stage, role, agent (subagents nested under the Lead that hired them), model, day and issue/PR,
  in dollars and a local currency (SGD by default, ECB rate fetched daily or set by hand). The top bar
  shows `$42 today · $252 / $600 · 42 %` next to the branch and `Office $110 today` at the far right.
  The office's own model calls (Jeff, the analyzer, task naming, the summary, the Firm) are now
  metered and booked on the floor they served. History from before the ledger started is filled in
  from the workers and `analysis/runs.jsonl`, marked as estimated.
- **💰 Budget: a plan, a forecast, alerts and auto-pause.** Each project gets an expected plan per
  toolkit stage (and per build module), priced from this office's history or default rates, editable
  line by line, or re-forecast from a Firm audit in one click. A chart compares expected and actual
  spend; the forecast at completion colours the top-bar chip. Alerts fire at 80 % (changeable per
  project and office-wide), at 100 % and when the forecast goes over budget, once each, through Needs
  you, the Teams cards and the audit log. At 100 % the project is paused with ⏸ Pause project (its line reads *⏸ Paused: budget reached*;
  people's messages still go through) until the budget is raised or someone resumes it from the
  Needs-you item, which opens the ▶ Resume project preview.
- **New project wizard: a Budget page.** Lean, Balanced or Fast, each with a preset budget from the
  plan estimate (travel-approval: $220 / $330 / $530), its time and what it changes (models, early
  drafts, autonomy by stage, and how many subagents a Lead runs at once, written into the Leads'
  Playbooks), or Manual. The team is hired on the level's choices;
  **Change level** on the Budget tab does the same for a running project from the next hire.
- **💰 Budget insights and an all-projects view.** The Budget tab names what drives the spend ("Opus
  Leads are 71 % of spend", the Lead Tester's review loop this week, the Coordinator's relays a day)
  and suggests savings, each linked to the action that does it: swap a Lead's model, delegate to its
  subagents, idle benching, Jeff's real-ask mode, early drafts off, with the worker ranking's token
  efficiency. A new 💰 Budget tab on the home page lists every project's spend against its budget,
  forecast, status and a 14-day sparkline, with the office's background calls and the Firm's audits.

### Improved
- **🧩 Subagents: runs only the transcript saw finish count.** A background run that only the Lead's transcript
  reports as finished (no hook does) is now a run of its subagent's record, unreviewed until the Lead's
  `office-workers subagent review`, which lands on that run rather than adding one. Grades still count only
  reviewed runs; cards and hover cards say *N unreviewed*. A late SubagentStop for the same run isn't counted again.
- **🧩 Subagents live about the 2D view.** Idle subagents no longer vanish: they take the same breaks benched
  Leads do (the lounge TV, the balcony, the kitchen's coffee, walking the aisle), still small and tagged
  *tester (Hedy's)*, with a speech bubble when two stand close; when a run starts they walk back to the stool
  behind their Lead, and away when it ends. Benched ones do the same with a 🪑 tag. The home Overview matches.
- **🧩 Never-run subagents are hidden.** The Workers tab shows only subagents that have run (or are at work for
  the first time, or are benched or on warning) unless **☐ Include never-run** is ticked next to Show
  subagents. The 2D view shows only subagents that have run at least once.

### Fixed
- A fake `--agent` (or `AGENT_OFFICE_AGENT`) now runs Claude Code workers whatever its file is called: only one
  named `claude` did, so test offices with a `fake-agent.cmd` started real Claude sessions.

### To know
- Resume, Pause and Restart safely are admin-only on every route, not just hidden for others; tests pin it.
- **The budget's spend ledger starts with estimated history.** The first time a project's Budget is
  opened, what it spent before is filled in from its workers and `analysis/runs.jsonl`, spread over the
  days and marked as estimated; everything after is booked as it happens. The office's own model calls
  now count in the office's total spend too, so it reads a little higher than before.

## 2026-10-06 · release 12 (`18ff64d`)

### New
- **▶ Resume project** (Command Center heading and team pages; **▶ Resume all projects** on Home): a
  preview first, listing every asleep or benched agent with the work waiting for it and why (answers owed,
  held prompts, queued relays and notes, cut off mid-turn, failing PR checks, an assigned issue, an
  unhanded standup page) plus safety checks (the spend cap blocks, Studio mode warns, a missing worktree or
  lost session re-hires from the handoff note, a merged branch offers Send home, behind or uncommitted is
  noted). Wakes those with work by default, the Coordinator first and then the most blocking Leads, 2 at a
  time 45 s apart (team settings), each with a short brief as your turn. Runs as a checkpointed workflow
  that carries on after a restart; audited as `resume.started` / `agent.woken` / `agent.skipped` /
  `resume.finished`.
- **⏸ Pause project** (and **⏸ Pause all projects**): agents finish their turn (never interrupted, nothing
  typed into a question), write a handoff note and sleep with their session kept; the office's own prompts
  to the floor (nudges, standups, relays, review nudges, Firm interviews) are held until it's resumed, while
  what a person sends still goes through. Shown as *⏸ Paused by … at … · N waiting on you*.
- **🔁 Restart safely** (**⚙️ Settings → Workers**, or `POST /api/office/restart`): pauses every project,
  waits until no agent is mid-turn (timeout: keep waiting, restart anyway, or cancel), optionally builds new
  commits first, then exits with code 75 for a looping launcher; the next start resumes exactly the floors
  it paused.
- **🧩 Subagents as workers.** A Lead's subagents now show as workers of their own. On the **👷 Workers**
  tab each gets a card right after its Lead's (*🧩 tester · hired by Hedy (Lead Tester)*): working on what and
  for how long, idle since its last run, or benched; its model, runs and A–F grade. Click it for its recent
  runs, the Lead's verdicts, Warn/Bench/Model/Reinstate (Project Manager) and a link to the Lead's terminal.
  **☑ Show subagents** hides them. In the **2D view** (and the home page's 2D Overview) a subagent at work
  sits on a stool behind its Lead's chair, tagged *tester (Hedy's)*; benched ones take breaks with benched Leads.
- The office follows each run live from the hooks (the Agent call going out and coming back, SubagentStart /
  SubagentStop) and, every 10 seconds, from the Lead's transcript, which is the only place a background
  run says it's finished. A floor's last 50 runs are kept in its roster file.
### Fixed
- A subagent run in the background (newer Claude Code's default) no longer counts twice in its track record:
  its launch made a run of its own besides the one its SubagentStop records. The SubagentStop's run now
  carries the task.
- **The Command Center no longer scrolls outside its parts**: on a desktop window it's a fixed-height
  layout with no page scroll and no column scrollbars (the project details on the left and the console in
  the middle used to scroll as a whole, sometimes twice). Each card scrolls inside its own frame with a
  thin scrollbar in the theme's colors; the console's chat or terminal fills the middle and is the only
  thing there that scrolls, with the escalation cards behind a one-line bar that swaps them in. The tabs
  are a little smaller, Needs you and the folded setup line share a row, and on a short window the setup
  panel starts folded. The short page scroll at 1280×720 is gone; phones still scroll the stacked page.
- **The Team phone's button shows its messages icon in the Clean themes**: Clean gave every button its
  ink colour, so the icon was drawn in the button's own colour and vanished. It's now its own colour (a
  white icon on an accent-blue disc in Clean (Light) and Clean (Dark)), and checked in all five themes.

### To know
- The launcher needs the restart loop (`AGENT_OFFICE_LAUNCHER_LOOP=1` and `do { … } while ($code -eq 75)`,
  in Running the office → Releasing and restarting safely); without it, Restart safely only pauses, waits
  and exits. The pauses live in `<office data>/project-run.json`, so they survive a restart.

## 2026-10-06 · release 11 (`a52ebae`)

### New
- **📱 Team phone**: a button at the bottom right of the 1D and 2D views, above the Issues / PRs /
  Queue / New task bar (a pixel-art iPhone in the Default theme, a round messages button in the
  others), with a red count of what needs you or a grey dot for unread messages. It opens a chat like
  Slack's: **Needs you** pinned on top, **All projects**, a channel per floor with its team chatter
  (escalations and conversations as threads with reply counts, the old filters as chips, *working…*
  while an agent is mid-turn), and DMs with the floor's agents.
- **Message the team from the phone**: a plain message goes to the floor's Project Coordinator (the
  Chief Analyst or another Lead when there's none, and it says so), `@Name` to that agent with
  @-autocomplete, `@team` to every active Lead after a *This wakes N agents (≈N turns)* warning, a DM
  to its agent, a reply in an escalation's thread answers the escalation. It goes through the same
  delivery as the office's own prompts (held until the turn is over, never typed into a dialog, as
  your turn, through a reached spend cap), is kept in the chatter as yours, and the agent's reply is
  read off its transcript into the same thread (*replied in its terminal → Open* without one).
- **Notifications in the phone**: every Needs-you item arrives as a message from Jeff (escalations,
  with his priority) or the office, with **Reply / Approve / Reject**, **Open terminal**, **Merge…**,
  **Review** or **Raise cap**; answering there resolves it everywhere. Desktop alerts and a short sound
  only for those, with **Do not disturb** (until off, 1 hour, until 9:00 tomorrow) and a **Digest**
  (every 15, 30 or 60 minutes) in the phone's settings. What you've read is kept per person by the office.

### Improved
- **The Command Center fits a laptop screen**: Needs you is one row of counts that opens the phone,
  the setup panel folds to one line once its gates are fine (Show / Hide, remembered), the summary's
  columns take the window's height with the console the widest and each scrolling on its own, its
  sections fold (remembered), and Recent activity shows the newest 8 with **More**.
- **💬 Team chatter moved into the team phone**: it's off the Command Center, and each team page
  has **Open in the team phone →** filtered to that team instead of its short thread. The chatter's
  data and `GET /api/chatter` are unchanged.

## 2026-10-06 · release 10 (`3db2145`)

### New
- **📣 Microsoft Teams notifications.** Add the *Post to a channel when a webhook request is received*
  workflow to a Teams channel, paste its URL in **⚙️ Settings → Notifications → Microsoft Teams** (admins;
  masked once saved) and press **Send a test card**. The office posts an Adaptive Card when something needs
  a person, by the same rules as the Command Center's Needs you (now in `src/shared/needsyou.ts`, shared by
  the browser and the server): an agent asking in its terminal, an escalation, the spend cap, failing PR
  checks, a Firm report, a gate to sign off, Studio Pro changes to commit. Each card has the project, who,
  a line, urgency, age, Jeff's rank and an Open button (when a public office address is set). One card per
  item, never again after a restart; items within a minute share a card; quiet hours and a pause hold them
  for one catch-up card. Optionally a daily digest per floor after its standup. Pick the floors that post.
- **☕ Keep awake while agents work** (on by default, **⚙️ Settings → Workers**): while any worker is
  working, or a queued task, a Firm audit or a gate-check runs, the office asks Windows not to sleep (a
  hidden PowerShell helper, no new dependency; the screen may still turn off), and lets go after 10 idle
  minutes. Settings says what it's doing and how to set *When I close the lid* to *Do nothing* so work
  carries on with the lid closed.

### To know
- Teams posts are logged as `notify.teams.sent` / `notify.teams.failed` in the audit log, never with the
  URL. The URL sits in `.agent-office/notify-teams.json` (mode 0600) until Settings → Connections stores
  it encrypted. Failed posts are retried with backoff and never hold the office up.
- Keep-awake stops idle sleep only; closing the lid still sleeps the laptop unless Windows' lid setting is
  *Do nothing* when plugged in. The office never changes power settings itself.

## 2026-10-06 · release 9 (`4b1eb83`)

### Improved
- **Folders follow the new workspace layout**: with nothing picked in Settings → Connections → Folders and no
  environment variable, the office looks for the toolkit at `agent-spike/mendix-toolkit` and mxcli at
  `agent-spike/tools/mxcli`, then at their old places (`mxcli-project-toolkit`, `bin`), so it works before and
  after the folders are reorganised.

## 2026-10-06 · release 8 (`17ebd7f`)

### New
- **🔌 Connections**: the office's credentials in one admin page (☰ → 🔌 Connections, ⚙️ Settings,
  the home page, or the wizard when the admin token is missing): the GitHub token for agents, the
  GitHub admin token, the Mendix personal access token, the Jev key and the office password. Each has
  a status (connected, missing, invalid, expiring), 🧪 Test (for GitHub: who it is, its expiry, the
  repositories it sees and whether it reaches every project), replace and remove, and how to make one
  with the exact permissions and a pre-filled GitHub link. Saved values are encrypted with Windows DPAPI
  in `credentials.json` in the office's data folder and never shown again; the audit log records who
  changed which, never a value. The office uses Connections first, then the environment variable, then
  the old dot-file, so `start-office.ps1` keeps working; **📥 Import from files** moves the dot-files in
  with one click. The wizard's admin-token box now saves straight into Connections.
- **Mendix token, per project**: kept in Connections for the wizard (Mendix Projects API, coming next);
  a project's agents get `MENDIX_TOKEN` / `MX_PAT` only when you tick it for that project, off by default.
- **git & gh check** in Connections: git and gh installed, gh signing in with the agents' token (in a
  throwaway config, your own gh login untouched), git's commit identity, and a one-click commit
  identity for the workers when git has none.
- **Folders in Connections**: the projects folder and the mxcli-project-toolkit folder (checked for
  `bin/init-project.sh`), used by the wizard and the Playbooks without a restart.
- **Worktrees stay in the project**: a hook on every Claude worker refuses `git worktree add` outside
  the floor's `.agent-office/worktrees/` and gives the exact path to use, so no more worktrees in Temp
  or next to the project.
- **Worktree cleanup**: every hour, worktrees under `.agent-office/worktrees/` that no worker has,
  whose branch is merged (squash merges too) and that hold no changes are removed with their branch,
  each in the audit log; links inside them (node_modules junctions) are unlinked, never followed.
  Worktrees elsewhere are only reported. On by default; switch it off in Connections.

### Improved
- **📦 Deliverables reads "main" from GitHub.** *On main* now means on the project's default branch
  (`origin/main`), read the same way and with the same 90-second fetch as the setup panel, not whatever
  branch the floor's folder is on; the panel says so at the top when the folder is on another branch or
  behind. A project with no remote still uses its folder.
- **Mermaid diagrams render in the Deliverables viewer**: a Markdown file's ```mermaid blocks (a
  domain model, a process flow, the blueprint) are drawn, light or dark to match your theme, with the
  source folded under each; a block Mermaid can't parse stays as source with the reason.
- **Each team has its own reports.** The analysts' toolkit reports stay where they are
  (`reports/validation-report.md`, now an expected Stage 2 item, plus `summary.md` and `gaps-report.md`);
  the other teams' go in `reports/design/`, `reports/development/`, `reports/testing/` and
  `reports/management/`, and the Playbooks say so. A stray report straight under `reports/` shows as
  **Unsorted reports** on the Management page instead of under Testing.

### To know
- mermaid and playwright-core are now runtime dependencies of the office (pinned to 11.17.2 and
  1.63.0). export-pdf and screenshot answer 501 only when Chromium isn't downloaded on the machine.
  They stay commands, with no MCP tools, so their schemas don't cost every agent context on every turn.

## 2026-10-06 · release 7 (`a603397`)

### New
- **📦 Deliverables**: every team page starts with a checklist of what that team owes at each toolkit
  stage (triage, source ledger, knowledge base, BRDs and the BRD report; brand, ds.css, design system,
  wireframes, storyboard; blueprint, domain model, ADRs, fit-gap, build plan, module briefs; test plan,
  journeys, UI reviews, evidence; standups), each **On main**, **On a branch** (not merged, with the
  branch and who), **Draft** or **Missing**, plus what the team made beyond the list. The office looks
  in the floor's checkout, in each hired Lead's worktree (uncommitted work too) and on every `office/*`
  branch, so work like travel-approval's Stage 1–2 reports on unmerged branches finally shows. Click a
  file to read it: HTML reports in a sandboxed frame (no network, no origin), Markdown, pictures, PDFs,
  a CSV's first rows, JSON. The setup panel shows the counts per stage with **Open deliverables →**.
- **office-workers export-pdf** and **office-workers screenshot**: a Lead turns an HTML file of its
  worktree into a PDF or a PNG with the office's own headless Chromium (no network, files inside its
  worktree only), for a BRD PDF or a storyboard of wireframes, with nothing installed in the project.
- **Early drafts** (⚙️ Settings → Deliverables, on by default): while the Chief Analyst is on Stages
  0–2, the Lead Designer makes low-fi wireframes, the Lead Developer a draft domain model and
  architecture sketch, and the Lead Tester a test-plan outline, all marked as drafts, small, and revised
  once the BRDs are confirmed. Turn it off and they wait for their stage.

### Improved
- Every Lead's Playbook now has a **Your deliverables** section: the exact files it hands over per
  stage (for the Chief Analyst also `docs/requirements/BRD-<feature>.pdf`, `use-cases.xlsx` and a
  Mermaid `process-flow.md`; for the Lead Designer a storyboard; for the Lead Developer
  `architecture/domain-model.md` and ADRs; for the Lead Tester `tests/test-plan.md`), how to make them
  on the office machine (`py` with openpyxl and matplotlib, Mermaid, the new render commands), and to
  keep them on a branch with a pull request so they merge.
- The Design team page's 🖼️ Design artifacts panel is replaced by 📦 Deliverables, which covers it.

### Fixed
- **The setup panel no longer trusts a stale floor folder.** It reads `PROJECT.md`, `intake.md`,
  `triage.md` and the gate dashboard from the project's default branch on GitHub (`origin/main`), after
  a quiet fetch at most every 90 seconds, instead of whatever branch the floor's folder is on
  (travel-approval's folder sat on an old branch, 23 commits behind, and showed Stage 0 failing long
  after main had it signed off). When `origin/main` moves, the office re-runs the toolkit's gate-check
  on it in a temporary worktree it deletes afterwards (at most every three minutes per floor), so the
  verdicts follow merges; 🔄 Re-check gates does the same now. The panel says when the folder is on
  another branch or behind, and more than 10 commits behind adds a 🌿 item to Needs you.

### To know
- Branch work shows as *not merged*: only what lands on main counts, so Leads still need their PRs
  merged. The scan is read-only and never touches a branch or worktree.
- Mermaid diagrams in Markdown show as their source in the viewer (the page has no diagram renderer);
  an HTML report that loads Mermaid from a CDN (the toolkit's `blueprint.html`) gets the office's own copy.
- Excel workbooks are offered as a download, not previewed (the office has no xlsx parser).
- The render commands need playwright-core and its Chromium on the office machine (this office has
  both); without them they say so. A project with no remote keeps the old setup-panel behaviour.

## 2026-10-06 · release 6 (`c1c4a1e`)

### New
- **Chat view on the Command Center**: the Project Coordinator console in the middle of the Command
  Center has **Chat | Terminal** on its header. Chat (the default) shows the conversation as messages:
  your prompts, its replies in Markdown with its icon, each tool call as one line (*Ran mxcli check*,
  *Edited 3 files*), and a highlighted **Open terminal to answer** card for a question or a permission
  (answered in its terminal, never from the chat). Terminal is the live terminal as before. The office
  reads it off the Coordinator's Claude Code transcript and never sends what a tool printed or read;
  another agent (Codex, OpenCode…) shows its terminal's text instead. Which view it opens in is kept
  per browser: **Command Center terminal** in the ⚙️ Settings tab (*Your view*) or the 3D office's
  ⚙️ Settings › You.
- **Autonomy by pipeline stage**: a new team setting (⚙️ Settings → Autonomy → *By pipeline stage*,
  off by default) lets a toolkit project's stage pick its level: 2 Guided while it analyses,
  specifies and designs, 3 Delegated once the build plan's gate (Stage 4) has passed (both levels
  yours to pick). The office changes the level exactly as if you had: Playbooks rewritten, the Leads
  at work told, the cap for the new level, a line in the recent activity and the Audit log. While it's
  on, the Team tab's chip reads *Autonomy 2 · by stage* and the level buttons only show the level.

### Improved
- **Quieter finished turns**: a turn the office started itself (the team's relays and notes, review
  nudges, standup questions, waking a Lead with something for it) now finishes without a ✅ Review in
  Needs you, a ding or a desktop notification, and so does a team member's routine turn at autonomy 3
  and up (its card still shows it done; anything that needs you comes as an escalation). A question or
  a permission prompt still flags as before, and so does any turn you start.
- **Relays ask for no reply**: the Project Coordinator's relays (new escalations, your proposal
  decisions, the Leads' subagent decisions) and the Leads' notes say *no reply needed* instead of
  asking for `noted`, so each one no longer costs a turn that nobody reads.
- **Your decisions reach the Lead that proposed**: approving, rejecting or asking for changes to a
  standup proposal now tells the proposing Lead too, in one short note a minute after your last
  decision, between its turns. A subagent request you decide while its Lead is asleep or busy asking
  someone is kept for it rather than lost.
- **Restarts wake only who was mid-turn**: after a restart the office resumes just the agents it cut
  off in the middle of a turn; everyone who was at rest, finished or asleep stays asleep (session kept)
  until someone, or the office, prompts them, or you press R. Walking onto a floor no longer wakes
  them either. The turn it carries on is told its escalations are still open, by title, instead of
  "ask again", which brought a fresh round of the same escalations after every restart.
- **The review loop is bounded**: the office counts a subagent's revision rounds from its Lead's
  `subagent review` verdicts. One rework past the autonomy level's allowance (2 rounds at levels 1–2,
  3 at 3–4) raises one `revisions-exhausted` escalation for the Lead (an FYI at levels 3–4), tells the
  Lead not to send it back again, and stops the review nudge for that subagent until you answer or the
  work is accepted.
- **The review nudge stops when it isn't heeded**: after 3 nudges in a row with no review verdict
  from the Lead and no one else prompting it, the office stops nudging (one *Stopped nudging …* line in
  the Activity) until the Lead records a verdict.
- **`office-workers tell` can't ping-pong**: at most 5 tells from one agent to the same agent in 10
  minutes; past that it's refused with a word to use the team journal or escalate instead. A tell to an
  agent with a question open in its terminal is held and goes in when its turn is over.
- **Reworded duplicate escalations join the open one**: when a new escalation's title matches no open
  one, Jeff is asked whether it's the same ask in other words (mx-spike raised nine escalations about
  two CI secrets, each worded differently). Only a pick he's at least 85% sure of joins it as a +1;
  otherwise, or if he doesn't answer within 10 seconds, it's raised as its own.

### Fixed
- **Relays survive a restart**: what the office still had to tell the Project Coordinator (new
  escalations, your proposal decisions, subagent news) and the Leads is now kept in the floor's roster
  file instead of memory, so a restart, or a Coordinator that's asleep or benched for a while, no
  longer loses it. They wait there while the daily cost cap holds and go out once it lifts. A
  Coordinator left asleep (after a restart, say) is woken with everything it's owed in one message, at
  most once a minute. A floor with no Coordinator skips its relays (each Lead hears its own decisions).
  The turn that acts on your answer to an escalation is yours, not the office's: it still flags when
  it's done.
- **Go home once merged leaves the team alone**: a Lead whose pull request merged is no longer sent
  home without a handoff note; the project team goes through its own bench and handoff, and
  `office-workers home --merged` lists it as skipped (*on the project team*).
- **Answers no longer typed into a permission dialog**: an answer to an escalation went into the
  agent's terminal even while it had a permission prompt or a question open, where the Enter after it
  picked one of the dialog's options: the answer was lost but shown as delivered. Now nothing the office
  types (your answers, a +1's answer, a Lead told about your subagent decision, relays to the Project
  Coordinator, The Firm's questions, one agent's `office-workers tell` to another) goes in while a
  dialog may be up (*needs input*, or still starting). Your answer waits and goes in once that turn is
  over, with any others it's owed, in one message, and counts as delivered only then. The Activity
  says *… has a question open in its terminal: the answer goes in once that's answered*.
- **The daily cost cap holds the office's own prompts, not only new hires**: once a floor's cap is
  spent the office no longer sends review nudges, a scheduled standup's questions, relays to the
  Coordinator, autonomy and skill change notes, The Firm's interview questions or wakes, and one agent
  can't `tell` another. Needs you and Approvals say **💸 Spend cap reached: office prompts paused;
  agents finish their current turn**. What you send (your answers, your typing, a standup you call, a
  wake from the Team tab) still goes through, and no running turn is stopped.

### To know
- The same-ask check follows Jeff's **Waiting on you** setting: it runs in Shadow too (it only joins,
  never raises), and not when that's Off. It's at most 30 questions an hour per floor.
- `office-workers escalate` now waits up to 30 seconds for the office (was 15), for Jeff's answer.
- Held prompts live in memory: a tell held for an agent is lost if the office restarts before its turn
  ends. Escalation answers aren't: an undelivered one is still owed after a restart.

## 2026-10-06 · release 5 (`1cff8c8`)

### New
- **Open in Studio Pro**: a button in a Mendix project's Command Center heading (and ☰ → 🧱 Open in
  Studio Pro) opens the floor's `.mpr` in Studio Pro on the office's computer, in the version the
  project was saved in (through Mendix's Version Selector). Admins only, after a confirm that warns
  that no agent may run `mxcli exec` while Studio Pro has the project open and lists the agents busy on
  the floor. Each open is in the Audit log (`studio.open`) and in Team chatter. It only works when the
  office runs on a Windows desktop with Studio Pro installed; otherwise the button is greyed out and
  says why.
- **Studio mode**: the office now sees for itself when Studio Pro has a floor's project open (its
  `studiopro.exe` naming the `.mpr`, or the `.mpr.lock`'s process still running), however it was
  opened, and pauses that floor's agents' mxcli writes until it closes: a PreToolUse hook on every
  Claude worker denies `mxcli exec`, `fix`, `layout`, `rename`, a writing `mxcli -c`, the toolkit's
  `bin/exec.sh` and the like, and tells the agent to route the write through Studio Pro's MCP server
  (`mxcli --mcp http://localhost:7782/mcp`, on 11.10 and up) or work on something else. Reads still
  run. The Command Center shows **Studio Pro open · mxcli paused** while it
  is, and the button says **Studio Pro is open**. Opening and closing are in Team
  chatter and the Audit log (`studio.opened`, `studio.closed`, `studio.stale-lock`, and each held
  write as `studio.denied`). Closing it with model changes uncommitted puts *Commit your Studio Pro
  changes so the agents build on them* in Needs you. Workers already running get the hook when
  they're next started or resumed; agents other than Claude Code aren't held.

### Improved
- **New project wizard creates the Mendix app**: a new project gets a blank app from Studio Pro's own
  `mx create-project` (`travel-approval` → `TravelApproval.mpr`, at the repository's root where the
  toolkit looks for it), before the toolkit's init so the scaffold names it, and committed with the
  scaffold in one commit. Mendix's generated files (`deployment/`, `.mendix-cache/`, `theme-cache/`,
  `*.mpr.lock` …) go into `.gitignore`. Falls back to `mxcli new` when that Studio Pro has no `mx`. The
  live app no longer stops at "No Mendix project (.mpr)" on a fresh project.
- **New project wizard hires the team**: the Project Coordinator and the Leads you tick are hired on
  the new floor at the end of the setup (the Team tab's hire, each on its role's model), so they're at
  their desks when you arrive. A Retry never hires anyone twice. With the Chief Analyst on the team,
  the Discovery issue is its first task instead of going to a worker off the queue.
- **Studio Pro 11.12.4 by default**: the wizard picks the newest 11.12 installed (11.6.4 when there is
  none); the dropdown still lists every version. For an existing app that's already a floor, it picks
  the version the app was last saved with.
- **Interview mode in the toolkit's words**: Steering (default), Assist or Auto, the modes the toolkit's
  `interview-mode.sh` reads from `PROJECT.md`. The wizard used to write "attended"/"unattended", which
  the toolkit didn't recognise and quietly treated as steering.
- **Each project builds with its own Studio Pro**: agents, queue workers, 🔄 Re-check gates, the
  wizard's toolkit runs and the live app get the floor's `.claude/toolkit.env` (`MXBUILD_PATH` and the
  rest) over the office's environment. An office started with `MXBUILD_PATH` for 10.24 no longer makes
  an 11.12.4 project's agents build with 10.24's mxbuild (the toolkit lets the environment win over
  `toolkit.env`). A floor without `toolkit.env` is unchanged.
- **Edit answers hires roles ticked since**: editing a project's answers later also hires the roles
  newly ticked, and only those: never one the floor already has, at work, benched or sent home on
  purpose. Unticking a role sends no one home.
- **Chief Analyst on the Discovery model**: handed the Discovery issue, the Chief Analyst is hired on
  the model picked in the wizard (Opus by default), now shown as "Chief Analyst's model for Discovery".
  Its role's model on the Team tab stays for later hires.

- **New project wizard survives restarts and flaky steps**: the setup now runs on the office's new
  workflow engine. It's saved after every step, so an office restart halfway loses nothing: the step
  it was on shows as failed and 🔁 Retry carries on from there. Creating the repository, cloning,
  creating the app, pushing and opening the Discovery issue try again by themselves (up to three tries,
  waiting a few seconds longer each time) when the connection drops or GitHub is busy; the log says
  *↻ … trying again in 3s*. Otherwise the wizard looks and works as before.

### Fixed
- **No more false "needs input" at boot**: a Claude worker in a project with a slow SessionStart hook
  (a toolkit project's `mxcli init --sync-skills` and `mxcli run --setup`) shows as starting until its
  session is up, instead of jumping to 🙋 *Waiting on a setup prompt* after 12 seconds. It's flagged
  only when the trust or login screen is actually on its terminal. Once its session is up, the
  *Waiting on a setup prompt* line goes from its card (idle workers used to keep it for good).
- **Jeff escalates only real asks**: with *Waiting on you* On, Jeff raises an escalation only when the
  end of the agent's message really asks you something (a question to you, a request or approval, an
  `AWAITING-PM:` line). Progress reports he thinks are waiting ("Still running: …", "I also told
  Keith …", "Merging that branch will need your approval when I open its PR") are logged as
  disagreements, marked *held* on the Analysis tab, and not raised. He no longer raises what the agent
  already raised (open, or answered in the last 6 hours).
- **Duplicate escalations merge**: an agent escalating what's already open on the floor (nearly the
  same title) adds a **+1 from** *name* with its details to the open one instead of opening another,
  and hears your answer too.
- **Haiku workers stop asking for every edit**: Claude Code's auto mode isn't available for Haiku, so
  Haiku workers start in *accept edits* mode: file edits in their worktree don't ask. The hire window
  and the Team tab's model picker say so.

### To know
- Workflows (Docs → Automation → Workflows): runs are kept in the office's data folder under
  `flows/<workflow>/`, each run's start, finish, failure and pause is in the Audit log (`flow.*`, by
  Workflows), and `GET /api/flows` lists them. Setups saved before this are taken in on first use; their
  old file in `wizard/` is kept as `<id>.json.migrated`.
- Setups saved with "attended"/"unattended" read as Steering/Auto. Creating the app takes about 15
  seconds with `mx`; `mxcli new` takes longer (it downloads MxBuild first).
- Jeff's old behaviour is still there: Settings → Jeff · Router → **When to escalate** → *His say-so*.
- Haiku's shell commands (`git`, `gh`, builds) still follow the project's permission settings and may
  still ask. A `--permission-mode` or `--dangerously-skip-permissions` in `--agent-args` overrides the
  accept edits mode. Other agents (Codex, Grok, Muse, Pi), which can't be read off the screen, are
  still flagged when they haven't said they're up 12 seconds in.

## 2026-10-05 · release 4 (`6639313`)

### New
- **🎨 Clean (Light) and Clean (Dark)** themes: plain and quiet like VS Code's classic light and dark
  themes. Neutral greys, a blue accent, a sans-serif font with a strict type scale and no heavy weights,
  small corners and 1px borders, flat buttons and tabs, and no emoji anywhere (line icons on buttons
  that were only an emoji). The 🎨 button now opens a list of all five themes.
- **📚 Documentation at `/docs`**: the whole office explained, in the office's themes: a sidebar of
  sections (Get Started, Concepts, Using the Office, Teams & Agents, Automation, Integrations,
  Administration, Reference, Troubleshooting, FAQ), search as you type, "On this page", deep links,
  and these release notes. ☰ → 📖 Documentation, or 📚 Docs on Home. Same sign-in as the office. The
  pages are Markdown in `docs/site/`; this file is the Release notes page, so there is one copy.
- **🏛️ The Firm** (`/firm`): independent Reviewer Agents on Fable 5.1. An Engagement Partner plus a
  reviewer attached to each project team (Design, Code & Architecture, QA & Test, Requirements &
  Delivery; Security and Cost & Performance optional). Call an audit from a project's Command Center
  or from `/firm`: scope, test types, artifacts, depth, model per reviewer, budget cap, with a cost
  estimate. Reviewers work in an isolated clone at a pinned commit, without the team's instructions or
  GitHub write access, and interview the Leads (`office-workers firm ask` / `firm answer`). The report:
  executive summary, app statistics, findings register, pros and cons, root causes, re-forecast
  timeline, expectations vs reality, worker performance with "slacking?" flags, risks and
  recommendations. Budget warnings at 80 %, wrap-up at 100 %.
- **🧾 Audit log**: a tab on each project and on Home. Who did what and when (people, agents, the
  office, Jeff, reviewers), with filters, a histogram, expandable before/after details, CSV/JSONL
  export, and a hash chain that shows "Chain verified" or where it was edited. Prompt text is not
  logged unless an admin turns it on.
- **🧑‍⚖️ Jeff sorts your escalations**: open escalations are ranked by how blocking and risky they are
  (older blockers rise) and listed in that order in Escalations to you, Approvals and Needs you, with
  "#1 · resolve first" chips. A critical or urgent one he hasn't rated yet stays on top. Setting:
  Settings → Jeff · Router → Priority.
- **💬 Team chatter**: a chat thread on each project's Command Center, beside Recent activity, showing
  what the agents say to each other as it happens: escalations and your answers, the office's relays
  to the Project Coordinator, standups, review nudges, subagent tasks and their reviews, handoff
  notes, PRs handed over, team journal entries (a line naming a teammate is shown as said to them)
  and The Firm's interview questions and answers. Each message shows who said it, to whom, and opens
  what it's about. Filter by All, Between agents, With me, or one person; new messages slide in on
  top without moving your scroll. Each team's page has a short version. Nothing is made up: only
  what was really said or written.

### Improved
- **New project wizard**: client, operator and role settings are committed with the project
  (`agent-office.project.json`), not kept only on this machine. **Re-check gates** is admins-only,
  with an explanation of what it does.

### To know
- Test a real audit first with a quick depth, 2 reviewers and a small cap (e.g. $10): Fable is
  priced at $10 / $50 per million input / output tokens.

## 2026-10-05 · release 3 (`b740e6f`)

### New
- **🧰 Agent skills**: a Skills panel on every Org chart card, in three groups (Manage up, Manage
  down, Craft), each skill with a switch and a gate (Ask / Propose / Tell / FYI). Gates follow the
  project's autonomy level unless you override them per agent. The office enforces them.
- **Subagent track record and benching**: Leads record a verdict on each subagent run
  (`office-workers subagent review`); each subagent gets an A–F grade per model. Leads (within their
  gates) or you can warn, bench, swap the model of, or reinstate a subagent. Benched subagents are
  removed from the Lead's toolbox and denied in its settings; they come back after a cool-down
  (24 h by default, Settings → Subagents).
- **Escalation cards show who raised them**: the agent's 2D character, big, with a casual speech
  bubble saying what it needs; the details sit underneath.

### Improved
- **Rankings**: a Lead's Review turnaround and Review quality now come from its subagent reviews.

## 2026-10-05 · release 2 (`86e3955`)

### New
- **🏅 Worker rankings** on the Workers tab: an A–F grade for every agent from four standard criteria
  (model benchmark, delivery, autonomy, token efficiency) plus specialist duties for the Project
  Coordinator and each Lead, with evidence, confidence and highlights. Leaderboard, This floor / All
  floors, grouped by model or role. Agents that went home stay listed.
- **🗺️ 2D Overview** on Home: every project's office side by side, live, with zoom and pan like the
  2D view; click a floor's banner to open it.
- **Benched Leads take breaks** in the 2D view and the Overview: TV in the lounge, a smoke on the new
  balcony, coffee at the kitchen.
- **☰ is the last item on every top bar**, Home included.

### Improved
- **Workers tab** uses the full page width, cards in a grid.
- **Waiting on another floor**: the jump lands on that floor's Command Center; Needs you lists agents
  that finished a turn you haven't looked at (Review →), and their worker card says so.
- **Answer →** in Needs you lands on the escalation in one step and the card pulses.

## 2026-10-05 · release 1 (`70a37c3`)

### New
- **Needs you** strip at the top of the Command Center: everything blocked on you, most urgent first,
  each with one button to fix it, and a count on the Command Center tab.
- **🌳 Git tab**: the branches as a railway map, with agents' robots at their branch tips, PR pills by
  CI result, ahead/behind chips and stale-branch markers.
- **Top bar**: the ☰ menu with every 3D item on the 1D and 2D views, one view dropdown (1D / 2D / 3D /
  Retro), red badges on the tabs; the 2D view follows the 1D colour theme.
- **🧑‍⚖️ Jeff · Router**, the office's quick judge (Jev by TypeSafe AI, Claude Haiku as fallback), in
  shadow mode: "is this agent waiting on you?" at each turn end, and team triage of new issues.
  His own room in the 2D office, a staff card on the Org chart, a section on the Analysis tab.

### Fixed
- **Leads stuck waiting on you**: questions to you go through escalations, a Lead with an open
  escalation isn't benched, answering a benched Lead's escalation hires it back, and a Lead's
  handoff note that says it's waiting on you raises an escalation for it.
- **Idle benching is off by default**: Leads are benched only when you say so (Settings to turn it
  back on).
- **Board scroll**: hovering a card no longer jumps the columns back to the top.

## Before 2026-10-05 (`f4eaf2f`)

The App Factory baseline: floors and the 1D / 2D / 3D / Retro views, the Command Center with the
project console, the board and team boards, the project team (Project Coordinator and four Leads)
with autonomy levels, standups and the review loop, the new project wizard with the
mxcli-project-toolkit, the live app, analysis and model comparison, themes (Default / Dark /
Terminal), and the README guides.
