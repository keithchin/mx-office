// A floor's "Needs you" as the server sees it: the same NeedsInput the Command Center's strip builds in
// the browser (workers, the team, PRs, the setup panel, the Firm, Studio mode, incidents, the budget,
// stuck items, surfaced asks, questions and the decision cards' Separate choices), through the same
// builder (shared/decisions/input.ts) and collectNeeds (shared/needsyou.ts), then the red ones made ready to post.

import { collectNeeds, type NeedItem, type NeedsInput } from '../../shared/needsyou.js';
import { actionableRows, deliveryNeedsOf } from '../../shared/needs-actionable.js';
import type { RosterView } from '../../shared/roster/types.js';
import { capAt } from '../../shared/roster/autonomy.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { SetupView } from '../../shared/wizard.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { wizardOf } from '../wizard/index.js';
import { firmIfMade } from '../firm/adapter.js';
import { studioStateOf } from '../studio/index.js';
import { attentionBriefs } from '../incidents/index.js';
import { officeLink, type RedItem } from './cards.js';
import { budgetNeedOf } from '../budget/need.js';
import { stuckNeedOf } from '../stuck/index.js';
import { questionsNeedOf } from '../questions/index.js';
import { settingsHref } from '../../shared/settings-sections.js';
import { needsInputOf } from '../../shared/decisions/input.js';
import { asksFloor, asksOf } from '../asks/index.js';
import { decisionsOf } from '../decisions/index.js';
import { portfoliosOf } from '../portfolios/index.js';
import { designOf } from '../design/index.js';
import { marketplaceOf } from '../marketplace/index.js';
import { claudeAuthView } from '../claude-auth/index.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import type { AsksNeed } from '../../shared/asks.js';

