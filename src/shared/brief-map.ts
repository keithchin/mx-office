// What an approved project brief (shared/brief.ts) becomes in the project, in the toolkit's own formats:
// intake.md answers (Q2 the goal and success criteria, Q4 the scope and input documents, Q5 the
// constraints, Q8 the open questions), the ✋ Stage 0 rows of PROJECT.md's Decisions table, the committed
// docs/project-brief.md, and the brief's part of the Discovery issue. Every item keeps its tag and its
// source; an item still Assumed at the approval is recorded ASSUMED, never CONFIRMED.

import { READ_LABEL, SECTION_IDS, SECTION_INFO, sourceText, type Brief, type BriefItem, type BriefTag, type PlanBrief } from './brief.js';
import type { IntakeAnswer } from './wizard.js';

const TAG_WORD: Record<BriefTag, string> = { answered: 'Answered', assumed: 'ASSUMED', unverified: 'Unverified' };
/** Where an item came from, for a file: who settled it is named, never "you". */
const src = (it: BriefItem) => (it.by ? `${it.by.how === 'chat' ? 'from the chat with' : `${it.by.how} by`} ${it.by.name}${it.by.at ? ` ${it.by.at.slice(0, 16).replace('T', ' ')}` : ''}` : it.source);
const line = (it: BriefItem) => `- ${it.name ? `${it.name}: ` : ''}${it.text}${it.when ? ` (${it.when})` : ''} [${TAG_WORD[it.tag]}, ${src(it)}]`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The weakest tag of a set: one Assumed item makes the answer Assumed; Unverified only when nothing is known. */
function kindOf(items: BriefItem[]): IntakeAnswer['kind'] {
  if (items.some((x) => x.tag === 'assumed')) return 'assumed';
  if (items.every((x) => x.tag === 'unverified')) return 'unverified';
  return 'answered';
}

/**
 * The intake answers the brief gives: Q2 (what the project is and what drives it: the goal, then the
 * success criteria), Q4 (what we work on: in scope, out of scope, the input documents), Q5 (what must stay
 * as it is: the constraints) and Q8 (anything else: the open questions, Unverified with how to verify).
 * A question the brief says nothing about is left out, for the Chief Analyst to ask.
 */
export function intakeFromBrief(pb: PlanBrief): IntakeAnswer[] {
  const s = pb.brief.sections;
  const out: IntakeAnswer[] = [];
  const goal = s.goal;
  if (goal.length || s.success.length) {
    const head = goal.length ? `${oneLine(goal.map((g) => g.text).join(' '))} [${goal.map((g) => `${TAG_WORD[g.tag]}, ${src(g)}`).join('; ')}]` : 'The project brief’s success criteria:';
    out.push({ n: 2, kind: kindOf([...goal, ...s.success]), text: [`${head} (docs/project-brief.md)`, ...(s.success.length ? ['Success criteria:', ...s.success.map(line)] : [])].join('\n') });
  }
  const ins = s.scope.filter((x) => x.side !== 'out');
  const outs = s.scope.filter((x) => x.side === 'out');
  if (s.scope.length || pb.attachments.length) {
    const docs = pb.attachments.length ? `Input documents: ${pb.attachments.map((a) => a.name).join(', ')} (in sources/).` : 'Input documents: none, the description only.';
    const head = [ins.length ? `In scope: ${ins.map((x) => oneLine(x.text)).join('; ')}.` : '', outs.length ? `Out of scope: ${outs.map((x) => oneLine(x.text)).join('; ')}.` : '', docs].filter(Boolean).join(' ');
    out.push({ n: 4, kind: s.scope.length ? kindOf(s.scope) : 'answered', text: [head, ...(ins.length ? ['In scope:', ...ins.map(line)] : []), ...(outs.length ? ['Out of scope:', ...outs.map(line)] : [])].join('\n') });
  }
  if (s.constraints.length) out.push({ n: 5, kind: kindOf(s.constraints), text: [oneLine(s.constraints.map((c) => c.text).join('; ')), ...s.constraints.map(line)].join('\n') });
  if (s.questions.length) out.push({ n: 8, kind: 'unverified', text: [`ask the client in the Discovery interview (the brief's open questions): ${s.questions.map((q, i) => `(${i + 1}) ${oneLine(q.text)}`).join(' ')}`, ...s.questions.map(line)].join('\n') });
  return out;
}

