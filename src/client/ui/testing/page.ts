// The Testing tab's page (ui/testing/tab.ts registers it): drawn by render.ts from GET /api/testing.
// Nothing is fetched until the tab is first shown; after that it's asked again when the tab shows (at
// most every 20 s), when the floor changes and on ⟳. A late answer for a floor you've left is dropped.

import { store } from '../../state';
import type { TestingView } from '../../../shared/testing/view';
import { h } from '../dom';
import { markdownFile } from '../markdown';
import { domainsPanel, header, planPanel, runsPanel } from './render';
import { verificationPanel } from './verification';
import { qualityPanel } from './quality';
import type { QualityPart } from '../../../shared/testing/quality';
import type { VerificationView } from '../../../shared/testing/verify';
import './testing.css';
import { prereqsPanel } from './prereqs';
import type { TestPrereqs } from '../../../shared/testing/prereqs';

const AGAIN_MS = 20_000;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function testingTab(root: HTMLElement) {
  const status = h('p.tst-status', { role: 'status', 'aria-live': 'polite' });
  const body = h('div.tst-body');
  const reload = h('button.btn.tst-reload', { type: 'button', title: 'Read the records and main again', onclick: () => void load(true) }, '⟳ Refresh');
  root.replaceChildren(h('div.tst', {}, h('div.tst-bar', {}, h('p.tst-intro', {}, 'Test evidence for this project, bound to revisions: what each run tested, which tests it used and where its report is kept. Read-only.'), reload), status, body));

  let loadedAt = 0;
  let floor: string | null = null;
  let key = '';
  let asked = 0;
  /** The Verification panel (release 2): fetched on its own, so the release 1 panels draw as they did. */
  const vslot = h('div.tst-vslot');
  /** The Quality header (release 1b): fetched on its own, and again every few seconds while one of the office's mxcli runs is under way. */
  const qslot = h('div.tst-qslot');
  /** What the tests need on this machine (real-build fix): the test database and Playwright, with their fixes. */
  const pslot = h('div.tst-pslot');
  async function loadPrereqs() {
    const f = floor;
    if (!f) return;
    try {
      const v = await get<TestPrereqs & { admin?: boolean }>(`/api/testing/prereqs?floor=${encodeURIComponent(f)}`);
      if (f === store.floor) pslot.replaceChildren(prereqsPanel(v, f, () => void loadPrereqs()));
    } catch {
      if (f === store.floor) pslot.replaceChildren();
    }
  }
  let qtimer: ReturnType<typeof setTimeout> | undefined;
  let wasRunning = false;
  const askRun = async (what: 'tests' | 'quality'): Promise<string | undefined> => {
    const f = floor;
    const res = await fetch('/api/testing/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: f, what, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res?.ok) return out?.error ?? 'the office could not be reached';
    void loadQuality();
    return undefined;
  };
  const askLimit = async (minutes: number | null): Promise<string | undefined> => {
    const res = await fetch('/api/testing/runner', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, limitMinutes: minutes, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    return res?.ok ? undefined : (out?.error ?? 'the office could not be reached');
  };
  async function loadQuality() {
    const f = floor;
    if (!f) return;
    clearTimeout(qtimer);
    try {
      const q = await get<QualityPart>(`/api/testing?floor=${encodeURIComponent(f)}&part=quality`);
      if (f !== store.floor) return;
      qslot.replaceChildren(qualityPanel(q, askRun, askLimit));
      const running = q.runs.tests.running || q.runs.quality.running;
      // A run just ended: its record is in, so the rest of the page is read again.
      if (wasRunning && !running) void load(true);
      wasRunning = running;
      if (running && root.isConnected) qtimer = setTimeout(() => void loadQuality(), 5000);
    } catch (err) {
      if (f === store.floor) qslot.replaceChildren(h('p.tst-muted', {}, `Couldn’t load the quality scores: ${(err as Error).message}`));
    }
  }
  const send = async (b: Record<string, unknown>): Promise<string | undefined> => {
    const f = floor;
    const res = await fetch('/api/testing/verification', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, floor: f, by: store.me.account?.name ?? store.profile.name }) }).catch(() => undefined);
    const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res?.ok) return out?.error ?? 'the office could not be reached';
    void loadVerification();
    return undefined;
  };
  async function loadVerification() {
    const f = floor;
    if (!f) return;
    try {
      const v = await get<VerificationView>(`/api/testing?floor=${encodeURIComponent(f)}&part=verification`);
      if (f === store.floor) vslot.replaceChildren(verificationPanel(v, send));
    } catch (err) {
      if (f === store.floor) vslot.replaceChildren(h('p.tst-muted', {}, `Couldn’t load the verification: ${(err as Error).message}`));
    }
  }

  const draw = (v: TestingView) => {
    if (v.cacheKey === key && body.childElementCount) return;
    key = v.cacheKey;
    const f = floor;
    body.replaceChildren(header(v), pslot, qslot, vslot, planPanel(v, () => get<{ markdown: string }>(`/api/testing?floor=${encodeURIComponent(f ?? '')}&part=plan`), markdownFile), domainsPanel(v), runsPanel(v));
  };

  async function load(force = false) {
    const f = store.floor;
    if (!f) {
      body.replaceChildren(h('p.tst-empty', {}, 'Open a project to see its testing.'));
      return;
    }
    if (!force && f === floor && Date.now() - loadedAt < AGAIN_MS) return;
    if (f !== floor) {
      key = '';
      body.replaceChildren();
      vslot.replaceChildren();
      qslot.replaceChildren();
      pslot.replaceChildren();
      wasRunning = false;
    }
    floor = f;
    const n = ++asked;
    status.textContent = 'Loading…';
    try {
      const v = await get<TestingView>(`/api/testing?floor=${encodeURIComponent(f)}`);
      if (n !== asked || f !== store.floor) return;
      loadedAt = Date.now();
      status.textContent = '';
      draw(v);
      void loadVerification();
      void loadQuality();
      void loadPrereqs();
    } catch (err) {
      if (n !== asked) return;
      status.textContent = `Couldn’t load the testing view: ${(err as Error).message}`;
    }
  }

  return { show: () => void load(), refresh: () => void load(true) };
}

