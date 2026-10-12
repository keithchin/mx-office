// The Overview's Project brief card (Portal): for a project the new-project wizard made from an approved
// brief, docs/project-brief.md: its goal, its functional domains and its open questions, and the way to the
// whole file on the Documents page. Read once per project you open (GET /api/deliverables/file, the
// Documents page's own route), never on a timer; with no brief the card isn't there.

import { store } from '../../state';
import { h } from '../dom';
import { openDocuments } from '../deliverables/open';

/** Where the wizard writes it (server/wizard/brief-files.ts). */
export const BRIEF_PATH = 'docs/project-brief.md';

export interface BriefFacts {
  title?: string;
  goal: string[];
  /** "Stage 0 scope approved by Ann on 2026-10-02 09:30". */
  approved?: string;
  domains: string[];
  questions: string[];
}

/** The list items under one `## heading`, without their "_(Answered · …)_" tags. */
function section(md: string, heading: string): string[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l)) break;
    const m = l.match(/^\s*[-*]\s+(.*)$/);
    if (m) out.push(m[1].replace(/\s*_\([^)]*\)_\s*$/, '').replace(/\*\*/g, '').trim());
  }
  return out.filter(Boolean);
}

/** What the card shows of docs/project-brief.md (shared/brief-map.ts briefMarkdown writes it). */
export function parseBrief(md: string): BriefFacts {
  const title = md.match(/^#\s+Project brief:\s*(.+)$/m)?.[1]?.trim();
  const approved = md.match(/\*\*✋ Stage 0 scope approved\*\* by ([^.\n]+?) on (\d{4}-\d{2}-\d{2})/);
  const domains = [...md.matchAll(/^###\s+[A-Z0-9-]+:\s*(.+)$/gm)].map((m) => m[1].trim());
  return { title, goal: section(md, 'Goal'), approved: approved ? `Approved ${approved[2]} by ${approved[1]}` : undefined, domains, questions: section(md, 'Open questions') };
}

export function briefCard(): { el: HTMLElement; refresh(): void } {
  const body = h('div.pt-brief-b');
  const badge = h('span.pt-badge.pt-ok', { hidden: true });
  const open = h('button.pt-link', { type: 'button', onclick: () => openDocuments(store.floor) }, 'Open in Documents');
  const el = h('section.pt-ov-card.pt-brief', { 'aria-label': 'Project brief', hidden: true }, h('div.pt-ov-card-h', {}, h('h2', {}, 'Project brief'), badge, h('span.pt-grow'), open), body);
  let asked: string | undefined;

  function show(f: BriefFacts) {
    el.hidden = false;
    badge.hidden = !f.approved;
    badge.textContent = f.approved ?? '';
    const goal = f.goal.join(' ');
    body.replaceChildren(
      goal ? h('p.pt-brief-goal', {}, goal) : h('p.pt-card-none', {}, 'The brief has no goal written down.'),
      ...(f.domains.length ? [h('div.pt-chips', { 'aria-label': 'Functional domains' }, ...f.domains.map((d) => h('span.pt-chip', {}, d)))] : []),
      ...(f.questions.length ? [h('details.pt-brief-q', {}, h('summary', {}, `Open questions (${f.questions.length})`), h('ul', {}, ...f.questions.slice(0, 6).map((q) => h('li', {}, q))))] : []),
    );
  }

  function refresh() {
    const floor = store.floor;
    if (!floor || asked === floor) return;
    asked = floor;
    el.hidden = true;
    void fetch(`/api/deliverables/file?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(BRIEF_PATH)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : undefined))
      .then((md) => {
        if (md && asked === floor && store.floor === floor) show(parseBrief(md));
      })
      .catch(() => undefined);
  }
  return { el, refresh };
}
