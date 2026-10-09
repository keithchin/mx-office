// A microflow or nanoflow as the page draws it. From the flow's unit when the project's units can be
// read: every object at its exact place and size, its annotations, connection sides, curves and
// error-handler flows, and each element's details (flow-details.ts) — no mxcli. Its MDL (mxcli's
// `describe --format elk`) comes after, for the details panel, and each element's lines in it. Without
// the units, from mxcli alone: the elk nodes at the MDL's `@position` / `@start` coordinates. Either
// way the diagram sits where the developer put it: nothing is laid out automatically.

import { doc, list, point, str, typeOf, type BsonDoc } from './bson.js';
import { actionInfo, caseLabel, short, typeLabel } from './flow-actions.js';
import { NODE_CATEGORY, objectDetails } from './flow-details.js';
import type { FlowDoc, FlowEdge, FlowNode, FlowNodeKind, Pt } from '../../shared/model.js';

export interface ElkNode {
  id: string;
  type: string;
  category?: string;
  label?: string;
  details?: string[];
}
export interface ElkFlow {
  type?: string;
  name: string;
  parameters?: { name: string; type: string }[] | null;
  returnType?: string;
  nodes?: ElkNode[] | null;
  edges?: { id: string; sourceId: string; targetId: string; label?: string }[] | null;
  mdlSource?: string;
  sourceMap?: Record<string, { startLine: number; endLine: number }>;
}

const bare = (id: string) => id.replace(/^node-/, '');

/** Default sizes (Studio Pro's) for when only the MDL is known. */
const SIZE: Record<FlowNodeKind, [number, number]> = {
  start: [20, 20],
  end: [20, 20],
  error: [20, 20],
  break: [20, 20],
  continue: [20, 20],
  action: [120, 60],
  split: [90, 60],
  inheritance: [60, 40],
  merge: [30, 20],
  loop: [240, 160],
  parameter: [30, 30],
  annotation: [200, 50],
};

const KIND_OF: Record<string, FlowNodeKind> = {
  StartEvent: 'start',
  EndEvent: 'end',
  ErrorEvent: 'error',
  BreakEvent: 'break',
  ContinueEvent: 'continue',
  ActionActivity: 'action',
  ExclusiveSplit: 'split',
  InheritanceSplit: 'inheritance',
  ExclusiveMerge: 'merge',
  LoopedActivity: 'loop',
  MicroflowParameter: 'parameter',
  MicroflowParameterObject: 'parameter',
  Annotation: 'annotation',
};

/** Where a flow leaves or meets a node: 0 top, 1 right, 2 bottom, 3 left. */
export function anchor(n: { x: number; y: number; w: number; h: number }, side: number): Pt {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  switch (side) {
    case 0:
      return { x: cx, y: n.y };
    case 2:
      return { x: cx, y: n.y + n.h };
    case 3:
      return { x: n.x, y: cy };
    default:
      return { x: n.x + n.w, y: cy };
  }
}

/** The side of `a` that faces `b`, Studio Pro style: across when they're more apart sideways, else up or down. */
export function facing(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3;
  return dy >= 0 ? 2 : 0;
}

const SIDE: Record<string, number> = { top: 0, right: 1, bottom: 2, left: 3 };
const away = (side: number, d: number): Pt => [{ x: 0, y: -d }, { x: d, y: 0 }, { x: 0, y: d }, { x: -d, y: 0 }][side] ?? { x: d, y: 0 };

function curve(from: Pt, to: Pt, c1: Pt, c2: Pt): [Pt, Pt, Pt, Pt] {
  return [from, { x: from.x + c1.x, y: from.y + c1.y }, { x: to.x + c2.x, y: to.y + c2.y }, to];
}

