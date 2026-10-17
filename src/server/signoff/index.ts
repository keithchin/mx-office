// Signing off a ✋ MANUAL toolkit stage from the office (shared/gate-play.ts says when one is in play).
// gate-check can't certify such a stage from files: its verdict is a CONFIRMED row in PROJECT.md's
// Decisions. The office doesn't edit the team's register under it, so the Project Manager's sign-off is
// told to whoever covers Management through the team's durable tell (roster/interrupts.ts: the words in
// the answer store, the intent on disk before typing, after the lead's current turn), with an explicit
// "Signed off: Stage N" and the exact row to add. Until the register has that row the sign-off is kept
// here (<data>/signoff/<project>.json), so Needs you says it waits for the lead rather than asking again;
// once the row is there the card is gone. Escalations the sign-off card folded (the lead asking for the
// same sign-off) are answered with the same explicit words, never with the card's title.

import { parseStoreSync } from '../durable/read.js';
import { writeJsonDurableSync } from '../durable/write.js';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { SetupView } from '../../shared/wizard.js';
import { manualInPlay, signoffMessage, signoffState, type SignoffRequest } from '../../shared/gate-play.js';
import { audit, byWhom } from '../audit/index.js';
import { managerRole } from '../roster/coverage.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

const cache = new Map<string, SignoffRequest[]>();
const fileOf = (dataDir: string, floorId: string) => path.join(dataDir, 'signoff', `${floorId.replace(/[^\w.-]/g, '_')}.json`);

/** The sign-offs given in the office on a project and not yet recorded (a tiny file, read once, then kept). */
export function signoffRequests(dataDir: string, floorId: string): SignoffRequest[] {
  const file = fileOf(dataDir, floorId);
  let list = cache.get(file);
  if (!list) {
    try {
      const v = parseStoreSync(file) as { requests?: SignoffRequest[] };
      list = Array.isArray(v.requests) ? v.requests.filter((r) => r && typeof r.stage === 'string' && typeof r.by === 'string' && typeof r.at === 'number') : [];
    } catch {
      list = [];
    }
    cache.set(file, list);
  }
  return list;
}

function save(dataDir: string, floorId: string, list: SignoffRequest[]) {
  const file = fileOf(dataDir, floorId);
  writeJsonDurableSync(file, { requests: list });
  cache.set(file, list);
}

/** A setup view with the project's sign-offs on it (wizard/index.ts setup()). */
export function withSignoffs(dataDir: string, floorId: string, v: SetupView): SetupView {
  const list = signoffRequests(dataDir, floorId);
  return list.length ? { ...v, signoffs: list } : v;
}

export interface SignoffDeps {
  dataDir: string;
  now(): number;
  /** The floor's setup view (its verdicts and decision rows). */
  setup(floor: Floor): Promise<SetupView | undefined>;
  /** Whoever covers Management, when at work. */
  lead(floor: Floor): string | undefined;
  /** The team's durable tell to the lead, after their turn: an error, or undefined when it went (or was held). */
  tell(floor: Floor, text: string, by: string, owner: string | undefined, decision: string): Promise<string | undefined>;
  /** Answers the open escalations the sign-off card folded with the same words (an error, or undefined). */
  answerFolded?(floor: Floor, ids: readonly string[], text: string, by: string, owner: string | undefined): Promise<string | undefined>;
}

export type SignoffResult = { ok: true; request: SignoffRequest; message: string } | { ok: false; status: 400 | 409; error: string };

/** The Project Manager signs `stage` off: checked in play, told to the lead with the row to add, kept until recorded. */
export async function signOff(deps: SignoffDeps, floor: Floor, stage: string, by: string, owner: string | undefined, folded: readonly string[] = []): Promise<SignoffResult> {
  const setup = await deps.setup(floor);
  const verdicts = setup?.verdicts?.length ? setup.verdicts : (setup?.stages ?? []);
  const v = verdicts.find((x) => x.id.toUpperCase() === stage.toUpperCase());
  if (!v || !manualInPlay(verdicts, v.id)) return { ok: false, status: 409, error: `Stage ${stage} isn't waiting for a sign-off: the stages before it haven't all passed, or gate-check has moved on` };
  const st = signoffState(setup, v.id);
  if (st.state === 'recorded') return { ok: false, status: 409, error: `Stage ${v.id} is already signed off in PROJECT.md` };
  const lead = deps.lead(floor);
  if (!lead) return { ok: false, status: 409, error: "This project's team lead isn't at work to record it: hire or wake them first" };
  const now = deps.now();
  const message = signoffMessage(v.id, v.title, by, new Date(now).toISOString().slice(0, 10));
  const err = await deps.tell(floor, message, by, owner, `tell:signoff-stage-${v.id}`);
  if (err) return { ok: false, status: 409, error: err };
  if (folded.length && deps.answerFolded) {
    const e = await deps.answerFolded(floor, folded, message, by, owner);
    if (e) console.warn(`agent-office: sign-off: the folded escalations weren't answered: ${e}`);
  }
  const request: SignoffRequest = { stage: v.id, by, at: now, lead };
  save(deps.dataDir, floor.id, [...signoffRequests(deps.dataDir, floor.id).filter((r) => r.stage !== v.id), request]);
  audit.record({ floor: floor.id, actor: byWhom(by, owner), action: 'signoff.stage', target: { kind: 'stage', id: v.id, label: `Stage ${v.id} (${v.title})` }, summary: `Signed off Stage ${v.id} (${v.title}): ${lead} is asked to record it in PROJECT.md`, details: { stage: v.id, lead, ...(folded.length ? { escalations: folded.slice(0, 10) } : {}) }, severity: 'notice' });
  return { ok: true, request, message };
}

/** The office's wiring: the wizard's setup view, the roster's lead and tell, and the decision cards' answer. */
export function signoffDeps(ctx: Ctx, setup: (floor: Floor) => Promise<SetupView | undefined>, answerFolded?: SignoffDeps['answerFolded']): SignoffDeps {
  return {
    dataDir: ctx.cfg.dataDir,
    now: Date.now,
    setup,
    lead(floor) {
      const roster = rosterOf(ctx);
      const d = roster.data(floor.id);
      const m = d.members[managerRole(d)];
      return m && m.phase === 'active' ? m.name : undefined;
    },
    tell: (floor, text, by, owner, decision) => rosterOf(ctx).interrupts.tell(teamFloor(ctx, floor), text, by, 'after', {}, owner, decision),
    ...(answerFolded ? { answerFolded } : {}),
  };
}
