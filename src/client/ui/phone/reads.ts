// What you've read on the team phone: kept by the office per person (GET / POST /api/phone/reads, your
// account's, or on the shared password this browser's own key), and in this browser too, so the counts
// are right at once and still work when the office can't be reached.

import { cleanReads, mergeReads, type PhoneReads } from '../../../shared/phone';

const LOCAL = 'agent-office.phone.reads';
const BROWSER = 'agent-office.phone.browser';

function browserKey(): string {
  try {
    let k = localStorage.getItem(BROWSER);
    if (!k || !/^[\w-]{8,40}$/.test(k)) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(BROWSER, k);
    }
    return k;
  } catch {
    return 'nostorage-browser';
  }
}

function local(): PhoneReads {
  try {
    return cleanReads(JSON.parse(localStorage.getItem(LOCAL) ?? '{}'));
  } catch {
    return {};
  }
}

export interface ReadState {
  get(channel: string): number | undefined;
  /** Marks a channel read up to `at` (a later read wins); saved here and at the office. */
  mark(channel: string, at: number): void;
  onChange(fn: () => void): void;
}

export function readState(): ReadState {
  let reads = local();
  const listeners = new Set<() => void>();
  let pending: PhoneReads = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => listeners.forEach((fn) => fn());
  const keep = () => {
    try {
      localStorage.setItem(LOCAL, JSON.stringify(reads));
    } catch {
      // the office keeps it
    }
  };
  const push = () => {
    timer = undefined;
    const body = { browser: browserKey(), reads: pending };
    pending = {};
    void fetch('/api/phone/reads', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  };
  void fetch(`/api/phone/reads?browser=${encodeURIComponent(browserKey())}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { reads?: PhoneReads } | null) => {
      if (!j?.reads) return;
      reads = mergeReads(reads, cleanReads(j.reads));
      keep();
      changed();
    })
    .catch(() => undefined);
  return {
    get: (c) => reads[c],
    mark(c, at) {
      if (!(at > (reads[c] ?? 0))) return;
      reads = { ...reads, [c]: at };
      pending[c] = at;
      keep();
      changed();
      timer ??= setTimeout(push, 1200);
    },
    onChange: (fn) => void listeners.add(fn),
  };
}
