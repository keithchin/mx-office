// One decision, one card (project audit, 16 Oct 2026, finding 3): CAC-3 was filed four times there (the
// agent's own escalation, then three times from its AWAITING-PM line naming "escalation fb67d63102"), and
// the scratch-copy exec five times. Before an escalation is filed, from an agent or by the office from an
// agent's words (an AWAITING-PM item, a chat line), it is folded into the one it names instead:
//   - a permission denial (shared/roster/permission-denial.ts) of the same command: into its open card, the
//     count going up; one the person kept blocked (within a day) is not asked again;
//   - an escalation it names by id (`ESC-<id>`, `escalation <id>`), following a closed duplicate to the one
//     it repeats;
//   - the same decision id (refs.decisionId: CAC-3, OI-2, a gate) as an open one, or one answered within a day.
// Into an open one it is linked (a +1 for an agent; for the office the item's key is kept on it, so a look
// doesn't fold it again, and the role hears the answer too). When the one it names is already answered, the
// agent is told "already answered as ESC-x rev n: <answer>" and nothing is raised. A title that starts
// "Follow-up to ESC-x" (or says re-open) is a new question and is raised. Deterministic: no model.

import type { WorkerInfo } from '../../shared/protocol.js';
import { VERDICT_WORD, fyiNow, type Escalation, type EscalationAsk } from '../../shared/roster/escalation.js';
import { permissionDenial, permissionOptions, ranDenied, sameDenied } from '../../shared/roster/permission-denial.js';
import { refsFromTitle } from '../../shared/decisions/ids.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { audit, office } from '../audit/index.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** How long an answered escalation stands for its decision id (or a kept-blocked command) before the same may be asked anew. */
export const FOLD_WINDOW_MS = 24 * 3_600_000;
/** Keys kept on one escalation at most. */
const MAX_KEYS = 50;

/** `ESC-3f9c2a1b7e`, `escalation 3f9c2a1b7e`: the office's escalation ids (ten hex digits). */
const ESC_REF = /(?:\bESC-|\bescalations?\s+)([0-9a-f]{10})\b/gi;
/** A title that says it is a new question about an answered one. */
const FOLLOW_UP = /^\W*follow[- ]?up\b|\bre-?open/i;

/** The escalation ids a text names. */
export const referencedIds = (text: string): string[] => [...new Set([...text.matchAll(ESC_REF)].map((m) => m[1].toLowerCase()))];

/** Answered by the person (not noted, not closed as a duplicate, not settled by the office). */
export const answeredByPerson = (e: Escalation) => e.status === 'resolved' && !!e.resolution && e.resolution.verdict !== 'dismiss' && e.resolution.outcome !== 'superseded';

/** One closed as a duplicate stands for the one it repeats. */
function current(all: readonly Escalation[], e: Escalation): Escalation {
  let x = e;
  for (let i = 0; i < 5 && x.status === 'resolved' && x.resolution?.supersededBy; i++) {
    const next = all.find((y) => y.id === x.resolution!.supersededBy);
    if (!next) break;
    x = next;
  }
  return x;
}

const decisionOf = (e: Pick<Escalation, 'refs' | 'title'>) => e.refs?.decisionId ?? refsFromTitle(e.title).decisionId;

export interface Fold {
  target: Escalation;
  why: 'permission' | 'reference' | 'decision';
  /** What it was matched on: the command, `ESC-<id>`, or the decision id. */
  on: string;
}

/**
 * The escalation an ask folds into, or undefined to raise it. Open ones before answered ones, newest first.
 * `canJoin`: whether an open one may take it (an agent's loud ask doesn't hide inside an FYI). `own`: the
 * agent's own escalation, which only a named id (ESC-<id>, and only when it offers no options of its own)
 * or a kept-blocked command holds back once answered: a decision id alone can be a new round of the same
 * checkpoint ("CAC-3 (architecture)" after "CAC-3 (requirements)" was answered), so it is raised.
 */
