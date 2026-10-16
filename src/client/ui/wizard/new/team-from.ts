import './team-from.css';
// Start from a team, in the New project flow's Team & budget card (shared/team-from.ts): pick a project already
// in the office and copy its team's setup (shape, roles, each role's model, the budget level; never the amount),
// shown line by line with what is never copied; then edit as usual. "Also bring the same agents" picks those
// projects' agent profiles for the new seats; any that are on another project (or benched there) are listed in
// a Move confirmation before setup starts (confirm()), and the profiles' Move does the rest at the team step.
// The list is fetched once per New project, when the card first shows (GET /api/team-sources).
import { NOT_COPIED, COPY_HONESTY, copiedLines, copyTeam, type PlanTeamFrom, type SourceAgent, type TeamCopy, type TeamSource } from '../../../../shared/team-from';
import { PROFILE_HONESTY } from '../../../../shared/profiles';
import { SHAPES } from '../../../../shared/roster/coverage';
import { ROLE_BY_ID } from '../../../../shared/roster/roles';
import { INTERVIEW_MODE_INFO, type ProjectRole } from '../../../../shared/wizard';
import { h } from '../../dom';
import { openDialog } from './dialog';
import { icon } from './parts';
import type { Flow } from './index';

const lists = new WeakMap<Flow, Promise<TeamSource[] | string>>();
const title = (r: string) => ROLE_BY_ID.get(r as ProjectRole)?.title ?? r;
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

function fetchSources(flow: Flow): Promise<TeamSource[] | string> {
  let p = lists.get(flow);
  if (!p) {
    p = fetch('/api/team-sources', { credentials: 'same-origin' })
      .then(async (r) => {
        const v = (await r.json().catch(() => ({}))) as { sources?: TeamSource[]; error?: string };
        return r.ok && Array.isArray(v.sources) ? v.sources : (v.error ?? `The office said ${r.status}`);
      })
      .catch((e: Error) => e.message);
    lists.set(flow, p);
  }
  return p;
}

/** What a Move does there, in a sentence (the confirmation and the agent list). */
export function moveText(a: SourceAgent): string {
  if (a.where === 'working' && a.at) return `${a.name} is working on ${a.at.project} as ${title(a.at.role)}: a handoff note there first (it stays with ${a.at.project}), then a fresh session here. That seat on ${a.at.project} becomes open for someone new.`;
  if (a.where === 'benched' && a.at) return `${a.name} is benched on ${a.at.project}: that seat is released, and its next hire there is someone new.`;
  if (a.where === 'moving' && a.at) return `${a.name} is moving to ${a.at.project} now: can’t be brought until that move is finished or cancelled.`;
  return `${a.name} is on no project: hired with this project’s team.`;
}

export interface TeamFromHooks {
  /** Set the copy on the plan (the card's own pick of shape and level) and draw again. */
  apply(copy: TeamCopy): void;
  /** Back to the suggestion. */
  clear(): void;
  redraw(): void;
}

