// The office's own model calls, metered: Jeff's Haiku fallback, the analyzer's classifier, the task
// namer, the project summary's narrator and the Firm's reviewers. Each runs `claude -p --output-format
// json`, whose answer carries the call's tokens per model; they're priced here from the office's price
// list (usage.ts PRICES) and handed to whoever listens (the Budget ledger, which books them on the floor
// they served and into the office's Ledger). Which floor a call served comes from where it was asked:
// `withBilling({ floor, source }, fn)` around the asking, carried through every await by an
// AsyncLocalStorage, so the callers' signatures don't change. A call made outside any is the office's own.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Usage } from '../../shared/protocol.js';
import { usageOfMessage, zeroUsage, addUsage } from '../usage.js';

/** Which background job a call is for. */
export type BillingSource = 'jeff' | 'analyzer' | 'task-namer' | 'summary' | 'firm' | 'office';

export const SOURCE_LABEL: Record<BillingSource, string> = {
  jeff: 'Jeff (the Router)',
  analyzer: 'The analyzer',
  'task-namer': 'Task naming',
  summary: 'The project summary',
  firm: 'The Firm (audit reviewers)',
  office: 'The office',
};

export interface BillingTag {
  /** The floor the call served, when known. */
  floor?: string;
  /** The worker it was about (the task namer): its floor is the worker's. */
  worker?: string;
  source: BillingSource;
}

export interface BackgroundSpend extends BillingTag {
  model: string;
  usage: Usage;
  /** A provider the office can't price (Jev): counted, not costed. */
  unmetered?: boolean;
  /** Already in the office's Ledger (the Firm books its own): don't add it there again. */
  inLedger?: boolean;
}

const als = new AsyncLocalStorage<BillingTag>();
const listeners = new Set<(s: BackgroundSpend) => void>();

/** Runs `fn` with its model calls billed to `tag`; an outer tag's floor and worker carry in when this one has none. */
export function withBilling<T>(tag: BillingTag, fn: () => T): T {
  const outer = als.getStore();
  return als.run({ floor: tag.floor ?? outer?.floor, worker: tag.worker ?? outer?.worker, source: tag.source }, fn);
}

export const currentBilling = (): BillingTag | undefined => als.getStore();

/** Hears every background call's spend; returns the way to stop. */
export function onBackgroundSpend(fn: (s: BackgroundSpend) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSpend(s: BackgroundSpend) {
  for (const fn of listeners) {
    try {
      fn(s);
    } catch (err) {
      console.error(`agent-office: budget meter: ${(err as Error).message}`);
    }
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * A `claude -p --output-format json` answer's spend, priced from the price list: per model from its
 * `modelUsage` when it has one, else its `usage` at `fallbackModel`. Undefined when it says nothing.
 */
export function spendOfCliResult(out: string, fallbackModel = 'haiku'): { model: string; usage: Usage } | undefined {
  let res: any;
  try {
    res = JSON.parse(out);
  } catch {
    return undefined;
  }
  if (!res || typeof res !== 'object') return undefined;
  const mu = res.modelUsage && typeof res.modelUsage === 'object' ? Object.entries<any>(res.modelUsage) : [];
  if (mu.length) {
    let total = zeroUsage();
    let model = '';
    let top = -1;
    for (const [m, v] of mu) {
      const u = usageOfMessage(m, { input_tokens: num(v?.inputTokens), output_tokens: num(v?.outputTokens), cache_creation_input_tokens: num(v?.cacheCreationInputTokens), cache_read_input_tokens: num(v?.cacheReadInputTokens), server_tool_use: { web_search_requests: num(v?.webSearchRequests) } });
      total = addUsage(total, u);
      if (u.cost > top) ((top = u.cost), (model = m));
    }
    total.calls = Math.max(1, num(res.num_turns) || mu.length);
    return { model, usage: total };
  }
  if (res.usage && typeof res.usage === 'object') return { model: fallbackModel, usage: usageOfMessage(fallbackModel, res.usage) };
  return undefined;
}

/** Meters one `claude -p` answer under the current billing tag (or `source`, outside one). */
export function meterCliResult(out: string | null, source: BillingSource, fallbackModel = 'haiku') {
  if (!out) return;
  const s = spendOfCliResult(out, fallbackModel);
  if (!s || (!s.usage.cost && !s.usage.calls)) return;
  const tag = currentBilling();
  emitSpend({ ...tag, source: tag?.source ?? source, model: s.model, usage: s.usage });
}

/** Counts a call the office can't price (Jev), under the current billing tag. */
export function meterUnpriced(source: BillingSource, model: string) {
  const tag = currentBilling();
  emitSpend({ ...tag, source: tag?.source ?? source, model, usage: { ...zeroUsage(), calls: 1 }, unmetered: true });
}
