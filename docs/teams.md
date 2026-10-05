# Project teams

Back to [Features](features.md).

Every floor can have a project team: a **Project Coordinator** and four **Leads**, each an agent at a desk with a fixed name, and each Lead's own team as Claude Code subagents inside its session. They work for the **Project Manager**: you, the human who owns the project (anyone who's an admin; with the shared office password, everyone is). The 1D view's **👥 Team** tab is where you run the team, and the board's **project console** is where you talk to the Coordinator and answer the team's escalations.

Throughout the office, the Playbooks and every prompt, "the Project Manager" always means the human; the coordinating agent is "the Project Coordinator" (its role id stays `pm`, so saved rosters and its Playbook path `team-pm` carry on unchanged).

| Role | Mission | Team (subagents) |
| --- | --- | --- |
| 🧭 Project Coordinator | Keeps the plan, coordinates the Leads, runs the standup, relays and summarises escalations | — |
| 🎨 Lead Designer | Reviews and approves design changes (Atlas, wireframes, layouts, branding) | UI/UX Designers |
| 🛠️ Lead Developer | Does all the programming; the **one writer** of the Mendix app (only it runs `mxcli exec`) | Developers (draft MDL, `mxcli check`) |
| 🧪 Lead Tester | Every app with minimal bugs and the highest quality; approves testing, improves the framework | Testers (`tests/*.test.mdl`, `tests/e2e`, qa-tests) |
| 📈 Chief Analyst | High-quality requirements, business acumen; analyses each app's development cycle; weekly insight memo | Business Analysts, Data Analysts |

The roles are adapted from the mxcli-project-toolkit's agents (`skills/agent-roles.md`): the subagent files keep their scoped tools and the never-`exec` rule.

## The Team tab

- **🏢 Org chart.** The Project Coordinator over the four Leads. Each card has the role's name (picked from a pool of people's names, renamed with ✏️), where it stands (*Working*, *Needs you*, *Idle*, *Asleep*, *Writing handoff*, *Benched*, *Not hired*), its model (🧠, from its next hire), its session's cost, how long until it's benched, and the newest entry in its team journal. **🤝 Hire** starts it fresh, with an optional first task; **⏰ Wake** carries on an asleep one's session; **🪑 Bench** benches it now; **🖥️ Terminal** opens it.
- **📋 Standup.** **▶️ Run standup**, when the next scheduled one is, the standups so far, and the picked one's page with its proposals.
- **✅ Approvals** (with a count on the tab): everything waiting on you, the Project Manager, at the floor's autonomy level — open escalations (the same cards as on the project console, loudest first), standup proposals, the team's pull requests when merges need you, a cost cap reached.
- **⚙️ Settings**: the autonomy level (with what Leads escalate at each), the idle minutes before benching, the **review nudge** (on by default), the standup schedule, a daily cost cap per autonomy level, and a dry run for issues.

The meeting room's window has **📋 Standup** too, for the latest page.

## The project console on the Command Center

