// A worker's open background work: what Claude Code keeps running after the agent's turn is over, and
// wakes the agent for when it reports. A Monitor (a watch with a timeout, "expires in 15m"), a Bash
// command run in the background (asked for, or moved there when it outran its timeout); the async
// subagents (Agent tool) are the live runs' (subagent-live.ts) and only counted here. Each item is open
// from its launch (the tool call's result names its task id) until the task's <task-notification> says
// it ended (completed, failed, killed, stopped, or "Monitor expired"), or the session ends or restarts.
// The office hears the launch from the PostToolUse hook and reads launches and notifications off the
// transcript (server/roster/background-transcript.ts). No hook reports the end, so the transcript does.
//
// Honest about what it knows: each row says when the office last had word of it ("as of 00:27"), and an
// item past its stated expiry (plus a margin), or a command with no word for COMMAND_STALE_MS, is shown
// as "status unknown since …" and no longer counts as work going on. Pure: the server, the browser and
// the tests share it.

export type BgKind = 'monitor' | 'command';

export interface BgItem {
  /** Claude Code's task id when known (the launch's result names it), else the tool call's id. */
  id: string;
  kind: BgKind;
  toolUseId?: string;
  taskId?: string;
  /** The call's description (a Monitor's), or the command, clipped. */
  label?: string;
  startedAt: number;
  /** A Monitor's launch + its timeout; none for a persistent watch or a command. */
  expiresAt?: number;
  /** The last word of it (its launch, an event it reported). */
  seenAt: number;
  /** When its notification said it ended: kept a while so a late echo of its launch can't open it again. */
  closedAt?: number;
}

/** One thing heard about a worker's background work. */
export type BgSignal =
  /** A tool call's result says it runs in the background as task `taskId`. */
  | { kind: 'launched'; at: number; tool: BgKind; taskId?: string; toolUseId?: string; label?: string; timeoutMs?: number; persistent?: boolean }
  /** It reported something and runs on (a Monitor event). */
  | { kind: 'event'; at: number; taskIds: string[]; toolUseId?: string }
  /** Its notification says it's over. */
  | { kind: 'closed'; at: number; taskIds: string[]; toolUseId?: string }
  /** The session ended or a new one began: nothing of the old one runs on. */
  | { kind: 'reset'; at: number };

/** A Monitor's timeout when the call named none (Claude Code's default). */
export const MONITOR_DEFAULT_MS = 300_000;
/** Past its expiry this long without its notification, a Monitor's status is unknown. */
export const GRACE_MS = 2 * 60_000;
/** A background command with no word of it this long: its status is unknown. */
export const COMMAND_STALE_MS = 2 * 3_600_000;
/** How long an item of unknown status stays on its member's row before it's dropped. */
export const UNKNOWN_SHOWN_MS = 30 * 60_000;
/** A closed item is forgotten after this long. */
const CLOSED_KEPT_MS = 60 * 60_000;
/** Items a worker keeps at most (the oldest closed ones go first). */
const KEPT = 40;

export type BgState = 'open' | 'unknown' | 'gone';

/** Since when an item's word is too old to say it runs: its expiry plus the margin, or its last word plus COMMAND_STALE_MS. */
export function staleAt(i: BgItem): number | undefined {
  if (i.expiresAt !== undefined) return i.expiresAt + GRACE_MS;
  if (i.kind === 'command') return i.seenAt + COMMAND_STALE_MS;
  return undefined;
}

/** Open (evidenced and within its stated life), unknown (outlived it, no word since), or gone (closed, or unknown too long). */
export function bgState(i: BgItem, now: number): BgState {
  if (i.closedAt !== undefined) return 'gone';
  const stale = staleAt(i);
  if (stale === undefined || now < stale) return 'open';
  return now < stale + UNKNOWN_SHOWN_MS ? 'unknown' : 'gone';
}

function findItem(items: BgItem[], taskIds: readonly string[], toolUseId?: string): BgItem[] {
  return items.filter((i) => (i.taskId !== undefined && taskIds.includes(i.taskId)) || taskIds.includes(i.id) || (toolUseId !== undefined && i.toolUseId === toolUseId));
}

/** Takes in one signal. True when the list changed in a way a view would show. */
export function applyBg(items: BgItem[], s: BgSignal): boolean {
  switch (s.kind) {
    case 'reset': {
      if (!items.length) return false;
      items.splice(0, items.length);
      return true;
    }
    case 'launched': {
      if (!s.taskId && !s.toolUseId) return false;
      const had = findItem(items, s.taskId ? [s.taskId] : [], s.toolUseId)[0];
      const timeout = s.tool === 'monitor' && !s.persistent ? (s.timeoutMs && s.timeoutMs > 0 ? s.timeoutMs : MONITOR_DEFAULT_MS) : undefined;
      if (had) {
        const before = `${had.label}|${had.taskId}|${had.expiresAt}`;
        had.taskId ??= s.taskId;
        had.toolUseId ??= s.toolUseId;
        had.label ??= s.label;
        if (had.expiresAt === undefined && timeout !== undefined) had.expiresAt = had.startedAt + timeout;
        had.seenAt = Math.max(had.seenAt, s.at);
        return before !== `${had.label}|${had.taskId}|${had.expiresAt}`;
      }
      items.push({ id: s.taskId ?? s.toolUseId!, kind: s.tool, ...(s.taskId ? { taskId: s.taskId } : {}), ...(s.toolUseId ? { toolUseId: s.toolUseId } : {}), ...(s.label ? { label: s.label } : {}), startedAt: s.at, ...(timeout !== undefined ? { expiresAt: s.at + timeout } : {}), seenAt: s.at });
      trim(items);
      return true;
    }
    case 'event': {
      let changed = false;
      for (const i of findItem(items, s.taskIds, s.toolUseId)) {
        if (i.closedAt !== undefined || s.at <= i.seenAt) continue;
        i.seenAt = s.at;
        changed = true;
      }
      return changed;
    }
    case 'closed': {
      let changed = false;
      for (const i of findItem(items, s.taskIds, s.toolUseId)) {
        if (i.closedAt !== undefined) continue;
        i.closedAt = Math.max(s.at, i.startedAt);
        changed = true;
      }
      return changed;
    }
  }
}

