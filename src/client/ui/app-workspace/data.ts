// What the App Workspace shows, put together from what the page already has or already asks for: the live
// app as the office last said it (store.liveApp, the liveapp.state message), the business status
// (ui/business-status/feed.ts: GET /api/business-status, the same answer Home, the phone and the progress
// bar give), Needs you's decisions (ui/needsyou/feed.ts: the strip's own snapshot, nothing worked out
// again), the progress bar's phases and acceptance (GET /api/progress, asked once per project and again
// only when the business status moves), the approved brief (the Documents page's file route, once per
// project), the finished changes (the pull request list the page keeps) and the team's autonomy level
// (the roster the page keeps). No timer: every piece is asked when something it hangs on changed.

import { store } from '../../state';
import type { LiveAppState } from '../../../shared/protocol';
import type { BusinessStatus } from '../../../shared/business-status';
import type { ProgressAcceptance } from '../../../shared/progress';
import { AUTONOMY } from '../../../shared/roster/autonomy';
import { businessNow, onBusiness, wantBusiness } from '../business-status/feed';
import { appUrl, businessKey } from '../liveapp';
import { currentNeeds, onNeeds } from '../needsyou/feed';
import { getProgress } from '../progress/api';
import { BRIEF_PATH, parseBrief, type BriefFacts } from '../portal/brief-card';
import { currentRoster, onRoster } from '../teams/world';

export interface WorkspaceDecision {
  id: string;
  question: string;
  detail?: string;
  since?: number;
  level: 'block' | 'warn' | 'info';
  /** Takes you to where it's answered (the strip's own way, with its own checks). */
  answer(): void;
}

export interface WorkspaceData {
  floor: string | null;
  /** The project's name. */
  project?: string;
  /** The live app (null: the office hasn't said yet). */
  live: LiveAppState | null;
  /** Where this browser reaches it, while it runs. */
  appUrl?: string;
  /** The project's business status, and each milestone's (undefined: not known yet). */
  business?: BusinessStatus;
  milestones: BusinessStatus[];
  /** The progress bar's answer, in short (undefined: not known yet). */
  progress?: { toolkit: boolean; phase?: string; phaseTitle?: string; done: number; total: number; acceptance?: ProgressAcceptance };
  /** The approved brief (null: there is none; undefined: not read yet). */
  brief?: BriefFacts | null;
  /** The decisions the team needs from you, most blocking first (undefined: Needs you hasn't worked them out yet). */
  decisions?: WorkspaceDecision[];
  /** Everything else that waits on someone (hands-on and engineering items, shown on the Engineering view). */
  others: number;
  /** Finished changes, newest first (undefined: not read yet). */
  changes?: { title: string; at?: string }[];
  autonomy?: { level: number; name: string; byStage: boolean };
  admin: boolean;
}

export interface WorkspaceSource {
  get(): WorkspaceData;
  /** Calls `fn` when something it shows changed. Gives back a way to stop. */
  on(fn: () => void): () => void;
  /** The workspace is on screen: ask for what isn't known for this project yet. */
  wake(): void;
}

