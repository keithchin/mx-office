// The plan of a batch of walkthroughs: which journeys play on which fresh database, in which order, and
// which are played first only to set up another's start state (./start-state.ts says what each needs).
//   * A journey that says it runs after X plays in X's group, right after X (a chain); X and the chain
//     above it come along unfilmed ("setup") when only the later journey was asked for.
//   * A chain whose first journey needs a fresh database is a group of its own (its own database).
//   * Journeys that need nothing in particular share one group, ordered by their "run before" lines;
//     a fresh-database chain that must run before one of them heads that group (it gets the fresh database
//     either way), so it costs no extra start.
//   * One that leaves data behind goes last in its group.
//   * A chain that goes round in a circle, or "run before" lines that contradict each other, aren't
//     recorded: the plan says why. Templates (example, skeleton, broken controls) never are.
// Every group starts the recording app on a fresh database. Pure and cheap: a few hundred journeys at most.

import { resolveStartStates, type StartState, type TimeWindow } from './start-state.js';

export interface PlanInput {
  journey: string;
  title: string;
  file: string;
  start?: StartState;
}

export interface PlanStep {
  id: string;
  title: string;
  /** Played unfilmed, only to set up the start state of a journey after it. */
  setup?: boolean;
  /** The journey it runs directly after (in this group). */
  after?: string;
  /** Times it must not run in. */
  windows?: TimeWindow[];
}

export interface PlanGroup {
  /** 1-based. */
  n: number;
  steps: PlanStep[];
  /** Why it is a group of its own, in words. */
  why: string;
}

export interface PlanSkip {
  id: string;
  title: string;
  kind: 'template' | 'conflict' | 'window';
  why: string;
}

export interface WalkPlan {
  groups: PlanGroup[];
  skipped: PlanSkip[];
  /** What was read or ignored about a journey's start state (only the journeys in the plan). */
  notes: { id: string; note: string }[];
}

interface Node {
  id: string;
  title: string;
  ord: number;
  st: StartState;
  setup: boolean;
  kids: Node[];
  parent?: Node;
}

/** A unit: one chain (a journey that needs nothing before it, and everything that runs after it). */
interface Unit {
  root: Node;
  order: Node[];
  fresh: boolean;
  leaves: boolean;
}

const byOrd = (a: { ord: number }, b: { ord: number }) => a.ord - b.ord;

/**
 * Kahn's sort of `items` by `edges` (a before b), ties by `rank`. What can't be placed (a cycle, or
 * waits on one) comes back in `stuck`.
 */
function topo<T>(items: T[], edges: [T, T][], rank: (a: T, b: T) => number): { order: T[]; stuck: T[] } {
  const inDeg = new Map(items.map((i) => [i, 0]));
  for (const [, b] of edges) inDeg.set(b, (inDeg.get(b) ?? 0) + 1);
  const ready = items.filter((i) => !inDeg.get(i));
  const order: T[] = [];
  while (ready.length) {
    ready.sort(rank);
    const x = ready.shift()!;
    order.push(x);
    for (const [a, b] of edges) {
      if (a !== x) continue;
      inDeg.set(b, inDeg.get(b)! - 1);
      if (!inDeg.get(b)) ready.push(b);
    }
  }
  return { order, stuck: items.filter((i) => !order.includes(i)) };
}

/**
 * The plan for recording `selected` (default: every journey that isn't a template) of `all` (the
 * commit's journeys, templates included, in file order).
 */
