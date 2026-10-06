// What drives a project's spend, and what would cut it: rules over the ledger's detailed rows (the last
// 30 days) and the team's settings. Drivers say where the money goes ("Opus Leads are 71 % of spend");
// suggestions point at an action the office already has (swap a role's model, delegate to a subagent,
// idle benching, Jeff's real-ask mode, early drafts), with the worker ranking's token-efficiency score
// where it helps. Pure, so the tests hold the rules.

import type { AgentInfo, Insight, SpendRow, StageId } from './types.js';
import { addDaysUtc } from './days.js';
import { usd } from './money.js';

export interface InsightInput {
  rows: readonly SpendRow[];
  agents: Readonly<Record<string, AgentInfo>>;
  today: string;
  stage: StageId;
  /** The team's settings, when the floor has a team. */
  team?: { idleMinutes: number; jeffWaiting: 'off' | 'shadow' | 'on'; earlyDrafts: boolean };
  /** Token efficiency (0-100) from the worker ranking, by worker id. */
  efficiency?: Readonly<Record<string, number>>;
}

/** A share at or over this is a driver worth saying. */
const DRIVER_SHARE = 0.4;
const family = (model: string) => (/opus/i.test(model) ? 'Opus' : /sonnet/i.test(model) ? 'Sonnet' : /haiku/i.test(model) ? 'Haiku' : /fable|mythos/i.test(model) ? 'Fable' : undefined);
/** What a Sonnet run costs against an Opus one, from the price list (Opus 5.5 $4/$20, Sonnet 5 $2/$10). */
export const SONNET_VS_OPUS = 0.5;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const sum = (rows: readonly SpendRow[]) => rows.reduce((n, r) => n + r.cost, 0);
const isLead = (role: string) => /^Lead |Chief Analyst/.test(role);
const EARLY: readonly StageId[] = ['P', '0', '1', '2'];

