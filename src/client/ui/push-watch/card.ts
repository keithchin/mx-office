// The direct-push check on the 🔐 Security tab (GET/POST /api/push-check, server/review-gate/baseline.ts): where
// the office watches the default branch from, and while it has no earlier record (commits up to there weren't
// checked) the two ways to settle it: check the last commits for ones that skipped a pull request, or (an admin)
// accept that commit as the starting point. Both are audited. A check against mistakes, not a security boundary.

import { h, timeAgo, toast } from '../dom';

interface PushCheckView {
  localOnly?: boolean;
  branch?: string;
  tip?: string;
  since?: number;
  seenAt?: number;
  unchecked?: { from: string; at: number };
  reconciled?: { how: 'scan' | 'accept'; from: string; by: string; at: number; scanned?: number; found?: number };
  events?: number;
  scanDefault?: number;
  admin?: boolean;
  error?: string;
}

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);

export function pushCheckCard(floor: string): HTMLElement {
  const el = h('section.sec-card', { 'aria-label': 'Direct-push check' });
  const head = () => h('h3', {}, 'Direct-push check');
  const act = async (body: Record<string, unknown>, done: string) => {
    const res = await fetch('/api/push-check', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, ...body }) });
    const b = (await res.json().catch(() => ({}))) as { error?: string; scanned?: number; found?: number };
    if (!res.ok) return toast(b.error ?? `The office said ${res.status}`, 'warn');
    toast(b.scanned !== undefined ? `Checked ${b.scanned} commits: ${b.found} skipped a pull request` : done);
    void load();
  };
  const load = async () => {
    let v: PushCheckView;
    try {
      const res = await fetch(`/api/push-check?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
      v = (await res.json().catch(() => ({}))) as PushCheckView;
      if (!res.ok) throw new Error(v.error ?? `The office said ${res.status}`);
    } catch (err) {
      return void el.replaceChildren(head(), h('p.sec-muted', {}, `Couldn’t read it: ${(err as Error).message}`));
    }
    if (v.localOnly) return void el.replaceChildren(head(), h('p.sec-muted', {}, 'A local-only project: no default branch on GitHub to watch.'));
    if (!v.tip) return void el.replaceChildren(head(), h('p.sec-muted', {}, 'Not looked at yet: the office looks at the default branch a minute after it starts, and with Needs you.'));
    const rows: (HTMLElement | null)[] = [
      h('p', {}, `Watching ${v.branch} since ${v.since ? timeAgo(v.since) : 'its first look'}; last looked ${v.seenAt ? timeAgo(v.seenAt) : 'never'} at ${short(v.tip)}. Commits that reached it without a pull request show in Needs you (${v.events ?? 0} kept).`),
    ];
    if (v.unchecked) {
      const n = v.scanDefault ?? 50;
      const scan = h('button.btn', { type: 'button' }, `Check the last ${n} commits`) as HTMLButtonElement;
      scan.addEventListener('click', () => {
        scan.disabled = true;
        void act({ action: 'scan', count: n }, 'Checked');
      });
      const accept = v.admin ? (h('button.btn', { type: 'button' }, `Accept ${short(v.unchecked.from)} as the starting point`) as HTMLButtonElement) : null;
      accept?.addEventListener('click', () => {
        if (!confirm(`Commits on ${v.branch} up to ${short(v.unchecked!.from)} will never be checked for ones that skipped a pull request. This goes in the audit log.`)) return;
        accept.disabled = true;
        void act({ action: 'accept' }, 'Accepted as the starting point');
      });
      rows.push(
        h('p.sec-warn', {}, `No earlier record of ${v.branch}: commits up to ${short(v.unchecked.from)} weren’t checked.`),
        h('div.sec-actions', {}, scan, accept),
      );
    } else if (v.reconciled) {
      const r = v.reconciled;
      rows.push(h('p.sec-muted', {}, r.how === 'scan' ? `${r.by} checked the last ${r.scanned} commits up to ${short(r.from)} ${timeAgo(r.at)}: ${r.found} skipped a pull request. Older ones weren’t checked.` : `${r.by} accepted ${short(r.from)} as the starting point ${timeAgo(r.at)}: nothing before it was checked.`));
    }
    rows.push(h('p.sec-muted', {}, 'A check against mistakes, read from the office’s own copy of the project. It isn’t a security boundary: an agent runs as the office’s user and could change what the office keeps. Branch protection on GitHub is what stops a push.'));
    el.replaceChildren(head(), ...rows.filter((x): x is HTMLElement => !!x));
  };
  el.append(head(), h('p.sec-muted', {}, 'Loading…'));
  void load();
  return el;
}
