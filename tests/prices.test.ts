// The price list (server/prices.ts): every current Claude model priced from its own row, whatever a cloud
// wraps round its id; old ids keep their old rates; anything else is priced at Opus rates and named, and
// the Budget tab and Needs you say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModel, isPriced, OPUS, priceListView, priceOf, PRICES_CHECKED, resetPriceList, resolvedModel, unpricedModels } from '../src/server/prices.js';
import { usageOfMessage } from '../src/server/usage.js';
import { spendOfCliResult } from '../src/server/budget/meter.js';
import { budgetNeedOfView, unpricedNeed, unpricedNote } from '../src/shared/budget/prices.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import type { BudgetView } from '../src/shared/budget/types.js';

const CURRENT: Record<string, [number, number, number]> = {
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
};

test('every current model has its own row, with or without what a cloud adds round its id', () => {
  resetPriceList();
  for (const [id, rate] of Object.entries(CURRENT)) {
    for (const wrapped of [id, `${id}-20261001`, `us.anthropic.${id}-20261001-v1:0`, `global.anthropic.${id}`, `anthropic.${id}-v1`, `${id}@20261001`, `${id}@default`, `${id}[1m]`, `anthropic/${id}`, id.toUpperCase()]) {
      assert.deepEqual(priceOf(wrapped), rate, wrapped);
      assert.ok(isPriced(wrapped), wrapped);
    }
  }
  assert.deepEqual(unpricedModels(), [], 'none of them is a guess');
});

test('the aliases are priced as the model Claude Code runs for them', () => {
  assert.equal(resolvedModel('haiku'), 'claude-haiku-5-5');
  assert.equal(resolvedModel('Opus'), 'claude-opus-5-5');
  assert.equal(resolvedModel('fable'), 'claude-fable-5-1');
  assert.equal(resolvedModel('sonnet[1m]'), 'claude-sonnet-5-5');
  assert.equal(resolvedModel('claude-opus-4-6'), 'claude-opus-4-6', 'a full id stays as it is');
  for (const a of ['fable', 'opus', 'sonnet', 'haiku']) assert.deepEqual(priceOf(a), CURRENT[resolvedModel(a)], a);
});

