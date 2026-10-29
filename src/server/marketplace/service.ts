// Adding a Mendix Marketplace widget or module to a project (shared/marketplace.ts says the whole flow):
//   ask      an agent's request (hooks/office-marketplace.ts): recorded, looked up when the office has a
//            token it may use, and shown on the Needs-you card (shared/decisions/marketplace.ts);
//   approve  the PM's "Download and add": the office downloads it with ITS token (./token.ts, ./download.ts),
//            checks the package, places and commits it in the agent's branch (./place.ts);
//   file     the PM's "Use a package file…": a .mpk they picked (uploaded, or a path on the office's
//            machine), checked against the request (kind, name, version), then placed the same way; no token;
//   decline  with the PM's words, told to the agent.
//   wait     a module approved while the agent's app has uncommitted changes isn't a failure: the checked package
//            is kept (<data>/marketplace/waiting/<rid>.mpk), the request waits, the agent is told to commit, and
//            the office tries again every minute (retryWaiting) until the app is clean (WAIT_MAX_MS at most);
//   supersede an agent's corrected request for the same item closes its earlier failed ones.
// Every step is audited without any token; the agent is told the outcome as the office's own message.

import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askWords, packageMismatch, packageWords, type MarketplaceAsk, type MarketplaceRequest, type MarketplaceView, type PackageFacts } from '../../shared/marketplace.js';
import { MPK_MAX_BYTES, readPackage } from './mpk.js';
import { download, lookUp, type Run } from './download.js';
import { placeAndCommit } from './place.js';
import { MarketplaceStore } from './store.js';

export interface MarketplaceDeps {
  dataDir: string;
  now?: () => number;
  mxcli: () => string | undefined;
  token: () => { token: string } | { why: string };
  /** A project's folder: a request's folder stored relative (by an older office) is resolved against it, never the office's working directory. */
  floorDir?: (floor: string) => string | undefined;
  run?: Run;
  identity?: () => { name: string; email: string } | undefined;
  /** Tells the agent (the office's own message); false when it couldn't. */
  tell: (floor: string, workerId: string, text: string) => boolean;
  /** The projects with requests to look at for retryWaiting (every project the office has). */
  floors?: () => string[];
  /** Records an audit event (never given a token). */
  audit: (floor: string, action: string, actor: { kind: 'human' | 'agent' | 'office'; name: string; id?: string }, summary: string, details: Record<string, unknown>, target: { kind: string; id: string; label: string }) => void;
}

export type Outcome = { ok: true; request: MarketplaceRequest } | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): Outcome => ({ ok: false, error, status });
/** How long an approved request waits for the agent's app to be clean before it's said to have failed. */
export const WAIT_MAX_MS = 8 * 60 * 60_000;
/** The same Marketplace item: its content id, or the same package name. */
const sameItem = (a: Pick<MarketplaceRequest, 'id' | 'name'>, b: Pick<MarketplaceAsk, 'id' | 'name'>) => a.id === b.id || (!!a.name && !!b.name && a.name.toLowerCase() === b.name.toLowerCase());
const newRid = (now: number) => `mkt_${now.toString(36)}${randomBytes(4).toString('hex')}`;
const RECIPE = (r: MarketplaceRequest, p: PackageFacts) =>
  p.kind === 'widget'
    ? `Run \`mxcli widget init -p <app>.mpr\` in your folder so mxcli knows it, then \`mxcli widget describe ${p.name.toLowerCase()} -p <app>.mpr\` for its MDL properties, and use it in your MDL (pull/rebase first if your folder isn't where the commit is).`
    : `It's in the model now: \`mxcli describe module ${p.name} -p <app>.mpr\`. Check with \`mxcli check\` / \`mx check\` before using it. (Request ${r.rid}.)`;

/** A request's folder as an absolute path: as it is when absolute, else against the project's folder; undefined when that isn't known. */
export function resolveFolder(folder: string, floorDir: string | undefined): string | undefined {
  if (path.isAbsolute(folder)) return folder;
  return floorDir ? path.resolve(floorDir, folder) : undefined;
}