export function findFold(all: readonly Escalation[], ask: Pick<EscalationAsk, 'title' | 'details' | 'refs'> & { options?: readonly string[] }, now: number, o: { canJoin?: (e: Escalation) => boolean; own?: boolean } = {}): Fold | undefined {
  const canJoin = o.canJoin ?? (() => true);
  const recent = (e: Escalation) => (e.resolution?.at ?? e.at) >= now - FOLD_WINDOW_MS;
  const newest = (xs: Escalation[]) => [...xs].sort((a, b) => b.at - a.at)[0];
  const followUp = FOLLOW_UP.test(ask.title);
  const perm = permissionDenial(ask);
  if (perm) {
    const same = all.filter((e) => e.permission && sameDenied(e.permission.command, perm.command));
    const open = newest(same.filter((e) => e.status === 'open'));
    if (open) return { target: open, why: 'permission', on: perm.command };
    const kept = newest(same.filter((e) => e.permission?.kept && answeredByPerson(e) && recent(e)));
    if (kept && !followUp) return { target: kept, why: 'permission', on: perm.command };
  }
  for (const id of referencedIds(ask.title)) {
    const named = all.find((e) => e.id === id);
    if (!named) continue;
    const x = current(all, named);
    if (x.status === 'open' && canJoin(x)) return { target: x, why: 'reference', on: `ESC-${id}` };
    if (answeredByPerson(x) && !followUp && !(o.own && ask.options?.length)) return { target: x, why: 'reference', on: `ESC-${id}` };
  }
  const id = ask.refs?.decisionId ?? refsFromTitle(ask.title).decisionId;
  if (id) {
    const same = all.filter((e) => decisionOf(e) === id);
    const open = newest(same.filter((e) => e.status === 'open' && canJoin(e)));
    if (open) return { target: open, why: 'decision', on: id };
    const done = [...same.filter((e) => answeredByPerson(e) && recent(e))].sort((a, b) => (b.resolution?.at ?? 0) - (a.resolution?.at ?? 0))[0];
    if (done && !followUp && !o.own) return { target: done, why: 'decision', on: id };
  }
  return undefined;
}

/** "already answered as ESC-x rev n: APPROVED — Go with: A (Keith)". */
export function answeredLine(e: Escalation): string {
  const r = e.resolution!;
  if (e.permission?.kept) return `the Project Manager kept \`${e.permission.command}\` blocked (ESC-${e.id}, ${r.by}): don't run it, and don't route around the denial`;
  return `already answered as ESC-${e.id} rev ${r.answerRev ?? 1}: ${VERDICT_WORD[r.verdict]}${r.text ? ` — ${r.text.replace(/\s+/g, ' ').slice(0, 400)}` : ''} (${r.by})`;
}

/** What the agent is told when its ask was already answered: the answer, and how to raise a genuinely new question. */
export const answeredNote = (e: Escalation) =>
  `Not raised: ${answeredLine(e)}. Act on that answer${e.permission?.kept ? '' : ` and record it as \`Decided per ESC-${e.id} rev ${e.resolution!.answerRev ?? 1}: <the answer>\``}. If this is a genuinely new question about it, raise it with a title that starts "Follow-up to ESC-${e.id}:".`;

/** Notes a new escalation as a permission denial: its card's two answers, needs-human (never FYI). */
export function markPermission(e: Escalation, who: string, now: number, titleOnly = false) {
  // One the office files from an agent's words reads its title only: its details quote a whole journal entry or message.
  const perm = permissionDenial(titleOnly ? { title: e.title, details: '' } : e);
  if (!perm) return;
  e.permission = { ...perm, who, count: 1, lastAt: now };
  e.trigger = 'needs-human';
  e.fyi = false;
  e.options = permissionOptions(who);
  e.recommendation = `Allow it only if running \`${perm.command}\` is safe for ${who}; approving in the office alone doesn't change Claude Code's permission settings.`;
}

/** One more ask for the same denied command. */
function bump(target: Escalation, now: number) {
  if (!target.permission) return;
  target.permission.count++;
  target.permission.lastAt = now;
}

/**
 * An agent's own escalation (office-escalate.ts): folded into the open one it names (a +1, joined), or
 * not raised because what it names is answered (the agent is told so in the tool's reply). Undefined: raise it.
 */
export function foldAgentAsk(roster: Roster, floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk, canJoin: (e: Escalation) => boolean): { escalation: Escalation; joined: boolean; answered?: true } | undefined {
  const all = roster.data(floor.id).escalations;
  const now = roster.deps.now();
  const f = findFold(all, ask, now, { canJoin, own: true });
  if (!f) return undefined;
  if (f.target.status === 'open') {
    bump(f.target, now);
    return { escalation: roster.escalations.join(floor, w, ask, f.target), joined: true };
  }
  audit.record({ floor: floor.id, actor: office(), action: 'escalation.folded', target: { kind: 'escalation', id: f.target.id, label: f.target.title }, summary: `Not raised again for ${w.name} (it names ${f.on}, ${answeredLine(f.target)}): ${ask.title}`, details: { why: f.why, on: f.on, answered: true, worker: w.id }, severity: 'info' });
  floor.activity?.(`🔁 ${w.name} asked again what is ${f.target.permission?.kept ? 'kept blocked' : 'already answered'} (${f.on}): told the answer, nothing raised`);
  return { escalation: f.target, joined: false, answered: true };
}

/**
 * An ask the office would file from an agent's words (an AWAITING-PM item, a chat line), with its key:
 * folded when it names an open or answered escalation. Into an open one: linked (the key kept on it, the
 * role hears its answer too); into an answered one: the agent is told the answer after its turn, if it's
 * at work. True when it was folded (raise nothing); the key keeps it from being folded twice.
 */
