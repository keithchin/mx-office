// The budget numbers a page shows (the top bar's chips, the Budget tab): GET /api/budget for the floor
// you're on and GET /api/budget/office, fetched again a moment after the office's spend changes (its
// `usage` message, sent whenever its Ledger moves), when you change floors, and every minute.

import type { Net } from '../../net';
import { store } from '../../state';
import type { BudgetView, OfficeBudgetView } from '../../../shared/budget/types';
import { toast } from '../dom';

export interface BudgetFeed {
  floor(): BudgetView | undefined;
  office(): OfficeBudgetView | undefined;
  /** Calls `fn` now and after every fetch. */
  on(fn: () => void): void;
  refresh(): void;
}

/** Your name as this browser has it, for the record (an account's name wins on the server). */
export function myName(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('agent-office.profile') ?? 'null')?.name;
  } catch {
    return undefined;
  }
}

async function get<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** POSTs to the budget's API; the error as a toast, and undefined, when it fails. */
export async function post<T>(url: string, body: object): Promise<T | undefined> {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, by: myName() }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    toast((err as Error).message, 'warn');
    return undefined;
  }
}

let shared: BudgetFeed | undefined;

/** The page's one feed. */
export function budgetFeed(net: Net): BudgetFeed {
  if (shared) return shared;
  let floorView: BudgetView | undefined;
  let officeView: OfficeBudgetView | undefined;
  const fns: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const fire = () => fns.forEach((fn) => fn());
  const load = async () => {
    if (busy) return;
    busy = true;
    const f = store.floor;
    const [fv, ov] = await Promise.all([f ? get<BudgetView>(`/api/budget?floor=${encodeURIComponent(f)}`) : Promise.resolve(undefined), get<OfficeBudgetView>('/api/budget/office')]);
    busy = false;
    floorView = fv?.floor === store.floor ? fv : undefined;
    officeView = ov ?? officeView;
    fire();
  };
  const soon = (ms = 2500) => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), ms);
  };
  net.onMessage((m) => {
    if (m.t === 'usage') soon();
    if (m.t === 'welcome' || m.t === 'floor.enter') soon(50);
  });
  store.on('floor', () => {
    floorView = undefined;
    fire();
    soon(50);
  });
  setInterval(() => void load(), 60_000);
  shared = {
    floor: () => floorView,
    office: () => officeView,
    on: (fn) => {
      fns.push(fn);
      fn();
    },
    refresh: () => soon(0),
  };
  soon(50);
  return shared;
}