function trim(items: BgItem[]) {
  if (items.length <= KEPT) return;
  const order = [...items].sort((a, b) => Number(a.closedAt === undefined) - Number(b.closedAt === undefined) || a.startedAt - b.startedAt);
  const drop = new Set(order.slice(0, items.length - KEPT));
  items.splice(0, items.length, ...items.filter((i) => !drop.has(i)));
}

/** Drops what's gone (closed a while ago, or unknown too long). True when any was. */
export function pruneBg(items: BgItem[], now: number): boolean {
  const keep = items.filter((i) => (i.closedAt !== undefined ? now - i.closedAt < CLOSED_KEPT_MS : bgState(i, now) !== 'gone'));
  if (keep.length === items.length) return false;
  items.splice(0, items.length, ...keep);
  return true;
}

/** The items running now (open), oldest first. */
export const openBg = (items: readonly BgItem[] | undefined, now: number): BgItem[] => (items ?? []).filter((i) => bgState(i, now) === 'open').sort((a, b) => a.startedAt - b.startedAt);

/** What a member's status says while it's idle but its background work runs. */
export const WAITING_BG = 'Waiting on background work';

/** "14:05", in the viewer's (or the server's) time zone. */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const KIND_WORD: Record<BgKind, string> = { monitor: 'monitor', command: 'background command' };

export interface BgRow {
  id: string;
  kind: BgKind;
  state: 'open' | 'unknown';
  /** "monitor · 12 min left", "background command · started 3 min ago", "background work (status unknown since 14:05)". */
  line: string;
  /** What it is: the Monitor's description, the command. */
  label?: string;
  /** "as of 00:27": the office's last word of it. */
  asOf: string;
}

/** A row's line at `now`. */
export function bgLine(i: BgItem, now: number): string {
  const state = bgState(i, now);
  if (state !== 'open') return `background work (status unknown since ${clockOf(i.expiresAt ?? i.seenAt)})`;
  if (i.expiresAt !== undefined) {
    const left = i.expiresAt - now;
    return `${KIND_WORD[i.kind]} · ${left <= 0 ? 'expiring' : left < 60_000 ? 'under a minute left' : `${mins(left)} min left`}`;
  }
  const ago = now - i.startedAt;
  return `${KIND_WORD[i.kind]} · ${ago < 60_000 ? 'just started' : `started ${mins(ago)} min ago`}`;
}

/** A worker's background work as its member's rows show it: running first (oldest first), then unknown. */
export function bgRows(items: readonly BgItem[] | undefined, now: number): BgRow[] {
  const shown = (items ?? []).map((i) => ({ i, state: bgState(i, now) })).filter((x): x is { i: BgItem; state: 'open' | 'unknown' } => x.state !== 'gone');
  shown.sort((a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || a.i.startedAt - b.i.startedAt);
  return shown.map(({ i, state }) => ({ id: i.id, kind: i.kind, state, line: bgLine(i, now), ...(i.label ? { label: i.label } : {}), asOf: `as of ${clockOf(i.seenAt)}` }));
}

/** In how many ms the rows change by the clock alone (a minute more, an expiry, a fold); undefined when they won't. */
export function bgNextTick(items: readonly BgItem[] | undefined, now: number): number | undefined {
  let at = Infinity;
  for (const i of items ?? []) {
    const state = bgState(i, now);
    if (state === 'gone') continue;
    const stale = staleAt(i);
    if (state === 'open') {
      at = Math.min(at, now + 60_000 - ((now - i.startedAt) % 60_000));
      if (stale !== undefined) at = Math.min(at, stale);
    } else if (stale !== undefined) at = Math.min(at, stale + UNKNOWN_SHOWN_MS);
  }
  return at === Infinity ? undefined : Math.max(1_000, at - now + 50);
}

/** "monitor", "2 monitors, background command": what's running, by kind. */
export function bgKinds(items: readonly BgItem[]): string[] {
  const out: string[] = [];
  for (const k of ['monitor', 'command'] as const) {
    const n = items.filter((i) => i.kind === k).length;
    if (n) out.push(n === 1 ? KIND_WORD[k] : `${n} ${KIND_WORD[k]}s`);
  }
  return out;
}

/**
 * For the office's fact block: "waiting on background work: monitor, 1 subagent" (or, for one at work,
 * "with background work: …"); undefined when nothing runs in the background. `subs`: its subagents at
 * work, as factsSubagents words them. Unknown items are said as such, never as running.
 */
export function factsBackground(items: readonly BgItem[] | undefined, now: number, working: boolean, subs?: { count: number; who?: string }): string | undefined {
  const open = openBg(items, now);
  const unknown = (items ?? []).filter((i) => bgState(i, now) === 'unknown');
  if (!open.length) {
    if (!unknown.length) return undefined;
    return `background work of unknown status since ${clockOf(Math.min(...unknown.map((i) => i.expiresAt ?? i.seenAt)))}`;
  }
  const parts = bgKinds(open);
  if (subs?.count) parts.push(`${subs.count} subagent${subs.count === 1 ? '' : 's'}${subs.who ? ` (${subs.who})` : ''}`);
  return `${working ? 'with background work' : 'waiting on background work'}: ${parts.join(', ')}`;
}
