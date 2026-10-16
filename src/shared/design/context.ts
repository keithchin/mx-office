// What an agent gets of a bound design system (brief §8, §8A): one pointer line next to its `Task: tsk_…` line
// (at most 300 characters, never content), and a small guidance file by path, generated deterministically
// from the package digest and the task's patterns. Full details are retrieved by path, never injected.
// Plus the package summary and the task kind the ledger books (design, design-correction, other). Pure.

import { patternById, patternMarkdown, PATTERNS } from './patterns.js';
import { BRANDED_SCOPE, PRESET, type PackageManifest, type PatternSelection, type ProjectDesignBinding } from './types.js';

export const DESIGN_LINE_MAX = 300;
/** The bounded-correction policy (brief §8G): an instruction to agents (guidance and Playbooks), not counted or enforced by the office. */
export const CORRECTION_LIMIT = 2;

/** The pattern ids a task gets: those selected for its issue, else the project-wide ones; never another issue's or page's. */
export function patternsForTask(selections: readonly PatternSelection[], issue: number | undefined): string[] {
  const latest = new Map<string, PatternSelection>();
  for (const s of selections) latest.set(`${s.patternId}|${JSON.stringify(s.scope)}`, s);
  const all = [...latest.values()];
  const forIssue = issue === undefined ? [] : all.filter((s) => 'issue' in s.scope && s.scope.issue === issue);
  const chosen = forIssue.length ? forIssue : all.filter((s) => 'project' in s.scope);
  return [...new Set(chosen.map((s) => s.patternId))].filter((id) => !!patternById(id)).sort();
}

