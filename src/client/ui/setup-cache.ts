// One answer per key (a floor), asked for once however many callers want it at the same moment (the
// setup panel, ui/setup-panel.ts: the board redraws it many times a second while a floor loads, and
// each redraw used to send its own GET /api/wizard/setup). No DOM, so the tests drive it directly.
//
//   - Callers asking while a request is out share it; a kept answer is reused while it's fresh (`ttl`).
//   - `force` (an explicit re-check, the gate-check polling) always asks again and takes over: an older
//     request answering later never replaces the newer one's answer, it hands its callers that instead.
//   - A failed request is let go of (the next ask tries again); a key never answered is dropped.
//   - At most `max` keys are kept (the least recently asked go first); `forget`/`keepOnly` drop more.

interface Entry<V> {
  view?: V;
  at: number;
  pending?: Promise<V>;
  /** The newest request's number: only its answer is kept. */
  seq: number;
}

export class SetupCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  private seq = 0;

  constructor(
    private readonly load: (key: string) => Promise<V>,
    private readonly ttl: (v: V) => number,
    private readonly max = 32,
    private readonly now: () => number = Date.now,
  ) {}

  /** The answer for `key`: the request already out, the kept one while fresh (unless `force`), else a new request. */
  get(key: string, force = false): Promise<V> {
    let e = this.map.get(key);
    if (e && !force) {
      if (e.pending) return e.pending;
      if (e.view !== undefined && this.now() - e.at < this.ttl(e.view)) return Promise.resolve(e.view);
    }
    if (e) this.map.delete(key);
    else e = { at: 0, seq: 0 };
    // (Re)inserted last: the most recently asked.
    this.map.set(key, e);
    this.trim();
    const entry = e;
    const seq = ++this.seq;
    entry.seq = seq;
    const mine = () => this.map.get(key) === entry;
    const p = this.load(key).then(
      (v) => {
        if (!mine()) return v;
        if (entry.seq !== seq) return entry.pending ?? entry.view ?? v;
        entry.view = v;
        entry.at = this.now();
        entry.pending = undefined;
        return v;
      },
      (err: unknown) => {
        if (mine() && entry.seq !== seq && entry.pending) return entry.pending;
        if (mine() && entry.seq === seq) {
          entry.pending = undefined;
          if (entry.view === undefined) this.map.delete(key);
        }
        throw err;
      },
    );
    entry.pending = p;
    return p;
  }

  /** What's kept for `key`, fresh or not, without asking. */
  peek(key: string): V | undefined {
    return this.map.get(key)?.view;
  }

  /** Lets go of `key` (a deleted project): a request out for it is still answered, but not kept. */
  forget(key: string) {
    this.map.delete(key);
  }

  /** Keeps only these keys (the floors there are). */
  keepOnly(keys: Iterable<string>) {
    const keep = new Set(keys);
    for (const k of [...this.map.keys()]) if (!keep.has(k)) this.map.delete(k);
  }

  get size() {
    return this.map.size;
  }

  private trim() {
    for (const k of this.map.keys()) {
      if (this.map.size <= this.max) break;
      this.map.delete(k);
    }
  }
}
