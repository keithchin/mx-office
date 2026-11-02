// office-workers phases: the team and the project's phases (phased delivery, src/server/phases/). At the Build
// Plan gate (Stage 4) the team proposes how Build is cut into business-outcome phases, a foundation phase first,
// from architecture/build-plan.md's rows and the journeys that prove each phase; during Build it proposes a
// change (move rows, split, merge, reorder, a switch, starting the next phase's design early). The Project
// Manager accepts, declines or edits it on the Roadmap; the team hears the decision as a message. Exit criteria
// are never the team's to say: the office records them (journeys passed on main, mx check 0, no open data
// impact). office-workers.js imports the parts below. Plain Node, no dependencies.

export const PHASES_USAGE = `  office-workers phases status                  the phases: status, rows, journeys, open proposals
  office-workers phases propose <<'EOF'         propose the phases at the Build Plan gate, or a change
  {"reason": "…", "phases": [ … ]}              during Build ({"reason": "…", "ops": [ … ]}): JSON on
  EOF                                           stdin, as the propose_phases / propose_phase_change
                                                MCP tools take it`;

const PHASE_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'A business outcome in a few words ("Events", "People & points"); the first is the foundation (design system, data model and security).' },
    goal: { type: 'string', description: 'What the users can do at the end of it, one sentence.' },
    foundation: { type: 'boolean', description: 'A foundation phase (design system, data model & security).' },
    rows: { type: 'array', items: { type: 'integer' }, description: "Its architecture/build-plan.md rows (the # column). A row belongs to one phase." },
    useCases: { type: 'array', items: { type: 'string' }, description: 'The use cases it delivers (UC-01…).' },
    journeys: { type: 'array', items: { type: 'string' }, description: 'The journeys (tests/e2e/*.journey.json ids) that prove it. A journey belongs to one phase; later phases re-run earlier ones as regression.' },
    estimate: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } }, required: ['min', 'max'], description: 'Your estimate in USD of agent spend, a range.' },
    days: { type: 'integer', minimum: 1, description: 'Your estimate in working days.' },
    checkpoint: { type: 'boolean', description: "Stop for the Project Manager's review at its end (default true)." },
    publish: { type: 'boolean', description: 'Publish to the sandbox at its end (default true).' },
  },
  required: ['name', 'goal', 'rows', 'estimate'],
  additionalProperties: false,
};

const OP_ITEM = {
  type: 'object',
  description:
    'One edit. op is rename {phase, name?, goal?}, move-rows {rows, to}, reorder {order: every phase id}, split {phase, rows, name, goal?}, merge {phases}, toggle {phase, checkpoint?, publish?, foundation?}, ' +
    "overlap {phase, teams, what} (start a planned phase's work early, e.g. teams ['design'], what 'design'), estimate {phase, min, max, days?}, journeys {phase, journeys} or add {name, goal?, rows?, after?}. Phases are named by id (ph-3, as phases_status shows). Done phases are locked.",
  properties: { op: { type: 'string', enum: ['rename', 'move-rows', 'reorder', 'split', 'merge', 'toggle', 'overlap', 'estimate', 'journeys', 'add'] } },
  required: ['op'],
};

export const PHASE_TOOLS = [
  {
    name: 'propose_phases',
    title: 'Propose the phases at the Build Plan gate',
    description:
      "Proposes how Build is cut into phases, at the Build Plan gate (Stage 4), for a project delivered in phases. Each phase is a business outcome (foundation first: design system, data model & security), with its build-plan rows, the journeys that prove it, your estimate (USD range) and its checkpoint and publish switches. " +
      'The Project Manager approves or edits them on the Roadmap; approving starts Build with phase 1. A newer proposal replaces an open one. Once approved, use propose_phase_change instead.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why this cut, in a sentence or two (shown to the Project Manager).' },
        summary: { type: 'string', description: 'A one-line summary (default: "N phases from the build plan").' },
        phases: { type: 'array', items: PHASE_ITEM, minItems: 1, maxItems: 20 },
        cutover: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' }, days: { type: 'integer' } }, description: 'Your estimate for Cutover after the last phase.' },
      },
      required: ['reason', 'phases'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'propose_phase_change',
    title: 'Propose a change to the phases',
    description:
      'Proposes a change to the approved phases during Build: move rows between phases, split, merge, reorder, a checkpoint or publish switch, an estimate, or starting a planned phase early (overlap, e.g. its design while the current phase is built). ' +
      "It waits on the Roadmap for the Project Manager to accept, decline or edit; you hear the decision as a message. Every accepted change is recorded with your name and reason. Don't wait on it: carry on with the current phase.",
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: "Why, with what it costs or saves (e.g. 'needs the notification service phase 6 sets up; Events closes 2 days sooner')." },
        summary: { type: 'string', description: 'A one-line summary (default: the office words the ops).' },
        ops: { type: 'array', items: OP_ITEM, minItems: 1, maxItems: 50 },
      },
      required: ['reason', 'ops'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'phases_status',
    title: "The project's phases",
    description: "The project's phases as approved (or proposed): each one's id, status (planned, active, checkpoint, done, stopped), rows, journeys, estimate and switches, with the open and recently decided proposals.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export const PHASE_TOOL_NAMES = PHASE_TOOLS.map((t) => t.name);

/** What the office answered, in words. */
export function formatPhases(answer, op) {
  if (op === 'status') {
    const ps = answer?.phases ?? [];
    if (!ps.length) return 'This project has no phases (delivered in one go), or none proposed yet.';
    const lines = ps.map((p) => `${p.order}. ${p.name} [${p.id}] ${p.status}${p.foundation ? ' · foundation' : ''}${p.early ? ` · started early (${p.early})` : ''} · rows ${p.rows.join(', ') || 'none'} · journeys ${p.journeys.join(', ') || 'none'} · $${p.estimate?.min ?? 0}–${p.estimate?.max ?? 0}${p.checkpoint ? ' · checkpoint' : ''}${p.publish ? ' · publish' : ''}`);
    const open = (answer.open ?? []).map((x) => `open: ${x.id} (${x.kind}) by ${x.by}: ${x.summary}`);
    const recent = (answer.recent ?? []).map((x) => `${x.status}: ${x.id} ${x.summary}${x.note ? ` (${x.note})` : ''}`);
    return [`Phases (${answer.state}):`, ...lines, ...open, ...recent].join('\n');
  }
  return answer?.note ?? `Proposed (${answer?.proposal?.id ?? ''}).`;
}

/** The MCP tool's arguments as the office's request. */
export function phasesRequest(name, args) {
  if (name === 'phases_status') return { op: 'status' };
  if (name === 'propose_phases') return { op: 'propose', kind: 'plan', ...args };
  return { op: 'propose', kind: 'change', ...args };
}

/**
 * The arguments after `phases`. Throws `UsageError` (passed in, so the caller's usage is shown).
 * @param {string[]} args
 * @param {new (msg: string) => Error} UsageError
 */
export function parsePhases(args, UsageError) {
  const [op, ...rest] = args;
  const json = rest.includes('--json');
  if (rest.some((a) => a !== '--json')) throw new UsageError(`phases ${op ?? ''} takes no arguments but --json (the proposal comes as JSON on stdin)`);
  if (op === 'status' || op === undefined) return { cmd: 'phases', op: 'status', json };
  if (op === 'propose') return { cmd: 'phases', op: 'propose', json };
  throw new UsageError('phases status, or phases propose with the JSON on stdin');
}