export interface BriefDecisionRow {
  stage: string;
  decision: string;
  status: string;
  notes: string;
}

/**
 * The ✋ Stage 0 rows of PROJECT.md's Decisions table, once the brief is approved: the scope approval
 * itself (CONFIRMED, by whom, when), the goal (CAC-1 records it as `Goal:`), and one ASSUMED row per item
 * that was still Assumed, so nothing inferred is recorded as confirmed. The Stage 0 gate itself
 * (gate-check's triage.md `## Sign-off`) is left to the Discovery stages: see the Discovery issue.
 */
export function briefDecisionRows(pb: PlanBrief, date: string): BriefDecisionRow[] {
  if (!pb.approved) return [];
  const { by, at } = pb.approved;
  const when = at.slice(11, 16);
  const assumed = SECTION_IDS.flatMap((s) => pb.brief.sections[s].filter((x) => x.tag === 'assumed').map((x) => ({ s, x })));
  const goal = pb.brief.sections.goal;
  const rows: BriefDecisionRow[] = [
    {
      stage: '0',
      decision: 'Scope: project brief approved (docs/project-brief.md)',
      status: `CONFIRMED ${date}`,
      notes: `Approved by ${by} in the agent-office new-project wizard${when ? ` at ${when}` : ''}${assumed.length ? `; ${assumed.length} item${assumed.length === 1 ? '' : 's'} still Assumed, recorded as ASSUMED rows below` : ''}; triage.md's capability map and sign-off are still due at Stage 0`,
    },
  ];
  if (goal.length) rows.push({ stage: '0', decision: `Goal: ${oneLine(goal.map((g) => g.text).join(' '))}`, status: `${goal.some((g) => g.tag === 'assumed') ? 'ASSUMED' : 'CONFIRMED'} ${date}`, notes: `From the project brief (${goal.map(src).join('; ')})` });
  for (const { s, x } of assumed) {
    if (s === 'goal') continue;
    rows.push({ stage: '0', decision: `Brief assumption ${x.id}: ${x.name ? `${x.name}: ` : ''}${oneLine(x.text)}`, status: `ASSUMED ${date}`, notes: `${SECTION_INFO[s].title}; ${x.source}; approved with the scope but not yet confirmed by the client` });
  }
  return rows;
}

const tagCell = (it: BriefItem) => `${TAG_WORD[it.tag]} · ${src(it)}`;

/** docs/project-brief.md: the approved brief and its functional domains, committed with the project. */
export function briefMarkdown(pb: PlanBrief, meta: { repo: string; entry: string }): string {
  const b = pb.brief;
  const s = b.sections;
  const out: string[] = [`# Project brief: ${b.title || meta.repo}`, ''];
  out.push(`${b.description ? `${b.description}\n\n` : ''}Drafted ${pb.manual ? 'by hand' : 'with the Chief Analyst'} in the agent-office new-project wizard for \`${meta.repo}\` (entry mode: ${meta.entry}).`);
  if (pb.approved) out.push('', `**✋ Stage 0 scope approved** by ${pb.approved.by} on ${pb.approved.at.slice(0, 16).replace('T', ' ')}${pb.approved.assumed ? `, with ${pb.approved.assumed} item${pb.approved.assumed === 1 ? '' : 's'} still **ASSUMED** (recorded as ASSUMED in PROJECT.md)` : ''}.`);
  out.push('', 'Every item says how it is known: **Answered** (given or confirmed), **ASSUMED** (inferred, to be confirmed with the client) or **Unverified** (an open question), and where it came from.');
  const list = (items: BriefItem[]) => items.map((it) => `- ${it.text} _(${tagCell(it)})_`);
  out.push('', '## Goal', '', ...list(s.goal), '', '## Success criteria', '', ...list(s.success), '', '## User roles', '');
  for (const r of s.roles) out.push(`- **${r.name}**: ${r.text}${r.when ? `\n  _${r.when}_` : ''} _(${tagCell(r)})_`);
  out.push('', '## Scope', '', '**In scope**', '', ...list(s.scope.filter((x) => x.side !== 'out')), '', '**Out of scope**', '', ...list(s.scope.filter((x) => x.side === 'out')));
  out.push('', '## Constraints', '', ...list(s.constraints), '', '## Open questions', '', ...list(s.questions));
  if (pb.domains?.domains.length) {
    out.push('', '## Functional domains', '', 'Drafted after the approval, as the starting point for the BRDs (Stage 2) and the build plan (Stage 4). Each story is **ASSUMED** until the client confirms it.');
    for (const d of pb.domains.domains) {
      out.push('', `### ${d.code}: ${d.name}`, '', `${d.description}${d.roles.length ? ` Roles: ${d.roles.join(', ')}.` : ''}`, '');
      for (const st of d.stories) out.push(`- **${st.id} ${st.title}**: ${st.text} (${st.ac} acceptance criteria drafted)`);
    }
    if (pb.domains.tier) out.push('', `Suggested size tier: **${pb.domains.tier}**${pb.domains.tierWhy ? ` (${pb.domains.tierWhy})` : ''}.`);
  }
  if (pb.attachments.length) {
    out.push('', '## Input documents', '', 'Copied into `sources/` (the toolkit’s drop folder, git-ignored by default).', '');
    for (const a of pb.attachments) out.push(`- ${a.name}: ${READ_LABEL[a.read]}${a.note ? ` (${a.note})` : ''}`);
  }
  return `${out.join('\n')}\n`;
}