/** The floor's surfaced asks as Needs you reads them (the same the browser's feed hands in). */
async function asksNeedOf(ctx: Ctx, floor: Floor): Promise<AsksNeed | undefined> {
  try {
    const v = await asksOf(ctx).view(asksFloor(ctx, floor), true);
    return v.items.length ? { floor: floor.id, items: v.items, ...(v.unreadAt ? { unreadAt: v.unreadAt } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

export interface FloorNeeds {
  input: NeedsInput;
  needs: NeedItem[];
}

/** What collectNeeds reads of the floor's team, without the Team tab's journals and members. */
function teamOf(ctx: Ctx, floor: Floor): RosterView {
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  const d = roster.data(floor.id);
  const paused = roster.pauseOf(d);
  return { floor: floor.id, admin: true, settings: d.settings, escalations: roster.escalations.view(tf), approvals: roster.approvals(tf, d, paused), paused, spentToday: d.spend.usd, cap: capAt(d.settings.costCaps, d.settings.autonomy) } as unknown as RosterView;
}

/** The setup panel's view is read from git: at most every couple of minutes per floor here. */
const SETUP_TTL_MS = 2 * 60_000;
const setups = new WeakMap<Floor, { at: number; view: SetupView | undefined }>();

async function setupOf(ctx: Ctx, floor: Floor, now: number): Promise<SetupView | undefined> {
  const hit = setups.get(floor);
  if (hit && now - hit.at < SETUP_TTL_MS) return hit.view;
  const view = await wizardOf(ctx)
    .setup(floor)
    .catch(() => undefined);
  setups.set(floor, { at: now, view });
  return view;
}

/** The project's answers whose outcome is unknown, as Needs-you items; none when the dispatch log can't be read. */
async function unconfirmedOf(ctx: Ctx, floor: Floor) {
  try {
    const d = rosterOf(ctx).dispatch;
    await d.ready(floor.id);
    return deliveryNeedsOf(floor.id, d.unsettled(floor.id));
  } catch {
    return [];
  }
}

export async function floorNeeds(ctx: Ctx, floor: Floor, now = Date.now()): Promise<FloorNeeds> {
  const roster = teamOf(ctx, floor);
  const setup = await setupOf(ctx, floor, now);
  const input: NeedsInput = needsInputOf({
    floor: floor.id,
    workers: floor.workers.list(),
    roster,
    pulls: floor.github.pulls.items,
    floors: [],
    setup,
    // A crash or a milestone ready in it (shared/liveapp/status.ts liveNotifies); none when nobody ever opened a live app.
    live: liveAppsIfMade(ctx)?.peek(floor.id),
    // Its report-ready line comes from an audit this office ran, so a Firm nobody made has none.
    firm: firmIfMade(ctx)?.floorStatus(floor.id),
    studio: studioStateOf(floor.id),
    incidents: attentionBriefs(),
    budget: budgetNeedOf(ctx, floor),
    stuck: await stuckNeedOf(ctx, floor),
    asks: await asksNeedOf(ctx, floor),
    questions: await questionsNeedOf(ctx, floor),
    splits: await decisionsOf(ctx).splits.get(floor.id).catch(() => []),
    brain: portfoliosOf(ctx).changeView(floor.id, true),
    design: designOf(ctx).needView(floor.id, true),
    marketplace: await marketplaceOf(ctx).view(floor.id, true).catch(() => undefined),
    // Office-wide: posted with the first project only, so one alert is one post.
    claude: ctx.floors.values().next().value === floor ? claudeAuthView(false) : undefined,
  });
  // Answers whose delivery the office couldn't confirm: the Command Center draws their cards from the dispatch
  // feed; the tray, Home, Teams and pushes count them here as needing intervention.
  return { input, needs: [...collectNeeds(input), ...(await unconfirmedOf(ctx, floor))] };
}

const URGENT_WORD = (n: NeedItem) => n.tag ?? (n.level === 'block' ? 'Blocking' : 'Needs a look');

/** Who an item is from or about. */
function whoOf(n: NeedItem, workers: readonly WorkerInfo[], roster: RosterView | undefined, input: NeedsInput): string {
  const t = n.target;
  switch (n.kind) {
    case 'asking':
      return (t.to === 'worker' && workers.find((w) => w.id === t.id)?.name) || 'An agent';
    case 'escalation':
      return (t.to === 'escalation' && roster?.escalations.find((e) => e.id === t.id)?.by) || 'The team';
    case 'pr':
      return (t.to === 'pr' && input.pulls.find((p) => p.number === t.number)?.author) || 'GitHub';
    case 'paused':
      return 'Spend cap';
    case 'setup':
      return 'Toolkit gate';
    case 'audit':
      return 'The Firm';
    case 'studio':
      return 'Studio Pro';
    case 'budget':
      return 'Budget';
    case 'stuck':
      return 'Stuck detection';
    case 'questions':
      return 'Questions';
    case 'delivery':
      return 'Your answer';
    default:
      return 'The office';
  }
}

/** The line without its "who" prefix, when the item's text starts with it. */
function summaryOf(n: NeedItem, who: string): string {
  if (n.kind === 'asking' && n.text.startsWith(`${who} is asking: `)) return n.text.slice(who.length + 12);
  if (n.kind === 'escalation' && n.text.startsWith(`${who} escalated: `)) return n.text.slice(who.length + 12);
  return n.text;
}

/** Where an item's Open button goes: the floor's 1D view (its Command Center lists it), its ⚙️ Settings section, or the Firm's report. */
export function pathOf(n: Pick<NeedItem, 'target'>, floor: string): string {
  if (n.target.to === 'firm') return n.target.url.replace(/^\//, '');
  if (n.target.to === 'settings') return settingsHref(n.target.section ?? 'team', floor).replace(/^\//, '');
  return `lite?floor=${encodeURIComponent(floor)}`;
}

/** The red items, each with a stable id: an agent's question also by when it started, so a new one posts again. */
export function redItems(floor: Floor, f: FloorNeeds, publicUrl: string | undefined): RedItem[] {
  const workers = [...f.input.workers];
  const out: RedItem[] = [];
  // One rule for every surface (shared/needs-actionable.ts): red, not a sign-off waiting to be recorded, a batch once.
  for (const n of actionableRows(f.needs)) {
    const who = whoOf(n, workers, f.input.roster, f.input);
    out.push({
      id: `${floor.id}:${n.key}${n.kind === 'asking' && n.since ? `@${n.since}` : ''}`,
      floor: floor.id,
      project: floor.def.name,
      who,
      summary: summaryOf(n, who),
      urgency: URGENT_WORD(n),
      level: n.level === 'block' || n.kind === 'asking' ? 'block' : 'warn',
      ...(n.since !== undefined ? { since: n.since } : {}),
      ...(n.rank ? { rank: n.rank.n } : {}),
      ...(officeLink(publicUrl, pathOf(n, floor.id)) ? { link: officeLink(publicUrl, pathOf(n, floor.id)) } : {}),
    });
  }
  return out;
}
