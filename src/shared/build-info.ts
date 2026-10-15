// Which build of the office is running, and which one is built: the truth behind 🔁 Restart safely.
// `npm run build` writes build-info.json beside the pages (vite.config.ts: the commit, the release the
// changelog was at, the time) and compiles the same into the pages (__BUILD_INFO__). The server reads
// it once as it starts (what it runs) and again when asked (what's built now, server/restart/build.ts),
// so a rebuild under a running office shows as "A newer build is ready", and a page from that newer
// build talking to the older server says so instead of failing with "Unknown action". On 13 Oct 2026
// release 43 was built under the release 42 office and nothing said so for an hour and a half. Pure.

/** A build: its commit, the release its changelog was at, and when it was built. */
export interface BuildInfo {
  sha: string;
  release?: number;
  /** The changelog has entries under Unreleased: newer than that release ("release 45+"). */
  ahead?: boolean;
  builtAt?: number;
  /** The dispatch record schema it knows (shared/dispatch.ts DISPATCH_SCHEMA); missing on builds from before durable dispatch (release 47). */
  dispatchSchema?: number;
}

/** The build the office runs, and since when it has been running it. */
export interface RunningBuild extends BuildInfo {
  startedAt: number;
}

/** The file `npm run build` writes beside the pages (dist/public). */
export const BUILD_INFO_FILE = 'build-info.json';

/** A build-info.json's content, when it is one. */
export function parseBuildInfo(x: unknown): BuildInfo | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.sha !== 'string' || !o.sha) return undefined;
  const out: BuildInfo = { sha: o.sha.slice(0, 40) };
  if (typeof o.release === 'number' && Number.isInteger(o.release) && o.release > 0) out.release = o.release;
  if (o.ahead === true) out.ahead = true;
  if (typeof o.builtAt === 'number' && Number.isFinite(o.builtAt) && o.builtAt > 0) out.builtAt = o.builtAt;
  if (typeof o.dispatchSchema === 'number' && Number.isInteger(o.dispatchSchema) && o.dispatchSchema > 0) out.dispatchSchema = o.dispatchSchema;
  return out;
}

/** The newest release in a CHANGELOG.md: its first "## 2026-10-14 · release 45" heading. */
export function releaseOf(changelog: string): number | undefined {
  const m = /^## \d{4}-\d{2}-\d{2} · release (\d+)\b/m.exec(changelog);
  return m ? Number(m[1]) : undefined;
}

/** Whether a CHANGELOG.md has entries waiting under "## Unreleased" (not "Nothing waiting yet."). */
export function unreleasedIn(changelog: string): boolean {
  const m = /^## Unreleased[ \t]*\n([\s\S]*?)^## /m.exec(changelog.replace(/\r\n/g, '\n'));
  const body = (m?.[1] ?? '').trim();
  return !!body && !/^Nothing waiting yet\.?$/.test(body);
}

/** What `npm run build` (vite.config.ts) and a checkout without a build (server/restart/build.ts) say of a changelog. */
export const releaseInfo = (changelog: string): Pick<BuildInfo, 'release' | 'ahead'> => {
  const release = releaseOf(changelog);
  return release ? { release, ...(unreleasedIn(changelog) ? { ahead: true } : {}) } : {};
};

/** "release 45 (aaf30a5)", "release 45+ (fc7a5a9)" past it, or the commit alone when the release isn't known. */
export function buildLabel(b: BuildInfo): string {
  const sha = b.sha.slice(0, 7);
  return b.release ? `release ${b.release}${b.ahead ? '+' : ''} (${sha})` : sha;
}

/** `a` was built after `than` (both with a build time, and not the same build). */
export function newerBuild(a: BuildInfo | undefined, than: BuildInfo | undefined): boolean {
  if (!a?.builtAt || !than?.builtAt) return false;
  return a.builtAt > than.builtAt && !(a.sha === than.sha && a.builtAt === than.builtAt);
}

/** The page's build against the server's: the same, the page newer (rebuilt, not restarted) or older (restarted, not reloaded). */
export type PageVsServer = 'same' | 'page-newer' | 'page-older';

export function pageVsServer(page: BuildInfo | undefined, server: BuildInfo | undefined): PageVsServer {
  if (newerBuild(page, server)) return 'page-newer';
  if (newerBuild(server, page)) return 'page-older';
  return 'same';
}

/** What `GET /api/office/version` says: the build running, a newer one built since, and a restart under way. */
export interface OfficeVersionView {
  running: RunningBuild;
  /** Built after the office started: a restart puts it to use. */
  ready?: BuildInfo;
  admin: boolean;
  /** A looping launcher started the office, so Restart safely can bring it back by itself. */
  loop: boolean;
  /** A safe restart under way (phase not idle, cancelled or failed). */
  restart?: { phase: string; waitingOn: string[]; deadline?: number };
  /** The server's clock, for countdowns against it. */
  now: number;
}

/** "Running release 45 (aaf30a5), started 08:32". */
export const runningLine = (r: RunningBuild, time: (at: number) => string) => `Running ${buildLabel(r)}, started ${time(r.startedAt)}`;

/** What a failed request says when the page is from a newer build than the server: the reason, not "Unknown action". */
export function staleServerError(page: BuildInfo, server: BuildInfo | undefined, error: string): string {
  return `This page is from ${buildLabel(page)}, but the office server still runs ${server ? buildLabel(server) : 'an older build'}, which can't do this yet (${error}). Restart the office (⚙️ Settings › Workers › Restart safely), then reload.`;
}

/** "6:05": minutes and seconds left (never below 0:00). */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
