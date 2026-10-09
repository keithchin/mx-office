---
title: API endpoints
description: Every HTTP route of the office server - method, path, whether it needs the sign-in, admin-only actions, and what it's for.
weight: 3
---

The office's HTTP routes, in the order the server tries them (`src/server/http/routes/`). **Public** routes answer anyone. **Session** routes need a signed-in browser: without one, `/api/*` gets `401` and pages redirect to `/login`. Most real-time traffic goes over the WebSocket at `/ws` instead.

## Sign-in and health (public)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Sign in |
| GET | `/api/login` | Which sign-in fields exist |
| POST | `/api/join` | Accept an invite |
| GET / POST | `/api/claim` | Check / claim a generated password with its token |
| POST | `/api/link` | One-time sign-in link key |
| POST | `/api/logout` | Sign out |
| any | `/api/health` | `{ ok: true }` when the office is up |
| any | `/assets/*` | The client bundle's files |
| any | `/login`, `/claim`, `/join`, `/favicon.svg` | Pages |
| GET | `/manifest.webmanifest` | The [phone version](../using-the-office/phone-version.md)'s web app manifest |
| GET | `/sw.js` | The phone version's service worker (app shell, push notifications) |
| GET | `/icons/*` | The phone version's home-screen icons |

## The office (session)

