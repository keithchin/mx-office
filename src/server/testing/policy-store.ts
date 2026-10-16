// What Testing release 2 keeps per project, beside the test-run records: <data>/testing/<floor>.verify.json
// holds the project's verification policy (none: the default), the waivers given, and the test-first
// Needs you item it raised. Every change to it is audited by whoever made it (server/testing/verify.ts);
// the file is written whole, to a temporary file first and then renamed, one write at a time.

import { readJsonStore } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import path from 'node:path';
import { cleanPolicy, LINKED, isCheckKey, type VerificationPolicy, type Waiver } from '../../shared/testing/policy.js';

export interface VerifyFile {
  v: 1;
  policy?: VerificationPolicy & { by?: string; at?: number };
  waivers: Waiver[];
  /** The "acceptance criteria have no linked test" item: raised once, then updated. */
  testFirst?: { escalationId: string; n: number; at: number };
}

const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;
const WAIVERS_KEPT = 500;

function revive(raw: unknown): VerifyFile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<VerifyFile>;
  const policy = cleanPolicy(r.policy);
  const waivers = (Array.isArray(r.waivers) ? r.waivers : []).filter(
    (w): w is Waiver => !!w && typeof w === 'object' && (isCheckKey(w.check) || w.check === LINKED) && typeof w.revision === 'string' && typeof w.by === 'string' && typeof w.reason === 'string' && typeof w.at === 'number',
  );
  const t = r.testFirst;
  return {
    v: 1,
    ...(policy ? { policy: { ...policy, ...(typeof r.policy?.by === 'string' ? { by: r.policy.by } : {}), ...(typeof r.policy?.at === 'number' ? { at: r.policy.at } : {}) } } : {}),
    waivers: waivers.slice(-WAIVERS_KEPT),
    ...(t && typeof t.escalationId === 'string' && typeof t.n === 'number' && typeof t.at === 'number' ? { testFirst: { escalationId: t.escalationId, n: t.n, at: t.at } } : {}),
  };
}

export class VerifyStore {
  readonly file: string;
  private cached?: VerifyFile;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    readonly floorId: string,
  ) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    this.file = path.join(dir, `${floorId}.verify.json`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async load(): Promise<VerifyFile> {
    if (this.cached) return this.cached;
    // Only a missing file is the default policy: a locked one rejects (and isn't written over), a corrupt one
    // is moved aside (durable/read.ts). Before, any error read as {} and the next change wiped the waivers.
    const r = await readJsonStore(this.file);
    this.cached = revive(r.state === 'ok' ? r.value : {});
    return this.cached;
  }

  read(): Promise<VerifyFile> {
    return this.serial(() => this.load());
  }

  /** Changes the file with `fn` (which edits it in place) and writes it. */
  change<T>(fn: (f: VerifyFile) => T): Promise<T> {
    return this.serial(async () => {
      const f = await this.load();
      const out = fn(f);
      f.waivers = f.waivers.slice(-WAIVERS_KEPT);
      await writeTextDurable(this.file, `${JSON.stringify(f, null, 1)}\n`);
      return out;
    });
  }
}