/** Where a straight line from `n`'s middle towards `p` leaves its box. */
function edgeToward(n: FlowNode, p: Pt): Pt {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

function straight(a: FlowNode, b: FlowNode): [Pt, Pt, Pt, Pt] {
  const from = edgeToward(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const to = edgeToward(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
  return [from, from, to, to];
}

/** MDL lines of each element, and the coordinates and annotations its lines carry. */
interface MdlMarks {
  pos?: Pt;
  start?: Pt;
  caption?: string;
  anchors?: { from?: number; to?: number; branch?: Record<string, { from?: number; to?: number }> };
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const POS = new RegExp(String.raw`@position\(\s*${NUM}\s*,\s*${NUM}\s*\)`, 'i');
const START = new RegExp(String.raw`@start\(\s*${NUM}\s*,\s*${NUM}\s*\)`, 'i');

/** The `@…` marks just before (or on) the first statement line in [from, to]. */
export function marksAt(lines: string[], from: number, to: number): MdlMarks {
  const m: MdlMarks = {};
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) {
    const l = lines[i].trim();
    if (!l.startsWith('@')) break;
    const p = POS.exec(l);
    if (p) m.pos = { x: Number(p[1]), y: Number(p[2]) };
    const s = START.exec(l);
    if (s) m.start = { x: Number(s[1]), y: Number(s[2]) };
    const c = /^@caption\s+'((?:[^']|'')*)'/i.exec(l);
    if (c) m.caption = c[1].replace(/''/g, "'");
    if (/^@anchor\(/i.test(l)) {
      const a: NonNullable<MdlMarks['anchors']> = (m.anchors = m.anchors ?? {});
      for (const b of l.matchAll(/(true|false)\s*:\s*\(([^)]*)\)/gi)) {
        const f = /from:\s*(\w+)/.exec(b[2]);
        const t = /to:\s*(\w+)/.exec(b[2]);
        (a.branch = a.branch ?? {})[b[1].toLowerCase()] = { from: f ? SIDE[f[1]] : undefined, to: t ? SIDE[t[1]] : undefined };
      }
      const plain = l.replace(/(true|false)\s*:\s*\([^)]*\)/gi, '');
      const f = /from:\s*(\w+)/.exec(plain);
      const t = /to:\s*(\w+)/.exec(plain);
      if (f) a.from = SIDE[f[1]];
      if (t) a.to = SIDE[t[1]];
    }
  }
  return m;
}

/** Parameters' positions in the MDL header: `@position(x, y)` then `$Name: Type`. */
export function paramMarks(lines: string[]): Map<string, Pt> {
  const out = new Map<string, Pt>();
  let pending: Pt | undefined;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^begin\b/i.test(l)) break;
    const p = POS.exec(l);
    if (p && l.startsWith('@')) {
      pending = { x: Number(p[1]), y: Number(p[2]) };
      continue;
    }
    const v = /^\$(\w+)\s*:/.exec(l);
    if (v && pending) {
      out.set(v[1], pending);
      pending = undefined;
    }
  }
  return out;
}

const TOKEN = /\$\w+|'(?:[^']|'')*'|[A-Za-z_]\w*(?:\.\w+)+/g;
const tokens = (s: string) => new Set((s.match(TOKEN) ?? []).map((t) => t.toLowerCase()));

/**
 * Each elk node's statement in the MDL: its `@…` marks and its lines. mxcli's sourceMap points near
 * the right place but drifts when statements span lines, so it's a hint: the statement chosen is the
 * one of the node's kind that shares the most names with the node's label and details, nearest the hint.
 */
export function locate(lines: string[], nodes: ElkNode[], hint: Record<string, { startLine: number }> = {}): Map<string, { from: number; to: number }> {
  const stmts: { at: number; line: number; to: number; text: string; toks: Set<string> }[] = [];
  let begun = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^begin\b/i.test(l)) begun = true;
    if (!begun || !l || l.startsWith('@') || l.startsWith('--')) continue;
    let at = i;
    while (at > 0 && lines[at - 1].trim().startsWith('@')) at--;
    let to = i;
    while (to < lines.length - 1 && !/;\s*$|\bthen\s*$|\bbegin\s*$|^\s*(else|end)\b/i.test(lines[to]) && !lines[to + 1].trim().startsWith('@')) to++;
    stmts.push({ at, line: i, to, text: l, toks: tokens(lines.slice(i, to + 1).join(' ')) });
    i = to;
  }
  const fits = (n: ElkNode, s: string) => {
    if (n.type === 'end') return /^return\b/i.test(s);
    if (n.type === 'split') return /^if\b/i.test(s);
    if (n.type === 'loop') return /^(loop|while)\b/i.test(s);
    if (n.type === 'start' || n.type === 'merge') return false;
    return !/^(return|if|else|end|loop|while|begin)\b/i.test(s);
  };
  const used = new Set<number>();
  const out = new Map<string, { from: number; to: number }>();
  for (const n of nodes) {
    const want = tokens([n.label ?? '', ...(n.details ?? [])].join(' '));
    const near = hint[n.id]?.startLine ?? 0;
    let best = -1;
    let score = -Infinity;
    stmts.forEach((s, i) => {
      if (used.has(i) || !fits(n, s.text)) return;
      let shared = 0;
      for (const t of want) if (s.toks.has(t)) shared++;
      const sc = shared * 10 - Math.abs(s.line - near) * 0.3;
      if (sc > score) [best, score] = [i, sc];
    });
    if (best < 0) continue;
    used.add(best);
    out.set(bare(n.id), { from: stmts[best].at, to: stmts[best].to });
  }
  return out;
}

