// What an approved project brief (shared/brief.ts) becomes in the project, in the toolkit's own formats:
// intake.md answers (Q2 the goal and success criteria, Q4 the scope and input documents, Q5 the
// constraints, Q8 the open questions), the ✋ Stage 0 rows of PROJECT.md's Decisions table, the committed
// docs/project-brief.md, and the brief's part of the Discovery issue. Every item keeps its tag and its
// source; an item still Assumed at the approval is recorded ASSUMED, never CONFIRMED.

import { DRAFTED, READ_LABEL, SECTION_IDS, SECTION_INFO, sourceText, whenDrafted, type Brief, type BriefItem, type BriefTag, type PlanBrief, type SectionId } from './brief.js';
import type { IntakeAnswer } from './wizard.js';
import { bytesText, legacyRel } from './source-folder.js';

const TAG_WORD: Record<BriefTag, string> = { answered: 'Answered', assumed: 'ASSUMED', unverified: 'Unverified' };
/** Where an item came from, for a file: who settled it is named, never "you". */
const src = (it: BriefItem) => {
  if (!it.by) return it.source;
  const at = it.by.at ? ` ${it.by.at.slice(0, 16).replace('T', ' ')}` : '';
  return it.by.how === 'chat' ? `from the chat with ${it.by.name}${at}` : it.by.how === 'chat-confirmed' ? `confirmed by ${it.by.name} in the chat${at}` : `${it.by.how} by ${it.by.name}${at}`;
};
/** A role's statement, saying when the Chief Analyst wrote it rather than anyone saying it. */
const whenText = (it: BriefItem) => (it.when ? `${it.when}${whenDrafted(it) ? ` (${DRAFTED})` : ''}` : '');
const line = (it: BriefItem) => `- ${it.name ? `${it.name}: ` : ''}${it.text}${it.when ? ` (${whenText(it)})` : ''} [${TAG_WORD[it.tag]}, ${src(it)}]`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** One line without its closing period, for joining with "; " or ending with one (no "kiosk.; Host" or "days.."). */
const bare = (s: string) => oneLine(s).replace(/[.;,:\s]+$/, '');
const joined = (items: BriefItem[]) => items.map((x) => bare(x.text)).join('; ');

/** The weakest tag of a set: one Unverified item makes the answer Unverified, one Assumed item Assumed; CONFIRMED only when every item is Answered. */
function kindOf(items: BriefItem[]): IntakeAnswer['kind'] {
  if (!items.length || items.some((x) => x.tag === 'unverified')) return 'unverified';
  if (items.some((x) => x.tag === 'assumed')) return 'assumed';
  return 'answered';
}

/** What is known of a section: its items that aren't Unverified (those are open questions: Q8 and the register's OQ table). */
const known = (items: BriefItem[]) => items.filter((x) => x.tag !== 'unverified');
/** The items still Unverified outside the open questions section, with their section: open questions too, never part of a CONFIRMED answer. */
const unverifiedElsewhere = (pb: PlanBrief) => SECTION_IDS.filter((s) => s !== 'questions').flatMap((s) => pb.brief.sections[s].filter((x) => x.tag === 'unverified').map((x) => ({ s, x })));
/** The distinct sources of a set of items, joined ("from your description", once). */
const sources = (items: BriefItem[], each: (it: BriefItem) => string = src) => [...new Set(items.map(each))].join('; ');

/**
 * The intake answers the brief gives: Q2 (what the project is and what drives it: the goal, then the
 * success criteria), Q4 (what we work on: in scope, out of scope, the input documents), Q5 (what must stay
 * as it is: the constraints; not for a greenfield project, where nothing exists to stay) and Q8 (anything
 * else: the open questions and every other Unverified item, with how to verify). An answer's kind comes
 * from its known items only. A question the brief says nothing about is left out, for the Chief Analyst to ask.
 */
