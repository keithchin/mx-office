// Asks in a reply's list (live, 18 Oct 2026): asked for a status update, a lead answered in chat "Only items 1
// to 3 need your hands. Items 4 and 5 can be skipped for now. 1. Merge PR #10 … 2. Deploy and walk row 32 …
// 3. …", and nothing reached Needs you: Jeff's chat ask (jeff-ask.ts) wants one sentence asking the Project
// Manager something, needs the judge to agree, and files one ask per turn at most. Here, deterministically,
// with no model: a list in an agent's turn-ending reply that the agent itself marks as the Project Manager's
// to do ("need your hands", "needs you", "for you to do", "your action", "you need to", "only you can"), or
// list items addressed to them ("Tell me once …", "Get someone to …"), becomes one escalation per item:
//   - its title the item's words, its details the agent's own words, `from: reply-ask` with the message it
//     came from (the team chat's message, when the reply went to the phone);
//   - folded by the escalation-fold rules (ESC id, decision id, the same denied command), into an open
//     escalation of the same agent about the same, and never filed twice for the same item (24 hours);
//   - items the agent says can be skipped (or FYI, no action needed) are not filed: they are named in the
//     filed ones' details, and counted nowhere;
//   - negated lead-ins ("nothing here needs you"), conditionals, the future, and relays of someone else's
//     ask (unless a question) are not asks;
//   - deploying, cloud settings and credentials are needs-human and outside the office: no automatic action.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { Escalation, EscalationAsk } from '../../shared/roster/escalation.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { isHandsOn } from '../../shared/roster/hands-on.js';
import { audit, office } from '../audit/index.js';
import { CHAT_PREFIX, CONDITIONAL, FUTURE, NEGATED, RELAYED, sameAsk } from './jeff-ask.js';
import { foldOfficeAsk } from './escalation-fold.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** The same item from the same agent's replies isn't filed again within this. */
export const REPLY_ASK_DEDUPE_MS = 24 * 3_600_000;
/** Items filed from one reply at most. */
export const REPLY_ASKS_MAX = 8;
/** The agent's own escalation raised this recently is the one its reply's items came with: they show as one card (real-build fix). */
export const REPLY_GROUP_MS = 15 * 60_000;

/** Words that put a list on the Project Manager. Checked per sentence, the clause before them not negated. */
const PM_NEED = new RegExp(
  [
    String.raw`\bneeds? (your hands|you|a person|a human|the PM|the Project Manager)\b`,
    String.raw`\bneed(ed|s)? from you\b`,
    String.raw`\bfor you to (do|handle|action|pick up)\b`,
    String.raw`\byour (actions?|to-?dos?|hands)\b`,
    String.raw`\byou (need|have) to\b`,
    String.raw`\bonly you can\b`,
    String.raw`\b(waiting|blocked) on you\b`,
    String.raw`\b(things|items|steps) for you\b`,
    String.raw`\bI need you to\b`,
  ].join('|'),
  'i',
);
/** Words that say an item (or the items a sentence names) can wait: not filed. */
const SKIP = /\bcan be skipped\b|\bskip (this|these|them|it|for now)\b|\bcan (wait|be left)\b|\bno action (is )?needed\b|\bnothing (for you )?to do\b|\bno need\b|\bFYI\b|\bfor (your )?information( only)?\b|\boptional\b|\bnot (urgent|needed|blocking)\b/i;
/** An item that addresses the Project Manager in its own words. */
const ADDRESSED = /^\W*(please\b|tell me\b|let me know\b|get someone to\b|ask someone to\b|you need to\b|you have to\b|only you can\b|I need you to\b)|\bfor you to\b/i;
/** Deploying, cloud settings and credentials: needs a person, outside the office. */
const OUTSIDE = /\bdeploy(s|ed|ing|ment)?\b|\brelease to (prod|production|the cloud|acceptance)\b|\bcloud (portal|settings?|environment|node|app)\b|\b(Mendix|developer|cloud) portal\b|\benvironment (variable|setting|constant)s?\b|\b(constant|variable|setting)s?\b[^.\n]{0,40}\benvironment\b|\benvironment\b[^.\n]{0,40}\b(constant|variable|setting)s?\b|\bcredentials?\b|\bpasswords?\b|\btokens?\b|\bsecrets?\b|\bapi[ -]?keys?\b|\blicen[cs]e keys?\b|\b(sign|log)(\s|-)?in\b|\bDNS\b|\bfirewall\b|\bSSO\b/i;
/** "items 1 to 3", "items 4 and 5", "item 2" (never a bare #10: that is a PR or an issue). */
const NUMS = /\b(?:items?|points?|steps?|numbers?)\s*#?(\d{1,2}(?:\s*(?:-|–|to|through|and|or|,|&)\s*#?\d{1,2})*)\b/gi;