The 1D view's **🎛️ Command Center** tab (its first) has the project summary in three equal columns: the project's details, the **project console**, and the recent activity (stacked on a phone, the console second). The console shows the Project Coordinator's name, where it stands, its model and cost, and its terminal live and read-only (scaled to the column; **⤢ Open** for the full terminal, **⏰ Wake** when it's asleep). Above the prompt box are the **🚩 Escalations to you** (see [The review loop](#the-review-loop-and-escalations)); they show even with no Coordinator hired. **Ask the Project Coordinator…** sends it a prompt (Enter sends, Shift+Enter is a new line, ↑/↓ recalls what you sent this visit); while it's busy the prompt waits in its input box. The chips ask for a status update, what's blocking, or the next steps, and **📋 Run standup** runs the standup. When the Coordinator is asking something, answer it in ⤢ Open: a typed prompt isn't an answer to a choice. With no Coordinator, the console offers **🤝 Hire Project Coordinator** (admins); with a benched one, its handoff note and **Hire again**. The console watches the Coordinator's terminal only while the Command Center is in front, since a viewer counts as someone at its terminal and keeps it from being benched.

## Sub-boards

The project has one main board and a sub-board per team. Every card on the 1D view's **🗂 Board** (an issue, a queued task, an agent, a PR) belongs to a team, and wears its tag (🧭 Coord, 🎨 Design, 🛠️ Dev, 🧪 Test, 📈 Analysis, or ◌ None):

1. a `team:<team>` label on the issue or PR (`team:design`, `team:development`, `team:testing`, `team:analysis`, `team:management`) — what the Project Manager sets, what a Lead's `gh pr create --label team:<team>` sets (its Playbook asks for it), what the office adds to a Lead's own PR that has none, and what an approved standup proposal gets;
2. else, for an agent: the team of its roster role, when it's one of the Leads or the Project Coordinator;
3. else, for a PR: its author worker's roster team, else the team of an issue it closes;
4. else, for a queued task: its issue's team; for another agent: its task's issue, else its PR's label;
5. else **Unassigned**.

**The main board** is the Project Manager's view from above: every team's cards, a **Teams** bar of chips over the columns (All, each team with its count, Unassigned; pick several to see them together, remembered on that browser and kept in the address as `&teams=design,testing`), and under each column's header how many of its cards are each team's.

**Re-tagging.** A card's hover preview, and the issue and PR windows, have **Team [▼]**: for the Project Manager (an admin) a picker that swaps the card's `team:` label on GitHub as the office's gh account (the card moves at once, and back if GitHub refuses); for everyone else the tag, read-only. A Lead's own card is its role's team and stays read-only. Before the first tag on a floor the office makes whichever of the five labels the repo is missing, in their team's color. In dry-run mode (the team setting, or `AGENT_OFFICE_TEAMS_DRY_RUN=1`) nothing is written to GitHub: the card moves on that page only, until the next look at GitHub.

**🧩 Team boards** (`?tab=teams&team=testing`; the org chart stays on **👥 Team**) has a page per team: a switcher of the five teams with their card counts; the team's header (its mission, its Lead's card from the org chart with ⏰ Wake and 🤝 Hire for the Project Manager, its subagents); the team's own board (the same columns, only its cards); its journal's newest entries, read from the floor's main checkout; and panels of its own:

| Team | Panels |
| --- | --- |
| 🧭 Management | The latest standup (and its page in the repo), the approvals waiting on the Project Manager |
| 🎨 Design | Design approvals, the files under `design/` and `docs/design/` |
| 🛠️ Development | The 🌐 Live app chip, the open **Development** PRs with their checks (by the same rule as the tags) |
| 🧪 Testing | Open PRs whose checks fail, and each open PR's CI scorecard (the pr-checks run) |
| 📈 Analysis | The BRD and insight memos (`docs/insights/`, `docs/requirements/`, `*brd*.md`), the analyzer's model ranking for the floor |

None of it asks a model or polls: it's the board's own data, the roster, the PR checks and the analyzer, plus `GET /api/teams/page` (the journal and file lists, kept 20 seconds) and `POST /api/teams/labels` (admins).

## In the project

Hiring a role writes these into the folder it works in (its worktree), to land with its first pull request:

- its Playbook, `.ai-context/skills/team-<role>/SKILL.md`, mirrored to `.claude/skills/team-<role>/SKILL.md`: mission, rights, what needs the Project Manager at the current autonomy level, the **review protocol** with its escalation thresholds (Leads), journal etiquette (and `gh pr create --label team:<team>`), lessons and the one-writer rule. It's written again, and the Leads at work told, when the Project Manager changes the level.
- its team's subagents, `.claude/agents/<id>.md` (`ui-ux-designer`, `developer`, `tester`, `business-analyst`, `data-analyst`): they never ask the Project Manager or escalate themselves, and end every result with **Done / Checks / Open / Next** for their Lead to review.
- the team journal, `docs/team/<team>.md` (management, design, development, testing, analysis), when missing: dated `## YYYY-MM-DD HH:MM — <what>` entries, newest at the bottom. Teams share updates there instead of messaging each other.
- the lessons Playbook when missing: `.ai-context/skills/mxcli-field-lessons/SKILL.md` if the project has it, else `.ai-context/skills/project-lessons/SKILL.md`.

## Benching

A Lead whose turn has been over for the idle minutes (default 30; 0 = only by hand), with nobody at its terminal, is **benched**: the office asks it for a handoff note (what it knows, decisions, open threads, next steps) in its team journal and for its durable lessons in the lessons Playbook (and `mxcli brain capture`, where available), waits for that turn to end, keeps the note, and sends the worker home: its session is gone, and its worktree stays if it holds work not on GitHub. Hiring it again starts a **fresh session** primed with its Playbook and that note, never a resume. A Lead mid-task or waiting on a person is never idle, and never stopped while it writes; an asleep one already costs nothing, so it's only benched by hand.

## The standup

On **▶️ Run standup**, and on schedule (weekdays 09:00 Asia/Singapore by default) **only if the floor had activity since the last one**: each Lead at its desk is asked to append a `— Standup` entry to its journal with `### Done`, `### Next`, `### Blockers` and `### Proposals` (`- [kind] Title — why`). Benched, asleep and unhired Leads are summarised from their journals without being woken. Once everyone asked has answered (or after 20 minutes), the office compiles the page, writes it into the Project Coordinator's folder as `docs/standups/YYYY-MM-DD.md` and asks the Coordinator to add a summary, with the open escalations, and commit it (with no Coordinator at work, the page stays in the office). The Chief Analyst also gets the analyzer's numbers for the floor and is asked for the week's insight memo (`docs/insights/YYYY-Www.md`) when there isn't one.

Each proposal is a card. What the team may decide itself at the floor's level becomes a GitHub issue straight away; the rest waits for the Project Manager: **✅ Approve** makes an issue labelled `team:<team>`, **❌ Reject** records the reason, **✏️ Change** says what to change. The Project Coordinator is told the decisions in one message a minute after the last one (an asleep one hears them when it's back at its desk). A dry run (the setting, or `AGENT_OFFICE_TEAMS_DRY_RUN=1` for the whole office) records approvals without making issues.