/** The brief's part of the Discovery issue: what was approved, what's still assumed, the domains, and what Stage 0 still needs. */
export function briefForDiscovery(pb: PlanBrief): string[] {
  const b = pb.brief;
  const s = b.sections;
  const assumed = SECTION_IDS.flatMap((id) => s[id].filter((x) => x.tag === 'assumed'));
  const out = [
    '',
    '## The project brief (approved in the wizard)',
    `The client${pb.approved ? ` (${pb.approved.by})` : ''} drafted and approved a project brief with the office before this project was created: **\`docs/project-brief.md\`** has it in full, with every item tagged Answered, ASSUMED or Unverified and where it came from.`,
    `- **Goal:** ${s.goal.map((g) => oneLine(g.text)).join(' ') || '(none written)'}`,
    `- **User roles:** ${s.roles.map((r) => `${r.name}${r.tag === 'assumed' ? ' (ASSUMED)' : ''}`).join(', ') || '(none written)'}`,
    `- **In scope:** ${s.scope.filter((x) => x.side !== 'out').map((x) => oneLine(x.text)).join('; ') || '(none written)'}`,
    `- **Out of scope:** ${s.scope.filter((x) => x.side === 'out').map((x) => oneLine(x.text)).join('; ') || '(none written)'}`,
  ];
  if (assumed.length) out.push(`- **Still ASSUMED (confirm these with the client first):** ${assumed.map((x) => `${x.name ? `${x.name}: ` : ''}${oneLine(x.text)}`).join('; ')}`);
  if (s.questions.length) out.push(`- **Open questions (Unverified):** ${s.questions.map((q) => oneLine(q.text)).join('; ')}`);
  if (pb.domains?.domains.length) {
    out.push('', '### Functional domains', 'Start the BRDs (Stage 2) and the build plan (Stage 4) from these; every story is ASSUMED until the client confirms it.');
    for (const d of pb.domains.domains) out.push(`- **${d.code} ${d.name}** (${d.roles.join(', ')}): ${d.stories.map((st) => `${st.id} ${st.title}`).join('; ')}`);
  }
  out.push(
    '',
    '### Stage 0',
    '`PROJECT.md` already has the scope approval as a Stage 0 `CONFIRMED` row and every assumption as an `ASSUMED` row. The Stage 0 gate still needs `triage.md`: build its capability map from the brief and the domains, reflect the scope back to the client (don’t start the brainstorm from nothing), confirm or correct the ASSUMED items, and record the `## Sign-off` only when the client says so.',
  );
  if (pb.attachments.length) out.push(`The attached documents are in \`sources/\`: ${pb.attachments.map((a) => `${a.name} (${READ_LABEL[a.read]})`).join(', ')}. Read every one yourself; the brief may have missed things.`);
  return out;
}

/** The brief as plain text for a prompt: every item with its id, tag and source. */
export function briefAsText(b: Brief): string {
  return JSON.stringify({ title: b.title, description: b.description, sections: Object.fromEntries(SECTION_IDS.map((s) => [s, b.sections[s].map((x) => ({ id: x.id, ...(x.name ? { name: x.name, when: x.when } : {}), ...(x.side ? { side: x.side } : {}), text: x.text, tag: x.tag, source: sourceText(x) }))])) });
}