/** One listed item the agent marks as the Project Manager's. */
export interface ReplyAskItem {
  /** The list number, when it's a numbered list. */
  n?: number;
  /** One line for the escalation's title. */
  title: string;
  /** Its bold lead, when it starts with one: what an earlier escalation of the same is likely titled. */
  head?: string;
  /** The agent's own words for it. */
  words: string;
  /** Deploying, cloud settings or credentials: needs a person, outside the office. */
  outside: boolean;
  /** A hands-on action only a person can do (or outside): needs-human rather than a question. */
  handsOn: boolean;
}

export interface ReplyAsks {
  asks: ReplyAskItem[];
  /** Items the agent said can be skipped (or FYI): not filed. */
  skipped: string[];
}

interface Item {
  n?: number;
  text: string;
}

interface Block {
  items: Item[];
  numbered: boolean;
  /** The lines before it, back to the previous list. */
  lead: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const LIST = /^\s{0,6}(?:(\d{1,2})[.)]|[-*•+])\s+(.*\S)\s*$/;

/** A numbered list run into one line ("… need your hands. 1. Merge PR #10 … 2. Deploy …"): its lead and one line per item, numbered 1, 2, … in order. */
function inlineList(line: string): string[] {
  if (LIST.test(line) || !/(?:^|\s)1[.)]\s+\S.*\s2[.)]\s+\S/.test(line)) return [line];
  const marks = [...line.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g)];
  const seq: RegExpExecArray[] = [];
  for (const m of marks) if (Number(m[1]) === seq.length + 1) seq.push(m as RegExpExecArray);
  if (seq.length < 2) return [line];
  const out = [line.slice(0, seq[0].index).trim()];
  seq.forEach((m, i) => out.push(line.slice(m.index, i + 1 < seq.length ? seq[i + 1].index : undefined).trim()));
  return out.filter(Boolean);
}

/** The reply's lists and what's said before each; code and quotes out of the way. */
function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/```[\s\S]*?(```|$)/g, '\n').split('\n').flatMap(inlineList);
  const out: Block[] = [];
  let lead: string[] = [];
  let cur: Block | undefined;
  let blank = false;
  for (const raw of lines) {
    if (/^\s*>/.test(raw)) {
      cur = undefined;
      continue;
    }
    const m = LIST.exec(raw);
    if (m) {
      const numbered = m[1] !== undefined;
      if (!cur || cur.numbered !== numbered) {
        cur = { items: [], numbered, lead };
        out.push(cur);
        lead = [];
      }
      cur.items.push({ ...(numbered ? { n: Number(m[1]) } : {}), text: m[2] });
      blank = false;
      continue;
    }
    if (!raw.trim()) {
      blank = true;
      continue;
    }
    // An indented line goes on with the item above it; anything else ends the list.
    if (cur && /^\s{2,}\S/.test(raw) && !blank) {
      const last = cur.items[cur.items.length - 1];
      last.text = `${last.text} ${raw.trim()}`;
      continue;
    }
    cur = undefined;
    blank = false;
    lead.push(raw.trim());
  }
  // Only the last few lines before a list lead into it.
  for (const b of out) b.lead = b.lead.slice(-4);
  return out;
}

