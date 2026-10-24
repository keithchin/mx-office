// Developer changes on the page (ui/dev-changes/): the revision strip's chips, each state's pill and row, Cancel only
// where the viewer may cancel, the current change in the panel, Project Management's card from the same feed, and
// the phone width (the strip wraps onto its own line; rows never overflow).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { installFakeDom, FakeEl } from './support/fakedom.js';

installFakeDom();
const { revisionStrip, changeRow, changePill, currentChangePart, changeList } = await import('../src/client/ui/dev-changes/view.js');
const { devFeed } = await import('../src/client/ui/dev-changes/feed.js');
const { devChangesCard } = await import('../src/client/ui/dev-changes/pm.js');
const { changeFour, CHANGE_TONE } = await import('../src/shared/dev-changes.js');
type View = import('../src/shared/dev-changes.js').DevChangeView;
type Views = import('../src/shared/dev-changes.js').DevChangesView;

const M = 'f0'.padEnd(40, '0');
const S = 'e0'.padEnd(40, 'e');
const C = 'c1'.padEnd(40, '1');
const html = (e: unknown) => (e as FakeEl).outerHTML;

const view = (id: string, over: Partial<View> & { preview?: { running: boolean; served?: string }; inServed?: boolean }): View => {
  const base = view0(id, over);
  return { ...base, facts: over.facts ?? changeFour({ state: base.state, words: base.words, tone: CHANGE_TONE[base.state], ...(base.revision ? { revision: base.revision } : {}), ...(base.checks ? { checks: base.checks } : {}), ...(over.preview ? { preview: over.preview } : {}), ...(over.inServed !== undefined ? { inServed: over.inServed } : {}), ...(base.reviews ? { reviews: base.reviews } : {}) }) };
};
const view0 = (id: string, over: Partial<View>): Omit<View, 'facts'> => ({
  id,
  text: `Change ${id}: show the host on the badge`,
  by: 'Alex Lee',
  at: Date.now() - 60_000,
  source: { sha: M, kind: 'main' },
  queue: 'queued',
  candidates: [],
  branch: `dev/${id}`,
  state: 'queued',
  words: 'Queued',
  detail: 'DC-1 is with the team: this one starts when that one is merged, cancelled or set aside.',
  mayCancel: false,
  ...over,
});

const views = (changes: View[], strip: Views['strip'] = { main: M, preview: { status: 'running', served: S }, behind: 2 }): Views => ({ floor: 'shop', changes, strip, current: changes.find((c) => c.queue === 'active')?.id ?? changes[0]?.id ?? null });

test('the strip: main, the preview behind by N, the active change’s candidate; not running said plainly', () => {
  const s = html(revisionStrip(views([], { main: M, preview: { status: 'running', served: S }, behind: 2, change: { id: 'DC-1', candidate: C, branch: 'dev/DC-1' } })));
  assert.match(s, /data-chip="main"[^>]*>main @f000000</);
  assert.match(s, /data-chip="preview"[^>]*>preview @e0eeeee · behind main by 2</);
  assert.match(s, /data-chip="change"[^>]*>DC-1 candidate @c111111</);
  assert.match(s, /aria-label="Revisions"/);
  assert.match(html(revisionStrip(views([], { main: M, preview: { status: 'off' } }))), />preview: not running</);
  assert.match(html(revisionStrip(undefined)), /Reading revisions/);
});