export function intakeFromBrief(pb: PlanBrief, opts: { entry?: string } = {}): IntakeAnswer[] {
  const s = pb.brief.sections;
  const out: IntakeAnswer[] = [];
  const goal = known(s.goal);
  const success = known(s.success);
  if (goal.length || success.length) {
    const head = goal.length ? `${oneLine(goal.map((g) => g.text).join(' '))} [${sources(goal, (g) => `${TAG_WORD[g.tag]}, ${src(g)}`)}]` : 'The project brief’s success criteria:';
    out.push({ n: 2, kind: kindOf([...goal, ...success]), text: [`${head} (docs/project-brief.md)`, ...(success.length ? ['Success criteria:', ...success.map(line)] : [])].join('\n') });
  }
  const scope = known(s.scope);
  const ins = scope.filter((x) => x.side !== 'out');
  const outs = scope.filter((x) => x.side === 'out');
  if (scope.length || pb.attachments.length) {
    const docs = pb.attachments.length ? `Input documents: ${pb.attachments.map((a) => a.name).join(', ')} (in sources/).` : 'Input documents: none, the description only.';
    const head = [ins.length ? `In scope: ${joined(ins)}.` : '', outs.length ? `Out of scope: ${joined(outs)}.` : '', docs].filter(Boolean).join(' ');
    out.push({ n: 4, kind: scope.length ? kindOf(scope) : 'answered', text: [head, ...(ins.length ? ['In scope:', ...ins.map(line)] : []), ...(outs.length ? ['Out of scope:', ...outs.map(line)] : [])].join('\n') });
  }
  const constraints = known(s.constraints);
  if (constraints.length && opts.entry !== 'greenfield') out.push({ n: 5, kind: kindOf(constraints), text: [`${joined(constraints)}.`, ...constraints.map(line)].join('\n') });
  const open = [...s.questions, ...unverifiedElsewhere(pb).map(({ x }) => x)];
  if (open.length) out.push({ n: 8, kind: 'unverified', text: [`ask the client in the Discovery interview (the brief's open questions): ${open.map((q, i) => `(${i + 1}) ${oneLine(q.text)}`).join(' ')}`, ...open.map(line)].join('\n') });
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
export function briefDecisionRows(pb: PlanBrief, date: string, opts: { change?: boolean } = {}): BriefDecisionRow[] {
  if (!pb.approved) return [];
  const { by, at } = pb.approved;
  const when = at.slice(11, 16);
  const assumed = SECTION_IDS.flatMap((s) => pb.brief.sections[s].filter((x) => x.tag === 'assumed').map((x) => ({ s, x })));
  const goal = known(pb.brief.sections.goal);
  if (opts.change) return changeRequestRows(pb, date, assumed, goal);
  const rows: BriefDecisionRow[] = [
    {
      stage: '0',
      decision: 'Scope: project brief approved (docs/project-brief.md)',
      status: `CONFIRMED ${date}`,
      notes: `Approved by ${by} in the agent-office new-project wizard${when ? ` at ${when}` : ''}${assumed.length ? `; ${assumed.length} item${assumed.length === 1 ? '' : 's'} still Assumed, recorded as ASSUMED rows below` : ''}; triage.md's capability map and sign-off are still due at Stage 0`,
    },
  ];
  if (goal.length) rows.push({ stage: '0', decision: `Goal: ${oneLine(goal.map((g) => g.text).join(' '))}`, status: `${goal.some((g) => g.tag === 'assumed') ? 'ASSUMED' : 'CONFIRMED'} ${date}`, notes: `From the project brief (${sources(goal)})` });
  for (const { s, x } of assumed) {
    if (s === 'goal') continue;
    rows.push({ stage: '0', decision: `Brief assumption ${x.id}: ${x.name ? `${x.name}: ` : ''}${oneLine(x.text)}`, status: `ASSUMED ${date}`, notes: `${SECTION_INFO[s].title}; ${x.source}; approved with the scope but not yet confirmed by the client` });
  }
  return rows;
}

/**
 * The rows a change request adds to an existing toolkit project's Decisions table (the toolkit's Stage 0b,
 * skills/existing-app-change.md: what to work on, the input documents, what else it touches): the request
 * itself, as the brief its owner approved, and one ASSUMED row per item still Assumed. Appended only: the
 * project's own rows, its stage and its intake answers stay as they are.
 */
function changeRequestRows(pb: PlanBrief, date: string, assumed: { s: SectionId; x: BriefItem }[], goal: BriefItem[]): BriefDecisionRow[] {
  const { by, at } = pb.approved!;
  const when = at.slice(11, 16);
  const what = goal.length ? oneLine(goal.map((g) => g.text).join(' ')) : pb.brief.title || 'see docs/project-brief.md';
  const docs = pb.attachments.length ? `input documents ${pb.attachments.map((a) => a.name).join(', ')} (in sources/)` : 'no input documents (the description only)';
  const rows: BriefDecisionRow[] = [
    {
      stage: '0b',
      decision: `Change request: ${bare(what)} (docs/project-brief.md)`,
      status: `CONFIRMED ${date}`,
      notes: `Raised and approved by ${by} in the agent-office new-project wizard${when ? ` at ${when}` : ''}; ${docs}${assumed.length ? `; ${assumed.length} item${assumed.length === 1 ? '' : 's'} still Assumed, recorded as ASSUMED rows below` : ''}; what else it touches (from the app map) and what must stay as it is are still to be confirmed at Stage 0b`,
    },
  ];
  for (const { s, x } of assumed) rows.push({ stage: '0b', decision: `Change assumption ${x.id}: ${x.name ? `${x.name}: ` : ''}${oneLine(x.text)}`, status: `ASSUMED ${date}`, notes: `${SECTION_INFO[s].title}; ${x.source}; approved with the change request but not yet confirmed` });
  return rows;
}

/** The "## Assumptions (ASSUMED, unresolved)" lines of PROJECT.md: each item still Assumed at the approval, as its Decisions row says. */
export function briefAssumptions(pb: PlanBrief, opts: { change?: boolean } = {}): string[] {
  if (!pb.approved) return [];
  const [label, stage] = opts.change ? ['Change assumption', '0b'] : ['Brief assumption', '0'];
  return SECTION_IDS.flatMap((s) => pb.brief.sections[s].filter((x) => x.tag === 'assumed').map((x) => `- ${label} ${x.id}: ${x.name ? `${x.name}: ` : ''}${bare(x.text)} (${SECTION_INFO[s].title}; ${x.source}). Recorded as an ASSUMED Stage ${stage} row; confirm it with the client.`));
}

export interface BriefQuestionRow {
  question: string;
  raised: string;
  status: string;
}

/** The "## Open questions" rows of PROJECT.md: the brief's open questions and every other item still Unverified, still to ask (OPEN), with where each came from. */
export function briefOpenQuestions(pb: PlanBrief, opts: { change?: boolean } = {}): BriefQuestionRow[] {
  if (!pb.approved) return [];
  const raised = (id: string) => (opts.change ? `Stage 0b: change request ${id} (docs/project-brief.md)` : `Stage 0: project brief ${id} (docs/project-brief.md)`);
  const questions = pb.brief.sections.questions.map((q) => {
    const from = /^open question \((.+)\)$/i.exec(q.source)?.[1];
    return { question: `${oneLine(q.text)}${from ? ` (${from})` : ''}`, raised: raised(q.id), status: 'OPEN' };
  });
  const others = unverifiedElsewhere(pb).map(({ s, x }) => ({ question: `${x.name ? `${x.name}: ` : ''}${oneLine(x.text)} (${SECTION_INFO[s].title}; ${x.source})`, raised: raised(x.id), status: 'OPEN' }));
  return [...questions, ...others];
}

const tagCell = (it: BriefItem) => `${TAG_WORD[it.tag]} · ${src(it)}`;

/** docs/project-brief.md: the approved brief and its functional domains, committed with the project. */
export function briefMarkdown(pb: PlanBrief, meta: { repo: string; entry: string; change?: boolean; source?: { name: string; files: number; bytes: number } }): string {
  const b = pb.brief;
  const s = b.sections;
  const out: string[] = [`# Project brief: ${b.title || meta.repo}`, ''];
  out.push(`${b.description ? `${b.description}\n\n` : ''}Drafted ${pb.manual ? 'by hand' : 'with the Chief Analyst'} in the agent-office new-project wizard for \`${meta.repo}\` (entry mode: ${meta.entry}).`);
  if (pb.approved && meta.change) out.push('', `**✋ Stage 0b change request approved** by ${pb.approved.by} on ${pb.approved.at.slice(0, 16).replace('T', ' ')}: recorded as Stage 0b rows appended to PROJECT.md; intake.md and the project's earlier decisions stay as they are.`);
  else if (pb.approved) out.push('', `**✋ Stage 0 scope approved** by ${pb.approved.by} on ${pb.approved.at.slice(0, 16).replace('T', ' ')}${pb.approved.assumed ? `, with ${pb.approved.assumed} item${pb.approved.assumed === 1 ? '' : 's'} still **ASSUMED** (recorded as ASSUMED in PROJECT.md)` : ''}.`);
  out.push('', 'Every item says how it is known: **Answered** (given or confirmed), **ASSUMED** (inferred, to be confirmed with the client) or **Unverified** (an open question), and where it came from.');
  const list = (items: BriefItem[]) => items.map((it) => `- ${it.text} _(${tagCell(it)})_`);
  out.push('', '## Goal', '', ...list(s.goal), '', '## Success criteria', '', ...list(s.success), '', '## User roles', '');
  for (const r of s.roles) out.push(`- **${r.name}**: ${r.text}${r.when ? `\n  _${r.when}_${whenDrafted(r) ? ` (${DRAFTED})` : ''}` : ''} _(${tagCell(r)})_`);
  out.push('', '## Scope', '', '**In scope**', '', ...list(s.scope.filter((x) => x.side !== 'out')), '', '**Out of scope**', '', ...list(s.scope.filter((x) => x.side === 'out')));
  out.push('', '## Constraints', '', ...list(s.constraints), '', '## Open questions', '', ...list(s.questions));
  if (pb.domains?.domains.length) {
    out.push('', '## Functional domains', '', 'Drafted after the approval, as the starting point for the BRDs (Stage 2) and the build plan (Stage 4). Each story is **ASSUMED** until the client confirms it.');
    for (const d of pb.domains.domains) {
      out.push('', `### ${d.code}: ${d.name}`, '', `${d.description}${d.roles.length ? ` Roles: ${d.roles.join(', ')}.` : ''}`, '');
      for (const st of d.stories) out.push(`- **${st.id} ${st.title}**: ${st.text} (${st.ac} acceptance criteria drafted)`);
    }
    if (pb.domains.tier) out.push('', `Suggested size tier: **${pb.domains.tier}**${pb.domains.tierWhy ? ` (${bare(pb.domains.tierWhy)})` : ''}.`);
  }
  if (meta.source) out.push('', '## Legacy source (confidential)', '', `The legacy app's source folder **${meta.source.name}** (${meta.source.files} files, ${bytesText(meta.source.bytes)}) is copied into \`${legacyRel(meta.source.name)}/\`, git-ignored: it stays on the office's machine and is never committed, pushed or uploaded. Dependencies, build output and secrets-like files were left out. Quote it in analysis only as far as the client allows.`);
  if (pb.attachments.length) {
    out.push('', '## Input documents', '', 'Copied into `sources/` (the toolkit’s drop folder, git-ignored by default).', '');
    for (const a of pb.attachments) out.push(`- ${a.name}: ${READ_LABEL[a.read]}${a.note ? ` (${a.note})` : ''}`);
  }
  return `${out.join('\n')}\n`;
}

/** The brief's part of the Discovery issue: what was approved, what's still assumed, the domains, and what Stage 0 still needs. */
/** The project's input documents folder on the office's machine, with forward slashes (what an agent in Git Bash types). */
export const sourcesDirOf = (floorDir: string) => `${floorDir.replace(/\\/g, '/').replace(/\/+$/, '')}/sources`;

/**
 * Where the input documents are and how to inventory them, for whoever does the analysis: `sources/` is
 * git-ignored (client documents stay on the office's machine), so a worktree doesn't have it, and the
 * toolkit's source ledger fails while the files there have no inventory.
 */
export function sourcesLines(sourcesDir: string, toolkitDir?: string): string[] {
  const bin = toolkitDir ? `${toolkitDir.replace(/\\/g, '/').replace(/\/+$/, '')}/bin/source-sufficiency.sh` : 'bin/source-sufficiency.sh';
  return [
    `- The input documents are in \`${sourcesDir}\`: the project's \`sources/\` folder, git-ignored, so only in the main checkout and never in your worktree. Read them from that path, and never copy them into the repository.`,
    `- Before the triage, inventory them: \`${bin} init . --sources ${sourcesDir}\` from your working folder writes \`analysis/source-sufficiency.json\` (one row per file); fill each row as you read the file, then run \`report\` and commit the rubric. Without it the gates' source ledger fails.`,
  ];
}

/** `sourcesDir`: the floor's sources/ on the office's machine, said in full (sourcesLines). */
export function briefForDiscovery(pb: PlanBrief, where: { sourcesDir?: string; toolkitDir?: string } = {}): string[] {
  const b = pb.brief;
  const s = b.sections;
  const assumed = SECTION_IDS.flatMap((id) => s[id].filter((x) => x.tag === 'assumed'));
  const out = [
    '',
    '## The project brief (approved in the wizard)',
    `The client${pb.approved ? ` (${pb.approved.by})` : ''} drafted and approved a project brief with the office before this project was created: **\`docs/project-brief.md\`** has it in full, with every item tagged Answered, ASSUMED or Unverified and where it came from.`,
    `- **Goal:** ${s.goal.map((g) => oneLine(g.text)).join(' ') || '(none written)'}`,
    `- **User roles:** ${s.roles.map((r) => `${r.name}${r.tag === 'assumed' ? ' (ASSUMED)' : ''}`).join(', ') || '(none written)'}`,
    `- **In scope:** ${joined(s.scope.filter((x) => x.side !== 'out')) || '(none written)'}`,
    `- **Out of scope:** ${joined(s.scope.filter((x) => x.side === 'out')) || '(none written)'}`,
  ];
  if (assumed.length) out.push(`- **Still ASSUMED (confirm these with the client first):** ${assumed.map((x) => `${x.name ? `${x.name}: ` : ''}${bare(x.text)}`).join('; ')}`);
  if (s.questions.length) out.push(`- **Open questions (Unverified):** ${joined(s.questions)}`);
  if (pb.domains?.domains.length) {
    out.push('', '### Functional domains', 'Start the BRDs (Stage 2) and the build plan (Stage 4) from these; every story is ASSUMED until the client confirms it.');
    for (const d of pb.domains.domains) out.push(`- **${d.code} ${d.name}** (${d.roles.join(', ')}): ${d.stories.map((st) => `${st.id} ${st.title}`).join('; ')}`);
  }
  out.push(
    '',
    '### Stage 0',
    '`PROJECT.md` already has the scope approval as a Stage 0 `CONFIRMED` row and every assumption as an `ASSUMED` row. The Stage 0 gate still needs `triage.md`: build its capability map from the brief and the domains, reflect the scope back to the client (don’t start the brainstorm from nothing), confirm or correct the ASSUMED items, and record the `## Sign-off` only when the client says so.',
  );
  if (pb.attachments.length) {
    out.push(`The attached documents are in \`${where.sourcesDir ?? 'sources/'}\`: ${pb.attachments.map((a) => `${a.name} (${READ_LABEL[a.read]})`).join(', ')}. Read every one yourself; the brief may have missed things.`);
    if (where.sourcesDir) out.push(...sourcesLines(where.sourcesDir, where.toolkitDir));
  }
  return out;
}

/** The brief as plain text for a prompt: every item with its id, tag and source. */
export function briefAsText(b: Brief): string {
  return JSON.stringify({ title: b.title, description: b.description, sections: Object.fromEntries(SECTION_IDS.map((s) => [s, b.sections[s].map((x) => ({ id: x.id, ...(x.name ? { name: x.name, when: x.when, whenSource: whenDrafted(x) ? 'drafted' : x.whenSource && x.whenSource !== DRAFTED ? x.whenSource : sourceText(x) } : {}), ...(x.side ? { side: x.side } : {}), text: x.text, tag: x.tag, source: sourceText(x) }))])) });
}
