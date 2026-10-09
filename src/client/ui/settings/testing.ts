// ⚙️ Settings › 🧪 Testing (admins): whether this office is in test mode and why (GET /api/test-mode),
// what test mode is, and the way to the Test Mode page (/lite?tab=tests, ui/testlab/), where the
// performance and journey suites run against a throwaway test office.

import { testsHref } from '../../../shared/testlab';
import { store } from '../../state';
import { h } from '../dom';
import { testModeIntro } from '../testlab';
import { setting, type Built } from './kit';

export function testingPart(): Built {
  const state = h('div', {}, h('p.setting-note', {}, 'Asking the office…'));
  let gone = false;
  void fetch('/api/test-mode', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<{ on: boolean; why?: string }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((mode) => !gone && state.replaceChildren(testModeIntro(mode)))
    .catch((err: Error) => !gone && state.replaceChildren(h('p.setting-note', {}, `Couldn’t ask the office: ${err.message}`)));
  const open = h('a.btn', { href: testsHref(store.floor ?? undefined) }, '🧪 Open the Test Mode page');
  return {
    nodes: [
      setting('Test mode', 'office', state),
      setting(
        'Test Mode page',
        'office',
        h('p.setting-note', {}, 'The suites (unit tests, the quick performance check, page responsiveness, the end-to-end journey, the Command Center check) with their last results, per-view timings and charts, a history of past runs, and ▶ Run to start one. Every run uses a throwaway test office of its own under scratch/test-offices, never this office or its data, and spends nothing.'),
        h('div.seg', {}, open),
      ),
    ],
    off: () => (gone = true),
  };
}
