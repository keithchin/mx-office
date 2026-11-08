// The Lock in panel (Expert mode, design: docs/mockups/expert-mode screen 5; server/expert-lockin/): opened from the
// Session header's Lock in, by the person, never by itself. Step 1, the checks at session/main's head with their
// live progress (asked again every 1.5 s while they run); step 2, where it goes: Merge to main (when the checks pass,
// or with the failures accepted by name; a data impact only once confirmed), Publish to sandbox (a Free App: Studio
// Pro opens on the merged main and the person presses Run, then Publish) or Request deploy (a licensed node: to
// approval, blocked while demo users are on). After a merge of a phase whose rows are all done: Close phase N.
// ✕ or Esc closes it and gives focus back to where it was opened from. "Fix in session" copies a prompt: the office
// never types into the session.

import { h, openModal, toast, type Modal } from '../dom';
import { openProjectTab } from '../../tabs/host';
import { FREE_APP_STEPS, STATUS_WORDS, holding, publishWords, type LockInCheck, type LockInView } from '../../../shared/expert-lockin';
import { WISH_PROMPTS } from '../../../shared/expert-ready';
import { closePhaseLockIn, deployLockIn, getLockIn, mergeLockIn, publishLockIn, runLockIn } from './api';
import './lockin.css';

const POLL_MS = 1500;
const ICON: Record<LockInCheck['status'], string> = { waiting: '·', running: '◌', passed: '✓', warn: '!', failed: '✕', 'not-run': '–' };
const short = (s: string | null | undefined) => (s ? s.slice(0, 7) : '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
function took(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Copies a prompt for the session (the person pastes it and presses Enter themselves). */
async function copyPrompt(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Prompt copied: paste it in the session and press Enter');
  } catch {
    toast(`Copy this into the session: ${text}`, 'warn');
  }
}

export interface LockInPanel {
  modal: Modal;
  refresh(): Promise<void>;
}

/** Opens the panel for `floor`. `opener`: where focus goes back to (the Lock in button). */
export function openLockIn(floor: string, opener: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null): LockInPanel {
  const checksBox = h('section.xl-sec', { 'aria-label': 'Checks' });
  const whereBox = h('section.xl-sec', { 'aria-label': 'Where it goes' });
  const err = h('p.xl-err', { role: 'alert', hidden: true });
  const last = h('span.xl-last');
  const back = h('button.btn', { type: 'button' }, 'Back to session');
  const primary = h('button.btn.primary.xl-primary', { type: 'button' }, 'Run the checks');
  const el = h(
    'div.modal.xl',
    { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'xl-title' },
    h('header.xl-head', {}, h('span.xl-tile', { 'aria-hidden': 'true' }, '🔒'), h('div.xl-ht', {}, h('h2', { id: 'xl-title' }, 'Lock in'), h('p', {}, 'Full checks on session/main, then choose where it goes. You pick the moment: a phase end or before a deploy. Not per change.'))),
    h('div.body.xl-body', {}, checksBox, err, whereBox),
    h('footer.xl-foot', {}, last, h('span.grow'), back, primary),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const modal = openModal(el, {
    doing: 'locking in',
    onClose: () => {
      closed = true;
      clearTimeout(timer);
      opener?.focus();
    },
  });
  back.addEventListener('click', () => modal.close());

  let v: LockInView | undefined;
  const accepted = new Set<string>();
  let impactOk = false;
  let acting = false;

  const say = (text?: string) => {
    err.textContent = text ?? '';
    err.hidden = !text;
  };

  async function act<T>(label: string, fn: () => Promise<T | { error: string }>): Promise<T | undefined> {
    if (acting) return undefined;
    acting = true;
    say();
    primary.setAttribute('disabled', '');
    const r = await fn();
    acting = false;
    if (r && typeof r === 'object' && 'error' in r) {
      say(r.error);
      draw();
      return undefined;
    }
    if (label) toast(label);
    await load();
    return r as T;
  }

  function row(c: LockInCheck) {
    const fix = c.prompt && (c.status === 'failed' || c.status === 'warn' || c.status === 'not-run') ? h('button.btn.sm.xl-fix', { type: 'button', title: 'Copies a prompt for the session: you paste it and press Enter', onclick: () => void copyPrompt(c.prompt!) }, c.status === 'warn' && /None/.test(c.summary) ? 'Ask session to add' : 'Fix in session') : null;
    return h(
      'div.xl-row',
      { 'data-state': c.status },
      h('span.xl-ico', { 'aria-label': STATUS_WORDS[c.status] }, ICON[c.status]),
      h('span.xl-name', {}, c.name),
      h('span.xl-say', {}, h('span.xl-sum', {}, c.summary), c.detail ? h('span.xl-detail', {}, c.detail) : null),
      h('span.xl-act', {}, fix),
    );
  }

  function demoRow(d: LockInView['demoUsers']) {
    const state = !d.known ? 'warn' : d.on ? 'failed' : 'passed';
    return h(
      'div.xl-row',
      { 'data-state': state },
      h('span.xl-ico', { 'aria-hidden': 'true' }, !d.known ? '!' : d.on ? '✕' : '✓'),
      h('span.xl-name', {}, 'Demo users'),
      h('span.xl-say', {}, h('span.xl-sum', {}, !d.known ? 'Unknown' : d.on ? `On${d.count ? ` (${d.count})` : ''}` : 'Off'), h('span.xl-detail', {}, d.on ? 'blocks Deploy only' : !d.known ? 'the model couldn’t be read' : 'nothing blocks a deploy')),
      h('span.xl-act', {}, d.on ? h('button.btn.sm.xl-fix', { type: 'button', title: 'Copies the readiness fix as a prompt for the session', onclick: () => void copyPrompt(WISH_PROMPTS['seed-users']) }, 'Switch to seed users') : null),
    );
  }

  function drawChecks(view: LockInView) {
    const r = view.run;
    const head = h('div.xl-sh', {}, h('h3', {}, 'Checks'));
    if (r) head.append(h('span.xl-meta', {}, view.running ? `running at ${short(r.commit)} · the session keeps working meanwhile` : `ran ${clock(r.startedAt)} at ${short(r.commit)} · ${took((r.finishedAt ?? r.startedAt) - r.startedAt)}${r.committed ? ` · committed ${plural(r.committed.files, 'pending file')} first` : ''}`));
    head.append(h('span.grow'));
    if (r && !view.running) head.append(h('button.btn.sm.xl-again', { type: 'button', disabled: !!view.busy, title: view.busy ?? 'Run the checks again at the current head', onclick: () => void act('', () => runLockIn(floor)) }, '↻ Run again'));
    const rows = h('div.xl-rows');
    if (r) rows.append(...r.checks.map(row));
    else rows.append(h('p.xl-empty', {}, `A full mx check, all microflow tests, the journeys that are due and lint against the baseline, at ${short(view.head) || 'the head of session/main'}. What the session left uncommitted is committed first.`));
    rows.append(demoRow(view.demoUsers));
    const notes: (HTMLElement | null)[] = [];
    if (view.busy && !view.running) notes.push(h('p.xl-note.xl-busy', {}, `${view.busy}: wait for the turn to end, or stop it in the session.`));
    if (r && view.newer && !view.merged) notes.push(h('p.xl-note', {}, `${plural(view.newer, 'newer commit')} on session/main since the checks: they come in a later Lock in.`));
    checksBox.replaceChildren(head, rows, ...notes.filter((x): x is HTMLElement => !!x));
  }

  function card(cls: string, title: string, icon: string, text: string, badge: [string, string] | null, ...more: (HTMLElement | null)[]) {
    return h(`div.xl-card.${cls}`, {}, h('h4', {}, h('span.xl-ci', { 'aria-hidden': 'true' }, icon), title), h('p', {}, text), badge ? h('p.xl-req', {}, h(`span.xl-badge.${badge[0]}`, {}, badge[1])) : null, ...more);
  }

  function drawWhere(view: LockInView) {
    const r = view.run;
    const done = !!r?.finishedAt && !view.running;
    const held = r ? holding(r.checks) : [];
    const m = view.merged;
    const parts: HTMLElement[] = [h('div.xl-sh', {}, h('h3', {}, 'Where it goes'), h('span.xl-meta', {}, 'every option merges session/main into main first'))];
    // Merge to main.
    let mergeBadge: [string, string];
    let mergeText = `A milestone in history: ${plural(view.ahead, 'commit')} on session/main that main hasn’t got, merged with a receipt of the checks.`;
    if (m) {
      mergeBadge = ['ok', 'Merged'];
      mergeText = `Merged as ${short(m.merge)} (${plural(m.commits, 'commit')}). ${m.push === 'ok' ? 'Pushed to Team Server.' : m.push === 'pending' ? 'Pushing to Team Server…' : m.push === 'failed' ? `Push failed: ${m.pushError ?? ''}` : m.pushError ?? 'Not pushed.'} ${m.session === 'fast-forward' ? 'session/main carries on from it.' : m.session === 'merged-main' ? 'main was merged into session/main.' : m.sessionNote ?? ''}`;
    } else if (!r) mergeBadge = ['wait', 'Run the checks first'];
    else if (!done) mergeBadge = ['wait', 'Checks running'];
    else if (held.length && held.some((c) => !accepted.has(c.name))) mergeBadge = ['bad', `Blocked: ${held.map((c) => c.name).join(', ')}`];
    else if (view.impact?.status === 'impact' && !impactOk) mergeBadge = ['warn', 'Confirm the data impact'];
    else mergeBadge = ['ok', held.length ? `Ready with ${plural(held.length, 'known failure')}` : 'Ready'];
    const merge = card('xl-merge', 'Merge to main', '⑂', mergeText, mergeBadge);
    // Publish to sandbox.
    const publishBtn = view.licence !== 'licensed' && m ? h('button.btn.sm.xl-publish', { type: 'button', onclick: () => void act<{ note?: string }>('Studio Pro is opening on the merged main', () => publishLockIn(floor)).then((x) => x?.note && toast(x.note)) }, 'Open Studio Pro') : null;
    const steps = view.licence !== 'licensed' ? h('ol.xl-steps', {}, ...FREE_APP_STEPS.map((s) => h('li', {}, s))) : null;
    const publish = card('xl-publish-card', 'Publish to sandbox', '☁', publishWords(view.licence), view.licence === 'licensed' ? ['wait', 'Use Deploy'] : m ? ['ok', 'Ready'] : ['wait', 'After the merge'], steps, publishBtn);
    // Deploy.
    const req = view.deploy.requested;
    const deployBtn = view.deploy.allowed && !req ? h('button.btn.sm.xl-deploy', { type: 'button', onclick: () => void act<{ id: string }>('Deploy requested: it waits for approval in Needs you', () => deployLockIn(floor)) }, 'Request deploy') : null;
    const fixLink = view.demoUsers.on ? h('button.btn.sm.xl-fix', { type: 'button', onclick: () => void copyPrompt(WISH_PROMPTS['seed-users']) }, 'Switch to seed users') : null;
    const deploy = card('xl-deploy-card', 'Deploy', '🚀', 'Licensed node: a deploy request goes to the node owner for approval. The office never deploys by itself.', req ? ['ok', `Requested (${req.id})`] : view.deploy.allowed ? ['ok', 'Ready'] : ['bad', 'Blocked'], !req && view.deploy.why ? h('p.xl-why', {}, view.deploy.why) : null, deployBtn, fixLink);
    parts.push(h('div.xl-cards', {}, merge, publish, deploy));
    // Before the merge: what must be said out loud.
    if (done && !m) {
      if (held.length)
        parts.push(
          h(
            'div.xl-accepts',
            {},
            ...held.map((c) => {
              const box = h('input', { type: 'checkbox', checked: accepted.has(c.name), 'data-check': c.name }) as HTMLInputElement;
              box.addEventListener('change', () => {
                if (box.checked) accepted.add(c.name);
                else accepted.delete(c.name);
                draw();
              });
              return h('label.xl-accept', {}, box, ` ${c.name} is a known failure (${c.summary}). Note it in the receipt and the decision log.`);
            }),
          ),
        );
      if (view.impact?.status === 'impact') {
        const box = h('input.xl-impact-box', { type: 'checkbox', checked: impactOk }) as HTMLInputElement;
        box.addEventListener('change', () => {
          impactOk = box.checked;
          draw();
        });
        parts.push(h('div.xl-impact', { role: 'group', 'aria-label': 'Data impact' }, h('p.xl-impact-h', {}, 'This change may affect stored data:'), h('ul', {}, ...view.impact.lines.map((l) => h('li', {}, l))), h('label.xl-accept', {}, box, ' I confirm this data impact. It goes in the receipt and the decision log.')));
      } else if (view.impact?.status === 'unknown') parts.push(h('p.xl-note', {}, `Data impact couldn’t be read: ${view.impact.lines[0] ?? ''}`));
    }
    // After the merge: the phase.
    if (m && view.phase && !view.closed) {
      const p = view.phase;
      parts.push(
        h(
          'div.xl-phase',
          {},
          h('span', {}, p.complete ? `Phase ${p.order} of ${p.of}, ${p.name}: all ${p.rows} rows done.` : `Phase ${p.order} of ${p.of}, ${p.name}: ${p.rowsDone} of ${p.rows} rows done.`),
          h('span.grow'),
          p.complete ? h('button.btn.sm.primary.xl-close-phase', { type: 'button', onclick: () => void act(`Phase ${p.order} closed`, () => closePhaseLockIn(floor, p.id)) }, `Close phase ${p.order}`) : null,
          h('button.btn.sm.xl-roadmap', { type: 'button', onclick: () => (modal.close(), openProjectTab('roadmap')) }, 'Roadmap'),
        ),
      );
    }
    if (view.closed) parts.push(h('div.xl-phase.done', {}, h('span', {}, `${view.closed.name} is closed. Its checkpoint and phase report come with the Roadmap.`), h('span.grow'), h('button.btn.sm.xl-roadmap', { type: 'button', onclick: () => (modal.close(), openProjectTab('roadmap')) }, 'Roadmap')));
    whereBox.replaceChildren(...parts);
    whereBox.hidden = !r && !m;
  }

  function drawFoot(view: LockInView) {
    last.textContent = view.last ? `Last lock-in: ${day(view.last.at)} · merged ${plural(view.last.commits, 'commit')}` : 'No lock-in yet';
    const r = view.run;
    const held = r ? holding(r.checks) : [];
    primary.removeAttribute('title');
    if (view.merged) {
      primary.textContent = 'Done';
      primary.disabled = false;
      primary.onclick = () => modal.close();
      return;
    }
    if (!r) {
      primary.textContent = 'Run the checks';
      primary.disabled = !!view.busy || acting;
      if (view.busy) primary.title = view.busy;
      primary.onclick = () => void act('', () => runLockIn(floor));
      return;
    }
    primary.textContent = 'Merge to main';
    const blocked = view.running || !r.finishedAt || held.some((c) => !accepted.has(c.name)) || (view.impact?.status === 'impact' && !impactOk);
    primary.disabled = blocked || acting;
    primary.onclick = () => void act('Merged into main', () => mergeLockIn(floor, r.commit, [...accepted], impactOk));
  }

  function draw() {
    if (!v) return;
    drawChecks(v);
    drawWhere(v);
    drawFoot(v);
  }

  async function load() {
    clearTimeout(timer);
    const got = await getLockIn(floor);
    if (closed) return;
    if (!got) {
      say('Lock in couldn’t be read just now');
      return;
    }
    if (v?.run?.id !== got.run?.id) {
      accepted.clear();
      impactOk = false;
    }
    v = got;
    draw();
    // The phase's rows are read from main a little after it moves: looked at again for a short while after a merge.
    const phaseLag = !!got.merged && !!got.phase && !got.phase.complete && !got.closed && Date.now() - got.merged.at < 30_000;
    if (got.running || got.merged?.push === 'pending' || got.merged?.session === 'waiting' || phaseLag) timer = setTimeout(() => void load(), phaseLag ? 3000 : POLL_MS);
  }

  checksBox.append(h('p.xl-empty', {}, 'Reading…'));
  void load();
  setTimeout(() => primary.focus(), 30);
  return { modal, refresh: load };
}
