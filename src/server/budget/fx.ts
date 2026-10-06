// The exchange rate the budget shows a local currency with: typed in by hand, or fetched once a day from
// the European Central Bank's reference rates through frankfurter (free, no key). A failed fetch keeps
// the last good rate and says so; nothing else depends on it, so the office never waits on it.

import type { FxSettings, FxView } from '../../shared/budget/types.js';

export const FX_URL = 'https://api.frankfurter.dev/v1/latest';
export const DEFAULT_FX: FxSettings = { currency: 'SGD', mode: 'daily' };

/** The last rate fetched: kept on disk with the office's budget settings. */
export interface FxLast {
  currency: string;
  rate: number;
  asOf: string;
  /** The office's day it was fetched on (one fetch a day). */
  fetchedDay: string;
  error?: string;
}

const CODE = /^[A-Z]{3}$/;

/** Settings from a request or a file; anything odd keeps what was there. */
export function cleanFx(raw: unknown, was: FxSettings = DEFAULT_FX): FxSettings | string {
  if (!raw || typeof raw !== 'object') return 'Send the currency settings';
  const r = raw as Record<string, unknown>;
  const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : was.currency;
  if (!CODE.test(currency)) return 'A currency is three letters, like SGD';
  const mode = r.mode === 'manual' || r.mode === 'daily' ? r.mode : was.mode;
  const rate = r.manualRate === undefined ? was.manualRate : Number(r.manualRate);
  if (mode === 'manual' && currency !== 'USD' && !(typeof rate === 'number' && rate > 0 && rate < 1e6)) return 'Type the rate: how many of the currency one US dollar buys';
  return { currency, mode, ...(rate !== undefined && rate > 0 ? { manualRate: rate } : {}) };
}

/** What the pages show, from the settings and the last fetch. */
export function fxView(s: FxSettings, last: FxLast | undefined): FxView {
  if (s.currency === 'USD') return { currency: 'USD', rate: 1, source: 'manual' };
  if (s.mode === 'manual' && s.manualRate) return { currency: s.currency, rate: s.manualRate, source: 'manual' };
  if (last && last.currency === s.currency && last.rate > 0) return { currency: s.currency, rate: last.rate, asOf: last.asOf, source: 'ecb', ...(last.error ? { error: last.error } : {}) };
  return { currency: s.currency, rate: 0, source: 'none', ...(last?.error && last.currency === s.currency ? { error: last.error } : {}) };
}

/** Whether a fetch is due: daily mode, and none yet today for this currency. */
export const fxDue = (s: FxSettings, last: FxLast | undefined, today: string) => s.mode === 'daily' && s.currency !== 'USD' && (!last || last.currency !== s.currency || last.fetchedDay !== today);

/**
 * Fetches the day's rate. On success, the new last rate; on failure, the last one kept (if it's for this
 * currency) with the error, so the pages say "rate as of <its day>" and that the fetch failed.
 */
export async function fetchFx(currency: string, last: FxLast | undefined, today: string, f: typeof fetch = fetch, timeoutMs = 8000): Promise<FxLast> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(`${FX_URL}?base=USD&symbols=${encodeURIComponent(currency)}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { date?: unknown; rates?: Record<string, unknown> };
    const rate = Number(body?.rates?.[currency]);
    if (!(rate > 0)) throw new Error(`no ${currency} rate in the answer`);
    return { currency, rate, asOf: typeof body.date === 'string' ? body.date : today, fetchedDay: today };
  } catch (err) {
    const error = ctl.signal.aborted ? 'timed out' : (err as Error).message || 'failed';
    const kept = last && last.currency === currency ? last : undefined;
    // Marked fetched today either way: a failing source is tried again tomorrow, not on every request.
    return kept ? { ...kept, fetchedDay: today, error } : { currency, rate: 0, asOf: '', fetchedDay: today, error };
  } finally {
    clearTimeout(timer);
  }
}
