// Microsoft Teams notifications: the office posts Adaptive Cards to a Teams Workflows webhook when
// something needs a person (the red "Needs you" items), and, at the digest level, a summary per floor
// each morning after its standup. One-way: no Teams app, bot or admin consent, only a workflow someone
// makes in their channel. Polls every posting floor (gather.ts), hands what it finds to the notifier
// (dedupe, the minute's batch, holds and catch-up) and logs every post to the audit log as
// notify.teams.sent / notify.teams.failed, never with the URL. Started by office/timers.ts.

import path from 'node:path';
import { inQuietHours, type TeamsSettingsView } from '../../shared/notify-teams.js';
import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { rosterOf } from '../roster/adapter.js';
import { digestCard, officeLink, testCard, type TeamsMessage } from './cards.js';
import { buildDigest, digestDue } from './digest.js';
import { floorNeeds, redItems } from './gather.js';
import { TeamsNotifier } from './notifier.js';
import { postToTeams, type PostOptions } from './sender.js';
import { TeamsSettings } from './settings.js';

/** How often each posting floor is looked at. */
export const POLL_MS = 20_000;

const OFFICE_ACTOR = { kind: 'office' as const, name: 'Agent Office' };

export class TeamsNotify {
  readonly settings: TeamsSettings;
  readonly notifier: TeamsNotifier;
  private error?: string;
  private lastSentAt?: number;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly postOpts: PostOptions = {},
  ) {
    const dir = ctx.cfg.dataDir;
    this.settings = TeamsSettings.in(dir);
    this.notifier = new TeamsNotifier({
      now: () => Date.now(),
      file: path.join(dir, 'notify-teams-state.json'),
      post: (msg, what) => this.post(msg, what),
      holdReason: () => this.holdReason(),
      home: () => officeLink(this.settings.get().publicUrl, ''),
    });
  }

  start() {
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Why posting is held back now: a pause from ⚙️ Settings, or quiet hours on the office's clock. */
  holdReason(now = new Date()): string | undefined {
    if (this.settings.paused(now.getTime())) return 'paused';
    if (inQuietHours(this.settings.get().quiet, now.getHours() * 60 + now.getMinutes())) return 'quiet hours';
    return undefined;
  }

  view(admin: boolean): TeamsSettingsView {
    const s = this.settings.get();
    return {
      on: !!this.settings.url(),
      hint: this.settings.hint(),
      storedIn: this.settings.where(),
      floors: s.floors,
      level: s.level,
      ...(s.quiet ? { quiet: s.quiet } : {}),
      ...(this.settings.paused() ? { pausedUntil: s.pausedUntil } : {}),
      ...(s.publicUrl ? { publicUrl: s.publicUrl } : {}),
      by: s.by,
      at: s.at,
      error: this.error,
      lastSentAt: this.lastSentAt,
      pending: this.notifier.pendingCount,
      held: this.notifier.heldCount,
      allFloors: [...this.ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name })),
      admin,
    };
  }

  /** The Test button: posts at once, outside the batch and any hold. */
  test(by: string): Promise<string | undefined> {
    return this.post(testCard(by, this.ctx.officeName, officeLink(this.settings.get().publicUrl, '')), { kind: 'test', items: 0, floors: [] });
  }

  /** One look at every posting floor; never throws, never overlaps. */
  async poll(now = Date.now()): Promise<void> {
    if (this.polling || !this.settings.url()) return;
    this.polling = true;
    try {
      const s = this.settings.get();
      for (const floor of this.ctx.floors.values()) {
        if (!this.settings.posts(floor.id)) {
          this.notifier.dropFloor(floor.id);
          continue;
        }
        try {
          const f = await floorNeeds(this.ctx, floor, now);
          this.notifier.observe(floor.id, redItems(floor, f, s.publicUrl));
          if (s.level === 'digest' && !this.holdReason()) await this.maybeDigest(floor.id, f, now);
        } catch (err) {
          console.error(`agent-office: notify-teams: couldn't look at ${floor.id}: ${(err as Error).message}`);
        }
      }
      await this.notifier.tick();
    } finally {
      this.polling = false;
    }
  }

  private async maybeDigest(floorId: string, f: Awaited<ReturnType<typeof floorNeeds>>, now: number) {
    const floor = this.ctx.floors.get(floorId);
    if (!floor) return;
    const d = rosterOf(this.ctx).data(floorId);
    const compiled = d.standups.filter((x) => x.status === 'compiled').at(-1)?.compiledAt;
    const slot = digestDue(now, d.settings.schedule, compiled, this.notifier.state.digests[floorId]);
    if (slot === undefined) return;
    const r = f.input.roster;
    const data = buildDigest({
      floor: floorId,
      project: floor.def.name,
      now,
      pulls: floor.github.pulls.items,
      needs: f.needs,
      spent: r?.spentToday,
      cap: r?.cap,
      setup: f.input.setup,
      link: officeLink(this.settings.get().publicUrl, `lite?floor=${encodeURIComponent(floorId)}`),
    });
    const err = await this.post(digestCard(data), { kind: 'digest', items: data.openNeeds, floors: [floorId] });
    // A digest that didn't get through isn't tried again for this slot: tomorrow's will come.
    this.notifier.state.digests[floorId] = slot;
    this.notifier.save();
    if (err) console.error(`agent-office: notify-teams: the digest for ${floorId} didn't go: ${err}`);
  }

  private async post(msg: TeamsMessage, what: { kind: string; items: number; floors: string[] }): Promise<string | undefined> {
    const url = this.settings.url();
    if (!url) return 'No Teams webhook is set';
    const r = await postToTeams(url, msg, this.postOpts);
    const floor = what.floors.length === 1 ? what.floors[0] : undefined;
    const details = { kind: what.kind, items: what.items, floors: what.floors, attempts: r.attempts, ...(r.status ? { status: r.status } : {}) };
    if (r.ok) {
      this.error = undefined;
      this.lastSentAt = Date.now();
      audit.record({ ...(floor ? { floor } : {}), actor: OFFICE_ACTOR, action: 'notify.teams.sent', target: { kind: 'notify', id: 'teams', label: 'Teams' }, summary: `Posted a ${what.kind} card to Teams${what.items ? ` (${what.items} item${what.items === 1 ? '' : 's'})` : ''}`, details });
      return undefined;
    }
    this.error = r.error;
    audit.record({ ...(floor ? { floor } : {}), actor: OFFICE_ACTOR, action: 'notify.teams.failed', target: { kind: 'notify', id: 'teams', label: 'Teams' }, summary: `Couldn't post a ${what.kind} card to Teams: ${r.error}`, details: { ...details, error: r.error }, severity: 'warning' });
    console.error(`agent-office: notify-teams: ${r.error}`);
    return r.error;
  }
}

const offices = new WeakMap<object, TeamsNotify>();

/** The office's Teams notifications: made on first use, then the same one. */
export function teamsNotifyOf(ctx: Ctx): TeamsNotify {
  let t = offices.get(ctx.cfg);
  if (!t) {
    t = new TeamsNotify(ctx);
    offices.set(ctx.cfg, t);
  }
  return t;
}

/** Starts polling; returns what stops it. */
export function startNotifyTeams(ctx: Ctx): () => void {
  const t = teamsNotifyOf(ctx);
  t.start();
  return () => t.stop();
}