test('each state’s row: DC-n, the pill (with @revision where it names one), the detail, the branch; Cancel only where allowed', () => {
  const rows: [Partial<View>, RegExp][] = [
    [{ state: 'queued', words: 'Queued', mayCancel: true }, /data-cancel="DC-2"/],
    [{ state: 'working', words: 'Working', queue: 'active', requestId: 'CR-4', member: 'Ada', mayCancel: true }, /CR-4 for Ada · branch dev\/DC-2[\s\S]*/],
    [{ state: 'candidate', words: 'Working · candidate', revision: C, queue: 'active', requestId: 'CR-4', checks: { candidate: C, on: [], earlier: [], line: 'No checks on this candidate (this project has no CI)' } }, /Working · candidate @c111111[\s\S]*data-fact="verification" data-status="incomplete"[^>]*>Incomplete @c111111: no CI[\s\S]*data-fact="preview" data-status="main"[^>]*>Runs main, not this candidate/],
    [{ state: 'implemented', words: 'Implemented', revision: M, queue: 'settled', preview: { running: true, served: S }, inServed: true }, /Implemented @f000000[\s\S]*data-status="in"[^>]*>In the preview @e0eeeee[\s\S]*data-fact="review" data-status="none"[^>]*>No review yet/],
    [{ state: 'implemented', words: 'Implemented', revision: M, queue: 'settled', preview: { running: true, served: S }, inServed: false }, /data-status="behind"/],
    [{ state: 'implemented', words: 'Implemented', revision: M, queue: 'settled', preview: { running: false } }, /data-status="off"[^>]*>Preview not running/],
    [{ state: 'clarify', words: 'Needs clarification', queue: 'clarify', mayCancel: true }, /data-state="clarify"/],
    [{ state: 'cancelled', words: 'Cancelled', queue: 'cancelled' }, /class="dc-pill bad"(?![\s\S]*once it starts)/],
    [{ state: 'not-found', words: 'Candidate not found', queue: 'settled' }, /Candidate not found/],
    [{ state: 'attention', words: 'Needs attention', queue: 'active', mayCancel: true, mayRetry: true }, /data-retry="DC-2"[\s\S]*Cancel \(stops the work\)/],
    [{ state: 'abandoned', words: 'Abandoned', queue: 'settled' }, /class="dc-pill bad"[^>]*>Abandoned/],
  ];
  for (const [over, re] of rows) {
    const out = html(changeRow('shop', view('DC-2', over)));
    assert.match(out, re, String(over.state));
    assert.match(out, /<b class="dc-id">DC-2<\/b>/);
    assert.equal(/data-cancel=/.test(out), !!over.mayCancel, `${over.state}: Cancel only where the viewer may`);
  }
  assert.equal((changePill(view('DC-3', { state: 'queued' })) as unknown as FakeEl).getAttribute('data-state'), 'queued');
});

test('the panel’s current change and the Requests list', () => {
  const v = views([view('DC-2', { mayCancel: true }), view('DC-1', { queue: 'active', state: 'working', words: 'Working', requestId: 'CR-1', member: 'Ada' })]);
  const cur = html(currentChangePart('shop', v, () => undefined));
  assert.match(cur, /data-change="DC-1"/, 'the active change is the current one');
  assert.match(cur, /1 more queued/);
  assert.match(cur, /Request a change/);
  const list = html(changeList('shop', v));
  assert.match(list, /data-change="DC-2"[\s\S]*data-change="DC-1"/);
  assert.match(html(changeList('shop', views([]))), /No requests yet/);
  assert.match(html(currentChangePart('shop', undefined, undefined)), /Reading your requests/);
});

test('Project Management’s card is the same feed, hidden while nothing is in flight', async () => {
  const calls: string[] = [];
  const answer = views([view('DC-1', { queue: 'active', state: 'working', words: 'Working' }), view('DC-2', {})]);
  (globalThis as { fetch?: unknown }).fetch = async (u: string) => (calls.push(u), { ok: true, json: async () => answer });
  devFeed.reset();
  const el = devChangesCard('shop') as unknown as FakeEl;
  assert.equal(el.hidden, true);
  document.body.append(el as never);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['/api/dev-changes?floor=shop']);
  assert.equal(el.hidden, false);
  assert.match(el.outerHTML, /Developer changes[\s\S]*1 queued behind it[\s\S]*data-change="DC-1"[\s\S]*data-change="DC-2"/);
  assert.equal(devFeed.get('shop'), answer, 'the Developer view reads the same answer');
});

test('phone width: the strip takes its own line and wraps; rows wrap long words', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'src/client/ui/dev-changes/dev-changes.css'), 'utf8');
  assert.match(css, /\.dc-strip \{[^}]*flex-wrap: wrap/);
  assert.match(css, /@media \(max-width: 760px\) \{\s*\.aw \.aw-strip \{ margin-left: 0; flex-basis: 100%; \}/);
  assert.match(css, /\.dc-chip \{[^}]*max-width: 100%[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.dc-text \{[^}]*overflow-wrap: anywhere/);
});
