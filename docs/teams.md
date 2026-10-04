# Project teams

Back to [Features](features.md).

Every floor can have a project team: a **Project Manager** and four **Leads**, each a worker at a desk with a fixed name, and each Lead's own team as Claude Code subagents inside its session. The 1D view's **👥 Team** tab is where the CTO (anyone who's an admin; with the shared office password, everyone is) runs it.

| Role | Mission | Team (subagents) |
| --- | --- | --- |
| 🧭 Project Manager | Keeps the plan, coordinates the Leads, runs the standup | — |
| 🎨 Lead Designer | Reviews and approves design changes (Atlas, wireframes, layouts, branding) | UI/UX Designers |
| 🛠️ Lead Developer | Does all the programming; the **one writer** of the Mendix app (only it runs `mxcli exec`) | Developers (draft MDL, `mxcli check`) |
| 🧪 Lead Tester | Every app with minimal bugs and the highest quality; approves testing, improves the framework | Testers (`tests/*.test.mdl`, `tests/e2e`, qa-tests) |
| 📈 Chief Analyst | High-quality requirements, business acumen; analyses each app's development cycle; weekly insight memo | Business Analysts, Data Analysts |

The roles are adapted from the mxcli-project-toolkit's agents (`skills/agent-roles.md`): the subagent files keep their scoped tools and the never-`exec` rule.

## The Team tab

- **🏢 Org chart.** The PM over the four Leads. Each card has the role's name (picked from a pool of people's names, renamed with ✏️), where it stands (*Working*, *Needs you*, *Idle*, *Asleep*, *Writing handoff*, *Benched*, *Not hired*), its model (🧠, from its next hire), its session's cost, how long until it's benched, and the newest entry in its team journal. **🤝 Hire** starts it fresh, with an optional first task; **⏰ Wake** carries on an asleep one's session; **🪑 Bench** benches it now; **🖥️ Terminal** opens it.
- **📋 Standup.** **▶️ Run standup**, when the next scheduled one is, the standups so far, and the picked one's page with its proposals.
- **✅ Approvals** (with a count on the tab): everything waiting on the CTO at the floor's autonomy level — standup proposals, the team's pull requests when merges need the CTO, a cost cap reached.
- **⚙️ Settings**: the autonomy level, the idle minutes before benching, the standup schedule, a daily cost cap per autonomy level, and a dry run for issues.

The meeting room's window has **📋 Standup** too, for the latest page.

## The PM console on the board

The 1D view's **🗂 Board** tab has the project summary in three equal columns: the project's details, the **project manager console**, and the recent activity (stacked on a phone, the console second). The console shows the PM's name, where it stands, its model and cost, and its terminal live and read-only (scaled to the column; **⤢ Open** for the full terminal, **⏰ Wake** when it's asleep). Under it, **Ask the project manager…** sends it a prompt (Enter sends, Shift+Enter is a new line, ↑/↓ recalls what you sent this visit); while it's busy the prompt waits in its input box. The chips ask for a status update, what's blocking, or the next steps, and **📋 Run standup** runs the standup. When the PM is asking something, answer it in ⤢ Open: a typed prompt isn't an answer to a choice. With no PM, the console offers **🤝 Hire Project Manager** (admins); with a benched one, its handoff note and **Hire again**. The console watches the PM's terminal only while the Board tab is in front, since a viewer counts as someone at its terminal and keeps it from being benched.

## In the project

Hiring a role writes these into the folder it works in (its worktree), to land with its first pull request:

- its Playbook, `.ai-context/skills/team-<role>/SKILL.md`, mirrored to `.claude/skills/team-<role>/SKILL.md`: mission, rights, what needs the CTO at the current autonomy level, journal etiquette, lessons and the one-writer rule. It's written again, and the Leads at work told, when the CTO changes the level.
- its team's subagents, `.claude/agents/<id>.md` (`ui-ux-designer`, `developer`, `tester`, `business-analyst`, `data-analyst`).
- the team journal, `docs/team/<team>.md` (management, design, development, testing, analysis), when missing: dated `## YYYY-MM-DD HH:MM — <what>` entries, newest at the bottom. Teams share updates there instead of messaging each other.
- the lessons Playbook when missing: `.ai-context/skills/mxcli-field-lessons/SKILL.md` if the project has it, else `.ai-context/skills/project-lessons/SKILL.md`.

## Benching

A Lead whose turn has been over for the idle minutes (default 30; 0 = only by hand), with nobody at its terminal, is **benched**: the office asks it for a handoff note (what it knows, decisions, open threads, next steps) in its team journal and for its durable lessons in the lessons Playbook (and `mxcli brain capture`, where available), waits for that turn to end, keeps the note, and sends the worker home: its session is gone, and its worktree stays if it holds work not on GitHub. Hiring it again starts a **fresh session** primed with its Playbook and that note, never a resume. A Lead mid-task or waiting on a person is never idle, and never stopped while it writes; an asleep one already costs nothing, so it's only benched by hand.

## The standup

On **▶️ Run standup**, and on schedule (weekdays 09:00 Asia/Singapore by default) **only if the floor had activity since the last one**: each Lead at its desk is asked to append a `— Standup` entry to its journal with `### Done`, `### Next`, `### Blockers` and `### Proposals` (`- [kind] Title — why`). Benched, asleep and unhired Leads are summarised from their journals without being woken. Once everyone asked has answered (or after 20 minutes), the office compiles the page, writes it into the PM's folder as `docs/standups/YYYY-MM-DD.md` and asks the PM to add a summary and commit it (with no PM at work, the page stays in the office). The Chief Analyst also gets the analyzer's numbers for the floor and is asked for the week's insight memo (`docs/insights/YYYY-Www.md`) when there isn't one.

Each proposal is a card. What the team may decide itself at the floor's level becomes a GitHub issue straight away; the rest waits for the CTO: **✅ Approve** makes an issue labelled `team:<team>`, **❌ Reject** records the reason, **✏️ Change** says what to change. The PM is told the decisions in one message a minute after the last one (an asleep PM hears them when it's back at its desk). A dry run (the setting, or `AGENT_OFFICE_TEAMS_DRY_RUN=1` for the whole office) records approvals without making issues.

## Autonomy

| Level | The team may | The CTO approves |
| --- | --- | --- |
| 1 Directive | only propose | every task |
| 2 Guided (default) | create tasks within the approved scope | scope changes, design and architecture changes, peer approvals, merges, milestones, budget |
| 3 Delegated | approve each other's work within budget | merges, milestones, client-facing milestones, budget |
| 4 Autonomous | everything else | client-facing milestones and budget |

The level is in every Playbook and every hire's first message; the CTO always has the final say. A **daily cost cap** can be set per level (off by default): when the floor's spend today (in the schedule's time zone) reaches the cap for its current level, hiring on that floor pauses until the next day — every way of hiring, the team's, the desks', the queue's and meetings'.

## What it costs

Nothing on its own: the office makes no model calls for the team. Tokens are spent only by the Leads you hire, by a standup's question to the Leads at work (and only with activity since the last), by a handoff before benching, and by one message to the PM per batch of decisions. Benching frees the context of anyone idle.

## Where it's kept

The roster (names, models, handoff notes, standups, proposals, the day's spend) is in the office's data dir, `.agent-office/roster/<floor>.json`. The code is in `src/server/roster/`, `src/shared/roster/` and `src/client/ui/roster/`; the routes are `GET /api/roster`, `GET /api/roster/standup` and `POST /api/roster/action`.