export function insights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const weekFrom = addDaysUtc(i.today, -6);
  const rows = i.rows.filter((r) => !r.unmetered);
  const week = rows.filter((r) => r.day >= weekFrom);
  const total = sum(rows);
  const weekTotal = sum(week);
  if (total <= 0) return out;
  const agent = (k: string) => i.agents[k];
  const workerRows = (rs: readonly SpendRow[]) => rs.filter((r) => agent(r.agent)?.kind === 'worker');

  // Drivers ------------------------------------------------------------------------------------
  // A model family the Leads run on, when it's most of the spend.
  const leadByFamily = new Map<string, number>();
  for (const r of workerRows(rows)) {
    const a = agent(r.agent)!;
    const f = family(r.model);
    if (f && isLead(a.role)) leadByFamily.set(f, (leadByFamily.get(f) ?? 0) + r.cost);
  }
  for (const [f, c] of leadByFamily) if (c / total >= DRIVER_SHARE) out.push({ id: `leads-${f.toLowerCase()}`, kind: 'driver', text: `${f} Leads are ${pct(c / total)} of spend (${usd(c)} in the last 30 days)`, action: { label: 'Org chart', to: 'org' } });

  // The Lead Tester's review loop: its own session and its subagents this week.
  const tester = Object.values(i.agents).find((a) => a.kind === 'worker' && a.role === 'Lead Tester');
  if (tester && weekTotal > 0) {
    const loop = sum(week.filter((r) => r.agent === tester.key || agent(r.agent)?.lead === tester.key));
    if (loop / weekTotal >= 0.15) out.push({ id: 'tester-loop', kind: 'driver', text: `Lead Tester's review loop cost ${usd(loop)} this week (${pct(loop / weekTotal)} of the week)`, action: { label: 'Agents', to: 'budget' } });
  }

  // The Coordinator's relays: its turns a day this week.
  const coord = Object.values(i.agents).find((a) => a.kind === 'worker' && a.role === 'Project Coordinator');
  if (coord) {
    const mine = week.filter((r) => r.agent === coord.key);
    const days = new Set(mine.map((r) => r.day)).size;
    const calls = mine.reduce((n, r) => n + r.calls, 0);
    if (days && calls / days >= 20) out.push({ id: 'coordinator-relays', kind: 'driver', text: `Coordinator relays ${Math.round(calls / days)} turns/day (${usd(sum(mine) / days)}/day)`, action: { label: 'Settings', to: 'settings' } });
  }

  // The office's background calls.
  const bg = sum(rows.filter((r) => agent(r.agent)?.kind === 'background'));
  if (bg / total >= 0.05) out.push({ id: 'background', kind: 'driver', text: `The office's own calls (Jeff, the analyzer, task naming, audits) are ${pct(bg / total)} of spend (${usd(bg)})` });

  // Suggestions --------------------------------------------------------------------------------
  // Swap a role's model: a Lead on Opus that's a big share of the week.
  const byLead = new Map<string, { own: number; subs: number; opus: number }>();
  for (const r of week) {
    const a = agent(r.agent);
    if (!a) continue;
    const key = a.kind === 'subagent' ? a.lead : a.kind === 'worker' && isLead(a.role) ? a.key : undefined;
    if (!key) continue;
    const o = byLead.get(key) ?? { own: 0, subs: 0, opus: 0 };
    if (a.kind === 'subagent') o.subs += r.cost;
    else {
      o.own += r.cost;
      if (family(r.model) === 'Opus') o.opus += r.cost;
    }
    byLead.set(key, o);
  }
  const eff = (k: string) => (i.efficiency?.[k] !== undefined ? `; token efficiency ${Math.round(i.efficiency[k])}/100 in the worker ranking` : '');
  const leads = [...byLead].sort((a, z) => z[1].opus - a[1].opus);
  for (const [k, o] of leads) {
    const a = agent(k);
    if (!a || weekTotal <= 0) continue;
    if (o.opus / weekTotal >= 0.2) {
      const saves = o.opus * (1 - SONNET_VS_OPUS);
      out.push({ id: `swap-${k}`, kind: 'suggestion', text: `Move ${a.name} (${a.role}) from Opus to Sonnet: about ${usd(saves)} a week less${eff(k)}`, saves, action: { label: 'Change its model', to: 'org' } });
    }
    // Delegate: a Lead doing nearly everything itself on Opus while its subagents sit idle.
    const lt = o.own + o.subs;
    if (o.opus > 0 && lt / weekTotal >= 0.15 && o.subs / lt < 0.2) {
      const saves = o.opus * 0.3 * (1 - SONNET_VS_OPUS);
      out.push({ id: `delegate-${k}`, kind: 'suggestion', text: `${a.name} does ${pct(o.own / lt)} of its work itself on Opus: handing drafts to its subagents (Sonnet) would save about ${usd(saves)} a week${eff(k)}`, saves, action: { label: 'Org chart', to: 'org' } });
    }
  }
  if (i.team) {
    if (i.team.idleMinutes === 0) out.push({ id: 'idle-benching', kind: 'suggestion', text: 'Turn on idle benching: an idle Lead is benched (its context cleared) instead of being woken with a long session', action: { label: 'Team settings', to: 'settings' } });
    if (i.team.jeffWaiting !== 'on') out.push({ id: 'jeff-real-ask', kind: 'suggestion', text: `Switch on Jeff's real-ask mode (now ${i.team.jeffWaiting}): agents that are really waiting on you are told apart from ones that just finished, so fewer nudges and wake-up turns`, action: { label: 'Team settings', to: 'settings' } });
    // Early drafts: what Design, Development and Testing spent while the pipeline was still early.
    const drafts = sum(rows.filter((r) => EARLY.includes(r.stage) && /^Lead (Designer|Developer|Tester)/.test(agent(agent(r.agent)?.lead ?? r.agent)?.role ?? '')));
    if (i.team.earlyDrafts && EARLY.includes(i.stage) && drafts / total >= 0.1) out.push({ id: 'early-drafts', kind: 'suggestion', text: `Early drafts have cost ${usd(drafts)} so far (Design, Development and Testing before the build plan): turn them off to save that until Stage 3`, saves: drafts, action: { label: 'Team settings', to: 'settings' } });
  }
  return out.sort((a, z) => (a.kind === z.kind ? (z.saves ?? 0) - (a.saves ?? 0) : a.kind === 'driver' ? -1 : 1));
}