export class MarketplaceService {
  readonly store: MarketplaceStore;
  private busy = new Set<string>();
  constructor(private readonly deps: MarketplaceDeps) {
    this.store = new MarketplaceStore(deps.dataDir);
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  async view(floor: string, admin: boolean): Promise<MarketplaceView> {
    const requests = [...(await this.store.list(floor))].sort((a, b) => b.at - a.at).slice(0, 50);
    // Where the token is resolved only matters while something waits (Teams gathers every project's view).
    const t = requests.some((r) => r.status === 'pending' || r.status === 'failed') ? this.deps.token() : { why: '' };
    return { floor, admin, canDownload: 'token' in t, ...('why' in t && t.why ? { noDownload: t.why } : {}), requests };
  }

  /** An agent's request: joins an open one for the same item and version from the same folder, else a new card. */
  async ask(floor: string, who: { id: string; name: string }, folder: string, branch: string | undefined, a: MarketplaceAsk): Promise<{ request: MarketplaceRequest; joined: boolean }> {
    const open = (await this.store.list(floor)).find((r) => (r.status === 'pending' || r.status === 'working' || r.status === 'waiting') && r.id === a.id && (r.version ?? '') === (a.version ?? '') && r.folder === folder);
    if (open) return { request: open, joined: true };
    const r: MarketplaceRequest = { ...a, rid: newRid(this.now()), floor, status: 'pending', by: who, folder, ...(branch ? { branch } : {}), at: this.now() };
    const t = this.deps.token();
    const mxcli = this.deps.mxcli();
    if ('token' in t && mxcli) {
      const info = await lookUp({ mxcli, token: t.token, run: this.deps.run, cwd: os.tmpdir() }, a.id);
      if (info) r.info = info;
    }
    await this.store.put(r);
    // A corrected re-request (another version, name or id of the same item, from the same agent) closes its failed ones.
    for (const old of (await this.store.list(floor)).filter((x) => x.rid !== r.rid && x.status === 'failed' && x.by.id === who.id && sameItem(x, a))) {
      await this.store.put({ ...old, status: 'superseded', supersededBy: r.rid, note: `${old.note ? `${old.note} · ` : ''}replaced by ${who.name}’s new request ${r.rid}`, done: { by: 'the office', at: this.now() } });
      this.deps.audit(floor, 'marketplace.superseded', { kind: 'office', name: 'Marketplace' }, `Closed ${who.name}’s failed request for ${askWords(old)}: replaced by its new request ${r.rid}`, { rid: old.rid, supersededBy: r.rid }, { kind: 'marketplace', id: old.rid, label: askWords(old) });
    }
    this.deps.audit(floor, 'marketplace.request', { kind: 'agent', name: who.name, id: who.id }, `${who.name} asked to add ${askWords(r)} from the Mendix Marketplace (item ${r.id})${branch ? ` to ${branch}` : ''}`, { rid: r.rid, id: r.id, kind: r.kind, version: r.version, name: r.name, branch }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
    return { request: r, joined: false };
  }

  private async open(floor: string, rid: string, waiting = false): Promise<MarketplaceRequest | Outcome> {
    const r = await this.store.get(floor, rid);
    if (!r) return fail('No such Marketplace request', 404);
    if (r.status === 'waiting' && !waiting) return fail(`Already approved: it’s added once ${r.by.name}’s app has no uncommitted changes`, 409);
    if (r.status !== 'pending' && r.status !== 'failed' && !(waiting && r.status === 'waiting')) return fail(`Already ${r.status}${r.done ? ` by ${r.done.by}` : ''}`, 409);
    if (this.busy.has(rid)) return fail('Already being added', 409);
    return r;
  }

  /** The PM's "Download and add": the office's own download with its own token, then check, place, commit. */
  async approve(floor: string, rid: string, by: string): Promise<Outcome> {
    const r = await this.open(floor, rid);
    if ('ok' in r) return r;
    const t = this.deps.token();
    if (!('token' in t)) return fail(t.why);
    const mxcli = this.deps.mxcli();
    if (!mxcli) return fail('mxcli isn’t set up on the office’s machine (🔌 Connections › Paths)');
    return this.withTemp(r, by, async (dir) => {
      const file = path.join(dir, `item-${r.id}.mpk`);
      const err = await download({ mxcli, token: t.token, run: this.deps.run, cwd: dir }, r.id, r.version, file);
      if (err) return err;
      return this.checkAndPlace(r, file, path.basename(file), by, 'download');
    });
  }

  /** The PM's package file: bytes they uploaded (`bytes`, named `name`), or a path on the office's machine. */
  async importFile(floor: string, rid: string, by: string, src: { bytes: Buffer; name: string } | { path: string }): Promise<Outcome> {
    const r = await this.open(floor, rid);
    if ('ok' in r) return r;
    let bytes: Buffer;
    let name: string;
    if ('path' in src) {
      if (!path.isAbsolute(src.path) || !/\.mpk$/i.test(src.path)) return fail('Give the full path of a .mpk file on the office’s machine');
      try {
        const s = await stat(src.path);
        if (!s.isFile()) return fail('That is not a file');
        if (s.size > MPK_MAX_BYTES) return fail(`The file is over ${MPK_MAX_BYTES / 1024 / 1024} MB`);
        bytes = await readFile(src.path);
      } catch {
        return fail(`No such file on the office’s machine: ${src.path}`);
      }
      name = path.basename(src.path);
    } else {
      if (!/\.mpk$/i.test(src.name)) return fail('Pick a .mpk file (a Mendix package from the Marketplace website)');
      bytes = src.bytes;
      name = path.basename(src.name);
    }
    // Checked before anything is written: a wrong package changes nothing.
    const pkg = readPackage(bytes, name);
    if (typeof pkg === 'string') return fail(`That file can’t be used: ${pkg}`);
    const wrong = packageMismatch(pkg, r);
    if (wrong) return fail(`That file can’t be used: ${wrong}`);
    return this.withTemp(r, by, async (dir) => {
      const file = path.join(dir, name);
      await writeFile(file, bytes);
      return this.checkAndPlace(r, file, name, by, 'file');
    });
  }

  /** The PM's Decline, with their words (told to the agent). */
  async decline(floor: string, rid: string, by: string, words: string): Promise<Outcome> {
    const r = await this.open(floor, rid, true);
    if ('ok' in r) return r;
    if (r.status === 'waiting') await rm(this.waitFile(r), { recursive: true, force: true }).catch(() => undefined);
    const text = words.replace(/\s+/g, ' ').trim().slice(0, 1000);
    const next: MarketplaceRequest = { ...r, status: 'declined', ...(text ? { note: text } : {}), done: { by, at: this.now() } };
    await this.store.put(next);
    this.deps.audit(floor, 'marketplace.decline', { kind: 'human', name: by }, `${by} declined adding ${askWords(r)} for ${r.by.name}`, { rid: r.rid, words: text.length ? { length: text.length } : undefined }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
    this.deps.tell(floor, r.by.id, `The Project Manager (${by}) declined adding ${askWords(r)} from the Mendix Marketplace (request ${r.rid}).${text ? `\n\nTheir words: ${text}` : ''}\n\nCarry on without it: don't install it some other way.`);
    return { ok: true, request: next };
  }

  private async withTemp(r: MarketplaceRequest, by: string, fn: (dir: string) => Promise<string | Outcome>): Promise<Outcome> {
    this.busy.add(r.rid);
    await this.store.put({ ...r, status: 'working' });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mx-office-mpk-'));
    try {
      const out = await fn(dir);
      if (typeof out !== 'string') return out;
      // A failure: said on the card, the PM may try again (or another way).
      const failed: MarketplaceRequest = { ...r, status: 'failed', note: out, done: { by, at: this.now() } };
      await this.store.put(failed);
      this.deps.audit(r.floor, 'marketplace.failed', { kind: 'office', name: 'Marketplace' }, `Couldn’t add ${askWords(r)} for ${r.by.name}: ${out}`, { rid: r.rid }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
      return fail(out, 422);
    } catch (err) {
      const why = `Something went wrong adding it: ${(err as Error).message.slice(0, 200)}`;
      await this.store.put({ ...r, status: 'failed', note: why, done: { by, at: this.now() } });
      return fail(why, 500);
    } finally {
      this.busy.delete(r.rid);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async checkAndPlace(r: MarketplaceRequest, file: string, name: string, by: string, how: 'download' | 'file'): Promise<string | Outcome> {
    const pkg = readPackage(await readFile(file), name);
    if (typeof pkg === 'string') return `the ${how === 'download' ? 'download' : 'file'} isn’t usable: ${pkg}`;
    const wrong = packageMismatch(pkg, r);
    if (wrong) return wrong;
    const folder = resolveFolder(r.folder, this.deps.floorDir?.(r.floor));
    if (!folder) return `${r.by.name}'s folder was recorded as "${r.folder}", relative to the project, and the office doesn't know the project's folder any more: ${r.by.name} can ask again`;
    const placed = await placeAndCommit({ run: this.deps.run, mxcli: this.deps.mxcli(), identity: this.deps.identity?.() }, { ...r, folder }, file, pkg);
    if (!placed.ok && placed.dirty) return this.wait(r, file, by, how, placed.error);
    if (!placed.ok) return placed.error;
    if (r.status === 'waiting' || r.waiting) await rm(this.waitFile(r), { recursive: true, force: true }).catch(() => undefined);
    const next: MarketplaceRequest = { ...r, status: 'added', note: undefined, waiting: undefined, added: { how, pkg, commit: placed.commit, files: placed.files, by, at: this.now() }, done: { by, at: this.now() } };
    await this.store.put(next);
    const short = placed.commit.slice(0, 7);
    this.deps.audit(r.floor, 'marketplace.added', { kind: 'human', name: by }, `Added ${packageWords(pkg)} to ${r.branch ?? r.by.name + '’s folder'} for ${r.by.name} (${how === 'download' ? 'downloaded by the office' : 'from a package file'}), commit ${short}`, { rid: r.rid, how, kind: pkg.kind, name: pkg.name, version: pkg.version, sha256: pkg.sha256, bytes: pkg.bytes, commit: placed.commit, files: placed.files }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
    this.deps.tell(r.floor, r.by.id, `The office added ${packageWords(pkg)} to your branch${r.branch ? ` ${r.branch}` : ''} (request ${r.rid}): commit ${short}, ${placed.files.join(', ')}${pkg.version ? '' : '. The package states no version of its own: check it is the one you wanted'}. ${RECIPE(r, pkg)}`);
    return { ok: true, request: next };
  }

  /** Where a waiting request's checked package is kept until the app is clean (under its own file name: a version may be read from it). */
  private waitFile(r: Pick<MarketplaceRequest, 'rid'>) {
    return path.join(this.deps.dataDir, 'marketplace', 'waiting', r.rid.replace(/[^A-Za-z0-9_-]/g, '_'));
  }

  /** The app has uncommitted changes: the package is kept, the request waits, the agent is told once (retryWaiting tries again). */
  private async wait(r: MarketplaceRequest, file: string, by: string, how: 'download' | 'file', why: string): Promise<Outcome> {
    const first = r.status !== 'waiting';
    if (first) {
      await mkdir(this.waitFile(r), { recursive: true });
      await copyFile(file, path.join(this.waitFile(r), path.basename(file)));
    }
    const next: MarketplaceRequest = { ...r, status: 'waiting', note: why, waiting: { since: r.waiting?.since ?? this.now(), how, by, name: r.waiting?.name ?? path.basename(file), tries: (r.waiting?.tries ?? 0) + 1 } };
    await this.store.put(next);
    if (first) {
      this.deps.audit(r.floor, 'marketplace.waiting', { kind: 'human', name: by }, `${by} approved adding ${askWords(r)} for ${r.by.name}: waiting for its app to have no uncommitted changes`, { rid: r.rid, how }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
      this.deps.tell(r.floor, r.by.id, `The Project Manager (${by}) approved adding ${askWords(r)} from the Mendix Marketplace (request ${r.rid}), but your app has uncommitted changes and a module install rewrites model files. Commit your work (or put it aside) in ${r.folder}: the office adds the module by itself as soon as the app is clean (it looks every minute) and tells you. Don't install it some other way.`);
    }
    return { ok: true, request: next };
  }

  /**
   * Every waiting request tried again (a timer, every minute, ./index.ts): added once the agent's app is clean, still
   * waiting while it isn't, failed after WAIT_MAX_MS or when something else goes wrong (said on the card). Never throws.
   */
  async retryWaiting(floors = this.deps.floors?.() ?? []): Promise<void> {
    for (const floor of floors) {
      let list: MarketplaceRequest[];
      try {
        list = (await this.store.list(floor)).filter((r) => r.status === 'waiting');
      } catch {
        continue;
      }
      for (const r of list) {
        if (this.busy.has(r.rid)) continue;
        this.busy.add(r.rid);
        try {
          const how = r.waiting?.how ?? 'file';
          const by = r.waiting?.by ?? 'the Project Manager';
          const file = path.join(this.waitFile(r), r.waiting?.name ?? 'package.mpk');
          const gone = !(await stat(file).then((s) => s.isFile(), () => false));
          const late = this.now() - (r.waiting?.since ?? r.at) > WAIT_MAX_MS;
          const out = gone ? 'the kept package is gone: approve it again' : late ? `${r.by.name}’s app still had uncommitted changes after ${Math.round(WAIT_MAX_MS / 3_600_000)} h: ask ${r.by.name} to commit, then approve it again` : await this.checkAndPlace(r, file, path.basename(file), by, how);
          if (typeof out === 'string') {
            await this.store.put({ ...r, status: 'failed', note: out, waiting: undefined, done: { by, at: this.now() } });
            await rm(this.waitFile(r), { recursive: true, force: true }).catch(() => undefined);
            this.deps.audit(r.floor, 'marketplace.failed', { kind: 'office', name: 'Marketplace' }, `Couldn’t add ${askWords(r)} for ${r.by.name}: ${out}`, { rid: r.rid }, { kind: 'marketplace', id: r.rid, label: askWords(r) });
          }
        } catch (err) {
          console.error(`agent-office: marketplace: couldn't try ${r.rid} again: ${(err as Error).message}`);
        } finally {
          this.busy.delete(r.rid);
        }
      }
    }
  }
}