## Autonomy

| Level | The team may | The Project Manager approves |
| --- | --- | --- |
| 1 Directive | only propose | every task |
| 2 Guided (default) | create tasks within the approved scope | scope changes, design and architecture changes, peer approvals, merges, milestones, budget |
| 3 Delegated | approve each other's work within budget | merges, milestones, client-facing milestones, budget |
| 4 Autonomous | everything else | client-facing milestones and budget |

The level is in every Playbook and every hire's first message; the Project Manager always has the final say. A **daily cost cap** can be set per level (off by default): when the floor's spend today (in the schedule's time zone) reaches the cap for its current level, hiring on that floor pauses until the next day — every way of hiring, the team's, the desks', the queue's and meetings'.

## The review loop and escalations

A Lead runs its team as subagents, and a subagent that finished must never leave its lane idle. So every Lead's Playbook has a **review protocol**: after **every** subagent result it reviews the work against the task and its acceptance criteria (running the cheap checks: `mxcli check`, the tests, the linter), records a `## YYYY-MM-DD HH:MM — Review: <subagent> · <task>` entry in its journal with a verdict (**accept / revise / escalate**) and why, and then at once either dispatches that subagent's next step, sends it back with specific revision notes, or **escalates** to you, the Project Manager.

When a Lead escalates depends on the floor's autonomy level (`REVIEW_POLICY` in `src/shared/roster/autonomy.ts`, rendered into every Lead's Playbook):

| Level | Escalate to the Project Manager | Revision rounds | Ask before next step | Quietest urgency that alerts |
| --- | --- | --- | --- | --- |
| 1 Directive | every review outcome that changes scope, design or plan | 2 | yes | info |
| 2 Guided | design, architecture and scope changes; a review still failing after 2 revision rounds; anything blocking | 2 | no | important |
| 3 Delegated | only milestone-level issues, repeated failures and budget risk | 3 | no | urgent |
| 4 Autonomous | only critical issues: security, data loss, a client-facing milestone, a budget overrun, blocked with no path | 3 | no | critical |

