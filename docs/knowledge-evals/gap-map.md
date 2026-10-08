# Knowledge & Evals: Phase 0 gap map

Back to [Code layout](../code-layout.md).

This is the read-only discovery for the Knowledge Base and Evals specification (`Mx-Office-Knowledge-and-Evals-Spec.md`, draft v1, 6 October 2026). It was checked against the code at **f9c9dd6** (release 15). The spec's statements about the office were treated as hypotheses. This page records what is actually there, what each part is missing, and a proposed order of small increments.

Two other inputs were folded in:
- An external review of release 14 (`Mx-Office-Verified-Process-Review.md`), with the corrections noted in [section 6](#6-risks-and-what-could-not-be-verified).
- The agreed plan:
  1. this gap map;
  2. Evals Phase 1 with the leave-approval benchmark;
  3. the Solo/Startup/Enterprise cost experiment on that benchmark;
  4. Knowledge Phase 1, called the **Library** so it isn't confused with the toolkit's per-project `analysis/knowledge-base/`.

Paths are relative to the repository root. `file:N` is a line at f9c9dd6.

**Build status:** F1 (ids and evidence contracts) is built; see [F1 as built](#f1-as-built). F2's acceptance record is built (the DeliveryAttempt part is not); see [F2 acceptance as built](#f2-acceptance-as-built). The other increments are not started here.

Two terms are used throughout:
- **`<data>`** is the office data dir, `<officeDir>/.agent-office` (`src/server/config.ts:383`).
- **`<floor>/.agent-office`** is a floor's own data dir inside its checkout (`src/server/floor.ts:166`).

## Contents

1. [Inventory of reusable surfaces](#1-inventory-of-reusable-surfaces)
2. [Telemetry reality](#2-telemetry-reality)
3. [Identifier plan](#3-identifier-plan)
4. [Designs](#4-designs)
5. [Implementation order](#5-implementation-order)
6. [Risks and what could not be verified](#6-risks-and-what-could-not-be-verified)

---

## 1. Inventory of reusable surfaces

The table columns are: what the surface stores, the identifiers it uses, how durable it is, and what the spec still needs from it. In the identifiers column, "floor" means the floor id. A floor id is a slug of the floor's name: `[a-z0-9-]`, at most 32 characters, with `-2` and so on added on collision (`src/server/building.ts:398-400`). There is **no project id separate from the floor id**. The only other identifier is `FloorDef.repo` (owner/name), and it is optional (`src/server/building.ts:11-20`).

| Surface | Stores | Identifiers | Durability | Missing for the spec |
|---|---|---|---|---|
| **Audit log**: `src/shared/audit.ts:22` (`AuditInput`), `:36` (`AuditEvent`); `src/server/audit/index.ts:64` (`audit.record`), `src/server/audit/log.ts:82` (`append`) | Each event has: id, at, floor?, actor `{kind: human\|agent\|office\|jeff\|reviewer, name, id?}`, action, target `{kind, id?, label?}`, summary (300 chars max), details (redacted), severity, `prev` and `hash` (a sha256 chain). There are about 90 action strings. The ones that matter here are `worker.hire`, `worker.prompt`, `queue.add/start`, `escalation.raise/answer`, `proposal.decide`, `pr.open/merge/autoMerge`, `studio.denied`, `flow.*`, `firm.requested/delivered`, `budget.*` and `judge.*`. | floor, worker id or account id in actor/target, `#n` for PRs and issues, escalation id, queue task id, engagement id inside details | `<data>/audit/<floor>.jsonl` plus `_office.jsonl`. Appended with `appendFileSync` (`log.ts:104`), which is not atomic per line, but the hash chain detects damage. Keeps 50k events or 90 days (`log.ts:13-14`) and archives older ones to `audit/archive/`. | No execution, task, span or session id. No commit sha on `pr.*`. Prompt text is logged as a length by default (`audit/index.ts:142-144`). The `subagent.` and `approval.` filter groups (`shared/audit.ts:71,73`) have no emitter. Actor names are self-asserted for shared-password users (see [Tenancy](#48-minimal-tenant-and-project-membership-model)). |
| **Team chatter**: `src/shared/chatter.ts:9` (`ChatterKind`); `src/server/chatter/bus.ts:44,55`; `chatter/sources.ts:63` | Message: from/to party (name, kind, roleId, team, workerId), kind (relay, escalation, answer, journal, handoff, dispatch, review, standup, nudge, firm, message), text (redacted, 400 chars; 4000 for phone), and `ref` (escalationId, pr, journal, subagent, standup, engagement, worker) | floor, workerId, roleId/team, escalation id, PR number, subagent name, standup id, engagement id | `<data>/chatter/<floor>.jsonl`. Capped at 1000 messages, trimmed to 800 with an atomic rewrite (`chatter/store.ts:11-12,61-77`). No hash chain. Rebuilt by polling roster data and journals, so it is a **derived view**. | It is the only place handoffs and subagent dispatches are visible. Because it is derived and capped, it can't be primary evidence. It needs promoting into trace events that carry ids. |
| **Convo transcripts**: `src/server/convo/index.ts`, `convo/transcript.ts:94-181` (`TranscriptReader`) | The last 400 messages of a Claude Code session, with tool_use id, name, a one-line summary, ok/error status, and a 160-char error preview | worker id, sessionId | **Memory only** (`convo/index.ts:1-6`). The source is Claude Code's JSONL under `~/.claude/projects/*/<sessionId>.jsonl` (`analysis/transcript.ts:30-54`). Non-Claude providers return "unavailable". | It is the richest source of tool-call data, but nothing persists it. `TranscriptReader.feed` and `analysis/transcript.ts` (`SessionStats`) are pure, so they **can parse an external Claude Code session**, which is the basis for the baseline import ([4.4](#44-leave-approval-benchmark-harness)). |
| **Analysis runs**: `src/shared/analysis.ts:49-94` (`RunRecord`); `src/server/analysis/collect.ts:154-215`; `analysis/store.ts:16-17,46-51` | One row per worker session: provider, model, effort, title, issue, prompt (2000 chars), started/ended/duration/active ms, apiCalls, **toolCalls** (distinct tool_use ids), tokens `{input, output, cacheWrite, cacheRead}`, cost, humanPrompts (only before the PR was linked), needsInput count and ms, outcome (`merged\|open\|closed\|no-pr\|running`, `:21`), PR facts, and a `scorecard` (`:28-39`: CI sticky comment or the agent's self-report) | `id = <floor>:<workerId>`, issue, PR number. Role is not stored. | `<data>/analysis/runs.jsonl`, written atomically with tmp + rename and no cap. The classifier cache `classes.json` is not written atomically. | Outcome is PR state, not acceptance. **Cost is an estimate** from the office's price table, except where Claude Code's own `cost-state` line exists (`src/server/usage.ts:209-221`). needsInput is seen live only, so it is lost across restarts. Task classification is a paid Haiku call, up to 40 per hour (`analysis/llm.ts:11-14,58-71`). There is no snapshot or commit sha. |
| **Ranking**: `src/shared/ranking/standard.ts:10`, `src/server/ranking/index.ts` | Weighted scores: benchmark .25, delivery .30, autonomy .25, efficiency .20. Grades A–D. 60 days of history. | `<floor>:<workerId>` or `<floor>:role:<role>` | `<data>/ranking/history.json` and `highlights.json`, atomic | A heuristic. Not a grader (review finding 6). Must not feed Eval Lab as quality evidence. |
| **Budget ledger**: `src/shared/budget/types.ts:38-51` (`SpendRow`), `:108-120` (`BudgetSettings`); `src/server/budget/ledger.ts:18-30`; `budget/control.ts:87-101` | `SpendRow {day, agent, model, stage, issue?, pr?, cost, calls, est?, unmetered?}`; daily rollups by stage, role, model, agent and work; settings, plan, alerts | floor, agent key, issue, PR, stage | `<data>/budget/<floor>.json` and `office.json`, atomic with a 1 s debounce. Rows kept 30 days, rollups for ever. | **Three spending layers**: (1) the office daily budget, `Ledger` in `src/server/usage.ts:298` (`overBudget :329`, `hiringPaused :334`, which only toasts); (2) the team daily cap, `src/server/roster/index.ts:270-301` (`noteSpend`/`pauseOf`), enforced in `roster/deliver.ts:75-76`; (3) the project budget with optional `autoPause` (`control.ts:95`). Costs are estimated, and non-Claude providers are `unmetered` with cost 0 (`budget/service.ts:120,127`). The only split from delivery spend is the background `BillingSource` (`budget/meter.ts:14`), so evaluation spend has no separate account. Spend deltas are not audited; only alerts and settings changes are. |
| **Incidents**: `src/shared/incidents.ts:66`; `src/server/incidents/store.ts:79`, `rules.ts:53`, `signals.ts:7-15` | INC-n, severity, status, timeline, root cause, corrective actions (which link commit, pr or issue), auditIds, workers | incident number, floors, worker ids, audit ids | `<data>/incidents/incidents.jsonl`, an append-only snapshot per change, hash-chained. No cap. | A good `EvidenceRef` target. The signal `gate-check.failed` exists (`signals.ts:12`). No execution link. |
| **The Firm**: `src/shared/firm/engagement.ts:131-139` (`TRANSITIONS`), `:199` (`Engagement`); `src/shared/firm/report.ts:23-41` (`Evidence`, `Finding`); `src/server/firm/isolation.ts:20-29` (`pinCommit`) | An engagement pinned to a commit (`engagement.ts:205`). Findings carry severity, team, evidence `{text, file?, line?, pr?, issue?, url?}` (1–20 items, `report.ts:204-218`), recommendation and effort. Also root causes, `WorkerGrade` (an LLM grade beside the ranking grade), risks and per-reviewer sections. | floor, engagement id `YYYYMMDD-<hex6>` (`firm/index.ts:146`), report id `r-<engagementId>`, reviewer id | `<data>/firm/engagements/<id>/engagement.json` and `reports/<id>.json` are atomic. `<id>.md` and `sections.json` are not (`firm/store.ts:394-397`, `firm/index.ts:131-133`). | Finding ids are free text (24 chars max) with no continuity across engagements, no status or resolution, and no calibration. Reviewer isolation in a detached clone at a pinned commit (`isolation.ts:76-144`) is **the pattern to reuse for the benchmark's protected verifier workspace**. |
| **Workflow engine**: `src/server/flow/types.ts:155-184` (`RunRecord`), `:203-211` (events); `flow/engine.ts:226,238,249`; `flow/store.ts:34-52` | A run's state, step, attempts, loops, `usage{cost, ms}`, waiting/interrupt payload, and history `{seq, step, status, attempt, startedAt, endedAt, next?, error?}` | runId `<workflow>-<base36>-<rand>` (`engine.ts:163`), floor, by | `<data>/flows/<workflow>/<run>.json`, atomic (`writeJsonAtomic`, `store.ts:34`). A run that was running loads as `interrupted`. | It already has durable attempts, interrupts as human gates, and budgets, so it is the obvious **eval-run job machine**. History has no per-step output. `ctx.report` was not found being called by project-run or the wizard, so `usage.cost` is probably 0 there. |
| **Wizard jobs**: `src/server/wizard/job.ts:13-37,52-53`; `wizard/steps.ts:226-269`; `wizard/gate-source.ts` | The `new-project` workflow. Writes `intake.md`, `PROJECT.md` (a `## Decisions` table with `CONFIRMED <date>`, `steps.ts:403-423`) and `agent-office.project.json` | job id `owner__name` | Flow checkpoint, plus files in the repo (not atomic) | The decisions table is the only decision record that maps to a real approval event, the wizard's "Chosen by X". It has no ids. |
| **Project-run**: `src/server/project-run/flows.ts:30-31`; `project-run/store.ts:80-117`; `src/shared/project-run.ts:84-102` | Pause/resume workflows; `PauseInfo {by, at, why: person\|restart\|budget, waiting[]}`; pacing | floor, runId | `<data>/project-run.json`, atomic | It restores operational state, not acceptance. Not otherwise relevant except as a trace source (`pause.*`/`resume.*` in audit). |
| **Deliverables catalog**: `src/shared/deliverables.ts:26,46,54,100,105,148`; `src/server/deliverables/scan.ts:1-4` | Spec patterns per stage and team. `knowledge-base` is `**/knowledge-base/*.md` (`:54`). `NEVER` excludes `docs/team/**` and `.ai-context/**` (`:105`). `safeRelPath` (`:148`). | floor, deliverable id, path, branch/head sha (cached per sha, `deliverables/git.ts:131-135`) | Read-only scan of the checkout, member worktrees and up to 40 office branches | It shows a file is present, not that it is correct. It is a ready source list for Library import adapters, and its path guard is reusable. |
| **Roster subagent records and Lead verdicts**: `src/shared/roster/subagents.ts:11-48`; `src/server/roster/subagents.ts:179-195`; `roster/review-rounds.ts:14-26` | `SubagentRun {id (Claude agent_id), at, endedAt, durationMs, model, task (160 chars), outcome: pending\|accept\|rework\|failed, reviewedAt, note (300 chars), ci?}`; reworks, exhaustion → escalation | `<lead>/<name>` key, Claude agent_id, floor, RoleId | `<data>/roster/<floor>.json`, atomic with a 500 ms debounce (`roster/store.ts:196-214`). Keeps 50 runs per subagent. | The verdict is binary with no criteria. It is the **only "review completed" record for in-team review**. Not mirrored to audit. |
| **Escalations**: `src/shared/roster/escalation.ts:19-53`; `src/server/roster/escalations.ts:96,137,159-205,267-294` | Urgency, level, options, recommendation, resolution `{verdict: reply\|approve\|reject\|dismiss, text, by, at, delivered}` | escalation id, workerId, role, team | Roster file, capped at 200 (`roster/store.ts:81-83`). Raise and answer are audited. | It is the best "human intervention" record, but older ones fall off the cap. Needs categorising (correction, clarification, approval, unblock, override). |
| **Journals, standups, lessons, playbooks** (in the project repo) | `docs/team/<team>.md` (`src/shared/roster/roles.ts:137`), `docs/standups/<date>.md` (`:141`), lessons in `.ai-context/skills/mxcli-field-lessons/SKILL.md` or `project-lessons/SKILL.md` (`src/server/roster/playbooks.ts:25-29`), playbooks in `.ai-context/skills/team-<role>/SKILL.md` | file path, role | git, but the files are free-form markdown | Lessons are dated bullets with no schema, source, applicability or dedupe. The handoff note is the latest journal `handoff` entry, copied to `MemberRecord.handoff` (`roster/members.ts:142-145`). These are Library **source** adapters, never accepted knowledge on import. |
| **mxcli / gate-check / CI / e2e as graders** | The office runs mxcli only for `mxcli run --local` (live app, `src/server/liveapp/app.ts:163-168`) and `mxcli new` (wizard, `wizard/mendix-app.ts:107`). `check`, `lint` and `report` appear only in agent prompts (`playbooks.ts:69,77,97`). Gate-check runs `bash <toolkit>/bin/gate-check.sh <dir>` (`wizard/index.ts:55-58`) in a temporary worktree (`gate-source.ts:156-194`). Its HTML verdicts are scraped by `stageVerdicts` (`src/server/summary/project.ts:108-114`). CI checks are `statusCheckRollup` collapsed to pass, fail, pending or skip (`src/server/github.ts:35-60`). Playwright runs **only in the project's CI** (`docs/site/integrations/ci-pipeline.md`). The scorecard is parsed from the `<!-- mx-pr-checks-scorecard -->` comment (`analysis/scorecard.ts:8-56`). | PR number, head sha (`headRefOid`, `github.ts:477`), floor | Gate results and checks are **not persisted** (they are read on each look). The scorecard survives only inside RunRecord. | No grader adapter invokes a check against a frozen snapshot. The exact mxcli command lines for check and lint must be discovered and pinned from the installed toolkit, not invented. Gate output is parsed from HTML rather than structured data, which is fragile. |
| **Live app**: `src/server/liveapp/*` | A per-floor Mendix runtime from a detached clone at `<data>/live/<floor>/` with PostgreSQL (`liveapp/process.ts:13-20`) | floor, branch | Process state only | **It is a usable runtime target** for the benchmark's runtime fixtures: a fresh database name per trial and its own ports. It runs no tests. |
| **Bookshelf**: `src/server/docs.ts:14-55,162-170`; `src/shared/docs.ts:29-60` | Lists and reads `*.md` in a checkout. Caps: 5000 docs, 2 MB each. Path guard via `isDocPath` and `insideCheckout` (realpath, which catches symlink escape; `src/server/changes.ts:144-154`). | floor, relative path | none (live read, list cached 3 s) | A document browser. Reuse its path guard for Library ingestion (spec 5.5). |
| **Search**: `src/server/http/routes/search.ts:11-21`; `src/shared/search.ts:5-6` | Chat lines and worker terminal buffers only | floor | none | No document or knowledge search exists. The Library needs its own index. |
| **Queue**: `src/server/queue.ts`; `src/shared/protocol/queue.ts:8-36` | `QueueTask {id (hex12, queue.ts:103), issue?, title, prompt, addedBy, owner, status, workerId, branch, startedAt, finishedAt, outcome: done\|exited\|killed\|failed, error, pr}` | task id, issue, workerId (one-way: workers don't store the task) | `<floor>/.agent-office/queue.json`, plain `writeFileSync` (`queue.ts:375`), **not atomic**. Capped at 100 tasks. | It has one attempt per task with no attempt history, and outcome means *session* completion. See [4.5](#45-queue--worker-reconciliation-after-restart). |
| **Workers**: `src/server/workers/persist.ts:20-51`; `workers/manager.ts:256` | id (hex12), provider, model, effort, worktree `{path, branch, base}`, sessionId, task (a Haiku name/summary, `src/shared/protocol/workers.ts:24-27`), pr, pastPrs, workedMs, usage tracker, pty id, midTurn | worker id, sessionId, branch `office/<slug>` | `<floor>/.agent-office/workers.json`, plain write (`persist.ts:53`) | A worker is a long-lived *agent instance*. One worker spans many sessions and tasks. |

**Single tenant, coarse roles.** Accounts are `admin | member` only (`src/shared/protocol/accounts.ts:5`). A shared-password session counts as admin (`src/server/office/people.ts:14`). There is **no per-project membership**: every signed-in user sees every floor. HTTP routes say `auth: 'public' | 'session'` (`src/server/http/router.ts:25-34`), and admin is checked per handler.

**No eval or knowledge registry exists.** There is no `/api/evals` or `/api/knowledge` in `src/server/http/routes/index.ts` or `docs/site/reference/api-endpoints.md`. "Experiment" appears only in prose (`src/server/wizard/brief.ts:3`, `src/shared/budget/shapes.ts:16`). There is no `scripts/` dir in the repo.

## 2. Telemetry reality

**Real** means a durable, structured record of that event exists today. **Inferred** means it can be reconstructed from other records with known blind spots. **Absent** means there is nothing to rebuild it from. An absent event is a gap in the evidence and must show as unknown, never as zero.

| Spec event | Status | Where it is, and the gap |
|---|---|---|
| execution started / completed / aborted | **Inferred** | Partial sources: `queue.start` (audit, `src/server/floor.ts:268`), QueueTask `startedAt/finishedAt/outcome`, RunRecord `startedAt/endedAt` (first and last transcript timestamps), and `flow.start/finish`. There is no record that bounds one delivery attempt. After a restart a queue attempt is recorded as `exited` even when its PTY was adopted and kept working (see [4.5](#45-queue--worker-reconciliation-after-restart)), so "aborted" is unreliable. |
| task assigned | **Real (coarse)** | `queue.start` and `worker.hire` with a task (audit), and subagent dispatch (chatter `dispatch`, `chatter/bus.ts:55`, persisted but capped). No taskId spans the queue, roster proposals and issues. |
| tool started / completed / failed | **Absent (durable)** | Claude `PreToolUse/PostToolUse/PostToolUseFailure` hooks are received (`src/server/providers/claude.ts:44-55`) and used live only (`workers/tasks.ts:63`, in memory). The transcript has them, but nothing persists them. RunRecord keeps only a **count**. For non-Claude providers there are hooks for some (`codex.ts:71`, `grok.ts:72`) but no transcript reader. |
| mutation lock acquired / released | **Absent** | No lock exists. Only `studio.denied` is recorded, when the Claude Bash guard holds an mxcli write while Studio Pro is open (`src/server/studio/guard.ts:49-57`). One-writer compliance can't be graded, so the spec's "one-writer discipline" criterion is **unknown** for every current run. |
| handoff requested / completed | **Inferred** | Chatter `handoff` items (derived from roster and journals, capped at 1000), and `MemberRecord.handoff {at, text}` (latest only). No audit action. No request/complete pairing. |
| escalation raised / resolved | **Real** | `escalation.raise/answer` in audit (`roster/escalations.ts:137,205`); the record and `resolution.delivered` in the roster file (capped at 200). |
| human intervention | **Real but uncategorised** | `worker.prompt` (prompt text off by default), `escalation.answer`, `proposal.decide`, `phone.*`, `budget.resume`, `pr.merge`. RunRecord `humanPrompts` counts only prompts before the PR was linked (`analysis/collect.ts:197`). There are no categories and no human minutes. |
| artifact submitted | **Real (PR level)** | `pr.open` (audit `github.ts:41`, `workers.ts:166`). No commit sha or artifact hash. Commits and pushes are not recorded. A PR is not a submission in the spec's sense (frozen snapshot). |
| check completed | **Absent (durable)** | CI checks are polled into memory (`github.ts:35-60`), gate verdicts are scraped from HTML on each look, and the scorecard is parsed into RunRecord. No record of *which check, which commit, which result, when*. Only failures leave traces (`flow.fail`, the `gate-check.failed` incident signal). |
| review completed | **Real (two kinds)** | Lead accept/rework on `SubagentRun` (roster file, not audited) and `firm.delivered` (audit plus report). PR reviews on GitHub are not recorded. |
| knowledge retrieved | **Absent** | Agents read playbooks, lessons and the KB through their own file tools. That shows up only as transcript tool calls. |
| budget updated | **Real (thresholds only)** | `budget.alert/settings/level/plan/resume` audited (`budget/index.ts:73`, `budget/control.ts:128-224`); `SpendRow`s in the ledger. Spend deltas are not events. Costs are estimates, labelled `est`/`unmetered` only partly. |

**Cross-cutting gaps:**
- No event carries span or parent ids.
- Ordering across files relies on timestamps alone.
- Non-Claude providers have no cost (`unmetered`) and no transcript.

**External single-agent sessions** can export comparable evidence through two things: the Claude Code session JSONL, which `analysis/transcript.ts` already parses for tokens, tool calls, cost, prompt times and the PR link, and the git result. Interventions and wall time outside the transcript can only be self-reported, so they must be labelled that way.

## 3. Identifier plan

Introduce the domain identifiers as **aliases recorded beside the floor and worker ids**. Nothing gets renamed. Every new record carries both, and old records are read through an adapter.

| Domain id | Introduced as | Mapping over today's ids | Where |
|---|---|---|---|
| `tenantId` | The constant `'local'` | One office is one tenant | `src/shared/evidence/ids.ts` |
| `projectId` | `prj_<ulid>`, generated once per floor and stored as an optional `FloorDef.projectId` | Floor ids can change: a removed floor's slug can be reused, and a name change makes a new slug. So the projectId is minted when it is first needed, persisted in `floors.json` (`building.ts`), and looked up through `projectIdOf(floorId)`. Old records without it resolve through the floor id at read time, and the adapter marks that as inferred. | `src/server/projects/ids.ts` (new), plus a field in `FloorDef` (`building.ts:11`) |
| `agentInstanceId` | Equal to the **worker id** (hex12, `workers/manager.ts:256`) | A worker is already a durable instance across sessions. A subagent instance is `sub_<claude agent_id>` (`SubagentRun.id`). Firm reviewers are `firm_<engagementId>_<reviewerId>`. | alias function, no storage |
| `roleId` | The existing `RoleId` (`src/shared/roster/roles.ts`) | Under coverage (team shapes), the role a worker *covers* comes from `Coverage` (`src/shared/roster/coverage.ts:38`). Record it at event time because coverage changes. | — |
| `sessionId` | The existing provider `sessionId` | — | — |
| `taskId` | `tsk_<ulid>` | Queue tasks get one on `queue.add`, keeping `QueueTask.id` as `legacyId`. Issue-based work maps to `issue:<repo>#<n>` as a stable *external* key. Proposals and Lead assignments get a taskId when they become work. Benchmark trials have their own taskId. | `src/server/delivery/tasks.ts` (new) |
| `executionId` | `exe_<ulid>`, one per **delivery attempt** | Minted when a queue task is seated, a Lead is handed work, or a benchmark trial starts. Bound to `{agentInstanceId, sessionId at start, branch, base sha}`. A worker that keeps going after a restart keeps its executionId (see 4.5). | The DeliveryAttempt record (4.1) |
| `spanId` / `parentSpanId` | Optional on new trace events | A subagent run is a child span of its Lead's execution. A tool call is a child of a session. | trace envelope (4.2) |

Rollout rules:
1. **Write first, read later.** Add the ids to *new* records (audit `details.ids`, the new DeliveryAttempt and eval records) before any reader relies on them.
2. Add `ids?: {projectId?, executionId?, taskId?, agentInstanceId?, spanId?}` as an **optional** field on `AuditInput` (`src/shared/audit.ts:22`). The hash covers the whole line, so old lines still verify, and no reader breaks.
3. The 3D/2D/Lite views keep addressing floors and desks. Only the Evals and Library routes accept a `projectId` and translate it with `floorIdOf(projectId)`.
4. Every adapter that reads an old record reports `idSource: 'recorded' | 'inferred'`, so a scorecard can show that a link was inferred.

## 4. Designs

Module rules (`AGENTS.md`, `docs/code-layout.md`):
- Each design is its own folder.
- HTTP goes in `src/server/http/routes/<name>.ts` with an explicit `auth`.
- Any WebSocket messages go in a protocol domain file plus a handler map.
- Client code goes in its own feature or Lite tab.
- No edits to the middle of `server.ts`, `main.ts`, the store or `protocol.ts`.
- Every file stays under 600 lines (`tests/size.test.ts`).
- Storage reuses `writeJsonAtomic` (`src/server/flow/store.ts:34`) and the JSONL-with-hash-chain pattern from `audit/log.ts` and `incidents/store.ts`.
- No database is introduced. The office is file-backed, and the spec (§12) allows a repository abstraction with atomic writes.

### 4.1 DeliveryAttempt / acceptance record

Purpose: keep apart four things that the office currently treats as one, *execution done ≠ submitted ≠ verified ≠ accepted* (review finding 1).

```ts
// src/shared/delivery/types.ts
type AttemptState = 'running' | 'execution-ended' | 'submitted' | 'verified' | 'accepted' | 'changes-requested' | 'abandoned';
interface DeliveryAttempt {
  schemaVersion: 1; id: string /* executionId */; tenantId: 'local'; projectId: string; floorId: string;
  taskId: string; requirement?: { ref: EvidenceRef; version: string /* content hash or PROJECT.md decision row */ };
  agentInstanceId: string; roleId?: RoleId; provider: AgentProvider; model?: string; sessionIds: string[];
  branch?: string; baseSha?: string;
  execution: { startedAt: number; endedAt?: number; end?: 'turn-done' | 'exited' | 'killed' | 'restart-adopted' | 'restart-lost' };
  submissions: ArtifactSubmission[];          // append-only
  acceptance?: { decision: 'accepted' | 'changes-requested' | 'waived'; by: AuditActor; at: number; submissionId: string; rationale: string; waiverRefs?: string[] };
  state: AttemptState; legacy?: { queueTaskId?: string; issue?: number };
}
interface ArtifactSubmission {
  id: string; at: number; by: AuditActor; kind: 'pr' | 'commit' | 'bundle' | 'import';
  pr?: { number: number; headSha: string }; commitSha: string; snapshotId?: string;   // set when frozen for eval
  checks: { name: string; sha: string; state: 'pass' | 'fail' | 'pending' | 'skip' | 'unknown'; url?: string; observedAt: number }[];
  evalRunIds: string[];
}
```

- **Where it lives:**
  - `src/server/delivery/` with `store.ts` (an append-only JSONL per floor at `<data>/delivery/<floor>.jsonl`, each line a full snapshot plus `op`, hash-chained like `incidents/store.ts:79-91`), `attempts.ts` (state transitions with a `TRANSITIONS` table like the Firm's) and `observe.ts` (the adapters).
  - A read route at `http/routes/delivery.ts` (session auth).
- **How it fills in, advisory only:**
  - `queue.start` and Lead hire-with-task create an attempt.
  - QueueTask `finish` or worker status sets `execution.end`.
  - `pr.open` or a GitHub poll seeing a PR on the attempt's branch adds a submission with `headRefOid` (`github.ts:477`).
  - Every new head sha is a **new submission**.
  - Check observations attach only to the submission whose `commitSha` equals the check's sha.
  - `pr.merge` does **not** set `accepted`. Acceptance is an explicit PM action, or a declared policy that a merge counts as acceptance, recorded as such.
- **Legacy compatibility:** the existing queue, analysis and ranking are untouched. The attempt is a parallel record that links to them.
- **Tests:**
  - transition table (illegal moves throw);
  - check binding (a check on an older sha never verifies a newer head);
  - restart (an attempt survives and re-links);
  - chain verification;
  - size guard.

### 4.2 EvidenceRef and trace envelope

```ts
// src/shared/evidence/types.ts
interface EvidenceRef {
  id: string; tenantId: 'local'; projectId?: string;
  kind: 'artifact' | 'test_report' | 'trace_event' | 'requirement_revision' | 'review_finding' | 'incident' | 'benchmark_result' | 'human_assessment' | 'transcript';
  sourceSystem: 'audit' | 'chatter' | 'delivery' | 'firm' | 'incidents' | 'analysis' | 'budget' | 'git' | 'github' | 'import' | 'eval';
  sourceId: string;            // e.g. audit event id, `r-<eng>#<findingId>`, `INC-12`, `<floor>:<workerId>`, git sha:path
  sourceVersion?: string;      // audit hash, report id, commit sha, ledger day
  contentHash?: string; capturedAt: number;
  locator: string;             // logical, never a client-supplied path: `git:<sha>:<relpath>`, `audit:<floor>:<eventId>`
  excerpt?: { start?: number; end?: number };
  availability: 'available' | 'expired' | 'redacted' | 'missing'; retentionClass: 'audit-90d' | 'ledger-30d' | 'permanent' | 'transcript-external';
}
interface TraceEvent { eventId: string; schemaVersion: 1; occurredAt: number; ingestedAt: number; tenantId: 'local'; projectId: string;
  executionId?: string; taskId?: string; agentInstanceId?: string; roleId?: string; spanId?: string; parentSpanId?: string;
  eventType: SpecEventType; payload: unknown; source: EvidenceRef; idSource: 'recorded' | 'inferred'; redaction: 'none' | 'redacted' }
```

- **Where it lives:** `src/shared/evidence/` (types, pure validation, locator parsing) and `src/server/evidence/`:
  - `resolve.ts` implements `evidence.resolve(ref, principal)`, which checks authorisation (4.8) and then dispatches to one resolver per `sourceSystem`;
  - `trace.ts` builds a **normalised trace view built on demand** from audit, chatter, delivery, roster and the ledger. Nothing is stored except a rebuildable cache.
- **Retention:** retention differs by source (audit 90 days, ledger rows 30 days, chatter 1000 messages, escalations 200). So snapshots copy what they cite into the snapshot (4.3), and a ref whose source has aged out resolves as `expired`, never as empty.
- **Filling durable gaps without a new telemetry store:**
  - Persist tool start/complete only for **benchmark and eval executions**, by copying the session transcript into the snapshot at freeze time.
  - Do not add a firehose for everyday work.
- **Tests:**
  - every resolver, including expired, missing and redacted sources;
  - locator parsing rejects `..` and absolute paths (reuse `safeRelPath`, `src/shared/deliverables.ts:148`);
  - the trace builder marks inferred ids.

### 4.3 Eval definition / snapshot / run / result / gate

```ts
// src/shared/evals/types.ts (pure, no Node imports)
type Outcome = 'pass' | 'fail' | 'unknown' | 'error' | 'not_applicable';
interface Criterion { id: string; dimension: 'functional' | 'security' | 'regression' | 'model-consistency' | 'process' | 'resource'; requirementIds: string[];
  description: string; assertion: { grader: string; params: Record<string, unknown> }; required: boolean; notApplicableWhen?: string }
interface EvalDefinitionRevision { id: string; definitionId: string; version: number; name: string; target: 'delivery-attempt' | 'benchmark-trial';
  criteria: Criterion[]; graders: string[] /* GraderRevision ids */; gatePolicy: { mode: 'advisory' | 'blocking'; required: string[] }; contentHash: string }
interface GraderRevision { id: string; kind: 'deterministic' | 'human' | 'llm'; adapter: string; version: string; command?: string[] /* pinned, discovered */;
  timeoutMs: number; inputs: EvidenceRef['kind'][] }
interface ExecutionSnapshot { id: string; executionId: string; projectId: string; taskId: string; baseSha?: string; finalSha: string;
  bundleHash?: string; config: ConfigManifest; evidence: EvidenceRef[]; startedAt: number; finishedAt?: number; endReason: string;
  origin: 'office' | 'import'; completeness: Record<'cost' | 'tokens' | 'tools' | 'interventions' | 'wallTime', 'observed' | 'estimated' | 'self-reported' | 'unknown'> }
interface EvalRun { id: string; snapshotId: string; definitionRevisionId: string; graderRevisionIds: string[]; purpose: 'advisory' | 'benchmark' | 'regrade' | 'calibration';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; idempotencyKey: string; createdBy: AuditActor; queuedAt: number; startedAt?: number; finishedAt?: number; flowRunId?: string }
interface EvalResult { runId: string; criterionId: string; graderRevisionId: string; outcome: Outcome; value?: number | string; evidence: EvidenceRef[]; rationale: string; limitation?: string; observedAt: number }
interface GateDecision { runId: string; policyRevision: string; verdict: 'pass' | 'fail' | 'inconclusive'; blockers: string[]; unresolved: string[]; at: number }
```

- **Gate rule (a pure function, unit-tested):** any required `fail` gives `fail`; otherwise any required `unknown` or `error` gives `inconclusive`; otherwise `pass`. A waiver lives on `DeliveryAttempt.acceptance` and never changes a result.
- **Runner:**
  - Each `EvalRun` is a workflow `eval-run` on the office engine (`flowsOf(ctx)`, `src/server/flow/index.ts`).
  - Its steps are: `freeze`, which checks out the snapshot's `finalSha` into an isolated verifier clone (the pattern of `firm/isolation.ts:20-144`); one step per grader, each with `done(state)` so a resume never re-runs a finished grader; and `gate`.
  - Retries come from the engine (`flow/retry.ts`), and the grader `timeoutMs` maps to the step's limits.
  - Idempotency key: `sha256(snapshotId + definitionRevisionId + graderSet + purpose)`. A regrade adds a request id.
- **Storage:**
  - `<data>/evals/definitions/<definitionId>/<version>.json` (immutable: written once, refused if present);
  - `<data>/evals/snapshots/<id>/` (manifest plus copied evidence: transcript, check JSON, git bundle hash);
  - `<data>/evals/runs/<floor>.jsonl` (append-only, hash-chained; a result is never rewritten).
- **Deterministic graders first.** Each is a file in `src/server/evals/graders/` with a shared `Grader` interface and an entry in a `GRADERS` registry, like `PROVIDERS`:
  1. `ci-checks`: the check rollup for `finalSha` via `gh` (as in `github.ts:189`), recorded per check.
  2. `mx-scorecard`: wraps `analysis/scorecard.ts` parsing, labelled `source: ci | self-reported`. Self-reported can never pass a required criterion; it gives `unknown`.
  3. `gate-check`: runs `gate-check.sh` against the frozen clone (reusing `gate-source.ts`'s worktree runner) and parses `stageVerdicts`. Fragile, so a parse failure is `error`.
  4. `mxcli-check`: the command is **discovered from the installed toolkit and pinned in the GraderRevision**, and not written until then.
  5. `runtime-fixture`: the benchmark's hidden verifiers (4.4).
  6. `budget-ceiling`: from ledger rows for the execution window, with `est`/`unmetered` mapped to `estimated`/`unknown`.
  7. `one-writer`: from mutation-lease events (4.6). It gives `unknown` until the lease exists.
- **Advisory by default.** `gatePolicy.mode = 'advisory'` everywhere. Blocking is a per-project setting, versioned and audited (`evals.policy`), and is a [user decision](#decisions-needed-from-the-user).
- **Routes:** `http/routes/evals.ts` with `GET /api/evals/runs?project=`, `GET /api/evals/runs/:id`, `POST /api/evals/runs` (admin; idempotency key), `POST /api/evals/imports`, and `POST /api/evals/comparisons`. Session auth plus project membership (4.8).
- **Cost:** eval spend is booked to a **new `BillingSource` `'eval'`** (`budget/meter.ts:14`) under the project ledger with role "Evaluation". It has a separate cap in `BudgetSettings` (`evalCap?`), so evaluation never silently uses delivery budget. Phase 1 graders are deterministic and cost nothing in tokens.
- **Tests:**
  - gate truth table;
  - immutability (rewriting a definition is refused);
  - idempotent enqueue;
  - crash mid-run resumes without re-running finished graders (flow test style, `tests/flow.test.ts`);
  - a self-reported scorecard never passes;
  - missing cost is `unknown`, not 0;
  - no live model calls.

### 4.4 Leave-approval benchmark harness

- **Case storage, outside every floor checkout so delivery agents can't read it:**
  - `<officeDir>/benchmarks/<caseId>/<rev>/case.json` holds the public prompt (the spec's §9 requirement text verbatim), the 8 criteria, limits (time and USD) and the environment requirements (Mendix version, mxcli version).
  - `starting/` holds a git bundle of the synthetic baseline app: login plus an unrelated baseline module, test identities, seeded data.
  - `verifiers/` holds the hidden fixtures, one per criterion.
  - Each revision has a content hash. A revision is frozen once used in a trial.
- **Fixtures per criterion (spec §9):**
  - C1–C7 are runtime checks against the live app's runtime: authorisation and persisted state, not screenshots.
  - C8 is the baseline regression suite plus the model-consistency grader.
  - Driving the runtime needs a supported access path. The options are a test-only published REST/OData API in the baseline, Playwright against the UI, or direct database assertions for persistence. *Which path Mendix and mxcli support here was not verified*, so it is the first task of increment E3.
  - Negative tests (C3–C5) must use the runtime's own access rules, not UI visibility.
- **Reset per trial:**
  - The trial's checkout is a fresh clone of the bundle as a **new floor**, ideally in a [test office](../site/administration/test-offices.md) (`src/server/testmode.ts`), or in a dedicated benchmark office for real runs.
  - The live app uses a fresh database name, since `databaseName(floorId)` in `liveapp/app.ts:164` keys it by floor.
  - New worktrees, no carried sessions, and a pinned config manifest: shape, models, effort, autonomy, budget level and caps, toolkit version and commit, mxcli version, Library corpus hash (empty for experiment 3).
  - Only one Mendix writer runs per trial.
- **Protected verifier workspace:**
  - After the trial's final submission, the harness freezes a snapshot.
  - It clones `finalSha` into `<data>/evals/verify/<runId>/` (a detached clone with remotes removed, as `firm/isolation.ts` does) and copies the verifiers in **only there**.
  - It starts a runtime from that clone and runs the verifiers.
  - Delivery agents never see the verifier directory. The harness checks that the verifier tree's hash is unchanged before and after, and that the delivered repo contains no copy of the verifier files. A failed check is a harness fault.
- **Same final evaluator for every arm:**
  - The A/B/C arms (Solo, Startup, Enterprise, plus the Firm repair loop for C) all go through the same `EvalDefinitionRevision` and grader revisions.
  - In arm C the Firm is part of delivery, and its cost is booked to delivery spend (`firm/adapter.ts:178` already pushes its USD figure).
- **Harness faults vs failures:** an environment failure (Postgres, ports, mxcli build) is `error` with `harnessFault: true`. A predeclared retry policy reruns the *grading*, never the delivery.
- **External single-agent baseline import** (`POST /api/evals/imports`, admin):
  - The bundle contains `{schemaVersion, caseRevisionId, declaredConfig, startedAt, finishedAt, git: {baseSha, finalSha, bundle}, transcripts: [Claude Code session JSONL], interventions?: [{at, category, minutes?}]}`.
  - The server validates the schema and checks the bundle's `baseSha` against the case's starting bundle. It parses transcripts with the existing pure parsers (`analysis/transcript.ts` `SessionStats`, `convo/transcript.ts` `TranscriptReader.feed`) for tokens, tool calls, active time and an estimated cost.
  - It marks `origin: 'import'`, `completeness.interventions = 'self-reported'`, and cost `estimated` unless a `cost-state` line is present.
  - Imported content is untrusted data: it is size-capped and never executed.
- **Where it lives:** `src/server/evals/bench/` (`case-store.ts`, `trial.ts`, `verify.ts`, `import.ts`), plus `src/shared/evals/bench.ts`.
- **Tests:**
  - case revision immutability;
  - the verifier workspace is outside the trial floor (path assertion);
  - a tampered verifier hash gives a harness fault;
  - import validation (bad schema, wrong base sha, missing cost gives unknown);
  - a dry trial with a fake agent in test mode (no paid calls).

### 4.5 Queue ↔ worker reconciliation after restart

- **What happens today:**
  - `TaskQueue` is constructed in the floor's constructor (`src/server/floor.ts:249`). Its `restore()` immediately turns every `running` task into `done/exited` with "The office restarted while it was running" (`src/server/queue.ts:411-416`).
  - Only later does `this.workers.start()` (`floor.ts:334`) adopt PTYs that survived in the PTY host (`src/server/workers/manager.ts:153-161`). The host keeps orphaned terminals for **30 minutes** (`src/server/ptyhost.ts:18`).
  - So an adopted worker keeps working while its task reads `exited`, and the toast invites a requeue, which risks duplicate work.
- **Design:**
  1. In `restore()`, a running task becomes `status: 'running'` with a new `recovering: true` flag. It is no longer finished there.
  2. Add `QueueTask.attempts?: {id /*executionId*/, workerId, startedAt, endedAt?, end?}[]`. This is an optional field, so older files still load. `workerId` stays as the current attempt.
  3. After `this.ready` resolves (`floor.ts:334`), call `queue.reconcileAfterRestart()`. For each `recovering` task:
     - worker adopted (status not `offline`/`exited`): clear `recovering` and keep the attempt, with end `restart-adopted`, only as a note;
     - worker present but asleep, with `midTurn` resumed by `wakeAll`: same as adopted;
     - worker absent or lost: finish as `exited` with error "restart-lost".
  4. `reconcile()` (`queue.ts:243`) skips `recovering` tasks, so a worker restored as `offline` (`workers/persist.ts:84`) isn't misread as finished before adoption completes.
  5. Make `save()` atomic with `writeJsonAtomic` (today it is a plain `writeFileSync`, `queue.ts:375`).
  6. Mirror the outcome to the DeliveryAttempt (4.1) and audit `queue.recovered`.
- **Tests (extend `tests/queue.test.ts`):** adopted worker, so the task stays running; worker gone, so exited; restored `offline` before adoption, so not finished; old `queue.json` without `attempts` loads; no duplicate seat for a recovering task.

### 4.6 `.mpr` mutation lease

- **What exists today:**
  - Studio guard: `bin/studio-guard.js` plus `src/server/studio/guard.ts:24-28`. It is wired **only for Claude** (`src/server/providers/claude.ts:94-95`), matches **Bash only**, and runs **only while Studio Pro has the project open** (the marker file). It is **not role-aware**.
  - The one-writer rule otherwise lives in prompts (`src/server/roster/playbooks.ts:69`, `src/shared/roster/roles.ts:76`).
  - The writer is the coverer of Development (`writerOf`, `src/shared/roster/coverage.ts:121-122`).
- **Design:**
  - `src/server/mutation/` with `lease.ts`, holding `ModelLease {key: normPath(mprPath) (reuse src/server/studio/detect.ts:68), holder: {agentInstanceId, roleId, provider, executionId?}, acquiredAt, expiresAt, renewedAt, ops: number}`.
  - Persisted per floor at `<floor>/.agent-office/model-lease.json` (atomic). Expiry is 10 minutes, renewed on each permitted write.
  - Policy: only the current `writerOf(coverage)` instance, or an explicit PM override (audited), may acquire. A Studio-open marker makes every agent write a deny, as today.
- **Hook route:** `POST /office/lease` on the hook server (beside `/office/studio`, `src/server/hooks/server.ts:29`) with the same worker bearer-token auth as `officeStudio`. It answers `allow | deny(reason)` and records audit `model.lease.acquire/renew/release/deny` with ids.
- **Enforcement points, widest first:**
  1. **An mxcli shim on the workers' PATH** that asks `/office/lease` before write subcommands (reusing studio-guard's pure classifier `simpleCommands` and the write detection). This covers every provider that shells out to mxcli, not just Claude.
  2. Generalise the Claude PreToolUse guard into a "model guard" that is always installed and consults the lease, not just the Studio marker.
  3. Equivalent hooks for providers that have PreToolUse-like events (Codex, Grok, Cursor, `codex.ts:71`, `grok.ts:72`, `cursor.ts:16`) where their hook contract allows a deny.
- **Not covered, and must be said in the UI and docs:**
  - direct filesystem writes to the `.mpr` or `mprcontents/`;
  - writes via Studio Pro's MCP (`mxcli --mcp`, allowed today on purpose);
  - providers without hooks and without the shim on their PATH;
  - a wrapper that calls the real mxcli by absolute path.
  - The one-writer grader therefore gives `unknown`, not `pass`, when any uncovered provider ran in the execution.
- **Tests:** classifier reuse (no divergence from `studio-guard.js` tests), lease acquire/expire/steal rules, role change on a coverage switch releases the lease, the hook route rejects a bad token, deny is audited.

### 4.7 Persistent held messages

- **What happens today:** `Delivery.held` is an in-memory `Map` (`src/server/roster/deliver.ts:60`), so a restart drops it. The callers that hold (`hold: true`) are:
  - an agent's `office-workers tell` (`src/server/hooks/office-workers.ts:144`);
  - a phone reply from a person (`src/server/phone/index.ts:126`);
  - subagent bench/approve notes (`src/server/roster/subagents.ts:341,368`).
- **Design:**
  - Persist into the roster file's existing outbox (`src/server/roster/relays.ts:44-56`) as `outbox.held: {id, workerId, text, origin, by?, createdAt, expiresAt, idempotencyKey, ack?: string}[]`. This reuses `reviveOutbox` and `OUTBOX_KEPT`.
  - `onSent` callbacks can't be persisted, so each caller passes an `ack` **name** from a small registry (`'phone.typed'`, `'subagent.noted'`). After a restart the registry re-runs it.
  - Expiry defaults to 24 hours. An expired message is dropped with a chatter `message` note so it is visible.
  - Dedupe is on `idempotencyKey`.
  - `forget(workerId)` (`deliver.ts:149`) still drops held messages when a worker goes home, but is audited.
- **Tests (extend `tests/delivery-limits.test.ts` / `tests/relays.test.ts`):** held survives a simulated restart; delivered once (idempotent); expiry; a person's message still bypasses the cap or pause; an old roster without `held` revives.

### 4.8 Minimal tenant and project-membership model

- `tenantId = 'local'`, derived on the server, never from the client.
- `<data>/projects/members.json`, written atomically: `{projectId: {accountId: 'owner' | 'curator' | 'member'}}`.
- The principal is `{accountId?, officeRole: 'admin' | 'member', projects: Map<projectId, role>}`. A shared-password session is admin with access to everything (`office/people.ts:14`). That has to stay so existing workflows keep working, but its actor name is self-asserted (`ws/connection.ts:36`), so **curator decisions and acceptance require a named account**.
- **Enforcement only in the new routes** (Evals, Library, evidence resolve, exports). Existing floor views are unchanged in Phase 1, because changing them would break today's "every signed-in user sees every floor".
- Default: a project with no members file entry gives every account `member` and admins `owner`. That matches today's behaviour.
- **Tests:** an authorisation matrix over the new routes, including revoked access; the shared-password principal can't author an acceptance or curation decision.

## 5. Implementation order

Each increment merges on its own, keeps existing flows green, and adds focused tests (`node:test`, `mkdtempSync` temp dirs as in `tests/queue.test.ts:9`). Each must pass `npm run typecheck`, the relevant tests and the size guard. Effort assumes one engineer or agent and is rough.

| # | Increment | Effort | Depends on | Tests |
|---|---|---|---|---|
| C1 | **Queue reconciliation after restart** (4.5), with atomic `queue.json` | S (1–2 d) | — | queue restart cases |
| C2 | **Persistent held messages** (4.7) | S (1–2 d) | — | relay/delivery restart cases |
| F1 | **Done.** **Ids and EvidenceRef contracts**: `src/shared/evidence/`, `projectIdOf`, optional `AuditInput.ids`, `FloorDef.projectId` | S (2 d) | — | id minting stability, audit chain still verifies with and without ids, locator safety |
| F2 | **DeliveryAttempt record**, advisory (4.1): created from queue/hire, submissions from PR head sha, checks bound to sha | M (4–5 d) | F1 (C1 helpful) | transitions, sha binding, restart re-link |
| F3 | **Trace view** over audit, chatter, roster and the ledger (read-only adapters, 4.2), plus an evidence resolver | M (3–4 d) | F1 | per-source resolver, expired source, inferred ids |
| E1 | **Eval contracts plus the pure gate** (`src/shared/evals/`) | S (2 d) | F1 | gate truth table, schema validation |
| E2 | **Eval runner on the flow engine**: snapshots, immutable definitions, `ci-checks`/`mx-scorecard`/`budget-ceiling` graders, the `eval` billing source and cap, read routes | M (5 d) | E1, F2 | idempotency, crash-resume, unknown-not-zero, no live calls |
| E3 | **Benchmark spike (discovery)**: build the synthetic baseline app and pick the supported runtime-assertion path (API, Playwright or DB). Pin the mxcli check command and versions. | M (3–5 d, mostly Mendix work) | — (parallel) | a written verifier contract per criterion |
| E4 | **Benchmark harness** (4.4): case store, reset per trial, protected verifier workspace, `runtime-fixture` and `gate-check`/`mxcli-check` graders | L (6–8 d) | E2, E3 | path isolation, tamper detection, dry trial in test mode |
| E5 | **Baseline import** plus **comparison view** (Lite tab or page: run table, side-by-side scorecards, completeness, cost split) | M (4–5 d) | E2 (E4 for real data) | import validation, comparison shows unknown as unknown |
| C3 | **Mutation lease** (4.6): lease service plus `/office/lease`, mxcli shim, always-on model guard | M–L (5–7 d) | F1 | classifier parity, lease rules, deny audited |
| C4 | **Merge checks bound to the PR head** (optional): show the gate verdict of the head-sha submission in the merge dialog; with a project policy set to blocking, refuse `gh.merge` (`src/server/ws/handlers/github.ts:17`) when the head sha has no passing required eval; optionally publish a GitHub commit status so `--auto` and agents' own `gh pr merge` are bound too | M (3–4 d) | F2, E2 | stale-sha refusal, advisory default unchanged |
| X1 | **Cost experiment** (team-scaling plan) on the benchmark: 3 arms, same final evaluator, predeclared limits | ops plus about $250–400 approved | E4, E5 (C3 recommended) | — (an experiment, not code) |
| K1 | **Library Phase 1**: membership (4.8), item/revision/lifecycle/review store, keyword index over accepted bodies, read-only source adapters (lessons, journals, PROJECT.md decisions, deliverables KB, Firm findings, incidents), bounded retrieval plus receipts, a small Library tab | L (2–3 wk, split into K1a–K1d) | F1, F3 | spec §13 knowledge criteria: dedupe on reimport, candidate excluded, authorisation matrix, malicious markdown, traversal |

Suggested sequence:
1. C1, C2 and F1, which are independent and can run in parallel.
2. F2, then E1 and E2. E3 starts in parallel as early as possible, because it holds up the benchmark and needs Mendix expertise.
3. E4 and E5.
4. C3 before X1. Arms B and C have more than one agent, so one-writer compliance should be measured rather than assumed.
5. X1.
6. K1. C4 can be done whenever it is decided.

The review's priority 1 (acceptance record) is covered by F2. Its priority 2 controls are C1–C4.

### F1 as built

- **Contracts** (`src/shared/evidence/ids.ts`, `src/shared/evidence/types.ts`, pure):
  - `TENANT_ID = 'local'`; `prj_`, `exe_` and `tsk_` ids on a ULID, with mint and validate functions; `issueTaskId` (`issue:<owner>/<repo>#<n>`) and `legacyQueueTaskId` (`queue:<floor>/<queue id>`) for work that has no minted task id; `agentInstanceId` is the worker id (`sub_<agent_id>` for a subagent, `firm_<engagement>_<reviewer>` for a reviewer); `roleId` is the roster `RoleId`; `sessionId` is the provider's own and is never folded into the agent instance id.
  - `EvidenceRef` and `TraceEvent` as in 4.2, with `validateEvidenceRef`, `validateTraceEvent` and `parseLocator`/`formatLocator` (git paths go through `safeRelPath`). Retention classes add `chatter-capped`.
  - A trace event's ids are each either present, with `idSource[field]` `recorded` or `inferred`, or listed in `gaps` with a reason. Validation refuses an id that is both, or neither. Costs and counts a source can't measure are `{ status: 'unknown', reason }`, never 0.
- **Project ids** (`src/server/projects/ids.ts`): `<data>/projects/ids.json` remembers each project's repository, checkouts and floor ids, so a floor added again under another name (same repository, or same checkout when it has none) gets its id back. `Building` stamps `FloorDef.projectId` on every save, and on the first load for floors from before. The floor id stays the routing key. `byFloorId` resolves an old record's floor id, and is always treated as inferred because a slug can be reused.
- **`AuditInput.ids`** (optional): written only when valid (`cleanIds`). Old lines and lines without ids still verify. Nothing records ids yet; F2 starts writing them.
- **Adapters** (`src/server/evidence/adapters.ts`, read-only): audit events, chatter messages, analysis runs (started and ended), budget ledger rows and incidents, each to trace events with an EvidenceRef back to the record. `trace.ts` builds the view on demand from the files in `<data>` and stores nothing.
- **API**: `GET /api/evidence/trace?floor=&since=&limit=` (session, like `/api/audit`; no UI). It answers the events, `coverage` per source (available, empty or missing, with its retention), and `absent`, the spec events nothing records today.
- **Tests**: `tests/evidence.test.ts`.
- **Differences from the design above:**
  - The id registry is a separate file as well as `FloorDef.projectId`, because a removed floor's def leaves `floors.json`. Without the registry a re-add couldn't find its old id.
  - The trace route reads audit, chatter, analysis, the ledger and incidents. Roster records (subagent runs, escalations) and the resolver `evidence.resolve(ref, principal)` are left for F3, with project membership (4.8).
  - The trace event adds `floorId`, `action` (the source's own name), `summary` and `sessionId` to the envelope in 4.2. Its event types add `incident.recorded` and `other`.
  - Queue tasks don't get a `tsk_` id yet, because `queue.ts` is C1's. Their events use `legacyQueueTaskId`, marked inferred.

### F2 acceptance as built

The user's decisions: acceptance is an explicit Project Manager action (never "merge = accepted"), deliveries are versioned (v1, v1.1, v2…), and reopening never erases an earlier acceptance. Built as the acceptance half of 4.1; the DeliveryAttempt record (executions, submissions per head sha) is still to do.

- **Contracts** (`src/shared/acceptance.ts`, pure): `AcceptanceRecord` (id `acc_<ulid>`, project id, version, cycle, who and when, scope agreed and delivered, the delivery branch's head with build and deploy references or gaps, test evidence lines, documents with `git:<sha>:<path>` locators, exceptions with owners, a frozen `CostSnapshot`, a deliverables digest, and `refs: EvidenceRef[]`), `Reopen`, and the cycles they make. Rules: `cyclesOf`, `suggestVersion`, `versionProblem`, `cleanExceptions` and `changedSince`. An evidence line is `pass`, `fail`, `pending`, `present`, or a gap (`missing`, `unknown`), never a zero.
- **Store** (`src/server/acceptance/store.ts`): `<data>/acceptance/<floor>.jsonl`, append-only and hash-chained like the incidents (`prev`, `hash`), with `verify()`.
- **Service** (`src/server/acceptance/index.ts`, `evidence.ts`): the evidence is gathered from what the office already keeps (`src/server/progress/gather.ts`): the setup view's gate verdicts and decision register, the deliverables scan, the floor's pull requests and their CI rollups, and the budget ledger and plan. Accept and reopen are audited (`acceptance.accept`, `acceptance.reopen`) with `ids.projectId`. "Changed since acceptance" is computed on view: the delivery branch's head (`origin/<default>`, or the folder's branch with no remote) against the record's commit, and the deliverables digest (paths and sizes on main).
- **Trace**: `diskSources` reads the acceptance file, `fromAcceptance` maps an accept to `review.completed` and a reopen to `other`, with source system `delivery`, kind `human_assessment` and the new locator `delivery:<floor>:<id>`.
- **API**: `GET /api/acceptance`, `GET /api/acceptance/draft`, `POST /api/acceptance` (admin, same-origin or JSON, re-auth through Phone access). The progress bar (`GET /api/progress`, `src/shared/progress.ts`) shows it.
- **Left for delivery closing**: handover packs and wind-down attach to a record by its `id`. The bar's Handover phase is `unknown` until then.
- **Tests**: `tests/acceptance.test.ts`, `tests/progress.test.ts`.

### Decisions needed from the user

1. **Do merge checks block?** The options are: advisory badge only (the default proposal); block the office's merge button per project; or also publish a GitHub status, which binds `--auto` and agents' own `gh pr merge` but needs branch protection on each generated repo. Note that mx-office's own `main` has no branch protection.
2. ~~**What counts as "accepted"?**~~ Decided: an explicit PM action, versioned, and a reopen never erases an earlier acceptance (see [F2 acceptance as built](#f2-acceptance-as-built)).
3. **Who curates knowledge?** A project owner for project scope, and a named human curator for organisation scope. Agents can submit candidates. Shared-password sessions can't curate.
4. **Lease strictness.** Is a deny for a non-writer a hard block from day one, or audit-only (shadow) for a period, as Jeff does?
5. **Benchmark runtime path** (comes out of E3), the **benchmark office**, and the **experiment budget and caps per arm**.
6. **Retention** for snapshot-copied transcripts. They can contain project content, so a default is needed, for example 180 days.
7. Whether **eval spend** has its own cap per project (proposed) and what its default is.

## 6. Risks and what could not be verified

**Corrections to the external review.** These were confirmed in code:
- The Firm has no Requested→Failed edge (`src/shared/firm/engagement.ts:131-139`).
- PTYs survive restarts through `src/server/ptyhost.ts` for up to 30 minutes (`:18`), so a queue attempt can show `exited` while its agent keeps working.
- The Studio guard is Claude-only, Bash-only, active only while Studio is open, and not role-aware.
- Merges run with the person's own GitHub sign-in (`ctx.withGitHub`, `ws/handlers/github.ts:23`, `as?.env` in `src/server/github.ts:284`).
- `--auto` defers to GitHub's own checks (`github.ts:283`), and agents can run `gh pr merge` themselves. The poll that notices this is at `github.ts:74-97`.
- There are three spending layers (see the budget row in section 1).

**Risks:**
- **Inferred ids look authoritative.** The adapters must label `idSource` and the UI must show it. Otherwise old runs would be compared as if they were linked properly.
- **Estimated cost looks like a bill.** Everything outside Claude's `cost-state` is an office price-table estimate. Codex and others are `unmetered` (0). The comparison has to show "estimated" and "unknown", and the experiment should use providers whose cost is metered.
- **Retention outlives nothing.** Audit is 90 days, ledger rows 30 days, chatter 1000 messages and escalations 200. Evidence has to be copied into snapshots at freeze time, or an eval loses inspectability. Copying transcripts raises a confidentiality question (decision 6).
- **Verifier leakage.** Agents have broad file access on the machine. Keeping verifiers outside floor dirs and checking hashes reduces the risk but doesn't create a security boundary, the same limit the Firm's isolation has. For the experiment, consider a separate OS user or machine for the verifier.
- **Lease coverage gaps** (4.6) mean "one-writer" can only be `pass` for executions where every agent was covered.
- **Gate-check parsing** scrapes HTML (`summary/project.ts:108-114`). A toolkit change breaks it silently, so the grader must report `error` on a parse failure, never `pass`.
- **Self-asserted actors.** Without named accounts, audit and acceptance identity is a free-text name. Curation and acceptance must require accounts.
- **Paid side effects of existing evidence.** Analysis classification and ranking highlights make Haiku calls (`analysis/llm.ts`). The Eval path must not trigger them implicitly. Ranking highlights may be billed to the office ledger rather than a floor (`ranking/index.ts:126`; inferred, not run).
- **Experiment confounds.** Solo, Startup and Enterprise differ in models and topology together. Compare complete configurations, and don't attribute the difference to hierarchy (spec §9).

**Not verified:**
- The supported way to make runtime assertions against a local Mendix app: a published API, Playwright, or the database. The exact `mxcli check`/`lint` command lines and output formats. The `gate-check.sh` source, whose output format was inferred from the parser.
- Where the `budget.alert` incidents signal is emitted (the type exists at `src/server/incidents/signals.ts:15`).
- Whether `flow` `ctx.report` is called anywhere outside the paths checked (project-run and wizard were checked).
- Hook contracts for non-Claude providers, and whether they can *deny* a tool call (needed for C3 point 3).
- How the live app is started from the client (probably the WebSocket), and whether two live apps can run per machine at once for parallel trials (ports come from `AGENT_OFFICE_LIVE_PORTS`).
- The worktree slug format `<name>-<id>` (from the docs; the code shows `office/<slug>`, `src/server/worktrees.ts:13-15`).
- Generated customer repos' branch protection settings.
- No tests were run for this document, which is a read-only analysis. Line numbers are at f9c9dd6 and will drift.
