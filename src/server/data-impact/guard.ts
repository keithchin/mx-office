// The data-impact guard: before an environment applies a revision (today: the live preview, server/liveapp/,
// on an update, a restart or a start over a database an earlier build used), it asks `check` with the
// revision applied there now (the starting baseline) and the candidate. A model diff that finds nothing that
// touches stored data passes; anything else holds, unless an approval binds all four of: the environment,
// the baseline, the candidate and the recovery evidence (a dump still on disk with the recorded size and
// sha256, or the approver's "no data to keep"). Any change to one of them voids the approval, said in the
// record and the audit, and the new pair is assessed again. A model that can't be read holds as `unknown`.
//
// The hold is a fact of its own (HeldFact): main has the candidate, the environment doesn't run it. It never
// folds into merged, implemented or verified.

import { randomUUID } from 'node:crypto';
import { audit, office } from '../audit/index.js';
import type { ModelUnits } from '../model/units.js';
import { binds, ENV_LIVE, holdReason, voidWhy, recoveryWords, type DataImpactApproval, type ImpactAssessment, type ImpactEnv } from '../../shared/data-impact.js';
import { Assessments } from './assess.js';
import { countRows, dumpStillThere, type PgTarget } from './pg.js';
import { ImpactStore, type Held } from './store.js';

export interface CheckInput {
  floorId: string;
  /** A repository that has both commits (the live checkout). */
  dir: string;
  base: string;
  target: string;
  units: ModelUnits;
  env?: ImpactEnv;
}

export type Verdict = { hold: false; assessment: ImpactAssessment; approval?: DataImpactApproval } | { hold: true; why: string; held: Held };

export interface GuardDeps {
  dataDir: string;
  /** The project's database in that environment, for row counts and dumps; none: no counts. */
  pg?(floorId: string, env: ImpactEnv): PgTarget | undefined;
  /** Told when a project's hold or approvals changed (the page asks again). */
  changed?(floorId: string): void;
}

const short = (sha: string) => sha.slice(0, 7);
const ROWS_MS = 20_000;

export class DataImpactGuard {
  readonly store: ImpactStore;
  private byUnits = new WeakMap<ModelUnits, Assessments>();

  constructor(readonly d: GuardDeps) {
    this.store = new ImpactStore(d.dataDir);
  }

  assessments(units: ModelUnits): Assessments {
    let a = this.byUnits.get(units);
    if (!a) this.byUnits.set(units, (a = new Assessments(units)));
    return a;
  }

  /** Whether `target` may be applied over `base` in `env`; records the hold (once per binding) and voids approvals that no longer bind. */
  async check(i: CheckInput): Promise<Verdict> {
    const env = i.env ?? ENV_LIVE;
    const assessment = await this.assessments(i.units).assess(i.dir, i.base, i.target);
    const rec = this.store.get(i.floorId);
    const binding = { env, base: i.base, target: i.target };
    if (assessment.status === 'clear') {
      if (rec.holds[env]) this.release(i.floorId, env, `the change to ${short(i.target)} touches no stored data`);
      return { hold: false, assessment };
    }
    // Approvals that bind on environment, baseline and target; then the recovery evidence must still be what was recorded.
    for (const a of rec.approvals.filter((x) => !x.void && x.env === env)) {
      let why = voidWhy(a, binding);
      if (!why && a.recovery.kind === 'dump') why = await dumpStillThere(a.recovery.path, a.recovery.size, a.recovery.sha256);
      if (!why) {
        this.release(i.floorId, env, `approved by ${a.by.name}`);
        return { hold: false, assessment, approval: a };
      }
      this.voidApproval(i.floorId, a, why);
    }
    const was = rec.holds[env];
    if (was && binds(was, binding) && was.status === assessment.status) return { hold: true, why: was.reason, held: was };
    const reason = holdReason(assessment.status as 'impact' | 'unknown', i.target, assessment.error);
    const pg = this.d.pg?.(i.floorId, env);
    if (pg && assessment.findings.length) await Promise.race([countRows(pg, assessment.findings), new Promise((r) => setTimeout(r, ROWS_MS).unref())]);
    const held: Held = { ...binding, status: assessment.status as 'impact' | 'unknown', reason, at: Date.now(), assessment };
    this.store.update(i.floorId, (r) => void (r.holds[env] = held));
    audit.record({
      floor: i.floorId,
      actor: office('Data-impact guard'),
      action: 'data-impact.hold',
      target: { kind: 'commit', id: i.target, label: `${env} ${short(i.base)} → ${short(i.target)}` },
      summary: `${reason} (${env}: running ${short(i.base)}, candidate ${short(i.target)}${assessment.findings.length ? `; ${assessment.findings.length} finding${assessment.findings.length === 1 ? '' : 's'}` : ''})`,
      details: { env, base: i.base, target: i.target, status: assessment.status, findings: assessment.findings.map((f) => `${f.unit}: ${f.risk}${f.rows !== undefined ? ` [${f.rows} rows]` : ''}`), ...(assessment.error ? { error: assessment.error } : {}), uncertainty: assessment.uncertainty },
      severity: 'warning',
    });
    this.d.changed?.(i.floorId);
    return { hold: true, why: reason, held };
  }

  /** The hold in `env` is over (approved, or the change no longer touches data). */
  private release(floorId: string, env: string, why: string) {
    const h = this.store.get(floorId).holds[env];
    if (!h) return;
    this.store.update(floorId, (r) => void delete r.holds[env]);
    audit.record({ floor: floorId, actor: office('Data-impact guard'), action: 'data-impact.release', target: { kind: 'commit', id: h.target, label: `${env} ${short(h.base)} → ${short(h.target)}` }, summary: `Data-impact hold released for ${short(h.target)} on the ${env}: ${why}`, details: { env, base: h.base, target: h.target, why }, severity: 'notice' });
    this.d.changed?.(floorId);
  }

  voidApproval(floorId: string, a: DataImpactApproval, why: string) {
    this.store.update(floorId, (r) => {
      const x = r.approvals.find((y) => y.id === a.id);
      if (x && !x.void) x.void = { at: Date.now(), why };
    });
    audit.record({ floor: floorId, actor: office('Data-impact guard'), action: 'data-impact.void', target: { kind: 'approval', id: a.id, label: `${a.env} ${short(a.base)} → ${short(a.target)}` }, summary: `Data-impact approval by ${a.by.name} for ${short(a.target)} is void: ${why}`, details: { env: a.env, base: a.base, target: a.target, recovery: recoveryWords(a.recovery), why }, severity: 'notice' });
  }

  /** A new approval's record (the caller checked the permission and the binding). */
  record(floorId: string, a: Omit<DataImpactApproval, 'id' | 'at'>): DataImpactApproval {
    const full: DataImpactApproval = { ...a, id: randomUUID(), at: Date.now() };
    this.store.update(floorId, (r) => void r.approvals.push(full));
    audit.record({
      floor: floorId,
      actor: { kind: 'human', name: a.by.name, ...(a.by.id ? { id: a.by.id } : {}) },
      action: 'data-impact.approve',
      target: { kind: 'commit', id: a.target, label: `${a.env} ${short(a.base)} → ${short(a.target)}` },
      summary: `Approved possible data impact of ${short(a.target)} on the ${a.env} (running ${short(a.base)}); recovery: ${recoveryWords(a.recovery)}; reason: ${a.reason}`,
      details: { env: a.env, base: a.base, target: a.target, recovery: a.recovery, reason: a.reason },
      severity: 'warning',
    });
    this.d.changed?.(floorId);
    return full;
  }
}