const box = (kind: FlowNodeKind, c: Pt, size?: Pt) => {
  const [w, h] = size && size.x > 0 && size.y > 0 ? [size.x, size.y] : SIZE[kind];
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
};

/** From mxcli's flow and MDL alone: elk nodes at their `@position`, with Studio Pro's default sizes. */
function fromMdl(elk: ElkFlow, lines: string[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const byId = new Map<string, FlowNode>();
  const marks = new Map<string, MdlMarks>();
  const where = locate(lines, elk.nodes ?? [], elk.sourceMap);
  for (const n of elk.nodes ?? []) {
    const id = bare(n.id);
    const kind: FlowNodeKind = n.type === 'split' ? (/inheritance/i.test(n.label ?? '') ? 'inheritance' : 'split') : ((KIND_OF[n.type] ?? (['start', 'end', 'merge', 'loop', 'error', 'break', 'continue'].includes(n.type) ? n.type : 'action')) as FlowNodeKind);
    const loc = where.get(id);
    const sm = loc ? { startLine: loc.from, endLine: loc.to } : undefined;
    const mk = sm ? marksAt(lines, sm.startLine, sm.endLine) : {};
    marks.set(id, mk);
    let c = mk.pos;
    if (kind === 'start') {
      const s = lines.map((l) => START.exec(l)).find((x) => x);
      if (s) c = { x: Number(s[1]), y: Number(s[2]) };
      else {
        // No @start: Studio Pro's usual gap to the left of the first statement.
        const begin = lines.findIndex((l) => /^\s*begin\b/i.test(l));
        const p = lines.slice(begin + 1).map((l) => POS.exec(l)).find((x) => x);
        if (p) c = { x: Number(p[1]) - 100, y: Number(p[2]) };
      }
    }
    if (!c) continue;
    const caption = mk.caption ?? (n.details ?? []).find((d) => d.startsWith('Caption: '))?.slice(9) ?? (kind === 'action' ? n.label ?? '' : kind === 'split' ? n.label ?? '' : '');
    const node: FlowNode = { id, kind, ...box(kind, c), caption, category: n.category, details: n.details ?? undefined, lines: sm ? [sm.startLine, sm.endLine] : undefined };
    const ret = (n.label ?? '').match(/^Return: (.*)$/);
    if (kind === 'end' && ret) node.expr = ret[1];
    nodes.push(node);
    byId.set(id, node);
  }
  const params = paramMarks(lines);
  for (const p of elk.parameters ?? []) {
    const c = params.get(p.name);
    if (!c) continue;
    const node: FlowNode = { id: `param:${p.name}`, kind: 'parameter', ...box('parameter', c), caption: p.name, output: { name: p.name, type: p.type } };
    nodes.push(node);
  }
  const edges: FlowEdge[] = [];
  for (const e of elk.edges ?? []) {
    const a = byId.get(bare(e.sourceId));
    const b = byId.get(bare(e.targetId));
    if (!a || !b) continue;
    const ma = marks.get(a.id);
    const mb = marks.get(b.id);
    const branch = e.label ? ma?.anchors?.branch?.[e.label] : undefined;
    const fs = branch?.from ?? (e.label ? undefined : ma?.anchors?.from) ?? facing(a, b);
    const ts = branch?.to ?? mb?.anchors?.to ?? facing(b, a);
    const from = anchor(a, fs);
    const to = anchor(b, ts);
    edges.push({ id: e.id, from: a.id, to: b.id, label: e.label || undefined, path: curve(from, to, away(fs, 30), away(ts, 30)) });
  }
  return { nodes, edges };
}

/** From the flow's unit: every object at its exact place and size, and every flow as Studio Pro draws it. */
function fromUnit(unit: BsonDoc, elk: ElkFlow | null, lines: string[], assocTarget: (a: string) => string | undefined): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const where = locate(lines, elk?.nodes ?? [], elk?.sourceMap);
  const elkById = new Map((elk?.nodes ?? []).map((n) => [bare(n.id), n]));
  const nodes: FlowNode[] = [];
  const byId = new Map<string, FlowNode>();
  const walk = (coll: BsonDoc | undefined, origin: Pt, parent?: string) => {
    for (const o of list(coll?.Objects)) {
      const t = str(o.$Type).replace(/^Microflows\$/, '');
      const kind = KIND_OF[t];
      if (!kind) continue;
      const id = str(o.$ID);
      const mid = point(o.RelativeMiddlePoint);
      const c = { x: mid.x + origin.x, y: mid.y + origin.y };
      const e = elkById.get(id);
      const loc = where.get(id);
      const sm = loc ? { startLine: loc.from, endLine: loc.to } : undefined;
      const node: FlowNode = { id, kind, ...box(kind, c, point(o.Size)), caption: '', category: e?.category ?? NODE_CATEGORY[kind], details: (e ? e.details : objectDetails(o)) ?? undefined, parent, lines: sm ? [sm.startLine, sm.endLine] : undefined };
      if (kind === 'action') {
        const info = actionInfo(doc(o.Action), assocTarget);
        node.action = info.action;
        node.category = info.category;
        node.caption = o.AutoGenerateCaption === false && str(o.Caption) ? str(o.Caption) : info.caption;
        node.output = info.output;
        if (info.commit) node.commit = true;
        if (info.refresh) node.refresh = true;
        const color = str(o.BackgroundColor);
        if (color && color !== 'Default') node.color = color;
        if (o.Disabled === true) node.disabled = true;
      } else if (kind === 'split') {
        const cond = doc(o.SplitCondition);
        node.expr = str(cond?.Expression) || (typeOf(cond).endsWith('RuleSplitCondition') ? short(str(doc(cond?.RuleCall)?.Rule)) : '');
        node.caption = str(o.Caption) || node.expr || '';
      } else if (kind === 'inheritance') {
        node.caption = str(o.Caption) || str(o.SplitVariableName);
        node.expr = str(o.SplitVariableName);
      } else if (kind === 'end') {
        node.expr = str(o.ReturnValue) || undefined;
      } else if (kind === 'parameter') {
        node.caption = str(o.Name);
        node.output = { name: str(o.Name), type: typeLabel(doc(o.VariableType)) ?? typeLabel(doc(o.ParameterType)) };
      } else if (kind === 'annotation') {
        node.caption = str(o.Caption).replace(/\r\n/g, '\n');
      } else if (kind === 'loop') {
        const src = doc(o.LoopSource);
        const listName = str(src?.ListVariableName) || str(o.IteratedListVariableName);
        const iter = str(src?.VariableName) || str(o.LoopVariableName);
        node.caption = str(o.Caption);
        node.output = iter ? { name: iter, type: listName ? `in ${listName}` : undefined } : undefined;
        node.expr = str(src?.Expression) || undefined;
      }
      nodes.push(node);
      byId.set(id, node);
      if (kind === 'loop') walk(doc(o.ObjectCollection), { x: node.x, y: node.y }, id);
    }
  };
  walk(doc(unit.ObjectCollection), { x: 0, y: 0 });
  const edges: FlowEdge[] = [];
  for (const f of list(unit.Flows)) {
    const a = byId.get(str(f.OriginPointer));
    const b = byId.get(str(f.DestinationPointer));
    if (!a || !b) continue;
    const id = str(f.$ID);
    if (str(f.$Type).endsWith('AnnotationFlow')) {
      edges.push({ id, from: a.id, to: b.id, annotation: true, path: straight(a, b) });
      continue;
    }
    const line = doc(f.Line);
    const fs = typeof f.OriginConnectionIndex === 'number' ? f.OriginConnectionIndex : facing(a, b);
    const ts = typeof f.DestinationConnectionIndex === 'number' ? f.DestinationConnectionIndex : facing(b, a);
    const c1 = line?.OriginControlVector != null ? point(line.OriginControlVector) : away(fs, 30);
    const c2 = line?.DestinationControlVector != null ? point(line.DestinationControlVector) : away(ts, 30);
    let label = a.kind === 'split' || a.kind === 'inheritance' ? caseLabel(f) : undefined;
    if (!label && a.kind === 'inheritance') label = '(empty)';
    edges.push({ id, from: a.id, to: b.id, label, error: f.IsErrorHandler === true || undefined, path: curve(anchor(a, fs), anchor(b, ts), c1, c2) });
  }
  return { nodes, edges };
}

/** The page's view of a flow, from mxcli's elk description and (when readable) the flow's unit. */
export function parseFlow(kind: 'microflow' | 'nanoflow', name: string, elk: ElkFlow | null, unit: BsonDoc | null, assocTarget: (a: string) => string | undefined = () => undefined): FlowDoc {
  const mdl = elk?.mdlSource ?? '';
  const lines = mdl.split('\n');
  const { nodes, edges } = unit ? fromUnit(unit, elk, lines, assocTarget) : elk ? fromMdl(elk, lines) : { nodes: [], edges: [] };
  const returnType = elk?.returnType ?? typeLabel(doc(unit?.MicroflowReturnType)) ?? undefined;
  return { kind, name, returnType: returnType === 'Void' ? undefined : returnType, nodes, edges, mdl, source: unit ? 'units' : 'mdl' };
}
