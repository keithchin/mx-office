// The Overview's Needs you card's decision cards (shared/decisions/): what every card says besides its
// question (what it blocks, the evidence, every source with Separate, small print, "possibly related",
// and the "After you answer" line), and the cards that aren't an escalation with options: a hands-on
// action (I've done it / Can't now / Ask, with an optional note sent with either), an FYI (Noted), an AWAITING-PM line that's gone (Resolved /
// Still needed), and any other source (its own button). The escalation with options stays needs-card.ts's.

import type { DecisionCard } from '../../../shared/decisions/types';
import { KIND_TAG } from '../../../shared/decisions/words';
import type { NeedTarget } from '../needsyou/logic';
import { h, timeAgo, toast } from '../dom';
import { decisionAct } from '../decisions/api';
import { decisionCheck } from '../decisions/feed';
import { fitsLine } from '../process-map/card-link';
import { cardWords } from './card-words';
import './decision-card.css';

export interface CardCtx {
  floor: string;
  admin: boolean;
  /** The lead's name, for "Ask <lead>". */
  leadName?: string;
  go(t: NeedTarget): void;
  ask(text: string): boolean;
  /** Called once an action went through (the card shows it, the feeds catch up). */
  done(card: DecisionCard, what: string): void;
}

const TAG_CLASS: Record<DecisionCard['kind'], string> = { decision: 't-normal', 'hands-on': 't-block', fyi: 't-later', status: 't-later' };
const TAG_ICON: Record<DecisionCard['kind'], string> = { decision: '⚑', 'hands-on': '✋', fyi: 'ℹ', status: '•' };

export const kindTag = (c: DecisionCard) => h('span.pt-tag', { class: c.level === 'block' && c.kind === 'decision' ? 't-block' : TAG_CLASS[c.kind] }, h('span.pt-tag-i', { 'aria-hidden': 'true' }, TAG_ICON[c.kind]), KIND_TAG[c.kind]);

/** The other open escalations a card folds (an answer answers them too). */
export const otherEscalations = (c: DecisionCard) => c.sources.slice(1).flatMap((s) => (s.escalation ? [s.escalation] : []));

/** What blocks, evidence, sources, notes, related and the after line say, under a card's question. */
export function cardExtras(c: DecisionCard, x: CardCtx): HTMLElement[] {
  const out: HTMLElement[] = [];
  // What the agent tried before asking (a Studio Pro hand-add needs it: shared/roster/handadd.ts), first and open.
  if (c.tried?.length) out.push(h('div.pt-dc-tried', {}, h('b', {}, `Tried (${c.tried.length}):`), h('ul', {}, ...c.tried.map((t) => h('li', {}, t)))));
  if (c.blocks.length) out.push(h('p.pt-dc-line', {}, h('b', {}, 'Blocks: '), c.blocks.map((b) => b.label).join(' · ')));
  if (c.evidence.length)
    out.push(
      h(
        'details.pt-dc-ev',
        {},
        h('summary', {}, `Evidence (${c.evidence.length})`),
        h('ul', {}, ...c.evidence.map((e) => h('li', {}, e.label, e.where ? h('small', {}, ` · ${e.where}`) : null, e.revision ? h('code', {}, ` ${e.revision}`) : null))),
      ),
    );
  if (c.sources.length > 1) {
    out.push(
      h(
        'div.pt-dc-src',
        {},
        h('b', {}, 'Also found in: '),
        h('span.pt-dc-one', {}, `one decision, ${c.sources.length} sources`),
        h(
          'ul',
          {},
          ...c.sources.slice(1).map((s) =>
            h(
              'li',
              { 'data-source': s.id },
              h('span', {}, s.label, s.text && s.text !== c.question ? h('small', {}, `: “${s.text.slice(0, 120)}”`) : null, s.note ? h('small.pt-dc-note', {}, ` (${s.note})`) : null),
              x.admin
                ? h(
                    'button.pt-link.pt-dc-sep',
                    {
                      type: 'button',
                      title: 'Not the same decision: show it as a card of its own (kept, and recorded in the audit log)',
                      onclick: () => void decisionAct(x.floor, { action: 'separate', cardId: c.id, sourceId: s.id }).then((ok) => ok && x.done(c, 'separated')),
                    },
                    'Separate',
                  )
                : null,
            ),
          ),
        ),
      ),
    );
  }
  // Where the question sits on the toolkit's process map, when it's pinned there (ui/process-map/).
  out.push(fitsLine(c, x.floor));
  for (const n of c.notes) out.push(h('p.pt-dc-small', {}, n));
  for (const r of c.related) out.push(h('p.pt-dc-small', {}, 'Possibly related (not merged): ', h('i', {}, r.label.slice(0, 140))));
  out.push(h('p.pt-dc-after', {}, c.after));
  return out;
}

