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
import { isBusinessDecision } from '../../../shared/app-workspace/business-decisions';
import type { DecisionArtifact } from '../../../shared/decisions/artifact';
import type { ChangeRequestView } from '../../../shared/change-requests';
import { postRequest, requestsFeed, type RequestAsk, type RequestSent } from './requests';
import type { AnswerResult } from './decision-cards';

export interface WorkspaceDecision {
  id: string;
  question: string;
  detail?: string;
  since?: number;
  level: 'block' | 'warn' | 'info';
  /** Takes you to where it's answered (the strip's own way, with its own checks). */
  answer(): void;
  /** Its options and the team's recommendation, when it has them. */
  options?: string[];
  recommendation?: string;
  /** Who asked (and acts on the answer). */
  owner?: string;
  /** The related artifact it names explicitly (never guessed). */
  artifact?: DecisionArtifact;
  /** The escalation it is, when it is one (answered here), and the card's other escalations (answered with it). */
  escalation?: string;
  others?: string[];
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
  /** The project's change requests with their state, newest first (undefined: not read yet). */
  requests?: ChangeRequestView[];
}

export interface WorkspaceSource {
  get(): WorkspaceData;
  /** Calls `fn` when something it shows changed. Gives back a way to stop. */
  on(fn: () => void): () => void;
  /** The workspace is on screen: ask for what isn't known for this project yet. */
  wake(): void;
  /** Request a change (POST /api/change-requests): the request with its task id, or why not. */
  request(ask: RequestAsk): Promise<RequestSent>;
  /** Answers a decision through the decision cards' path, with the revision it was opened at (a stale one: 409). */
  answer(x: WorkspaceDecision, a: { verdict: 'reply'; text: string }): Promise<AnswerResult>;
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
  const requests = requestsFeed(() => emit());
  let awake = false;
  const again = () => awake && requests.again(store.floor);
  const wake = () => {
    awake = true;
    const f = store.floor;
    if (!f) return;
    wantBusiness(f, businessKey(store.liveApp));
    askBrief(f);
    askProgress(f);
    requests.want(f);
    currentRoster();
  };

  store.on('liveApp', () => {
    if (store.liveApp) wantBusiness(store.liveApp.floor, businessKey(store.liveApp));
    emit();
  });
  store.on('floor', () => (awake ? wake() : undefined, emit()));
  // A request's state hangs on the business status, the team (its task) and the PR list: asked again when one moves.
  store.on('pulls', () => (again(), emit()));
  onBusiness(() => {
    if (awake && store.floor) askProgress(store.floor);
    again();
    emit();
  });
  onNeeds(emit);
  onRoster(() => (again(), emit()));

  const me = () => store.me.account?.name ?? store.profile.name;
  return {
    wake,
    async request(ask) {
      const f = store.floor;
      if (!f) return { ok: false, error: 'Pick a project first' };
      const r = await postRequest(f, ask, me());
      if (r.ok) requests.now(f);
      return r;
    },
    answer: (x, a) => answerDecision(store.floor, x, a, me()),
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
        // The business owner's decisions only (shared/app-workspace/business-decisions.ts); the rest are counted for the Engineering view.
        here.items.forEach((item, i) => {
          const card = here.cards?.[i];
          const mine = card ? isBusinessDecision(card) : item.kind === 'questions';
          if (mine)
            decisions!.push({
              id: card?.id ?? item.key,
              question: card?.question ?? item.text,
              ...(card?.detail ? { detail: card.detail } : {}),
              ...(item.since ? { since: item.since } : {}),
              level: item.level,
              answer: () => here.go(item.target),
              ...(card?.options?.length ? { options: card.options } : {}),
              ...(card?.recommendation ? { recommendation: card.recommendation } : {}),
              ...(card?.owner ? { owner: card.owner } : {}),
              ...(card?.artifact ? { artifact: card.artifact } : {}),
              ...(card?.escalation && card.sources[0]?.type === 'escalation' ? { escalation: card.escalation, others: card.sources.slice(1).flatMap((s) => (s.escalation ? [s.escalation] : [])) } : {}),
            });
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
        ...(requests.get(floor) ? { requests: requests.get(floor) } : {}),
      };
    },
  };
}

/** POST /api/decisions/action (answer): the decision cards' own path, admins only, a stale revision a 409 with the current state. */
async function answerDecision(floor: string | null, x: WorkspaceDecision, a: { verdict: 'reply'; text: string }, by: string): Promise<AnswerResult> {
  if (!floor || !x.escalation) return { ok: false, status: 400, error: 'This decision is answered on its own page.' };
  try {
    // 0: the card shows an open escalation (no answer revision yet); answered meanwhile, the office refuses it.
    const res = await fetch('/api/decisions/action', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor, by, action: 'answer', escalation: x.escalation, others: x.others ?? [], verdict: a.verdict, text: a.text, expectedRev: 0 }) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; current?: { state?: string; open?: string; rev?: number } };
    return res.ok ? { ok: true } : { ok: false, status: res.status, error: out.error ?? 'The office couldn’t send it just now.', ...(out.current ? { current: out.current } : {}) };
  } catch {
    return { ok: false, status: 0, error: 'The office couldn’t be reached.' };
  }
}

const rank = (l: WorkspaceDecision['level']) => (l === 'block' ? 0 : l === 'warn' ? 1 : 2);