export function planBatch(all: readonly PlanInput[], selected?: readonly string[]): WalkPlan {
  const states = resolveStartStates(all);
  const skipped: PlanSkip[] = [];
  const info = new Map(all.map((s, ord) => [s.journey, { s, ord }]));
  const want = new Set<string>();
  for (const s of all) {
    const st = states.get(s.journey)!;
    if (selected && !selected.includes(s.journey)) continue;
    if (st.template) skipped.push({ id: s.journey, title: s.title, kind: 'template', why: `a template, not a workflow: ${st.templateWhy ?? 'scaffolding'}` });
    else want.add(s.journey);
  }
  // Everything wanted, and the chain of "run after" above each (unfilmed when not wanted itself).
  const nodes = new Map<string, Node>();
  const node = (id: string, setup: boolean): Node => {
    let n = nodes.get(id);
    if (!n) {
      const { s, ord } = info.get(id)!;
      n = { id, title: s.title, ord, st: states.get(id)!, setup, kids: [] };
      nodes.set(id, n);
    } else if (!setup) n.setup = false;
    return n;
  };
  const circled = new Set<string>();
  for (const id of want) {
    const chain = [id];
    let cur = id;
    let loop = false;
    while (states.get(cur)?.after) {
      const up = states.get(cur)!.after!;
      if (chain.includes(up)) {
        loop = true;
        break;
      }
      chain.push(up);
      cur = up;
    }
    if (loop) {
      for (const c of chain) circled.add(c);
      continue;
    }
    chain.forEach((c, k) => node(c, k > 0 && !want.has(c)));
  }
  for (const id of circled) {
    if (!want.has(id) || nodes.has(id)) continue;
    const t = info.get(id)!.s.title;
    skipped.push({ id, title: t, kind: 'conflict', why: 'its “run after” chain goes round in a circle, so no order gives it its start state' });
  }
  for (const n of nodes.values()) {
    const up = n.st.after ? nodes.get(n.st.after) : undefined;
    if (up && !circled.has(n.id)) {
      n.parent = up;
      up.kids.push(n);
    }
  }
  // Each chain flattened: a journey, then what runs after it (siblings by their "run before" lines).
  const units: Unit[] = [];
  const conflict = (u: Unit, why: string) => {
    for (const n of u.order) if (!n.setup) skipped.push({ id: n.id, title: n.title, kind: 'conflict', why });
  };
  for (const root of [...nodes.values()].filter((n) => !n.parent).sort(byOrd)) {
    const order: Node[] = [];
    let bad = '';
    const walk = (n: Node) => {
      order.push(n);
      const kids = [...n.kids].sort(byOrd);
      const edges = kids.flatMap((a) => (a.st.before ?? []).map((b) => kids.find((k) => k.id === b)).filter((b): b is Node => !!b).map((b) => [a, b] as [Node, Node]));
      const t = topo(kids, edges, (a, b) => Number(!!a.st.leavesData) - Number(!!b.st.leavesData) || byOrd(a, b));
      if (t.stuck.length) bad ||= `“${t.stuck.map((x) => x.title).join('” and “')}” each say to run before the other`;
      for (const k of [...t.order, ...t.stuck]) walk(k);
    };
    walk(root);
    const u: Unit = { root, order, fresh: root.st.freshDb, leaves: order.some((n) => n.st.leavesData) };
    // A "run before" that points back up its own chain can't hold.
    for (const [k, n] of order.entries()) for (const b of n.st.before ?? []) {
      const at = order.findIndex((x) => x.id === b);
      if (at >= 0 && at < k) bad ||= `“${n.title}” says to run before “${order[at].title}”, but it runs after it`;
    }
    if (bad) conflict(u, `conflicting order: ${bad}`);
    else units.push(u);
  }
  const unitOf = new Map(units.flatMap((u) => u.order.map((n) => [n.id, u] as const)));
  const shared = units.filter((u) => !u.fresh);
  const edgesIn = (list: Unit[]) =>
    list.flatMap((u) => u.order.flatMap((n) => (n.st.before ?? []).map((b) => unitOf.get(b)).filter((v): v is Unit => !!v && v !== u && list.includes(v)).map((v) => [u, v] as [Unit, Unit])));
  // A fresh-database chain that must run before a shared journey heads the shared group.
  let head: Unit | undefined;
  if (shared.length) {
    head = units.find((u) => u.fresh && edgesIn([u, ...shared]).some(([a]) => a === u) && !edgesIn([u, ...shared]).some(([, b]) => b === u));
  }
  const groups: PlanGroup[] = [];
  const stepOf = (n: Node): PlanStep => ({ id: n.id, title: n.title, ...(n.setup ? { setup: true } : {}), ...(n.parent ? { after: n.parent.id } : {}), ...(n.st.windows?.length ? { windows: n.st.windows } : {}) });
  const firstOrd = (us: Unit[]) => Math.min(...us.map((u) => u.root.ord));
  const made: { ord: number; units: Unit[]; why: string }[] = [];
  for (const u of units) if (u.fresh && u !== head) made.push({ ord: u.root.ord, units: [u], why: `“${u.root.title}” needs a fresh database` });
  if (shared.length) {
    const list = head ? [head, ...shared] : shared;
    const t = topo(list, edgesIn(list), (a, b) => (a === head ? -1 : b === head ? 1 : 0) || Number(a.leaves) - Number(b.leaves) || byOrd(a.root, b.root));
    if (t.stuck.length) {
      const names = t.stuck.map((u) => `“${u.root.title}”`).join(', ');
      for (const u of t.stuck) conflict(u, `conflicting order: ${names} say to run before one another`);
    }
    if (t.order.length) {
      const hd = t.order[0] === head ? head : undefined;
      // The head only stays first when nothing in the group must run before it.
      if (head && !hd) made.push({ ord: head.root.ord, units: [head], why: `“${head.root.title}” needs a fresh database` });
      made.push({ ord: firstOrd(t.order), units: t.order.filter((u) => u === hd || u !== head), why: hd ? `“${hd.root.title}” needs a fresh database and runs before the journeys that need nothing in particular` : 'journeys that need no particular start state' });
    }
  }
  made.sort((a, b) => a.ord - b.ord);
  for (const g of made) groups.push({ n: groups.length + 1, steps: g.units.flatMap((u) => u.order.map(stepOf)), why: g.why });
  const inPlan = new Set(groups.flatMap((g) => g.steps.map((s) => s.id)));
  const notes = all.filter((s) => inPlan.has(s.journey)).flatMap((s) => states.get(s.journey)!.notes.map((note) => ({ id: s.journey, note })));
  return { groups, skipped, notes };
}

/** What a group's steps need set up before `id`: the chain above it in the group. */
export function chainAbove(g: PlanGroup, id: string): string[] {
  const out: string[] = [];
  let cur = g.steps.find((s) => s.id === id)?.after;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = g.steps.find((s) => s.id === cur)?.after;
  }
  return out;
}