const plainWords = (s: string) => s.replace(/`([^`\n]*)`/g, '$1').replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '').replace(/\s+/g, ' ').trim();

function sentencesOf(lines: readonly string[]): string[] {
  return plainWords(lines.join('\n'))
    .split(/(?<=[.?!:])\s+(?=[A-Z0-9#(])/)
    .map((s) => s.replace(/^[\s#>-]+/, '').trim())
    .filter(Boolean);
}

/** The list numbers a sentence names. */
function numsOf(s: string): number[] {
  const out = new Set<number>();
  for (const m of s.matchAll(NUMS)) {
    const spec = m[1].replace(/#/g, '');
    for (const part of spec.split(/\s*(?:,|&|\band\b|\bor\b)\s*/)) {
      const r = /^(\d+)\s*(?:-|–|to|through)\s*(\d+)$/.exec(part.trim());
      if (r) {
        const [a, b] = [Number(r[1]), Number(r[2])];
        for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 20; i++) out.add(i);
      } else if (/^\d+$/.test(part.trim())) out.add(Number(part.trim()));
    }
  }
  return [...out];
}

/** pm: the list is the Project Manager's; skip: it can wait; hold: only if or when something else happens (nothing is). */
type Say = 'pm' | 'skip' | 'hold' | undefined;

/** What a sentence says about the list: it's the Project Manager's, it can wait, or nothing. */
function sayOf(s: string): Say {
  const need = PM_NEED.exec(s);
  if (CONDITIONAL.test(s) || FUTURE.test(s)) return need || /you/i.test(s) ? 'hold' : undefined;
  if (need) {
    if (NEGATED.test(s.slice(0, need.index)) || /\b(don't|do not|doesn't|does not|won't) need\b/i.test(s.slice(0, need.index + need[0].length))) return 'skip';
    return 'pm';
  }
  return SKIP.test(s) ? 'skip' : undefined;
}

/** An item's bold lead ("**Merge PR #10** (…) and close PR #11" → "Merge PR #10"), if it starts with one. */
function headOf(text: string): string | undefined {
  const bold = /^\s*\*\*([^*]{2,120})\*\*/.exec(text);
  return bold ? plainWords(bold[1]).replace(/[:.]$/, '') : undefined;
}

/** The title for an item: its bold lead (with what follows it, briefly), else its first sentence. */
function titleOf(text: string): string {
  const bold = /^\s*\*\*([^*]{2,120})\*\*\s*([:.,—–-]*)\s*(.*)$/.exec(text);
  if (bold) {
    const head = plainWords(bold[1]).replace(/[:.]$/, '');
    const rest = plainWords(bold[3])
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^[\s,;:—–-]+/, '')
      .split(/(?<=[.?!;])\s|\s[—–]\s/)[0]
      ?.replace(/[.;]$/, '')
      .trim();
    if (!rest || head.length + rest.length >= 110) return clip(head, 140);
    // "… and close PR #11" goes on the same line; anything else after a colon.
    return clip(!bold[2] && /^(and|or|then|to|plus|with)\b/.test(rest) ? `${head} ${rest}` : `${head}: ${rest}`, 140);
  }
  const first = plainWords(text).split(/(?<=[.?!;])\s|\s[—–]\s/)[0].replace(/[.;]$/, '');
  return clip(first, 140);
}

/**
 * The items an agent's reply marks as the Project Manager's to do, and those it says can be skipped.
 * Pure and conservative: a list counts only when the words before it (or a sentence naming its numbers)
 * put it on the Project Manager, or an item addresses them itself.
 */
export function replyAsks(text: string): ReplyAsks {
  const blocks = blocksOf(text);
  if (!blocks.length) return { asks: [], skipped: [] };
  // Sentences anywhere outside the lists that name item numbers: "items 1 to 3 need your hands", "items 4 and 5 can be skipped".
  const need = new Set<number>();
  const skip = new Set<number>();
  const outside = blocks.flatMap((b) => b.lead);
  for (const s of sentencesOf(outside)) {
    const ns = numsOf(s);
    if (!ns.length) continue;
    const say = sayOf(s);
    for (const n of ns) {
      if (say === 'pm') need.add(n);
      else if (say === 'skip') skip.add(n);
    }
  }
  const asks: ReplyAskItem[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    // The last thing the lead-in says without naming numbers decides the whole list.
    let lead: Say;
    for (const s of sentencesOf(b.lead)) {
      const say = sayOf(s);
      if (say && !numsOf(s).length) lead = say;
      else if (say === 'pm' && numsOf(s).length) lead = lead ?? 'pm';
    }
    const named = b.numbered && b.items.some((i) => i.n !== undefined && (need.has(i.n) || skip.has(i.n)));
    for (const it of b.items) {
      const words = plainWords(it.text);
      if (!words) continue;
      const question = /\?\s*$/.test(words);
      let mine: boolean;
      if (named && it.n !== undefined && (need.has(it.n) || skip.has(it.n))) mine = need.has(it.n) && !skip.has(it.n);
      else if (named && need.size) mine = false;
      else mine = lead === 'pm' || (lead !== 'hold' && ADDRESSED.test(words));
      const says = SKIP.test(words) || (lead === 'skip' && !ADDRESSED.test(words)) || (it.n !== undefined && skip.has(it.n) && !need.has(it.n));
      if (!mine) {
        if (says && (lead || named)) skipped.push(clip(titleOf(it.text), 140));
        continue;
      }
      if (SKIP.test(words)) {
        skipped.push(clip(titleOf(it.text), 140));
        continue;
      }
      // Someone else's ask passed on has its own escalation; a question still counts.
      if (RELAYED.test(words) && !question) continue;
      if (/^\W*(no|none|nothing)\b/i.test(words)) continue;
      const title = titleOf(it.text);
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      const out = OUTSIDE.test(words);
      const head = headOf(it.text);
      asks.push({ ...(it.n !== undefined ? { n: it.n } : {}), title, ...(head && head !== title ? { head } : {}), words: clip(it.text.trim(), 1200), outside: out, handsOn: out || isHandsOn(words) });
    }
  }
  return { asks: asks.slice(0, REPLY_ASKS_MAX), skipped };
}

// ---- Filing them ----------------------------------------------------------------------------------------

/** Where the reply was read: the team chat's message (a reply to the person on the phone), else the agent's terminal. */
export interface ReplySource {
  message?: string;
  thread?: string;
}

/** The key an item is filed under: the agent (its role, else the worker) and the item's words. */
export const replyAskKey = (who: string, title: string) => `reply:${who}:${title.toLowerCase().replace(/\s+/g, ' ').trim()}`.slice(0, 300);

const OUTSIDE_NOTE = 'Needs a person, outside the office: deploying, cloud settings and credentials are never done by the office or its agents on their own. Do it yourself (or get someone to), then answer here.';

function sourceLine(src: ReplySource): string {
  return src.message ? `In the team chat: message ${src.message}${src.thread ? ` (thread ${src.thread})` : ''}.` : 'In its terminal: its last message.';
}

/** The escalation for one item. */
export function replyAskEscalation(by: string, item: ReplyAskItem, skipped: readonly string[], src: ReplySource): EscalationAsk {
  const details = [
    `${by} listed this as needing you in its reply and didn't escalate it, so the office filed it from the reply. Answer here and it goes to ${by} as its next prompt.`,
    ...(item.outside ? ['', OUTSIDE_NOTE] : []),
    '',
    `${by}'s words:`,
    '',
    item.words,
    ...(skipped.length ? ['', `In the same reply, ${by} said these can be skipped for now (not filed): ${skipped.join('; ')}.`] : []),
    '',
    sourceLine(src),
  ].join('\n');
  return { urgency: 'important', trigger: item.handsOn ? 'needs-human' : 'question', title: item.title, details, options: [] };
}

