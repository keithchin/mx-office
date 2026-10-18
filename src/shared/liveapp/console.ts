// The live app's Console (the 🌐 Live app tab's, like Studio Pro's): the Mendix runtime's log read into
// entries, and the requests the app made through the office's recording proxy. What both sides share:
// the entries' shapes, the runtime log's parser (pure: the server feeds it what it reads off the file's
// end, a piece at a time), and the words for a request. No Node imports.
//
// The runtime log (<live checkout>/.mxcli/runtime.log) is mxcli's: a `=== runtime start … ===` line per
// start, the launcher's `[rtlauncher:…] INFO …` lines, then the runtime's own
// `2026-10-13 08:00:02.948 INFO - M2EE: Added admin request handler …`. A stack trace or a "Caused by"
// follows its entry on lines of their own, without a time: they're the entry's detail (folded on the page).
// The Mendix web client sends its errors to the runtime, so they land here as `ERROR - Client: …`.

export type LiveLogLevel = 'error' | 'warning' | 'info' | 'debug';

export interface LiveLogEntry {
  /** Increases through the file; an entry still taking lines is sent again with the same id. */
  id: number;
  /** As the log says it ("2026-10-13 08:00:02.948"); empty for the launcher's lines. */
  time: string;
  level: LiveLogLevel;
  /** Who logged it: Client, ConnectionBus, M2EE, Core, rtlauncher, mxcli. */
  node: string;
  /** Its first line. */
  message: string;
  /** The lines after it (a stack trace, "Caused by …"), capped. */
  detail?: string;
  /** Logged by the app's web client (a page that failed to load, a widget's error). */
  client?: true;
  /** mxcli's `=== runtime start … ===`: where a run begins. */
  mark?: true;
}

export type LiveNetKind = 'xas' | 'xhr' | 'doc' | 'asset' | 'ws';

export interface LiveNetEntry {
  id: number;
  /** When it started (ms). */
  at: number;
  method: string;
  /** Path and query within the app. */
  path: string;
  /** The answer's status; 0 when there was none (refused, reset, timed out); absent while it's open. */
  status?: number;
  error?: string;
  /** How long it took (ms), or a WebSocket was open. */
  ms?: number;
  /** Bytes of the answer, as sent. */
  size?: number;
  kind: LiveNetKind;
  /** The answer's content type, without parameters. */
  type?: string;
  /** A Mendix xas/ call's action, read from its body ("executeaction MyModule.ACT_Save"). */
  action?: string;
  /** Headers with cookies and credentials redacted. */
  reqHeaders: [string, string][];
  resHeaders?: [string, string][];
  /** The bodies' first bytes as text (passwords and tokens masked); a note instead for binary or skipped ones. */
  reqBody?: string;
  resBody?: string;
  reqNote?: string;
  resNote?: string;
  /** Still open (no answer yet, or a WebSocket that's connected). */
  pending?: true;
}

/** How many of each the office keeps per app, and the page shows. */
export const LOG_KEEP = 2000;
export const NET_KEEP = 500;
/** A body is recorded up to this many bytes. */
export const BODY_MAX = 8 * 1024;
const DETAIL_MAX = 16 * 1024;
const DETAIL_LINES = 300;

const RUNTIME = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\s+-\s+([^:]{1,80}?):\s?(.*)$/;
const LAUNCHER = /^\[([^\]:]{1,40})(?::[^\]]*)?\]\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\s+(.*)$/;
const MARK = /^===\s*(.*?)\s*===$/;

export function levelOf(word: string): LiveLogLevel {
  const w = word.toUpperCase();
  if (w === 'ERROR' || w === 'CRITICAL' || w === 'FATAL') return 'error';
  if (w === 'WARNING' || w === 'WARN') return 'warning';
  if (w === 'DEBUG' || w === 'TRACE') return 'debug';
  return 'info';
}

/**
 * Reads the runtime log a piece at a time: `push` takes the text read since, `entries` are the ones it
 * finished, `open` the last one, which may still take lines (sent again with the same id once it does).
 */
export class LogParser {
  private rest = '';
  private cur: LiveLogEntry | undefined;
  private lines = 0;
  private next: number;
  /** Lines before the first entry (the start of a read in the middle of the file) are dropped. */
  private started: boolean;

  constructor(firstId = 1, opts: { fromMiddle?: boolean } = {}) {
    this.next = firstId;
    this.started = !opts.fromMiddle;
  }

  push(text: string): { entries: LiveLogEntry[]; open?: LiveLogEntry } {
    const parts = (this.rest + text).split('\n');
    this.rest = parts.pop() ?? '';
    const done: LiveLogEntry[] = [];
    for (const raw of parts) {
      const line = raw.replace(/\r$/, '');
      const head = this.head(line);
      if (head) {
        if (this.cur) done.push(this.cur);
        this.cur = head;
        this.lines = 0;
        this.started = true;
        continue;
      }
      if (!this.started || !line.trim()) continue;
      if (!this.cur) {
        // A line with nothing before it to belong to: an entry of its own.
        this.cur = { id: this.next++, time: '', level: 'info', node: '', message: line };
        this.lines = 0;
        continue;
      }
      this.more(this.cur, line);
    }
    return { entries: done, ...(this.cur ? { open: this.cur } : {}) };
  }

  /** The id the next entry gets. */
  get nextId() {
    return this.next;
  }

  private head(line: string): LiveLogEntry | undefined {
    let m = RUNTIME.exec(line);
    if (m) {
      const node = m[3].trim();
      return { id: this.next++, time: m[1], level: levelOf(m[2]), node, message: m[4], ...(node === 'Client' ? { client: true as const } : {}) };
    }
    m = LAUNCHER.exec(line);
    if (m) return { id: this.next++, time: '', level: levelOf(m[2]), node: m[1], message: m[3] };
    m = MARK.exec(line);
    if (m && m[1]) return { id: this.next++, time: '', level: 'info', node: 'mxcli', message: m[1], mark: true };
    return undefined;
  }

  private more(e: LiveLogEntry, line: string) {
    if (this.lines >= DETAIL_LINES || (e.detail?.length ?? 0) >= DETAIL_MAX) {
      if (this.lines === DETAIL_LINES || !e.detail?.endsWith('…')) e.detail = `${e.detail ?? ''}\n…`;
      this.lines = DETAIL_LINES + 1;
      return;
    }
    e.detail = e.detail === undefined ? line : `${e.detail}\n${line}`;
    this.lines++;
  }
}

/** The whole entry as text, for Copy. */
export const logText = (e: LiveLogEntry) => `${e.time ? `${e.time} ` : ''}${e.level.toUpperCase()}${e.node ? ` - ${e.node}` : ''}: ${e.message}${e.detail ? `\n${e.detail}` : ''}`;

/** A request's name in the list: its xas action when it has one, else the last part of its path. */
export function netName(e: Pick<LiveNetEntry, 'path' | 'action' | 'kind'>): string {
  if (e.action) return `xas · ${e.action}`;
  const p = e.path.split('?')[0];
  const last = p.replace(/\/+$/, '').split('/').pop();
  return last ? decodeSafe(last) : p || '/';
}

const decodeSafe = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A request that went wrong: no answer, or a 4xx/5xx. */
export const netFailed = (e: Pick<LiveNetEntry, 'status'>) => e.status !== undefined && (e.status === 0 || e.status >= 400);

/** "1.2 KB" */
export function bytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