const meta = (c: DecisionCard) => h('p.pt-esc-meta.pt-esc-by', {}, [c.owner && `from ${c.owner}`, c.since ? timeAgo(c.since) : ''].filter(Boolean).join(' · '));

function shell(c: DecisionCard, body: (HTMLElement | null)[], acts: HTMLElement | null): HTMLElement {
  return h(
    'article.pt-nitem.pt-esc.pt-dc',
    { 'data-id': c.escalation ?? c.id, 'data-card': c.id, 'data-kind': c.kind, 'aria-label': `${KIND_TAG[c.kind]}: ${c.question}` },
    h('div.pt-esc-h', {}, kindTag(c), h('b.pt-esc-t', {}, c.question)),
    meta(c),
    ...body,
    acts,
  );
}

const btn = (cls: string, text: string, run: (b: HTMLButtonElement) => void, title?: string) => {
  const b = h(`button.btn.small${cls}`, { type: 'button', ...(title ? { title } : {}) }, text) as HTMLButtonElement;
  b.addEventListener('click', () => run(b));
  return b;
};

const busy = async (b: HTMLButtonElement, p: Promise<boolean>) => {
  const all = [...(b.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  all.forEach((x) => (x.disabled = true));
  const ok = await p;
  all.forEach((x) => (x.disabled = false));
  return ok;
};

const notAdmin = () => h('p.pt-esc-meta', {}, 'Only the Project Manager (an admin) can act on it.');

/** A hands-on action: I've done it (the agent re-checks; never "APPROVED"), Can't now, Ask. */
export function handsOnCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const owner = c.owner;
  const check = c.escalation ? decisionCheck(c.escalation) : undefined;
  // An optional note, sent with I've done it or Can't now (./card-words.ts).
  const words = x.admin ? cardWords(owner) : undefined;
  const said = () => words?.value() ?? '';
  const acts = !x.admin
    ? notAdmin()
    : h(
        'div.pt-esc-acts',
        {},
        btn('.primary.pt-dc-done', "I've done it", (b) => void busy(b, decisionAct(x.floor, { action: 'done', escalation: c.escalation, others: otherEscalations(c), expectedRev: 0, ...(said() ? { text: said() } : {}) })).then((ok) => ok && (words?.clear(), toast(`${owner} is told it's done and re-checks`), x.done(c, `Done · ${owner} re-checks`)))),
        btn('.pt-dc-cant', `Can't now: tell ${owner}`, (b) => void busy(b, decisionAct(x.floor, { action: 'cant-now', escalation: c.escalation, ...(said() ? { text: said() } : {}) })).then((ok) => ok && (words?.clear(), toast(`${owner} is told you can't do it now`))), `${owner} hears it after their turn, with your note if you wrote one; the card stays open`),
        h('span.pt-grow'),
        x.leadName ? h('button.pt-link.pt-esc-ask', { type: 'button', onclick: () => x.ask(`About "${c.question.split(':')[0]}": `) }, `Ask ${x.leadName}`) : null,
      );
  return shell(c, [c.detail ? h('p.pt-esc-q', {}, c.detail) : null, ...cardExtras(c, x), check ? h('p.pt-dc-check', { class: check.ok ? 'ok' : 'bad' }, h('b', {}, `${check.label} (a check, not proof): `), check.text) : null, words?.el ?? null], acts);
}

/**
 * A permission block (shared/roster/permission-denial.ts): the exact command Claude Code denied, the rule
 * Allow writes, how often it was asked; Allow this command / Keep blocked. Never an Approve: it stays open
 * until the office sees the command run.
 */
export function permissionCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const p = c.permission!;
  const acts = !x.admin
    ? notAdmin()
    : h(
        'div.pt-esc-acts',
        {},
        p.allowed
          ? h('span.pt-dc-small', {}, `Allowed by ${p.allowed.by} ${timeAgo(p.allowed.at)}: waiting for the command to run.`)
          : btn('.primary.pt-dc-allow', `Allow this command for ${p.who} on this project`, (b) => void busy(b, decisionAct(x.floor, { action: 'allow-command', escalation: c.escalation })).then((ok) => ok && (toast(`Allowed: ${c.owner} is told to run it again`), x.done(c, 'Allowed · waiting for it to run'))), `Writes ${p.rule} to ${SETTINGS_HINT} in ${c.owner}'s folder; nothing else is allowed`),
        btn('.pt-dc-keep', 'Keep blocked', (b) => void busy(b, decisionAct(x.floor, { action: 'keep-blocked', escalation: c.escalation, expectedRev: 0 })).then((ok) => ok && x.done(c, 'Kept blocked'))),
        h('span.pt-grow'),
        x.leadName ? h('button.pt-link.pt-esc-ask', { type: 'button', onclick: () => x.ask(`About "${c.question.split(':')[0]}": `) }, `Ask ${x.leadName}`) : null,
      );
  return shell(
    c,
    [
      h('p.pt-dc-line', {}, h('b', {}, 'Denied by Claude Code: '), h('code', {}, p.command)),
      h('p.pt-dc-line', {}, h('b', {}, 'Allow writes: '), h('code', {}, p.rule), h('small', {}, ` in ${SETTINGS_HINT} (${p.allowed ? p.allowed.file : `${c.owner}'s folder`})`)),
      p.suggested ? h('p.pt-dc-small', {}, `${c.owner} suggested a wider rule, not written: `, h('code', {}, p.suggested)) : null,
      p.count > 1 ? h('p.pt-dc-small', {}, `Asked ${p.count} times: one card.`) : null,
      c.detail ? h('p.pt-esc-q', {}, c.detail) : null,
      ...cardExtras(c, x),
    ],
    acts,
  );
}

const SETTINGS_HINT = '.claude/settings.local.json';

/** An FYI: Noted, which approves nothing. */
export function fyiCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const acts = !x.admin ? notAdmin() : h('div.pt-esc-acts', {}, btn('.pt-dc-noted', 'Noted', (b) => void busy(b, decisionAct(x.floor, { action: 'noted', escalation: c.escalation, others: otherEscalations(c), expectedRev: 0 })).then((ok) => ok && x.done(c, 'Noted'))), h('small.pt-dc-small', {}, " Noting doesn't approve anything."));
  return shell(c, [c.detail ? h('p.pt-esc-q', {}, c.detail) : null, ...cardExtras(c, x).filter((e) => !e.classList.contains('pt-dc-after'))], acts);
}

/** An AWAITING-PM line that's gone: not settled; Resolved, or Still needed (ask the agent). */
export function goneCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const g = c.gone!;
  const acts = !x.admin
    ? notAdmin()
    : h(
        'div.pt-esc-acts',
        {},
        btn('.pt-dc-resolved', 'Resolved', (b) => void busy(b, decisionAct(x.floor, { action: 'resolved', escalation: c.escalation, expectedRev: 0 })).then((ok) => ok && x.done(c, 'Resolved'))),
        btn('.pt-dc-still', `Still needed: ask ${c.owner}`, (b) => void busy(b, decisionAct(x.floor, { action: 'still-needed', escalation: c.escalation })).then((ok) => ok && toast(`${c.owner} is asked, after their turn`))),
      );
  return shell(c, [h('p.pt-dc-gone', {}, h('i', {}, `${g.what}.`), g.asked ? h('small', {}, ` You said it's still needed ${timeAgo(g.asked)}.`) : null), ...cardExtras(c, x)], acts);
}

/** Any other card (a question, stuck, a proposal, a sign-off, a PR check): its question, extras and its own button. */
export function genericCard(c: DecisionCard, x: CardCtx): HTMLElement {
  const n = c.need;
  const acts = h('div.pt-esc-acts', {}, h('button.btn.small.primary', { type: 'button', onclick: () => x.go(n.target), 'aria-label': `${n.action}: ${c.question}` }, n.action), n.alt ? h('button.btn.small', { type: 'button', onclick: () => x.go(n.alt!.target) }, n.alt.action) : null);
  const answered = c.answered ? h('p.pt-dc-small', {}, c.answered.status === 'sent' ? `Sent to ${c.answered.to ?? 'the analyst'}: not recorded yet.` : 'Your answer is ready to send on the Questions page.') : null;
  return shell(c, [c.detail ? h('p.pt-esc-q', {}, c.detail) : null, c.options?.length ? h('p.pt-dc-line', {}, h('b', {}, 'Options: '), c.options.join(' · ')) : null, c.recommendation ? h('p.pt-esc-why', {}, h('b', {}, 'Recommends: '), c.recommendation) : null, answered, ...cardExtras(c, x)], acts);
}