test('Haiku 5.5 costs more for a request whose prompt is over 100,000 tokens', () => {
  assert.deepEqual(priceOf('claude-haiku-5-5', 100_000), [0.1, 0.5, 0.01]);
  assert.deepEqual(priceOf('claude-haiku-5-5', 100_001), [0.5, 2.5, 0.05]);
  // A message's own prompt counts its cache reads and writes too.
  const small = usageOfMessage('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 });
  assert.ok(Math.abs(small.cost - (1000 * 0.1 + 1000 * 0.5) / 1e6) < 1e-12, String(small.cost));
  const big = usageOfMessage('claude-haiku-5-5', { input_tokens: 1000, cache_read_input_tokens: 150_000, output_tokens: 1000 });
  assert.ok(Math.abs(big.cost - (1000 * 0.5 + 150_000 * 0.05 + 1000 * 2.5) / 1e6) < 1e-12, String(big.cost));
  // A `claude -p` answer sums its requests, so it's priced at the average request's prompt.
  const cli = (turns: number) => JSON.stringify({ type: 'result', num_turns: turns, modelUsage: { 'claude-haiku-5-5': { inputTokens: 20_000, outputTokens: 1000, cacheReadInputTokens: 180_000, cacheCreationInputTokens: 0 } } });
  const four = spendOfCliResult(cli(4))!.usage.cost; // 50,000 a request: the lower rate
  const one = spendOfCliResult(cli(1))!.usage.cost; // 200,000 in one request: the higher
  assert.ok(Math.abs(four - (20_000 * 0.1 + 1000 * 0.5 + 180_000 * 0.01) / 1e6) < 1e-12, String(four));
  assert.ok(Math.abs(one - (20_000 * 0.5 + 1000 * 2.5 + 180_000 * 0.05) / 1e6) < 1e-12, String(one));
});

test('old ids keep their old rates', () => {
  resetPriceList();
  const old: Record<string, [number, number, number]> = {
    'claude-fable-5': [10, 50, 1],
    'claude-mythos-5': [10, 50, 1],
    'claude-opus-5': [5, 25, 0.5],
    'claude-opus-4-8': [5, 25, 0.5],
    'claude-opus-4-5-20251101': [5, 25, 0.5],
    'claude-opus-4-1-20250805': [15, 75, 1.5],
    'claude-opus-4-20250514': [15, 75, 1.5],
    'claude-3-opus-20240229': [15, 75, 1.5],
    'claude-sonnet-5': [2, 10, 0.2],
    'claude-sonnet-4-6': [3, 15, 0.3],
    'claude-sonnet-4-5-20250929': [3, 15, 0.3],
    'claude-sonnet-4-20250514': [3, 15, 0.3],
    'claude-3-7-sonnet-20250219': [3, 15, 0.3],
    'claude-3-5-sonnet-20241022': [3, 15, 0.3],
    'claude-haiku-4-5-20251001': [1, 5, 0.1],
    'us.anthropic.claude-haiku-4-5-20251001-v1:0': [1, 5, 0.1],
    'claude-3-5-haiku-20241022': [0.8, 4, 0.08],
    'claude-3-haiku-20240307': [0.25, 1.25, 0.03],
  };
  for (const [id, rate] of Object.entries(old)) assert.deepEqual(priceOf(id), rate, id);
  assert.deepEqual(unpricedModels(), []);
});

test('a model not on the list is priced at Opus rates and named once, never as an older one of its family', () => {
  resetPriceList();
  for (const id of ['claude-haiku-6', 'claude-sonnet-6-0', 'claude-opus-6', 'some-new-model', 'claude-haiku-6']) assert.deepEqual(priceOf(id), OPUS, id);
  assert.equal(isPriced('claude-haiku-6'), false);
  // A Fable or Mythos id costs more than Opus: an unknown one gets the family's rates, and is named too.
  assert.deepEqual(priceOf('claude-mythos-preview'), [10, 50, 1]);
  // Claude Code's `<synthetic>` messages and an empty id say nothing.
  priceOf('<synthetic>');
  priceOf('');
  // A cloud's wrapping is taken off before it's named.
  priceOf('us.anthropic.claude-opus-6-20270101-v1:0');
  assert.deepEqual(
    unpricedModels().map((u) => u.model),
    ['claude-haiku-6', 'claude-sonnet-6-0', 'claude-opus-6', 'some-new-model', 'claude-mythos-preview'],
  );
  assert.equal(canonicalModel('us.anthropic.claude-opus-6-20270101-v1:0'), 'claude-opus-6');
  const v = priceListView();
  assert.equal(v.checked, PRICES_CHECKED);
  assert.match(v.checked, /^\d{4}-\d{2}-\d{2}$/);
  resetPriceList();
});

test('the Budget tab and Needs you say which models are priced at Opus rates', () => {
  const prices = { checked: '2026-10-16', unpriced: [{ model: 'claude-xyz', since: 5 }] };
  assert.equal(unpricedNote({ checked: '2026-10-16', unpriced: [] }), undefined);
  assert.match(unpricedNote(prices)!, /^Priced at Opus rates: claude-xyz isn't on the office's price list \(checked 2026-10-16\)/);
  assert.match(unpricedNote({ ...prices, unpriced: [...prices.unpriced, { model: 'claude-abc', since: 6 }] })!, /claude-xyz and claude-abc aren't on/);
  // With no budget set, Needs you still hears of the guess; with no guess and no budget, nothing.
  const view = (total: number | undefined, p = prices) => ({ floor: 'f', settings: { total }, alerts: [], prices: p }) as unknown as BudgetView;
  assert.equal(budgetNeedOfView(view(undefined, { checked: '2026-10-16', unpriced: [] })), undefined);
  const need = budgetNeedOfView(view(undefined))!;
  assert.deepEqual(need, { floor: 'f', alerts: [], prices });
  const row = unpricedNeed(need)!;
  assert.equal(row.level, 'info', 'shown, not counted as waiting on you');
  assert.deepEqual(row.target, { to: 'budget' });
  const needs = collectNeeds({ floor: 'f', workers: [], pulls: [], floors: [], budget: need });
  assert.deepEqual(needs.map((n) => n.key), ['budget-unpriced']);
});
