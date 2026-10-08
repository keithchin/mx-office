// The Test mode page's "This office's server" part: an admin records a CPU profile of this office's
// own server (POST /api/perf/profile, server/perfwatch/profile.ts), sees which functions took the time
// and which ran in the longest block, and downloads the .cpuprofile (Chrome DevTools › Performance, or
// VS Code, open it). The profiles the office recorded on its own after a stall are listed here too.
// Nothing is recorded until the button is pressed.

import { h, toast } from '../dom';

interface FrameTime {
  frame: string;
  ms: number;
}
interface Summary {
  file: string;
  durationMs: number;
  top: FrameTime[];
  longest?: { ms: number; top: FrameTime[]; stack: FrameTime[] };
}
interface Listing {
  recording: boolean;
  profiles: { file: string; at: number; bytes: number }[];
}

const SECONDS = 60;
const link = (file: string) => h('a', { href: `/api/perf/profiles/${encodeURIComponent(file)}`, download: file }, file);
const frames = (xs: FrameTime[]) => h('ol.tl-frames', {}, ...xs.map((x) => h('li', {}, h('b', {}, `${x.ms} ms`), ` ${x.frame}`)));

export function profilePart(): HTMLElement {
  const box = h('div.tl-part');
  const result = h('div');
  const list = h('div');
  const button = h('button.btn.small', { type: 'button', onclick: () => void record() }, `⏺ Record ${SECONDS} s CPU profile`) as HTMLButtonElement;

  async function listing() {
    try {
      const r = await fetch('/api/perf/profiles', { credentials: 'same-origin' });
      if (!r.ok) return;
      const v = (await r.json()) as Listing;
      button.disabled = v.recording;
      list.replaceChildren(
        v.profiles.length
          ? h('ul.tl-history', {}, ...v.profiles.slice(0, 10).map((p) => h('li', {}, link(p.file), h('span.tl-note', {}, ` ${new Date(p.at).toLocaleString()}, ${Math.round(p.bytes / 1024)} KB${/-stall\./.test(p.file) ? ', recorded by itself after a stall' : ''}`))))
          : h('p.tl-note', {}, 'No profiles yet.'),
      );
    } catch {
      // the list stays as it was
    }
  }

  async function record() {
    button.disabled = true;
    result.replaceChildren(h('p.tl-note', { role: 'status' }, `Recording this office's server for ${SECONDS} s…`));
    try {
      const r = await fetch('/api/perf/profile', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds: SECONDS }) });
      const s = (await r.json().catch(() => ({}))) as Summary & { error?: string };
      if (!r.ok) throw new Error(s.error ?? `HTTP ${r.status}`);
      const longest = s.longest;
      const parts: HTMLElement[] = [h('p', {}, 'Saved ', link(s.file), '.')];
      if (longest) parts.push(h('p', {}, `Longest busy stretch: ${longest.ms} ms. Ran in it:`), frames(longest.top.slice(0, 6)));
      if (longest?.stack.length) parts.push(h('p.tl-note', {}, 'Called from:'), frames(longest.stack.slice(0, 6)));
      parts.push(h('p', {}, 'Top functions by self time:'), frames(s.top));
      result.replaceChildren(...parts);
    } catch (e) {
      result.replaceChildren();
      toast(`Couldn't record a profile: ${(e as Error).message}`, 'warn');
    } finally {
      button.disabled = false;
      void listing();
    }
  }

  box.replaceChildren(
    h('h3', {}, "This office's server"),
    h('p.tl-note', {}, "When the office feels stuck, record what its server does for a minute: the profile names the functions that took the time. It is this office, not a test office, and costs nothing while nobody records. After a stall that comes back, the office records one by itself (at most once an hour) and notes it on the stall's incident."),
    h('div.tl-going-row', {}, button),
    result,
    list,
  );
  void listing();
  return box;
}
