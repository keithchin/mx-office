// The System Overview (Studio Pro's module dependency view): mxcli's module overview
// (`describe --format elk systemoverview SystemOverview`: each module with its counts, and an edge per
// module that uses another, with how many references of which kinds) as the Model tab draws it.
// Malformed entries are skipped; edges to modules that aren't listed are dropped.

import type { OverviewDoc, OverviewEdge, OverviewModule } from '../../shared/model.js';

interface RawModule {
  id?: unknown;
  name?: unknown;
  isSystem?: unknown;
  entityCount?: unknown;
  microflowCount?: unknown;
  pageCount?: unknown;
}

interface RawEdge {
  source?: unknown;
  target?: unknown;
  count?: unknown;
  kinds?: unknown;
}

export interface ElkOverview {
  modules?: RawModule[] | null;
  edges?: RawEdge[] | null;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function parseOverview(raw: ElkOverview): OverviewDoc {
  const modules: OverviewModule[] = [];
  const ids = new Map<string, string>();
  for (const m of Array.isArray(raw?.modules) ? raw.modules : []) {
    const name = typeof m?.name === 'string' && m.name ? m.name : typeof m?.id === 'string' ? m.id : '';
    if (!name || ids.has(name)) continue;
    ids.set(typeof m.id === 'string' && m.id ? m.id : name, name);
    ids.set(name, name);
    modules.push({ name, system: m.isSystem === true, entities: n(m.entityCount), microflows: n(m.microflowCount), pages: n(m.pageCount) });
  }
  const edges: OverviewEdge[] = [];
  for (const e of Array.isArray(raw?.edges) ? raw.edges : []) {
    const from = ids.get(String(e?.source ?? ''));
    const to = ids.get(String(e?.target ?? ''));
    if (!from || !to || from === to) continue;
    const kinds: Record<string, number> = {};
    if (e.kinds && typeof e.kinds === 'object') for (const [k, v] of Object.entries(e.kinds as Record<string, unknown>)) if (n(v)) kinds[k] = n(v);
    edges.push({ from, to, count: n(e.count) || Object.values(kinds).reduce((a, b) => a + b, 0) || 1, kinds });
  }
  return { kind: 'overview', modules, edges };
}