| Method | Path | Purpose |
|---|---|---|
| any | `/api/whoami` | The signed-in person, with the admin flag |
| GET | `/api/agents/<provider>/models` | A provider's model list |
| GET | `/api/image` | An image file |
| any | `/api/whiteboard/file` | A whiteboard file |
| any | `/api/term/drop` | A file dropped onto a terminal |
| any | `/api/changes/file` | A changed file's content |
| GET | `/api/docs`, `/api/docs/*` | The floor's own Markdown (the bookshelf) |
| GET | `/api/search` | Search the chat and terminals |
| GET | `/api/services` | Workers' web servers (port forwards) |
| GET | `/api/gh/pull`, `/api/gh/issue`, `/api/gh/labels`, `/api/gh/pull/diff` | GitHub PR and issue windows |
| GET | `/api/git` | The branch map |
| GET | `/api/model/refs` | The Model tab: main and the branches it can show (`?floor=`) |
| GET | `/api/model/tree` | The Model tab: the app's tree (`?floor=&ref=`, `&fresh=1` waits for a new tree instead of the last one) |
| GET | `/api/model/doc` | The Model tab: one document, drawn or as MDL (`?floor=&ref=&type=&name=`, `&compare=1` for what the branch changed) |
| GET | `/api/model/mdl` | The Model tab: a microflow's or nanoflow's MDL and each element's lines in it, asked for after its diagram (`?floor=&ref=&type=&name=`) |
| GET | `/api/model/changes` | The Model tab: the documents a branch changed against main (`?floor=&ref=`) |
| GET | `/api/analysis` | The analysis report (`?scope=global`, `?floor=`, `&by=effort`) |
| POST | `/api/analysis/backfill` | Re-record every worker (admin) |
| GET | `/api/judge` | Jeff · Router's summary for a floor |
| GET | `/api/summary` | The project summary |
| GET | `/api/ranking` | The A–F worker ranking (`?floor=`, or all) |
| GET | `/api/home/stats` | The office's totals |
| GET | `/api/home/overview` | Every floor, for the 2D Overview |
| GET | `/api/pr-shots` | A PR's CI scorecard and screenshots |
| GET | `/api/pr-shots/file` | One screenshot |
| GET | `/api/roster` | The floor's team |
| GET | `/api/roster/standup` | One standup with its page |
| POST | `/api/roster/action` | Team actions (see below) |
| GET | `/api/studio` | `?floor=`: whether the floor has a Mendix project (`hasMpr`, `mpr`, `version`), whether Studio Pro can be opened from here, the agents mid-turn, and Studio mode (`state`: `open`, `since`, `pid`, `staleLock`, `mcp`, `uncommitted`); changes come over the WebSocket as `studio.state` |
| POST | `/api/studio/open` | `{ floor }`: opens the floor's .mpr in Studio Pro on the office's computer (admin) |
| GET | `/api/teams/page` | A team's page, with its 📦 deliverables |
| GET | `/api/deliverables`, `/api/deliverables/*` | 📦 Deliverables: `?floor=<id>[&team=<team>][&fresh=1]` lists every expected and extra deliverable with its status and where it is (main, which is `origin/<default>` when the project has a remote, a team member's worktree, an office branch), with `main` and `checkout` saying what main was and where the folder is; `/file?floor=&src=main\|wt:<worker>\|ref:<branch>&path=[&download=1]` serves one (HTML self-contained under a no-network CSP for a sandboxed frame, PDF, pictures, text); `/table?…` a CSV's first 200 rows. Only catalog paths, only places the scan listed, size-capped |
| POST | `/api/teams/labels` | Create missing `team:` labels (admin) |
| GET / POST | `/api/connections` | [Connections](../administration/connections.md) (admin): GET `/api/connections` (statuses and masked tails, never a value) and `/api/connections/tools` (the git / gh check); POST `/api/connections/save`, `remove`, `test` (`{ id }`, plus `value` to save), `import`, `mendix-floor` (`{ floor, on }`), `paths` (`{ which, dir }`), `git-identity`, `sweep` (`{ on }`), `sweep/run` |
| GET / POST | `/api/setup` | [First-run setup](../get-started/new-machine.md#step-3-the-first-run-setup): GET `/api/setup` (where the setup is; anyone signed in, details for admins) and `/api/setup/needed` (`{ needed, admin }`, the home page's one look on load); admins: GET `/api/setup/checks` (the prerequisite rows, run when asked), POST `/api/setup/password` (`{ password }`), `step` (`{ step }`), `org` (`{ org }`), `mendix` (`{ version }`), `mxcli` (`{ path }`), `toolkit` (`{ dir }`), `toolkit/clone` (`{ url, dir }`, answers with git's progress as JSON lines), `finish`, `rerun` |
| GET / POST | `/api/wizard/*` | The new-project wizard: GET `info`, `job`, `setup`, `answers`, `app-version` (`?repo=`: the Studio Pro an existing floor's `.mpr` was saved with); POST `recheck`, `start`, `retry`, `edit` (admin) |
| GET / POST | `/api/toolkit` | A floor's [toolkit version](../administration/toolkit-versions.md): GET `?floor=` (its Toolkit line, from a cache), GET `/api/toolkit/job?id=`; POST `/api/toolkit/check` (fetch the fork now, once a minute at most), `/api/toolkit/preview` and `/api/toolkit/apply` with `{ to: <sha> | latest | previous }` (admin) |
| GET | `/api/chatter` | Team chatter: `?floor=<id>&since=<ms>&limit=<n>&cursor=…&who=<name>` (with `as=<kind>` to tell a person from an agent of the same name) or `&with=agents\|me` |
| POST | `/api/phone/send` | Team phone: `{floor, text, place, verdict?}` sends a person's message (plain → the Project Coordinator, `@Name`, `@team`, a DM, a thread) through the roster's delivery, or answers an escalation in its thread (admin) |
| GET | `/api/phone/state` | Team phone: `?floor=<id>`, the replies the floor is waiting for |
| GET / POST | `/api/phone/reads` | Team phone: what this person has read, per channel (`?browser=<key>` / `{browser, reads}`; their account's when signed in with one) |
| GET | `/api/audit` | The audit log: `?floor=<id>\|all\|_office&since=&until=&actor=human,agent&action=worker.hire,github&q=&limit=&cursor=`, with counts, the chain check and a histogram |
| GET | `/api/audit/export` | Every matching event as a download, `&format=csv\|jsonl` (admin) |
| POST | `/api/audit/settings` | `{ promptText }`: log the first 80 characters of prompts, or not (admin) |
| any | `/m` | The [phone version](../using-the-office/phone-version.md) |
| GET | `/api/m/me` | Admin or not, until when risky actions go through without the password (`reauthUntil`), the push key, this person's phones |
| POST | `/api/m/reauth` | `{ password }`: the password typed again for risky actions (10 minutes; rate-limited like sign-in). The desktop pages use it too: through Phone access's tunnel, the risky desktop routes (`/api/roster/action` hire, cap raise and risky escalation approvals, `/api/budget/action` raises, `/api/project-run` resume / pause / continue, `/api/office/restart` start / anyway, `/api/connections/*` changes, `/api/phone-access`, `/api/notify/teams`, `/api/studio/open`, resolving `/api/incidents/<id>`, starting or stopping a test run and opening an incident from it under `/api/testlab/runs`) answer 401 `{ reauth: true }` without a fresh sign-in |
| POST | `/api/m/act` | `{ do, floor, … }`: an action from the phone: `escalation` (approve / reject / reply), `raise-cap`, `hire`, `merge` (answers the PR's URL), `pause`, `resume` (`choice`: `{ mode: 'work' | 'all' }`; both through [Pause / Resume project](../using-the-office/resume-and-pause.md), answering the run's progress). Risky ones answer 401 `{ reauth: true }` without a fresh sign-in; each is `phone.*` in the audit log |
| GET | `/api/m/status` | Each project's status line (working, asleep, asking, stage, spend, escalations, its pause and latest resume or pause run), and a safe restart while one is going (`restart`) |
| POST | `/api/m/push/key`, `/api/m/push/subscribe`, `/api/m/push/unsubscribe`, `/api/m/push/alerts`, `/api/m/push/test` | This phone's Web Push: the VAPID public key (made once), its subscription, its Do not disturb and digest, a test |
| GET | `/api/m/push` | This person's phones (`?all=1`: everyone's, admins) |
| GET / POST | `/api/phone-access` | [📱 Phone access](../administration/phone-access.md): the tunnel's state, address, sign-in prompt and checks; admins switch it on or off, pick the provider and the Cloudflare hostname |
| GET | `/api/incidents` | The incidents: `?floor=<id>|all|_office&status=open,mitigated&severity=sev1,sev2&q=`, worst first, with counts, the history check, the detection rules and whether you're an admin |
| POST | `/api/incidents` | `{ title, severity, summary?, floors?, impact?, rootCause?, actions?, linkAudit?, workers? }`: open one (admin) |
| GET | `/api/incidents/<id>` | One incident |
| POST | `/api/incidents/<id>` | Change its fields; `status: resolved` needs a `rootCause`; `linkAudit` / `unlinkAudit` link audit events (admin) |
| POST | `/api/incidents/<id>/note` | `{ text }`: a note on its timeline (admin) |
| GET, POST | `/api/incidents/settings` | The detection rules; POST `{ rules, dedupeHours }` changes them (admin) |
| GET | `/api/progress` | `?floor=<id>[&mini=1]`: the project progress bar's phases (the toolkit stages its entry mode runs, then Handover and Accepted), each with its gate verdict, deliverables on main, ✋ gates and decisions, the days spend was booked to it and planned against actual spend; the delivery cycle and its acceptance (`changed` when the accepted commit or deliverables moved on). Only measured facts: what nobody measured is `unknown`. `mini=1` (Home's cards) skips the deliverables scan. Shared for 15 s per floor |
| GET | `/api/acceptance`, `/api/acceptance/draft` | `?floor=<id>`: every delivery cycle (v1, v1.1…) with its acceptance record, whether the accepted one changed since, and whether the file's hash chain holds; `/draft` what ✅ Accept would record now (scope, commit, test evidence, documents, suggested exceptions, the spend) |
| POST | `/api/acceptance` | `{floor, action: accept, confirm: true, version?, scopeNote?, exceptions?: [{text, owner}], build?, deploy?}` records the current cycle's acceptance; `{floor, action: reopen, version?, scopeNote}` starts the next version, keeping the record. The Project Manager (an admin) only; through Phone access with the password again |
| GET | `/api/evidence/trace` | `?floor=<id>&since=<ms or date>&limit=<n ≤ 2000>`: the floor's audit events, chatter, analysis runs, budget rows, incidents and acceptance records as one normalized trace, oldest first. Each event names its project, execution, task, agent instance, role and session ids, says whether each was `recorded` or `inferred`, and lists the ones it can't know under `gaps`; each points back at its record with an EvidenceRef. Also how each source fared (`coverage`) and the spec events no source records (`absent`). Read-only, with no UI yet; the design is section 4.2 of `docs/knowledge-evals/gap-map.md` |
| GET | `/api/test-mode` | `{ on, why }`: whether the office runs in test mode (the TEST MODE badge) |
| GET | `/api/testlab` | The [Test Mode page](../administration/test-mode-page.md): test mode, each suite with its last run, the history (at most 50 runs) and the run going with its progress, and where the throwaway test offices go or why a run can't start (admin) |
| POST | `/api/testlab/runs` | `{ suite: unit|pages|journey|command-center }`: start a run against a throwaway test office (admin; one at a time; 409 with the reason when refused) |
| GET | `/api/testlab/runs/<id>` | A run: its summary, `result` (the runner's result.json) and `summary` (its Markdown); `/log?from=<byte>` its log from there on, `/file/<name>.png` a screenshot it took (admin) |
| POST | `/api/testlab/runs/<id>/stop` | Stop the run going and every process it started (admin) |
| POST | `/api/testlab/runs/<id>/incident` | `{ view? | step? }`: open a sev3 incident from what failed, with a link to the run (admin, once per failure) |
| POST | `/api/perf/longtask` | `{ view, ms, floor?, stack?, url? }`: a page reporting one of its tasks ran over 500 ms; opens (or counts again into) a **A page froze** incident, at most once a minute per view (signed in; see [Performance budgets](../administration/performance-budgets.md)) |
| GET | `/api/perf/stalls?since=<ms>` | The server's event-loop blocks over 100 ms since `since` (epoch ms), each `{ at, ms }`: a **test office** only (404 otherwise), for the journey's server budget (signed in; see [Performance budgets](../administration/performance-budgets.md)) |
| POST | `/api/perf/profile` | `{ seconds }` (5 to 300, default 60): records a CPU profile of this office's own server for that long and answers with where the `.cpuprofile` was saved and what took the time (top functions by self time, the longest busy stretch and the office functions that called it). Admins only, one at a time (409 while one runs) |
| GET | `/api/perf/profiles` | The CPU profiles kept (the last 10, newest first: `{ recording, profiles: [{ file, at, bytes }] }`), by hand or recorded by the office itself after a returning stall. `/api/perf/profiles/<file>` downloads one. Admins only |
| GET | `/api/notify/teams` | [Teams notifications](../integrations/teams-notifications.md): the settings (never the webhook URL, only a hint), the last error, the last card, what's waiting and held, and the floors |
| POST | `/api/notify/teams` | `{ url?, floors?, level?, quiet?, pauseMinutes?, publicUrl? }`: change them; `url: ''` removes the webhook (admin) |
| POST | `/api/notify/teams/test` | Post a test card now (admin) |
| GET | `/api/keep-awake` | Keep-awake: the setting, the idle minutes, whether the office is holding the computer awake and what's running |
| POST | `/api/keep-awake` | `{ on?, idleMinutes? }` (admin) |
| GET | `/api/project-run` | `?floor=`: [Resume and pause](../using-the-office/resume-and-pause.md): the floor's pause (`by`, `at`, `why`, who's `waiting` on you), its latest resume or pause run with each agent's status, and its pacing |
| GET | `/api/project-run/preview` | `?floor=`: ▶ Resume project's dry run: each asleep or benched agent's reasons, safety checks, default action and options in waking order; who's awake; `blocked` (the spend cap) and warnings (Studio mode). Wakes nobody |
| POST | `/api/project-run` | `{ floor \| all: true, action: resume\|pause\|cancel\|hold\|continue\|pacing, choice?: { mode: work\|all\|pick, picks? }, pacing?: { concurrent, gapSec } }` (admin) |
| GET | `/api/office/restart` | [🔁 Restart safely](../administration/running-the-office.md#releasing-and-restarting-safely): its phase, who it's waiting on, whether there's a restart loop and new commits to build, a failed build's log |
| POST | `/api/office/restart` | `{ action?: start\|wait\|anyway\|cancel, build?, timeoutMin? }` (admin; a script may send JSON with its cookie and no Origin) |
| GET | `/api/budget` | [Budget](../using-the-office/budget.md): `?floor=<id>`. Returns the project's spend, budget settings, breakdowns (stage, role, agent with nested subagents, model, day, top issues/PRs), the exchange rate and the top-bar colour |
| GET | `/api/budget/office` | Returns the office-wide view: today's and all-time spend, the daily budget, every project's line with a 14-day sparkline, the background calls by source, the Firm, and the currency settings |
| POST | `/api/budget/action` | `{ floor, action, … }` (admin). The actions are: `settings` `{ total?, threshold?, autoPause? }`; `plan` `{ lines: [{ id, usd?, days? }] }`; `regenerate`; `firm` (apply the latest audit's re-forecast); `resume`; `level` `{ choice: { level, total, threshold, autoPause, settings } }`; `officeThreshold` `{ threshold }` (no floor). Answers with the project's view |
| GET | `/api/budget/estimate` | `?tier=small|standard&entry=<mode>` for a new project, or `?floor=<id>` for an existing one. Returns the plan estimate at Balanced, the working days and the three level cards (preset budget, time, what each changes) |
| POST | `/api/budget/fx` | `{ currency, mode: 'daily'|'manual', manualRate?, refresh? }`: sets the local currency and its rate (admin) |
| GET | `/api/flows` | The [workflow](../automation/workflows.md) runs, newest first: id, workflow, status, step, why it stopped, floor, tries. `?floor=<id>`, `?workflow=<id>`. Never a run's state |
| GET | `/api/firm` | The Firm's people, its engagements (newest first) and the floors an audit can be called on |
| GET | `/api/firm/engagement` | `?id=`: one engagement with its whole transcript |
| GET | `/api/firm/status` | `?floor=`: the floor's running audit and alerts, for its 1D view |
| GET | `/api/firm/defaults` | `?floor=`: the audit wizard's starting configuration and its estimate |
| POST | `/api/firm/estimate` | `{ config }`: what a configuration would cost, as an estimate |
| GET | `/api/firm/report` | `?id=`: a delivered report; `&format=md\|json` downloads it (admin) |
| POST | `/api/firm/action` | `{ action: start \| cancel \| models, … }`: call or cancel an audit, set reviewers' models (admin, the Project Manager) |

### /api/roster/action

Actions: `hire`, `bench`, `rename`, `model`, `settings`, `standup`, `decide`, `escalation`, `skill`, `subagent`, `subagent-decide`, `tell`, `nudge`. All are **admin-only** except `standup`, `tell` and `nudge`. POSTs must come from the office's own pages (same origin).

- `standup` takes `choices`: `{ <role>: "interrupt" | "after" | "journal" }` for the Leads mid-turn (after their current turn when unsaid).
- `tell` `{ prompt, when: "now" | "after", leads? }`: a question for whoever covers Management, now or after its current turn; `leads` (`interrupt` or `after` per role) holds its relays to busy Leads for half an hour.
- `nudge` `{ role }`: Needs you's **Nudge**, the back-to-work prompt to an idle member, as yours.

## Pages (session)

| Path | Page |
|---|---|
| `/`, `/index.html` | The 3D office |
| `/home` | Home |
| `/lite` | The 1D view |
| `/pixel` | The 2D view |
| `/firm` | The Firm (`?report=<id>` opens a report) |
| `/setup` | 🚀 [First-run setup](../get-started/new-machine.md#step-3-the-first-run-setup) |
| `/docs`, `/docs/*` | These docs; `/docs/site.json` is their bundle, `/docs/images/*` their pictures |
| `/*` | Anything else in the client bundle, or 404 |

## The hook server (workers only)

A separate loopback server, whose port is in `<office data>/hook-port`, answers the workers: `/office/workers` (and `/home`, `/tell`, `/pr`, `/escalate`, `/subagent`), `/office/queue`, `/office/studio` (the Studio mode hook saying it held an mxcli write, for the audit log) and Claude Code's `/hooks/*`. Each worker has its own token.
