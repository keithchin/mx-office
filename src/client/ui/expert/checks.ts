// The background checks' popover (mockup 04b): opened from the proof strip's TESTS or LINT cell, it lists what failed
// (a journey or microflow test, and whether it passed before this change) and the new lint findings, with detail.
// "Send to session" puts a short prompt about the picked one in the session's input and never submits it: the
// office never types into the session (design notes, answer 4), so the user reads it and presses Enter. It's
// disabled, with the reason, unless the session waits at its prompt. ✕ or Esc closes it and gives focus back to
// the cell it was opened from; so does a click outside it.

import { h, timeAgo, toast } from '../dom';
import { openProjectTab } from '../../tabs/host';
import type { ExpertProof } from '../../../shared/expert-proof';
import type { WorkerInfo } from '../../../shared/protocol';
import { failurePrompt, fillBlocked, lintPrompt, type CheckFailure, type LintFinding, type ProofLint, type ProofTests } from '../../../shared/expert-checks';
import { sendToSession } from './api';
import './checks.css';

export type ChecksFocus = 'tests' | 'lint';

type Pick = { kind: 'failure'; f: CheckFailure } | { kind: 'lint'; f?: LintFinding };

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface ChecksPopover {
  el: HTMLElement;
  update(p: ExpertProof): void;
  /** The session's state changed: Send to session is enabled or not. */
  session(): void;
  close(): void;
}

