// The Testing tab's page (ui/testing/tab.ts registers it): drawn by render.ts from GET /api/testing.
// Nothing is fetched until the tab is first shown; after that it's asked again when the tab shows (at
// most every 20 s), when the floor changes and on ⟳. A late answer for a floor you've left is dropped.

import { store } from '../../state';
import type { TestingView } from '../../../shared/testing/view';
import { h } from '../dom';
import { markdownFile } from '../markdown';
import { domainsPanel, header, planPanel, runsPanel } from './render';
import './testing.css';

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

  const draw = (v: TestingView) => {
    if (v.cacheKey === key && body.childElementCount) return;
    key = v.cacheKey;
    const f = floor;
    body.replaceChildren(header(v), planPanel(v, () => get<{ markdown: string }>(`/api/testing?floor=${encodeURIComponent(f ?? '')}&part=plan`), markdownFile), domainsPanel(v), runsPanel(v));
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
    } catch (err) {
      if (n !== asked) return;
      status.textContent = `Couldn’t load the testing view: ${(err as Error).message}`;
    }
  }

  return { show: () => void load(), refresh: () => void load(true) };
}