/** An open escalation of the same agent about the same, or this item filed from a reply already (open, or within a day). */
function alreadyThere(all: readonly Escalation[], who: { workerId: string; role?: RoleId }, key: string, titles: readonly string[], now: number): Escalation | undefined {
  const since = now - REPLY_ASK_DEDUPE_MS;
  const same = all.find((e) => e.from?.kind === 'reply-ask' && e.from.key === key && (e.status === 'open' || (e.resolution?.at ?? e.at) >= since));
  if (same) return same;
  const mine = (e: Escalation) => e.workerId === who.workerId || (!!who.role && e.role === who.role) || !!e.also?.some((a) => a.workerId === who.workerId);
  return all.find((e) => e.status === 'open' && mine(e) && titles.some((t) => sameAsk(e.title.replace(CHAT_PREFIX, ''), t)));
}

export interface Filed {
  raised: Escalation[];
  /** Items folded into, or already, an escalation. */
  kept: number;
  skipped: string[];
}

/**
 * An agent's turn-ending reply: each item it marks as the Project Manager's is filed (or folded into the
 * one it repeats). Called at the turn's end with its last words, and again when the phone posts the reply
 * in the team chat, which adds the message to what was filed (nothing is filed twice).
 */
export function fileReplyAsks(roster: Roster, floor: TeamFloor, w: Pick<WorkerInfo, 'id' | 'name' | 'kind'>, text: string, src: ReplySource = {}): Filed {
  const found = replyAsks(text);
  const out: Filed = { raised: [], kept: 0, skipped: found.skipped };
  if (w.kind !== 'agent' || !found.asks.length) return out;
  const role = roster.roleOf(floor, w.id);
  const who = { workerId: w.id, by: w.name, ...(role ? { role } : {}) };
  const now = roster.deps.now();
  let changed = false;
  // One reply, one card in Needs you: its items share a group, and so does the agent's own escalation raised in the same
  // turn (the real-build test's test-database blocker showed as an action plus four cards harvested from one reply).
  const own = roster
    .data(floor.id)
    .escalations.filter((x) => x.status === 'open' && x.workerId === w.id && x.from?.kind !== 'reply-ask' && now - x.at <= REPLY_GROUP_MS)
    .sort((a, b) => b.at - a.at)[0];
  const group = own?.group ?? `reply:${w.id}:${now}`;
  for (const item of found.asks) {
    const all = roster.data(floor.id).escalations;
    const key = replyAskKey(role ?? w.id, item.title);
    const ask = replyAskEscalation(w.name, item, found.skipped, src);
    const there = alreadyThere(all, who, key, [item.title, ...(item.head ? [item.head] : [])], now);
    if (there) {
      out.kept++;
      // The phone's message, once known, goes on what was filed from the same reply.
      if (src.message && there.from?.kind === 'reply-ask' && !there.from.message) {
        there.from = { ...there.from, message: src.message, ...(src.thread ? { thread: src.thread } : {}) };
        there.details = there.details.replace(/\nIn its terminal: its last message\.$/, `\n${sourceLine(src)}`);
        changed = true;
      } else if (there.from?.kind !== 'reply-ask' && !there.foldedKeys?.includes(key)) {
        there.foldedKeys = [...(there.foldedKeys ?? []), key].slice(-50);
        audit.record({ floor: floor.id, actor: office(), action: 'escalation.folded', target: { kind: 'escalation', id: there.id, label: there.title }, summary: `Not filed again for ${w.name}: its reply lists it, open as ESC-${there.id}: ${item.title}`, details: { why: 'same-ask', key }, severity: 'info' });
        changed = true;
      }
      continue;
    }
    // ESC-<id>, a decision id, the same denied command: into the one it names (escalation-fold.ts).
    if (foldOfficeAsk(roster, floor, who, ask, key)) {
      out.kept++;
      continue;
    }
    const e = roster.escalations.raiseFor(floor, who, ask, `📌 ${w.name}'s reply lists this as needing you: ${item.title}`);
    e.from = { kind: 'reply-ask', key, ...(src.message ? { message: src.message } : {}), ...(src.thread ? { thread: src.thread } : {}) };
    e.group = group;
    if (own && !own.group) own.group = group;
    out.raised.push(e);
    changed = true;
  }
  if (changed) roster.touch(floor);
  return out;
}

/** A turn just ended: its last words are read for a list it marks as the Project Manager's. Never throws. */
export function onReplyTurnEnd(roster: Roster, floor: TeamFloor, w: WorkerInfo): void {
  if (w.kind !== 'agent') return;
  try {
    const text = floor.lastWords?.(w);
    if (text?.trim()) fileReplyAsks(roster, floor, w, text);
  } catch (err) {
    console.error(`agent-office: reply asks on ${floor.id}: ${(err as Error)?.message ?? err}`);
  }
}
