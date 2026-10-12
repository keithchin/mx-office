// The Testing tab's Verification panel (Testing release 2), drawn from GET /api/testing?part=verification:
// the policy in force, each required check's state on main's newest integrated revision (the newest
// merged PR's merge commit), and the merged tasks that aren't verified ("Merged, not verified", "Passed
// on PR head, integrated revision not checked"), with links. An admin can waive a check that didn't pass
// on a revision, with a reason: recorded with their name and audited. Nothing here writes to GitHub.

import { settingsHref } from '../../../shared/settings-sections';
import { CHECK_LABEL, WAIVER_REASON_MIN, type CheckEval, type Waiver } from '../../../shared/testing/policy';
import type { VerificationTask, VerificationView } from '../../../shared/testing/verify';
import { store } from '../../state';
import { h } from '../dom';
import { CHECK_STATE, rev, VERIFY_STATE, type Tone } from './words';

const pill = (word: string, tone: Tone, title?: string) => h('span.tst-pill', { 'data-tone': tone, ...(title ? { title } : {}) }, word);

const label = (key: string) => (CHECK_LABEL as Record<string, string>)[key] ?? key;

/** "Waived by Ann: flaky runner, re-run passed locally". */
const waiverLine = (w: Waiver) => h('small.tst-waiver', {}, `Waived by ${w.by}: ${w.reason}`);

function checkRow(c: Pick<CheckEval, 'key' | 'state' | 'detail' | 'waiver'>): HTMLElement {
  const s = CHECK_STATE[c.state];
  return h('li.tst-vcheck', {}, h('span.tst-vcheck-k', {}, label(c.key)), pill(s.word, s.tone), c.detail && c.state !== 'missing' ? h('small.tst-from', {}, c.detail) : null, c.waiver ? waiverLine(c.waiver) : null);
}

/** An admin's waive form for one revision: the check, a reason, Waive. */
function waiveForm(revision: string, keys: string[], task: string | undefined, send: Sender): HTMLElement | null {
  if (!keys.length) return null;
  const sel = h('select.tst-wsel', { 'aria-label': 'Required check to waive' }, ...keys.map((k) => h('option', { value: k }, label(k)))) as HTMLSelectElement;
  const reason = h('input.tst-wreason', { type: 'text', maxlength: 1000, placeholder: 'Why it is acceptable (recorded with your name)', 'aria-label': 'Reason for the waiver' }) as HTMLInputElement;
  const note = h('small.tst-from', { role: 'status' });
  const go = h('button.btn.small', { type: 'button' }, 'Waive') as HTMLButtonElement;
  go.onclick = async () => {
    if (reason.value.trim().length < WAIVER_REASON_MIN) {
      note.textContent = `Give a reason (at least ${WAIVER_REASON_MIN} characters).`;
      reason.focus();
      return;
    }
    go.disabled = true;
    note.textContent = 'Recording…';
    const err = await send({ action: 'waive', check: sel.value, revision, reason: reason.value.trim(), ...(task ? { task } : {}) });
    go.disabled = false;
    note.textContent = err ? `Not recorded: ${err}` : 'Waived (audited).';
  };
  return h('div.tst-waive', {}, sel, reason, go, note);
}

type Sender = (body: Record<string, unknown>) => Promise<string | undefined>;

function taskRow(t: VerificationTask, admin: boolean, send: Sender): HTMLElement {
  const s = VERIFY_STATE[t.state];
  const blocking = t.checks.filter((c) => c.state !== 'passed' && c.state !== 'waived');
  return h(
    'li.tst-vtask',
    {},
    h('div.tst-vtask-h', {}, pill(s.word, s.tone), h('b', {}, t.name), h('span', {}, ` ${t.task} `), t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener' }, `PR #${t.pr}`) : h('span', {}, `PR #${t.pr}`)),
    h('p.tst-muted', {}, t.revision ? `Merge commit ${rev(t.revision)}` : 'Merge commit not known yet', t.head ? ` · PR head ${rev(t.head)}` : '', blocking.length ? ` · ${blocking.map((c) => `${label(c.key)}: ${CHECK_STATE[c.state].word.toLowerCase()}`).join('; ')}` : ''),
    admin && t.state === 'not-verified' && t.revision ? waiveForm(t.revision, blocking.map((c) => c.key), `PR #${t.pr}`, send) : null,
  );
}

/** The panel; `send` posts a change and says what went wrong, if anything. */
export function verificationPanel(v: VerificationView, send: Sender): HTMLElement {
  const admin = !!v.admin;
  const policy = h(
    'p.tst-gate',
    {},
    h('span.tst-k', {}, 'Policy in force: '),
    h('span', {}, v.words),
    h('small.tst-from', {}, v.from === 'default' ? ' (the default)' : ` (set by ${v.by ?? 'an admin'})`),
    h('a.tst-link', { href: settingsHref('verification', store.floor ?? undefined) }, admin ? 'Change in Settings' : 'See in Settings'),
  );
  const newest = v.newest
    ? h(
        'div.tst-vnewest',
        {},
        h('p.tst-gate', {}, h('span.tst-k', {}, 'Newest integrated revision: '), h('code.tst-sha', { title: v.newest.revision }, rev(v.newest.revision)), h('span', {}, ' from '), h('a', { href: v.newest.url, target: '_blank', rel: 'noopener' }, `PR #${v.newest.pr}`), h('span.tst-muted', {}, ` ${v.newest.title}`)),
        v.newest.eval.checks.length ? h('ul.tst-vchecks', {}, ...v.newest.eval.checks.map(checkRow)) : h('p.tst-muted', {}, 'The policy requires nothing.'),
        admin ? waiveForm(v.newest.revision, v.newest.eval.checks.filter((c) => c.state !== 'passed' && c.state !== 'waived').map((c) => c.key), `PR #${v.newest.pr}`, send) : null,
      )
    : h('p.tst-muted', {}, 'No merged pull request with a known merge commit yet.');
  const open = v.tasks.filter((t) => t.state !== 'integrated');
  const tasks = open.length ? h('ul.tst-vtasks', {}, ...open.map((t) => taskRow(t, admin, send))) : h('p.tst-muted', {}, 'No merged task is waiting on verification.');
  return h(
    'section.tst-card.tst-verify',
    { 'aria-label': 'Verification' },
    h('h3.tst-h', {}, 'Verification', h('span.tst-hsub', {}, 'required checks on the integrated revision (the merge commit), not the PR head')),
    policy,
    newest,
    h('h4.tst-feature-h', {}, 'Merged tasks not verified'),
    tasks,
    v.waivers.length ? h('details.tst-vwaivers', {}, h('summary', {}, `Waivers (${v.waivers.length})`), h('ul', {}, ...v.waivers.map((w) => h('li', {}, `${label(w.check)} on ${rev(w.revision)}${w.task ? ` (${w.task})` : ''}: `, waiverLine(w))))) : null,
  );
}