const clean = (s: string) => s.replace(/[\r\n`]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The line: `Design: Acme@v1 #3f2a91c (Branded Atlas, administration). Patterns: forms.validated. Read <path> first;
 * use the bound package and patterns, propose an exception instead of new variants.` The pattern list is cut first,
 * then the name; the path is never cut (a line that can't hold it says so without a path).
 */
export function designLine(b: Pick<ProjectDesignBinding, 'name' | 'n' | 'digest' | 'kind'>, patternIds: readonly string[], guidancePath: string): string {
  const what = b.kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults';
  const make = (name: string, pats: string) => `Design: ${name}@v${b.n} #${b.digest.slice(0, 7)} (${what}, ${PRESET}).${pats ? ` Patterns: ${pats}.` : ''} Read ${guidancePath} first; use the bound package and patterns, propose an exception instead of new variants.`;
  let name = clean(b.name).slice(0, 40) || 'design';
  let ids = [...patternIds];
  let line = make(name, ids.join(', '));
  while (line.length > DESIGN_LINE_MAX && ids.length) {
    ids = ids.slice(0, -1);
    line = make(name, ids.length ? `${ids.join(', ')} (+${patternIds.length - ids.length} in the file)` : `${patternIds.length} in the file`);
  }
  while (line.length > DESIGN_LINE_MAX && name.length > 1) {
    name = name.slice(0, Math.max(1, name.length - (line.length - DESIGN_LINE_MAX) - 1));
    line = make(`${name}…`, ids.length ? ids.join(', ') : patternIds.length ? `${patternIds.length} in the file` : '');
  }
  return line.length <= DESIGN_LINE_MAX ? line : `Design system bound: read ${guidancePath}`.slice(0, DESIGN_LINE_MAX);
}

const short = (b: Pick<ProjectDesignBinding, 'name' | 'n' | 'digest'>) => `${clean(b.name).slice(0, 40) || 'design'}@v${b.n} #${b.digest.slice(0, 7)}`;

/** A bound project whose guidance file couldn't be prepared before the task went: said so, with no path (none was supplied). */
export function unavailableLine(b: Pick<ProjectDesignBinding, 'name' | 'n' | 'digest' | 'kind'>): string {
  return `Design: ${short(b)} (${b.kind === 'branded' ? 'Branded Atlas' : 'Atlas defaults'}) is bound, but its guidance file couldn't be prepared for this task: use stock Atlas classes and the applied theme, and escalate design questions instead of inventing variants.`.slice(0, DESIGN_LINE_MAX);
}

/** A version committed on its own branch and not merged yet: the agent's revision doesn't have it. */
export function candidateLine(c: Pick<ProjectDesignBinding, 'name' | 'n' | 'digest'>, branch: string): string {
  return `Design: ${short(c)} is only a candidate, on the branch ${branch.slice(0, 80)}, not merged: your revision keeps the app's current styling; don't apply its tokens by hand.`.slice(0, DESIGN_LINE_MAX);
}

/** The per-task guidance file: the binding, the rules, and the selected patterns in full (the rest by path). */
export function guidanceText(b: ProjectDesignBinding, packageDir: string, patternIds: readonly string[]): string {
  const dir = packageDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const chosen = patternIds.map((id) => patternById(id)).filter((p): p is NonNullable<typeof p> => !!p);
  return [
    `# Design guidance: ${clean(b.name)} v${b.n}`,
    '',
    `Package \`${b.systemId}\` v${b.n}, digest \`${b.digest}\`, preset ${b.preset}, ${b.kind === 'branded' ? `Branded Atlas (theme \`${b.themeName ?? '?'}\`, applied by the office with mxcli theme)` : 'Atlas defaults (no theme change)'}.`,
    `Full package: \`${dir}/\` (summary.md, tokens.css, patterns/*.md). Read a file there only when you need it.`,
    '',
    '## Rules',
    '- Use the bound package and these patterns. Do not invent new component variants, colours or spacing.',
    `- The theme is already applied${b.applied?.branch ? ` (merged into the default branch from \`${b.applied.branch}\`; on an older branch, merge the default branch in first)` : ''}: do NOT map tokens to Atlas variables by hand and skip the toolkit design-artifacts token→Atlas mapping step; do not edit the \`mxcli:theme\` fenced blocks in theme/web/*.scss.`,
    '- Use stock Atlas classes, button styles and design properties. A need the package does not cover is an exception: escalate it (`office-workers escalate`) with the page and the reason, instead of styling around it.',
    `- At most ${CORRECTION_LIMIT} automated design-correction attempts per unresolved issue; then summarise the evidence and escalate for a decision.`,
    '- A hidden button is not security: entity access and microflow checks still decide.',
    ...(b.exceptions.length ? ['', '## Approved exceptions', ...b.exceptions.map((e) => `- ${clean(e.scope)}: ${clean(e.reason)}`)] : []),
    '',
    chosen.length ? '## Patterns for this task' : '## Patterns',
    ...(chosen.length ? chosen.flatMap((p) => ['', patternMarkdown(p)]) : PATTERNS.map((p) => `- \`${p.id}@${p.version}\` ${p.title}: \`${dir}/patterns/${p.id}.md\``)),
    '',
  ].join('\n');
}

/** summary.md in the package (a few hundred tokens: what it is, what it covers, where the rest is). */
export function summaryMarkdown(m: Pick<PackageManifest, 'name' | 'version' | 'kind' | 'digest' | 'compat' | 'gaps' | 'themeName'>): string {
  return [
    `# ${clean(m.name)} v${m.version}`,
    '',
    m.kind === 'branded' ? `Branded Atlas: the client's colours, type, density and shape as all 40 \`--mxt-*\` tokens (tokens.css), applied with \`mxcli theme create/apply\` as theme \`${m.themeName}\`. ${BRANDED_SCOPE}` : 'Atlas defaults: Atlas as it ships, no theme change. The patterns below still apply.',
    '',
    `Compatibility: Studio Pro ${m.compat.studioPro}, ${m.compat.atlas}, mxcli ${m.compat.mxcli}. Preset: ${PRESET}.`,
    '',
    '## Patterns',
    ...PATTERNS.map((p) => `- \`${p.id}@${p.version}\`: ${p.title}. ${p.whenToUse}`),
    '',
    '## Gaps (not covered by this package)',
    ...m.gaps.map((g) => `- ${g}`),
    '',
  ].join('\n');
}

/** What tokens can't express (0a gaps), said in every Branded Atlas package. */
export const BRANDED_GAPS = [
  'No secondary/accent colour token: the 40-token vocabulary has one brand colour.',
  'Brand web fonts: the theme names the font, it vendors no font files. Without them the fallback stack renders.',
  'Logo, layouts and the navigation shell are not tokens.',
  'Component classes beyond Atlas (the toolkit StyleGallery’s ds.css kit) need a separate SCSS port.',
];

export type TaskKind = 'design' | 'design-correction' | 'other';

const LOOK = /\b(look|looks|style|styling|colou?rs?|spacing|padding|margin|font|typography|theme|design|align(ment)?|icon|css|brand(ing)?|visual|layout|responsive)\b/i;
const FIX = /\b(fix|fixes|re-?look|rework|polish|pass \d|second pass|re-?review|correct(ion)?|adjust|tweak|refine(ment)?)\b/i;
const DESIGN_ROLES = new Set(['lead-designer', 'Lead Designer', 'ui-ux-designer']);

/** The kind of a task, from what the office knows when it dispatches it: the role or subagent, and the task's own words. */
export function taskKindOf(text: string | undefined, role?: string, sub?: string): TaskKind {
  const head = (text ?? '').slice(0, 400);
  if (head && LOOK.test(head) && FIX.test(head)) return 'design-correction';
  if ((role && DESIGN_ROLES.has(role)) || (sub && DESIGN_ROLES.has(sub))) return 'design';
  return 'other';
}
