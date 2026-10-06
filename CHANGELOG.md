# Release notes

What changed in the App Factory (our fork of agent-office), newest first. A release is what went
live with an office restart; **Unreleased** is merged into `staging/integration` and waits for the
next one. Each entry says what you'll notice, then anything to know. Commit hashes are on `main`.

## Unreleased

### New
- **Open in Studio Pro**: a button in a Mendix project's Command Center heading (and ☰ → 🧱 Open in
  Studio Pro) opens the floor's `.mpr` in Studio Pro on the office's computer, in the version the
  project was saved in (through Mendix's Version Selector). Admins only, after a confirm that warns
  that no agent may run `mxcli exec` while Studio Pro has the project open and lists the agents busy on
  the floor. Each open is in the Audit log (`studio.open`) and in Team chatter. It only works when the
  office runs on a Windows desktop with Studio Pro installed; otherwise the button is greyed out and
  says why.

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