export function teamFromPanel(flow: Flow, hooks: TeamFromHooks) {
  const el = h('div.nw-tf', {});
  let sources: TeamSource[] | string | undefined;
  let open = false;
  let picked: TeamSource | undefined;
  /** Why the copied models were let go (the person picked another level), shown under the summary. */
  let note = '';

  const agentsFor = (src: TeamSource) => src.agents.filter((a) => flow.plan.roles.includes(a.role));

  function pick(src: TeamSource) {
    const copy = copyTeam(src);
    picked = src;
    open = false;
    note = '';
    flow.plan.teamFrom = { floor: src.floor, project: src.project, ...(src.client ? { client: src.client } : {}), models: copy.models, ...(copy.level ? { level: copy.level } : {}) };
    hooks.apply(copy);
    flow.say(`Copied the setup of ${src.project}`);
    el.querySelector<HTMLElement>('.nw-tf-sum h3')?.focus();
  }

  function clear() {
    picked = undefined;
    delete flow.plan.teamFrom;
    hooks.clear();
    el.querySelector<HTMLElement>('.nw-tf-open')?.focus();
  }

  /** Keep the plan's team source in step with what the person changed since (roles, level). */
  function sync() {
    const t = flow.plan.teamFrom;
    if (!t || !picked) return;
    for (const r of Object.keys(t.models) as ProjectRole[]) if (!flow.plan.roles.includes(r)) delete t.models[r];
    if (t.agents) t.agents = t.agents.filter((a) => flow.plan.roles.includes(a.role));
    if (t.agents && !t.agents.length) (delete t.agents, delete t.moveConfirmed);
    const level = flow.plan.budget?.level;
    if (t.level && level && level !== t.level && Object.keys(t.models).length) {
      t.models = {};
      note = `You picked ${cap(level)}, so each role’s model follows that level instead of ${picked.project}’s.`;
    }
  }

  function row(src: TeamSource): HTMLElement {
    const s = SHAPES[src.shape];
    const b = h(
      'button.nw-tf-row',
      { type: 'button', 'data-floor': src.floor },
      h('b', {}, src.project),
      src.client ? h('span.nw-tf-client', {}, src.client) : null,
      h('span.nw-tf-meta', {}, `${s.icon} ${s.label} · ${src.roles.length} member${src.roles.length === 1 ? '' : 's'}${src.level && src.level !== 'manual' ? ` · ${cap(src.level)}` : ''}${src.agents.length ? ` · ${src.agents.map((a) => a.name).join(', ')}` : ''}`),
    );
    b.addEventListener('click', () => pick(src));
    return b;
  }

  function listBody(): HTMLElement {
    if (sources === undefined) return h('p.nw-hint', {}, 'Looking at the office’s projects…');
    if (typeof sources === 'string') return h('p.nw-hint', {}, `Couldn’t list the projects: ${sources}`);
    if (!sources.length) return h('p.nw-hint', {}, 'No project in the office has had a team yet.');
    return h('div.nw-tf-list', { role: 'group', 'aria-label': 'Projects to copy the team from' }, ...sources.map(row));
  }

  function agentsBlock(src: TeamSource, t: PlanTeamFrom): HTMLElement | null {
    const all = agentsFor(src);
    if (!all.length) return h('p.nw-hint', {}, `${src.project} has no agents for these roles to bring.`);
    const usable = all.filter((a) => a.where !== 'moving');
    const tick = h('input', { type: 'checkbox', checked: !!t.agents?.length, disabled: !usable.length }) as HTMLInputElement;
    tick.addEventListener('change', () => {
      if (tick.checked) t.agents = usable.map((a) => ({ role: a.role, profile: a.profile, name: a.name }));
      else delete t.agents;
      delete t.moveConfirmed;
      hooks.redraw();
      el.querySelector<HTMLInputElement>('.nw-tf-bring input')?.focus();
    });
    return h(
      'div.nw-tf-agents',
      {},
      h('label.nw-check.nw-tf-bring', {}, tick, h('span', {}, ' Also bring the same agents ', h('span.nw-muted', {}, '(their profiles: a name and a history, not their sessions or notes)'))),
      t.agents?.length ? h('ul.nw-tf-ul', {}, ...all.map((a) => h('li', { class: a.where === 'moving' ? 'nw-muted' : '' }, h('b', {}, `${title(a.role)}: `), moveText(a)))) : null,
    );
  }

  function draw() {
    sync();
    const t = flow.plan.teamFrom;
    if (!picked || !t) {
      const btn = h('button.btn.nw-tf-open', { type: 'button', 'aria-expanded': String(open), 'aria-controls': 'nw-tf-list' }, icon('team'), 'Start from a team');
      btn.addEventListener('click', () => {
        open = !open;
        draw();
        el.querySelector<HTMLElement>('.nw-tf-open')?.focus();
      });
      el.replaceChildren(h('div.nw-tf-head', {}, btn, h('span.nw-hint', {}, 'Copy the team setup of a project already in the office, then change what you like.')), h('div', { id: 'nw-tf-list', hidden: !open }, open ? listBody() : ''));
      return;
    }
    const stop = h('button.nw-link', { type: 'button' }, icon('x'), 'Don’t start from a team');
    stop.addEventListener('click', clear);
    const p = flow.plan;
    el.replaceChildren(
      h(
        'div.nw-tf-sum',
        {},
        h('div.nw-tf-sumh', {}, h('h3', { tabindex: '-1' }, `Copies the setup of ${picked.project}${picked.client ? ` (${picked.client})` : ''}`), stop),
        h('ul.nw-tf-ul', {}, ...copiedLines(picked, { ...copyTeam(picked), models: t.models }, title).map((l) => h('li', {}, l))),
        note ? h('p.nw-hint', {}, note) : null,
        h('p.nw-hint', {}, `${COPY_HONESTY} Change the shape, the roles or the level below as usual.`),
        h('div.nw-tf-not', {}, h('b', {}, 'Not copied'), h('ul.nw-tf-ul', {}, ...NOT_COPIED.map((l) => h('li', {}, l)))),
        h('p.nw-tf-review', {}, h('b', {}, 'This project’s own settings: '), `commands ${p.execApproval === 'ask' ? 'ask before running' : 'run without asking'} · interview ${INTERVIEW_MODE_INFO[p.interview].label.split(':')[0]} · change them under Advanced.`),
        agentsBlock(picked, t),
      ),
    );
  }

  return {
    el,
    draw,
    /** The card showed: the list is fetched once per New project. */
    load() {
      if (sources !== undefined) return;
      void fetchSources(flow).then((v) => {
        sources = v;
        if (open) draw();
      });
    },
    /**
     * Before Create project: agents that need a Move are listed, and setup starts only once the person confirms.
     * True to go on.
     */
    confirm(opener: HTMLElement): Promise<boolean> {
      const t = flow.plan.teamFrom;
      const src = picked;
      if (!t?.agents?.length || !src) return Promise.resolve(true);
      const rows = t.agents.map((a) => src.agents.find((x) => x.profile === a.profile)).filter((a): a is SourceAgent => !!a);
      const moving = rows.filter((a) => a.where !== 'free');
      if (!moving.length) return Promise.resolve(true);
      return new Promise((done) => {
        let answered = false;
        const cancel = h('button.btn', { type: 'button' }, 'Cancel');
        const go = h('button.btn.primary', { type: 'button' }, `Move ${moving.length === 1 ? moving[0].name : 'them'} and create`);
        const dlg = openDialog(
          flow.layer,
          moving.length === 1 ? `Move ${moving[0].name} to this project?` : `Move ${moving.length} agents to this project?`,
          [
            h('ul.nw-tf-ul.nw-tf-moves', {}, ...rows.map((a) => h('li', {}, h('b', {}, `${title(a.role)}: `), moveText(a)))),
            h('p.nw-hint', {}, `Nothing from ${src.project} comes with them: no session, handoff, journal or notes. ${PROFILE_HONESTY}`),
            h('p.nw-hint', {}, 'Each move is recorded, so a restart carries it on; if one stops, Home › Agents shows Retry and Cancel.'),
          ],
          { opener, foot: [cancel, go], onClose: () => !answered && done(false) },
        );
        cancel.addEventListener('click', () => dlg.close());
        go.addEventListener('click', () => {
          answered = true;
          t.moveConfirmed = true;
          dlg.close();
          done(true);
        });
      });
    },
  };
}