/** A change's title without a conventional prefix ("feat(sheets): " and the like) or a trailing (#12). */
export const changeTitle = (t: string) => t.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/\s*\(#\d+\)\s*$/, '').trim();

/** The page's own source: everything above, kept per project. */
export function pageSource(): WorkspaceSource {
  const fns = new Set<() => void>();
  const emit = () => fns.forEach((fn) => fn());
  let brief: { floor: string; v: BriefFacts | null | undefined } | undefined;
  let progress: { floor: string; key: string; v?: WorkspaceData['progress'] } | undefined;

  const askBrief = (floor: string) => {
    if (brief?.floor === floor) return;
    const mine: { floor: string; v: BriefFacts | null | undefined } = (brief = { floor, v: undefined });
    void fetch(`/api/deliverables/file?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(BRIEF_PATH)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null)
      .then((md) => {
        if (brief !== mine) return;
        mine.v = md ? parseBrief(md) : null;
        emit();
      });
  };
  const askProgress = (floor: string) => {
    const b = businessNow(floor)?.project;
    const key = `${b?.state ?? ''}|${b?.revision ?? ''}`;
    if (progress?.floor === floor && progress.key === key) return;
    const mine = (progress = { floor, key, v: progress?.floor === floor ? progress.v : undefined });
    void getProgress(floor, true).then((p) => {
      if (progress !== mine || !p) return;
      const phases = p.phases.filter((x) => x.kind !== 'accepted');
      const cur = p.phases.find((x) => x.current);
      mine.v = { toolkit: p.toolkit, phase: cur?.id, phaseTitle: cur?.title, done: phases.filter((x) => x.status === 'done' || x.status === 'waived').length, total: phases.length, acceptance: p.acceptance };
      emit();
    });
  };
  let awake = false;
  const wake = () => {
    awake = true;
    const f = store.floor;
    if (!f) return;
    wantBusiness(f, businessKey(store.liveApp));
    askBrief(f);
    askProgress(f);
    currentRoster();
  };

  store.on('liveApp', () => {
    if (store.liveApp) wantBusiness(store.liveApp.floor, businessKey(store.liveApp));
    emit();
  });
  store.on('floor', () => (awake ? wake() : undefined, emit()));
  store.on('pulls', emit);
  onBusiness(() => {
    if (awake && store.floor) askProgress(store.floor);
    emit();
  });
  onNeeds(emit);
  onRoster(emit);

  return {
    wake,
    on(fn) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    get() {
      const floor = store.floor;
      const live = store.liveApp && store.liveApp.floor === floor ? store.liveApp : null;
      const biz = businessNow(floor);
      const needs = currentNeeds();
      const here = needs && (!needs.floor || needs.floor === floor) ? needs : undefined;
      let decisions: WorkspaceDecision[] | undefined;
      let others = 0;
      if (here) {
        decisions = [];
        here.items.forEach((item, i) => {
          const card = here.cards?.[i];
          const isDecision = card ? card.kind === 'decision' : item.kind === 'escalation' || item.kind === 'questions';
          if (isDecision) decisions!.push({ id: card?.id ?? item.key, question: card?.question ?? item.text, ...(card?.detail ? { detail: card.detail } : {}), ...(item.since ? { since: item.since } : {}), level: item.level, answer: () => here.go(item.target) });
          else if (item.level !== 'info') others++;
        });
        decisions.sort((a, b) => rank(a.level) - rank(b.level));
      }
      const pulls = store.pulls;
      const changes = pulls.loading && !pulls.items.length ? undefined : pulls.items
        .filter((p) => p.state === 'MERGED')
        .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
        .slice(0, 5)
        .map((p) => ({ title: changeTitle(p.title), ...(p.mergedAt ? { at: p.mergedAt } : {}) }));
      const roster = currentRoster();
      const level = roster?.settings.autonomy;
      return {
        floor,
        project: store.currentFloor()?.name,
        live,
        ...(live?.status === 'running' && appUrl(live) ? { appUrl: appUrl(live) } : {}),
        ...(biz ? { business: biz.project } : {}),
        milestones: biz?.milestones ?? [],
        ...(progress?.floor === floor && progress.v ? { progress: progress.v } : {}),
        ...(brief?.floor === floor ? { brief: brief.v } : {}),
        ...(decisions ? { decisions } : {}),
        others,
        ...(changes ? { changes } : {}),
        ...(level ? { autonomy: { level, name: AUTONOMY[level].name, byStage: !!roster?.settings.autonomyByStage?.enabled } } : {}),
        admin: !!store.me.admin,
      };
    },
  };
}

const rank = (l: WorkspaceDecision['level']) => (l === 'block' ? 0 : l === 'warn' ? 1 : 2);