The critical ones (security, data loss, a client-facing milestone, a budget overrun, blocked with no path) escalate at every level.

**Raising one.** `office-workers escalate --urgency info|important|urgent|critical --trigger <kind> --title "…" --option "A" --option "B" --recommend "A"`, with the details on stdin, or the agent-office MCP server's `escalate` tool (Claude Code workers may call it without asking). Any agent on the floor can; the Leads and the Coordinator are told when to. The office records it on the floor's roster and never refuses one: below the floor's threshold for its level (its trigger isn't one the level escalates, or, without a trigger, its urgency is quieter than the level's) it's kept as **FYI**: shown, dimmed, without a toast or an alert.

**Seeing it.** On the project console (🎛️ Command Center), above the prompt box, as a card: who raised it and why, the details, its options (the recommended one starred) and **💬 Reply**, **✅ Approve**, **❌ Reject** (and **✓ Noted** for an FYI). Urgent and critical ones are highlighted, toasted on the floor and sent as a desktop notification (with notifications on). The same card is in the Team tab's **✅ Approvals**, counted on the tab's badge. The recent activity notes each one.

**Answering it.** Your answer goes to the agent that raised it as its next prompt (an asleep one wakes with it; one that has gone home gets it in its next hire's first message) and the card is resolved; the last few answered ones fold under it. The Project Coordinator is told about new escalations (not FYIs, not its own) in one message a minute after the last, notes them in `docs/team/management.md` and summarises the open ones in the standup; it never answers one for you.

**The review nudge.** When a Lead's turn ends right after one of its subagents came back (the office sees the Agent tool's result in the Lead's hook events), the office sends it one short prompt: *Review your subagent's last result per your Playbook's review protocol, then continue or escalate.* Once per idle period, 15 seconds after the turn ends (so your own prompt goes first), at least 3 minutes apart, and never while the Lead needs you, is asleep, benched or being benched, or is answering a standup; only for a result that came back in the turn that just ended. It's a team setting (**⚙️ Settings → Review loop**, on by default), each one is noted in the recent activity, and the office asks no model for it.

## What it costs

Nothing on its own: the office makes no model calls for the team. Tokens are spent only by the Leads you hire, by a standup's question to the Leads at work (and only with activity since the last), by a handoff before benching, by one message to the Project Coordinator per batch of decisions or escalations, by a review nudge (one turn of a Lead's, once per idle period), and by an escalation's answer (one turn of the agent that raised it). Benching frees the context of anyone idle.

## On the 2D view

Each team works in its own patch of the floor (`src/shared/zones.ts`), painted in its own style on the 2D view, with a signpost naming its Lead. Hiring a role from the Team tab sits it at a free desk in its team's patch first (the first desk listed, facing the room, is the Lead's), and anywhere free when they're all taken. Other hires sit where they always have.

| Patch | Team | Desks |
| --- | --- | --- |
| 🛠️ Dev bay (north-west pod) | Developers | 1, 2, 3, 4 |
| 🎨 Design studio (north-east pod) | UI/UX Designers | 5, 6, 7, 8 |
| 🧪 QA lab (south-west pod) | Testers | 9, 10, 11, 12 |
| 📈 Analyst corner (south-east pod, west half) | Business & Data Analysts | 13, 15 |
| 🧭 Coordinator office (south-east pod, east half, glass-walled) | Project Coordinator | 14, 16 |

The back office's desks, the bean bags and the board agents' kiosks are open floor.

## Where it's kept

The roster (names, models, handoff notes, standups, proposals, escalations, the day's spend) is in the office's data dir, `.agent-office/roster/<floor>.json`. The code is in `src/server/roster/`, `src/shared/roster/` and `src/client/ui/roster/`; the routes are `GET /api/roster`, `GET /api/roster/standup` and `POST /api/roster/action` (`action: 'escalation'` answers one), and the agents' side is `POST /office/workers/escalate` on the hook port (`office-workers escalate`, the `escalate` MCP tool). The review nudge is `src/server/roster/nudge.ts`, the escalations `src/server/roster/escalations.ts`, the thresholds `REVIEW_POLICY` in `src/shared/roster/autonomy.ts`.