export function foldOfficeAsk(roster: Roster, floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, key: string): boolean {
  const all = roster.data(floor.id).escalations;
  if (all.some((e) => e.foldedKeys?.includes(key))) return true;
  const now = roster.deps.now();
  // The item's own words: its details quote the whole entry or message, which may mention other escalations.
  const f = findFold(all, { title: ask.title, details: '', ...(ask.refs ? { refs: ask.refs } : {}) }, now);
  if (!f) return false;
  const t = f.target;
  t.foldedKeys = [...(t.foldedKeys ?? []), key].slice(-MAX_KEYS);
  const d = roster.data(floor.id);
  const member = who.role ? d.members[who.role] : undefined;
  const w = floor.worker(who.workerId) ?? (member ? roster.workerOf(floor, member) : undefined);
  if (t.status === 'open') {
    bump(t, now);
    if (w && w.kind === 'agent' && w.id !== t.workerId && !t.also?.some((a) => a.workerId === w.id)) (t.also ??= []).push({ workerId: w.id, by: w.name, ...(who.role ? { role: who.role } : {}), at: now });
    audit.record({ floor: floor.id, actor: office(), action: 'escalation.folded', target: { kind: 'escalation', id: t.id, label: t.title }, summary: `Not filed again for ${who.by}: it names ${f.on}, open as ESC-${t.id}: ${ask.title}`, details: { why: f.why, on: f.on, key }, severity: 'info' });
    floor.activity?.(`🔗 ${who.by}'s ask names ${f.on}: kept on the open ESC-${t.id}, not filed again`);
    roster.touch(floor);
    return true;
  }
  let told = `${who.by} isn't at work: not told`;
  if (w && w.kind === 'agent') {
    const text = `About “${ask.title}”: ${answeredLine(t)}. Act on that answer; don't wait on the Project Manager for it. If it is genuinely a new question, escalate it with a title that starts "Follow-up to ESC-${t.id}:".`;
    const sent = roster.delivery.send(floor, w, text, { origin: 'office', hold: true, between: true, resume: false });
    told = sent.status === 'refused' ? `couldn't tell ${w.name}: ${sent.why}` : sent.status === 'held' ? `held to type to ${w.name} after its turn` : `typed to ${w.name} (not confirmed received)`;
  }
  audit.record({ floor: floor.id, actor: office(), action: 'escalation.folded', target: { kind: 'escalation', id: t.id, label: t.title }, summary: `Not filed for ${who.by}: it names ${f.on}, ${answeredLine(t)}; ${told}: ${ask.title}`, details: { why: f.why, on: f.on, key, answered: true }, severity: 'info' });
  floor.activity?.(`🔁 ${who.by}'s ask names ${f.on}, already answered: ${told}, nothing filed`);
  roster.touch(floor);
  return true;
}

/**
 * A Bash command a worker ran (its PostToolUse hook): an open permission card for that command, raised
 * by the same role (or worker), is resolved, because the permission is in place now. The resolution is the
 * office's (verdict dismiss): nothing is typed to the agent. The ids it resolved.
 */
export function sawCommandRun(roster: Roster, floor: TeamFloor, workerId: string, command: string): string[] {
  const role = roster.roleOf(floor, workerId);
  const now = roster.deps.now();
  const done: string[] = [];
  for (const e of roster.data(floor.id).escalations) {
    if (e.status !== 'open' || !e.permission) continue;
    if (!(e.workerId === workerId || (!!role && e.role === role) || e.also?.some((a) => a.workerId === workerId))) continue;
    if (!ranDenied(e.permission.command, command)) continue;
    e.permission.ranAt = now;
    e.status = 'resolved';
    e.resolution = { verdict: 'dismiss', text: `The office saw \`${command.slice(0, 200)}\` run at ${new Date(now).toISOString().slice(11, 16)} UTC: the permission is in place`, by: 'The office', at: now, delivered: false };
    audit.record({ floor: floor.id, actor: office(), action: 'escalation.permission-ran', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Closed by a successful run: ${e.by}'s \`${e.permission.command}\` ran${e.permission.allowed ? ` after ${e.permission.allowed.by} allowed it` : ''}`, details: { command, asked: e.permission.count }, severity: 'info' });
    floor.activity?.(`✅ ${e.by}'s denied command ran, so its permission card is closed: ${e.permission.command}`);
    done.push(e.id);
  }
  if (done.length) roster.touch(floor);
  return done;
}

/** Whether an open escalation may take an ask as a +1 (Escalations.joinable's rule, for one ask). */
export const joinsFyi = (askIsFyi: boolean) => (e: Escalation) => !fyiNow(e) || askIsFyi;
