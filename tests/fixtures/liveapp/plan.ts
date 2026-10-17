// A PackTrack-shaped build plan for the live app readiness tests (tests/liveapp-*.test.ts).

/** A PackTrack-shaped build plan: phases of numbered rows, every State "not built" (as the agents leave it). */
export const PLAN = `# Build plan — PackTrack Line 7 demo (Checksheet)

Stage 4, small tier.

## Pending decisions

| OI | Decision needed | Proposal | Rows affected |
|---|---|---|---|
| OI-1 | Stage 3 | as written | all |

## Numbered sequence

### Phase 0 — Prerequisites

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 1 | BRIEF | check the brief | brief exists | — | skills/module-brief.md | not built |
| 3 | PROVE | capability probes | verdicts | 1 | skills/x.md | not built |
| 4 | BUILD | labels data file | 84 rows | 1 | skills/fixture-seeding.md | not built |

#### Row 1 — brief check
Builder: Chief Analyst.

### Phase 1 — Frame, domain and skeleton

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 6 | BUILD | \`01-frame.mdl\` | module, roles | 2, 3, 5 | skills/a.md | not built |
| 7 | BUILD | \`02-domain.mdl\` | entities | 6 | skills/a.md | not built |
| 8 | BUILD | \`03-stubs-nav.mdl\` | page stubs, navigation | 7 | skills/a.md | not built |
| 10 | HARNESS | walking skeleton | one journey passes | 6, 7, 8 | skills/w.md | not built |

### Phase 3 — Save, submit and My check sheets

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 19 | BUILD | \`07-mf-sheet-save-submit.mdl\` | save/submit | 17 | skills/a.md | not built |
| 20 | BUILD | \`08-pages-sheet.mdl\` | sheet pages | 19 | skills/a.md | not built |
| 21 | PROVE | sheet tests | completion % | 20 | skills/t.md | not built |

### Phase 4 — Approval, history and demo data

| # | Kind | Step | Produces / Proves | Depends on | Skills | State |
|---|---|---|---|---|---|---|
| 23 | BUILD | \`09-mf-approval-seed.mdl\` | approve, reject | 21 | skills/a.md | not built |
| 24 | BUILD | \`10-pages-view-approval.mdl\` | approval pages | 23 | skills/a.md | not built |
`;
