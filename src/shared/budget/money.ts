// Dollars as the budget shows them, the same amount in a local currency, and the top bar's chip:
// its words, its hover text and its colour. Pure, so the tests, the 1D and 2D views and the home page agree.

import type { BudgetTone, FxView } from './types.js';

/** Whole dollars from $10 up ("$42", "$1,250"), cents below ("$4.20"). */
export function usd(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const abs = Math.abs(v);
  const s = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2);
  return `${v < 0 ? '−' : ''}$${s}`;
}

/** Dollars with cents always ("$252.40"): tables. */
export const usdCents = (n: number) => (n > 0 && n < 0.005 ? '<$0.01' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** An amount in the local currency ("S$325"), or undefined with no rate. */
export function local(n: number, fx: FxView | undefined): string | undefined {
  if (!fx || fx.source === 'none' || !(fx.rate > 0) || fx.currency === 'USD') return undefined;
  const v = n * fx.rate;
  const abs = Math.abs(v);
  const digits = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2);
  const sym = SYMBOL[fx.currency];
  return `${v < 0 ? '−' : ''}${sym ?? `${fx.currency} `}${digits}`;
}

/** Symbols that can't be mistaken for the US dollar; any other currency shows its code. */
const SYMBOL: Record<string, string> = { SGD: 'S$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', AUD: 'A$', CAD: 'C$', HKD: 'HK$', NZD: 'NZ$', CNY: 'CN¥', MYR: 'RM ', CHF: 'CHF ', KRW: '₩', PHP: '₱', THB: '฿', IDR: 'Rp ' };

/** "$252 (S$325)": both, or just dollars with no rate. */
export const both = (n: number, fx: FxView | undefined) => {
  const l = local(n, fx);
  return l ? `${usd(n)} (${l})` : usd(n);
};

/** "1 USD = 1.2900 SGD, ECB rate as of 2026-10-05", for a tooltip or a footnote. */
export function rateLine(fx: FxView | undefined): string | undefined {
  if (!fx || fx.source === 'none' || fx.currency === 'USD') return undefined;
  const src = fx.source === 'manual' ? 'set by hand' : 'ECB reference rate';
  return `1 USD = ${fx.rate.toFixed(4)} ${fx.currency}, ${src}${fx.asOf ? ` as of ${fx.asOf}` : ''}${fx.error ? ` (last fetch failed: ${fx.error})` : ''}`;
}

/** How far through the budget `amount` is, as a whole percent. */
export const pctOf = (amount: number, budget: number) => (budget > 0 ? Math.round((amount / budget) * 100) : 0);

/**
 * The colour of a project's budget: green within it, amber within 10 % of it, red over. It follows the
 * forecast at completion once there is one, else what's spent so far; none with no budget.
 */
export function toneOf(budget: number | undefined, spent: number, forecast?: number): BudgetTone {
  if (!(budget && budget > 0)) return 'none';
  const basis = forecast ?? spent;
  if (basis > budget) return 'bad';
  if (basis >= budget * 0.9) return 'warn';
  return 'good';
}

export const TONE_WORD: Record<BudgetTone, string> = { good: 'Within budget', warn: 'Close to budget', bad: 'Over budget', none: 'No budget set' };

export interface ChipInput {
  today: number;
  spent: number;
  budget?: number;
  forecast?: number;
  fx?: FxView;
}

export interface Chip {
  text: string;
  title: string;
  tone: BudgetTone;
}

/** The project chip next to the branch: "$42 today · $252 / $600 · 42 %", or "$42 today · $252 spent" with no budget. */
export function projectChip(i: ChipInput): Chip {
  const tone = toneOf(i.budget, i.spent, i.forecast);
  const has = !!(i.budget && i.budget > 0);
  const text = has ? `${usd(i.today)} today · ${usd(i.spent)} / ${usd(i.budget!)} · ${pctOf(i.spent, i.budget!)} %` : `${usd(i.today)} today · ${usd(i.spent)} spent`;
  const l = (n: number) => local(n, i.fx);
  const lines = [
    `This project: ${both(i.today, i.fx)} today, ${both(i.spent, i.fx)} spent${has ? ` of a ${both(i.budget!, i.fx)} budget` : ''}`,
    ...(has && i.forecast !== undefined ? [`Forecast at completion: ${both(i.forecast, i.fx)} (${TONE_WORD[tone].toLowerCase()})`] : has ? [TONE_WORD[tone]] : []),
    ...(l(1) ? [rateLine(i.fx)!] : []),
    'Click for the Budget tab',
  ];
  return { text, title: lines.join('\n'), tone };
}

/** The office chip at the far right: "Office $110 today", with the office's daily budget when it has one. */
export function officeChip(today: number, dailyBudget: number | undefined, fx?: FxView): Chip {
  const has = !!(dailyBudget && dailyBudget > 0);
  const tone: BudgetTone = has ? (today > dailyBudget! ? 'bad' : today >= dailyBudget! * 0.9 ? 'warn' : 'good') : 'none';
  const text = has ? `Office ${usd(today)} / ${usd(dailyBudget!)} today` : `Office ${usd(today)} today`;
  const lines = [`Every project and the office's own calls: ${both(today, fx)} today${has ? ` of a ${both(dailyBudget!, fx)} daily budget` : ''}`, ...(local(1, fx) ? [rateLine(fx)!] : []), 'Click for the Budget tab'];
  return { text, title: lines.join('\n'), tone };
}
