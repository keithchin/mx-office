// One assessment: the domain models and enumerations at the base and the candidate, read from git
// (./read.ts), diffed by the pure rule (shared/data-impact.ts diffSnapshots). Kept per revision pair, so
// asking again (the page, a poll, the guard after a restart was asked for) costs nothing; when none of the
// units it reads changed (their content hashes are equal) it doesn't decode anything at all. Anything that
// goes wrong is `unknown`, never `clear`, and unknown isn't kept: the next ask tries again.

import type { ModelUnits } from '../model/units.js';
import { diffSnapshots, UNCERTAINTY, type ImpactAssessment } from '../../shared/data-impact.js';
import { impactKey, snapshotOf } from './read.js';

const KEEP = 32;

export class Assessments {
  private kept = new Map<string, ImpactAssessment>();
  private running = new Map<string, Promise<ImpactAssessment>>();

  constructor(private readonly units: ModelUnits) {}

  /** What changing the repository in `dir` from `base` to `target` may do to stored data. */
  assess(dir: string, base: string, target: string): Promise<ImpactAssessment> {
    const key = `${dir}|${base}|${target}`;
    const done = this.kept.get(key);
    if (done) return Promise.resolve(done);
    let p = this.running.get(key);
    if (!p) {
      p = this.run(dir, base, target)
        .then((a) => {
          if (a.status !== 'unknown') {
            this.kept.set(key, a);
            while (this.kept.size > KEEP) this.kept.delete(this.kept.keys().next().value as string);
          }
          return a;
        })
        .finally(() => this.running.delete(key));
      this.running.set(key, p);
    }
    return p;
  }

  /** The one kept for this pair, if any (no reading). */
  peek(dir: string, base: string, target: string): ImpactAssessment | undefined {
    return this.kept.get(`${dir}|${base}|${target}`);
  }

  private async run(dir: string, base: string, target: string): Promise<ImpactAssessment> {
    const at = Date.now();
    const out = (o: Pick<ImpactAssessment, 'status' | 'findings'> & { error?: string }): ImpactAssessment => ({ base, target, warnings: [], uncertainty: UNCERTAINTY, at, ...o });
    try {
      const [a, b] = await Promise.all([this.units.commit(dir, base), this.units.commit(dir, target)]);
      if (!a || !b) return out({ status: 'unknown', findings: [], error: "the model couldn't be read (node:sqlite missing or no unit table)" });
      if (impactKey(a) === impactKey(b)) return out({ status: 'clear', findings: [] });
      const [x, y] = await Promise.all([snapshotOf(a), snapshotOf(b)]);
      const findings = diffSnapshots(x, y);
      return out({ status: findings.length ? 'impact' : 'clear', findings });
    } catch (err) {
      return out({ status: 'unknown', findings: [], error: `the model couldn't be read: ${(err as Error).message.split('\n')[0].slice(0, 160)}` });
    }
  }
}
