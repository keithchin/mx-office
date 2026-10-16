// The office's price list for Claude models, and the models it had to guess for.
//
// Every cost the office books for a Claude agent or its own `claude -p` calls is priced here (usage.ts
// usageOfMessage), from what a million tokens cost on Anthropic's pricing page. A model id with a row
// of its own is priced exactly; any other id (a model newer than this list, or one it never knew) is
// priced at Opus rates, because a budget warning that comes early beats one that comes late, and is
// remembered so the Budget page and Needs you can say which models are guessed (`unpricedModels`).
// The rows match whole model ids, so a family's old row can't quietly swallow its next generation.

import type { PriceListView } from '../shared/budget/types.js';

/** USD per million tokens: [input, output, cache read]. A 5-minute cache write costs 1.25x input, a 1-hour write 2x. */
export type Rate = [number, number, number];

interface Row {
  /** The whole canonical id (see canonicalModel). */
  re: RegExp;
  rate: Rate;
  /** A dearer rate for a request whose prompt (input, cache writes and cache reads together) is over `prompt` tokens. */
  over?: { prompt: number; rate: Rate };
}

/** When the rows were last checked against the pricing page, and the page. */
export const PRICES_CHECKED = '2026-10-16';
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

/*
 * From the pricing page, checked 2026-10-16. Cache reads are 0.1x input except Fable 5.1 / Mythos 5.1
 * (0.025x) and Opus 5.5 / Sonnet 5.5 (0.05x): Sonnet 5.5's is $0.10, which is also what the `claude`
 * CLI's own total_cost_usd uses (the page said $0.20 when this was checked on 2026-10-12). Haiku 5.5 is
 * priced by prompt length: over 100,000 prompt tokens a request pays the higher row. The claude-3 era ids
 * (claude-3-5-sonnet-20241022 and so on) put the version before the family.
 */
const ROWS: Row[] = [
  { re: /^claude-(fable|mythos)-5-1$/, rate: [10, 50, 0.25] },
  { re: /^claude-(fable|mythos)-5$/, rate: [10, 50, 1] },
  { re: /^claude-opus-5-5$/, rate: [4, 20, 0.2] },
  { re: /^claude-opus-(5|4-[5-8])$/, rate: [5, 25, 0.5] },
  { re: /^claude-opus-4(-1)?$|^claude-3-opus$/, rate: [15, 75, 1.5] },
  { re: /^claude-sonnet-5-5$/, rate: [2, 10, 0.1] },
  { re: /^claude-sonnet-5$/, rate: [2, 10, 0.2] },
  { re: /^claude-sonnet-4(-[56])?$|^claude-3(-[57])?-sonnet$/, rate: [3, 15, 0.3] },
  { re: /^claude-haiku-5-5$/, rate: [0.1, 0.5, 0.01], over: { prompt: 100_000, rate: [0.5, 2.5, 0.05] } },
  { re: /^claude-haiku-4-5$/, rate: [1, 5, 0.1] },
  { re: /^claude-3-5-haiku$|^claude-haiku-3-5$/, rate: [0.8, 4, 0.08] },
  { re: /^claude-3-haiku$/, rate: [0.25, 1.25, 0.03] },
];

/** What an id not on the list is priced at: Opus 4.5 to 5's rates, the dearest Opus still sold. */
export const OPUS: Rate = [5, 25, 0.5];
/** ...except a Fable or Mythos id, whose family costs more than Opus: an unknown one gets the family's rates. */
const FABLE: Rate = [10, 50, 1];

/**
 * What the `claude` CLI runs for a bare alias on the Anthropic API, so a price asked for by alias (the
 * planner's estimate, a `claude -p` answer without its model) is the price the meter books afterwards.
 * From Claude Code's model configuration page, checked 2026-10-16 (`--model sonnet` was also seen
 * running claude-sonnet-5-5 on 2026-10-12). Bedrock, Google Cloud and Foundry resolve some to older
 * models; the office runs Claude Code on the Anthropic API.
 */
const CLI_ALIASES: Record<string, string> = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

const bare = (model: string) => model.trim().toLowerCase().replace(/\[[^\]]*\]$/, '');

/** The model id the CLI runs for `model`: an alias resolved (also with a `[1m]` suffix), anything else as it was. */
export const resolvedModel = (model: string) => CLI_ALIASES[bare(model)] ?? model;

/**
 * A model id without what a cloud or a pin adds to it: `us.anthropic.claude-haiku-5-5-20261001-v1:0`
 * (Bedrock), `claude-opus-5-5@20261001` (Google Cloud), `claude-sonnet-4-6[1m]`, a dated snapshot
 * (`claude-haiku-4-5-20251001`), a router's `anthropic/` prefix.
 */
export function canonicalModel(model: string): string {
  return resolvedModel(bare(model))
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/^.*\//, '')
    .replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/-\d{8}$/, '');
}

/** Rows found per id the office has seen (a few dozen at most): priced once, not per message. */
const rowOf = new Map<string, Row | null>();
const ROW_CACHE = 500;

function lookup(model: string): Row | null {
  let row = rowOf.get(model);
  if (row !== undefined) return row;
  const id = canonicalModel(model);
  row = ROWS.find((r) => r.re.test(id)) ?? null;
  if (rowOf.size >= ROW_CACHE) rowOf.clear();
  rowOf.set(model, row);
  if (!row) noteUnpriced(id);
  return row;
}

/** Whether `model` has a row of its own (false: it's priced at Opus rates, or Fable's for a Fable id). */
export const isPriced = (model: string) => lookup(model) !== null;

/** What `model` costs per million tokens; `prompt` (a request's input, cache writes and reads) picks a long-prompt rate where there is one. */
export function priceOf(model: string, prompt = 0): Rate {
  const row = lookup(model);
  if (!row) return /fable|mythos/.test(canonicalModel(model)) ? FABLE : OPUS;
  return row.over && prompt > row.over.prompt ? row.over.rate : row.rate;
}

// ---------------------------------------------------------------------------------------------
// The models priced by the fallback: each id once, with when it was first seen (since the office started).

const unpriced = new Map<string, number>();
const UNPRICED_KEPT = 20;

function noteUnpriced(id: string) {
  // Claude Code writes `<synthetic>` for messages no model sent; an empty id says nothing.
  if (!id || id.startsWith('<') || unpriced.has(id) || unpriced.size >= UNPRICED_KEPT) return;
  unpriced.set(id, Date.now());
}

/** The model ids the office priced by the fallback, oldest first. */
export const unpricedModels = (): { model: string; since: number }[] => [...unpriced].map(([model, since]) => ({ model, since }));

/** What the Budget page and Needs you show of the price list. */
export const priceListView = (): PriceListView => ({ checked: PRICES_CHECKED, unpriced: unpricedModels() });

/** For tests: forget what was seen. */
export function resetPriceList() {
  unpriced.clear();
  rowOf.clear();
}