export function checksPopover(o: { anchor: HTMLElement; floor: string; focus: ChecksFocus; proof: ExpertProof; worker: () => WorkerInfo | undefined; onClose(): void }): ChecksPopover {
  const titleId = `xs-ck-t-${Math.random().toString(36).slice(2, 8)}`;
  const el = h('div.xs-ck', { role: 'dialog', 'aria-labelledby': titleId, tabindex: '-1' });
  let proof = o.proof;
  let picked: Pick | undefined;
  let closed = false;

  const pickKey = (p: Pick | undefined) => (p ? (p.kind === 'failure' ? `f:${p.f.kind}:${p.f.id}` : `l:${p.f ? `${p.f.rule}|${p.f.document ?? ''}|${p.f.message}` : 'all'}`) : '');

  function firstPick(t: ProofTests | null | undefined, l: ProofLint | null | undefined): Pick | undefined {
    const fail = t?.failures[0] ? ({ kind: 'failure', f: t.failures[0] } as Pick) : undefined;
    const lint = l && l.findings.length ? ({ kind: 'lint', f: l.findings[0] } as Pick) : undefined;
    return o.focus === 'lint' ? (lint ?? fail) : (fail ?? lint);
  }

  function promptOf(p: Pick | undefined): string | undefined {
    if (!p) return undefined;
    if (p.kind === 'failure') return proof.tests ? failurePrompt(p.f, proof.tests.commit) : undefined;
    return proof.lint ? lintPrompt(proof.lint, p.f) : undefined;
  }

  const row = (p: Pick, ...body: (Node | string | null)[]) => {
    const on = pickKey(p) === pickKey(picked);
    return h('button.xs-ck-row', { type: 'button', 'aria-pressed': String(on), class: on ? 'on' : '', onclick: () => ((picked = p), draw()) }, ...body);
  };

  function testsPart(t: ProofTests | null | undefined): HTMLElement {
    if (!t) return h('section.xs-ck-sec', {}, h('p.xs-ck-line', {}, 'No background tests yet: they run when the session goes idle after a change.'));
    const items: (Node | null)[] = [];
    if (t.state === 'running') items.push(h('p.xs-ck-line.run', {}, h('span.xs-ck-spin', { 'aria-hidden': 'true' }), `Running on ${short(t.commit)}${t.now ? `: ${t.now}` : ''}…`));
    for (const f of t.failures)
      items.push(
        row(
          { kind: 'failure', f },
          h('span.xs-ck-dot.bad', { 'aria-hidden': 'true' }),
          h('span.xs-ck-main', {}, h('b', {}, `${f.id}`), f.kind === 'microflow' ? h('span.xs-ck-kind', {}, 'microflow test') : null, h('span.xs-ck-when', {}, `failed ${timeAgo(t.endedAt ?? t.startedAt)}`), f.detail ? h('span.xs-ck-detail', {}, f.detail) : null, f.passedAt ? h('span.xs-ck-detail', {}, `Passed on ${short(f.passedAt)} (before this change).`) : null),
        ),
      );
    const j = t.journeys;
    const failedJ = t.failures.filter((f) => f.kind === 'journey').length;
    if (t.state !== 'running' || j.passed) {
      const okWords = j.total ? `${failedJ ? `${plural(j.passed, 'other journey')}` : plural(j.passed, 'journey')} passed` : 'No journeys in the set';
      const tail = [t.scope === 'affected' ? 'affected set only' : 'every journey', t.endedAt ? dur(t.endedAt - t.startedAt) : ''].filter(Boolean).join(', ');
      items.push(h('p.xs-ck-line', {}, h('span.xs-ck-dot.good', { 'aria-hidden': 'true' }), okWords, j.notRun ? h('span.xs-ck-muted', {}, ` · ${j.notRun} didn’t run`) : null, h('span.xs-ck-muted', {}, ` · ${tail}`)));
    }
    const m = t.microflow;
    if (t.state !== 'running') {
      const none = !m.total;
      items.push(h('p.xs-ck-line', {}, h(`span.xs-ck-dot.${none ? 'warn' : m.failed ? 'bad' : 'good'}`, { 'aria-hidden': 'true' }), none ? (t.notes.find((n) => /microflow/i.test(n)) ?? 'No microflow tests in the set') : `${m.passed}/${m.total} microflow tests passed${m.notRun ? ` · ${m.notRun} didn’t run` : ''}`));
    }
    const notes = t.notes.filter((n) => !/^No microflow tests yet$/.test(n));
    if (notes.length) items.push(h('ul.xs-ck-notes', {}, ...notes.slice(0, 4).map((n) => h('li', {}, n))));
    return h('section.xs-ck-sec', {}, ...items);
  }

  function lintPart(l: ProofLint | null | undefined): HTMLElement {
    if (!l) return h('section.xs-ck-sec', {}, h('p.xs-ck-line', {}, 'No background lint yet.'));
    const items: (Node | null)[] = [h('h3.xs-ck-h3', {}, 'Lint against the baseline')];
    if (l.state === 'running') items.push(h('p.xs-ck-line.run', {}, h('span.xs-ck-spin', { 'aria-hidden': 'true' }), `Linting ${short(l.commit)}…`));
    else if (l.state === 'skipped') items.push(h('p.xs-ck-line', {}, l.note ?? 'Not run'));
    else {
      items.push(h('p.xs-ck-line', {}, h(`span.xs-ck-dot.${l.errors ? 'bad' : l.warnings ? 'warn' : 'good'}`, { 'aria-hidden': 'true' }), l.errors || l.warnings ? `${plural(l.errors, 'new error')}, ${plural(l.warnings, 'new warning')} at ${short(l.commit)}` : `No new findings at ${short(l.commit)}`));
      for (const f of l.findings.slice(0, 8)) items.push(row({ kind: 'lint', f }, h(`span.xs-ck-dot.${f.severity === 'error' ? 'bad' : f.severity === 'warning' ? 'warn' : 'idle'}`, { 'aria-hidden': 'true' }), h('span.xs-ck-main', {}, h('b', {}, f.rule), h('span.xs-ck-kind', {}, f.severity), h('span.xs-ck-when', {}, [f.module, f.document].filter(Boolean).join('.')), h('span.xs-ck-detail', {}, f.message))));
      if (l.findings.length > 8) items.push(h('p.xs-ck-muted', {}, `and ${l.findings.length - 8} more`));
      if (l.note) items.push(h('p.xs-ck-muted', {}, l.note));
    }
    return h('section.xs-ck-sec', {}, ...items);
  }

  function draw() {
    const t = proof.tests;
    const l = proof.lint;
    if (!picked || !promptOf(picked)) picked = firstPick(t, l);
    const reg = t?.failures.filter((f) => f.passedAt).length ?? 0;
    const bad = t?.failures.length ?? 0;
    const chip = o.focus === 'tests' ? (t?.state === 'running' ? 'running' : reg ? plural(reg, 'regression') : bad ? `${bad} failing` : t ? 'all passed' : '') : l?.state === 'running' ? 'running' : l && l.state === 'done' ? (l.errors || l.warnings ? `+${l.errors + l.warnings} new` : 'nothing new') : '';
    const blocked = fillBlocked(o.worker()?.status);
    const prompt = promptOf(picked);
    const why = !prompt ? 'Nothing failed to send' : blocked;
    el.replaceChildren(
      h('header.xs-ck-head', {}, h('h2', { id: titleId }, o.focus === 'tests' ? 'Tests in the background' : 'Lint in the background'), chip ? h(`span.xs-ck-chip${reg || bad || l?.errors ? '.bad' : ''}`, {}, chip) : null, h('span.xs-grow'), h('button.xs-ck-x', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => (close(), o.anchor.focus()) }, '✕')),
      h('div.xs-ck-body', {}, ...(o.focus === 'tests' ? [testsPart(t), lintPart(l)] : [lintPart(l), testsPart(t)])),
      prompt ? h('p.xs-ck-prompt', { title: 'What goes into the session’s input' }, h('span.xs-ck-muted', {}, 'Sends: '), prompt) : '',
      h(
        'footer.xs-ck-foot',
        {},
        why && prompt ? h('span.xs-ck-why', { role: 'note' }, why) : null,
        h('span.xs-grow'),
        h('button.btn', { type: 'button', onclick: () => (close(), openProjectTab('testing')) }, 'Show run'),
        h('button.btn.primary.xs-ck-send', { type: 'button', disabled: !!why, title: why ?? 'Puts this in the session’s input. You press Enter.', onclick: () => void send() }, '➤ Send to session'),
      ),
    );
  }

  async function send() {
    const text = promptOf(picked);
    if (!text || fillBlocked(o.worker()?.status)) return draw();
    const r = await sendToSession(o.floor, text);
    if ('error' in r) {
      toast(r.error, 'warn');
      return draw();
    }
    toast('In the session’s input: read it, then press Enter to send', 'info');
    close();
    (document.querySelector('.xs-term textarea') as HTMLElement | null)?.focus();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      o.anchor.focus();
    }
  };
  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && !o.anchor.contains(e.target as Node)) close();
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
    el.remove();
    o.onClose();
  }

  draw();
  document.body.append(el);
  // Above the cell, its left edge kept on screen.
  const r = o.anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onDown, true);
  const first = el.querySelector('.xs-ck-send:not([disabled])') as HTMLElement | null;
  (first ?? el).focus();

  return {
    el,
    update(p) {
      proof = p;
      if (!closed) draw();
    },
    session() {
      if (!closed) draw();
    },
    close() {
      close();
      o.anchor.focus();
    },
  };
}
