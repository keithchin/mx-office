// An escalation about a permission denial (project audit, 16 Oct 2026, finding 2): the agent's tool call
// was denied by Claude Code's permission layer (its mode or rules), so an Approve in the office changes
// nothing: the PM "approved" one scratch-copy `mxcli exec` five times while the terminal kept denying it.
// Such an escalation is a settings action: the exact command, the allow rule for exactly it, and the card
// stays open until a run of the command is seen. Read deterministically from its words (no model): a
// Claude Code permission signal (the permission layer / prompt / mode / rules, settings.local.json, an
// allow rule, "has been denied") together with a denial, and a quoted command next to the denial. An app's
// own permissions (a Mendix user role denied a page) name none of those, so they stay ordinary. Pure.

import type { Escalation, EscalationPermission } from './escalation.js';

/** Words that say Claude Code's permission layer, not an app's permissions. */
const LAYER = /\bpermission (?:layer|prompt|prompts|mode|dialog)\b|\bclaude code'?s?\b[^.\n]{0,40}\bpermission|\bsettings(?:\.local)?\.json\b|\ballow(?:ed)?[- ]?(?:rule|list)\b|\ballowlist\b|\bhas been denied\b|\bpermission to use\b|\btool (?:call|use) (?:was )?denied\b|\bBash\(/i;
/** A denial. */
const DENIED = /\b(?:denied|denies|deny|denial|refused|blocked|rejected)\b/gi;
/** A `Bash(<pattern>)` rule the agent named. */
const RULE = /\bBash\(([^()\n]{2,300})\)/;

/** Backtick spans with where they are. */
function spans(text: string): { at: number; end: number; s: string }[] {
  return [...text.matchAll(/`([^`\n]{2,400})`/g)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, s: m[1].trim() }));
}

/** Whether a quoted span reads as a shell command (a lower-case program or a path, then arguments) rather than a name or a rule. */
const isCommand = (s: string) => /^(?:[A-Z_]+=\S*\s+)*(?:\.{0,2}\/|~\/)?[a-z][\w./-]*\s+\S/.test(s);

/** The command closest to a denial: quoted right after it ("denied `x`", within 60 characters) or right before it ("`x` was denied", within 80). */
function deniedCommand(text: string): string | undefined {
  const qs = spans(text).filter((q) => isCommand(q.s));
  let best: { s: string; gap: number } | undefined;
  for (const m of text.matchAll(DENIED)) {
    const at = m.index!;
    const end = at + m[0].length;
    for (const q of qs) {
      const gap = q.at >= end ? q.at - end : q.end <= at ? at - q.end : -1;
      const near = q.at >= end ? gap <= 60 : gap >= 0 && gap <= 80;
      if (near && (!best || gap < best.gap)) best = { s: q.s, gap };
    }
  }
  return best?.s;
}

/** The denial an escalation's words describe: the command and the rule for exactly it, or undefined. */
export function permissionDenial(e: Pick<Escalation, 'title' | 'details'>): Pick<EscalationPermission, 'command' | 'rule' | 'suggested'> | undefined {
  const text = `${e.title}\n${e.details}`;
  if (!LAYER.test(text) || !new RegExp(DENIED.source, 'i').test(text)) return undefined;
  const command = deniedCommand(text);
  if (!command) return undefined;
  const suggested = RULE.exec(text)?.[0];
  return { command, rule: allowRule(command), ...(suggested && suggested !== allowRule(command) ? { suggested } : {}) };
}

/** The allow rule for exactly one command. */
export const allowRule = (command: string) => `Bash(${command.replace(/\s+/g, ' ').trim()})`;

/**
 * The command without what only sets it up: a leading `cd <dir> &&` (or `;`), spacing. Two denials of the
 * same core command (`cd /tmp/probe; mxcli exec …` and `cd /tmp/probe && mxcli exec …`) are one.
 */
export function coreCommand(command: string): string {
  return command
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:cd\s+\S+\s*(?:&&|;)\s*)+/i, '')
    .trim();
}

/** Whether two denied commands are the same one. */
export const sameDenied = (a: string, b: string) => coreCommand(a) === coreCommand(b);

/** Whether a command that ran is the denied one (its core, maybe after a `cd`, maybe with more after it). */
export function ranDenied(denied: string, ran: string): boolean {
  const d = coreCommand(denied);
  const r = coreCommand(ran);
  return !!d && (r === d || r.startsWith(`${d} `) || r.includes(d));
}

/** The card's two answers. */
export const permissionOptions = (who: string) => [`Allow this command for ${who} on this project`, 'Keep blocked'];
