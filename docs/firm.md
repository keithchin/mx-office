# The Firm

Back to the [README](../README.md).

The Firm is the office's team of **Reviewer Agents**: an independent consultancy that audits a project from outside its team. It lives at `/firm` (its own page, like `/home`), keeps its data in the office's data dir under `firm/`, and runs its reviewers on **Fable 5.1** (`claude-fable-5-1`) unless the Project Manager picks Opus or Sonnet per reviewer.

## The people

| Reviewer | Attached to | Staffing | Checks |
| --- | --- | --- | --- |
| 🎩 Eleanor Vance, Engagement Partner | Project Coordinator | always | scope, plan vs reality, re-forecast, root causes; owns the final report |
| 🖋️ Julian Hale, Design Reviewer | Lead Designer | default | Atlas conformance, flows, accessibility |
| 🏛️ Marcus Reed, Code & Architecture Reviewer | Lead Developer | default | layering, mxcli check/lint, delivery hygiene |
| 🔬 Priya Natarajan, QA & Test Reviewer | Lead Tester | default | test strategy, its own tests (unit, Playwright), result audit |
| 📐 Thomas Albright, Requirements & Delivery Reviewer | Chief Analyst | default | BRD traceability, scope & plan, decision register |
| 🛡️ Nadia Kerr, Security Reviewer | Lead Developer | optional | access rules, secrets, integration surface |
| ⚖️ Oliver Grant, Cost & Performance Reviewer | Project Coordinator | optional | worker performance, spend, "is someone slacking?" |

The table is data in `src/shared/firm/roles.ts`; each reviewer gets a Claude Code skill written from it.

## An engagement

1. **Call an audit** (`/firm`, or the floor's 1D view): teams, reviewers and models, test types, artifacts, documentation, recommendations, depth, budget cap, max time, and whether a benched Lead may be hired back to answer. The wizard shows an **estimate** (model prices × `EST_TOKENS` in `src/shared/firm/engagement.ts`), then a confirmation screen. Admins only.
2. **Staffing**: the commit is pinned (the project branch on `origin`, else `HEAD`) and each reviewer gets `firm/engagements/<id>/<reviewer>/`.
3. **Fieldwork**: every reviewer runs in parallel as a headless Claude Code session (`claude -p`, stream-json, `--resume` per turn). They interview their Lead and review.
4. **Consolidation**: once the specialists are done, their sections land in the Partner's `evidence/sections/` and the Partner sends the report's sections.
5. **Delivered**: the report is saved (`firm/reports/<id>.json` and `.md`), a toast goes to the floor, the 1D view's Needs-you strip says **📑 Audit report ready → Read**, and every session is stopped.

The PM can cancel at any time (no report). A restart of the office carries running reviewers on in fresh turns; an engagement caught mid-staffing fails and can be called again.

## Isolation (no shared context, no bias)

A reviewer's folder holds `CLAUDE.md` (its engagement letter from the Firm), `.claude/skills/firm-<id>/`, `.claude/settings.json` (deny rules: `git push`, `gh pr/issue` writes, `gh api`, reading `~/.agent-office*` and `~/.ssh`), `evidence/` (the office's data as JSON), `out/` (its work) and `repo/`:

- `repo/` is a **local clone** at the pinned commit, detached, with **no remote**, `credential.helper` emptied.
- The project's agent instructions (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.ai-context/skills/`, `.mcp.json`…) are **moved out** to `evidence/project-instructions/*.txt`, so Claude Code never loads them; journals stay as evidence.
- The environment drops `GH_*`, `GITHUB_*`, `GCM_*`, SSH agent and askpass variables and the office's worker tokens; sets an empty `GH_CONFIG_DIR`, `GIT_CONFIG_NOSYSTEM=1`, a private `GIT_CONFIG_GLOBAL` (no credential manager), `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND=false`.
- The session runs with `--strict-mcp-config` (no MCP servers), no web tools, and is not a floor worker: no desk, not in `workers.json`, invisible to Leads' `office-workers list`, not benchable.

Limits: the reviewer still runs as the same OS user, so the deny rules, not the OS, keep it from reading files outside its folder; the user's global Claude Code settings still apply.

## Interviews

- Reviewer: `office-workers firm ask [--team <team>] "question"`. Specialists ask their own team; the Partner the Project Coordinator or any attached Lead.
- The question goes to the Lead's session (woken if asleep) framed as *"📋 The Firm's … (independent audit) asks: …"*. A Lead mid-question gets it when free; a benched Lead's goes to the Project Coordinator, or the Lead is hired back if the engagement allows; otherwise it's recorded unanswered.
- Lead: `office-workers firm answer <id> "…"`. The answer comes back as the reviewer's next prompt. Unanswered after 20 minutes, the reviewer is told and moves on.
- Limits per reviewer by depth: quick 3 (1 open), standard 6 (2 open), deep 12 (3 open), with a gap between questions.

## Budget and time

Every turn's spend is priced per message from the office's price table (Fable 5.1: $10 / $50 / $0.25 per million input / output / cache-read tokens) and snapped to Claude Code's own `total_cost_usd` at the end of the turn; it also goes on the office's ledger. At 80% the floor is warned (toast, Needs-you item); at 100% every running turn is cut short and each reviewer is asked to send what it has; 6 minutes later, or at 115% of the cap, everything stops and a **partial** report is delivered from whatever was sent. The max time wraps up the same way.

## The report

Schema and checks: `src/shared/firm/report.ts`. Reviewers send sections with `office-workers firm report --section <key> --file <json>`; the server validates and names the bad field. Specialists send `reviewer`; the Partner sends `executive`, `statistics`, `findings`, `prosCons`, `rootCauses`, `timeline`, `expectations`, `workers`, `risks`, `recommendations`, `appendix` (the first, third and tenth are required). The office fills in what it knows (PRs, issues, CI pass rate, cost to date, the audit's cost, the ranking's grades). The viewer is `/firm?report=<id>`; admins can download Markdown or JSON.

## Audit log

`src/server/firm/audit-source.ts` reads the office audit log as evidence and records the Firm's own steps, through a run-time lookup of `src/server/audit/` (`readAudit`, `record`). Until that module exists it reads as empty.
