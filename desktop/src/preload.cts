// The office window's preload (sandboxed, context-isolated): one small bridge for the Live app tab's
// Show here (core/embed.ts, embed.ts). The page gets window.mxOfficeDesktop.embed: whether it's there is
// how the page knows it runs in the desktop app, and its few calls only send plain messages, which the
// app checks again (only the office's own page, only the current project's proxy address). Nothing of
// Node or Electron reaches the page. A script, not a module: a sandboxed preload has no exports.

{
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
  const CHANNEL = 'mxoffice:embed';
  const STATE = 'mxoffice:embed-state';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const rect = (r: unknown) => {
    const o = (typeof r === 'object' && r ? r : {}) as Record<string, unknown>;
    return { x: n(o.x), y: n(o.y), width: n(o.width), height: n(o.height) };
  };
  const send = (msg: Record<string, unknown>) => ipcRenderer.send(CHANNEL, msg);
  contextBridge.exposeInMainWorld(
    'mxOfficeDesktop',
    Object.freeze({
      embed: Object.freeze({
        version: 1,
        show: (floor: unknown, url: unknown) => ipcRenderer.invoke(CHANNEL, { op: 'show', floor: String(floor), url: String(url) }),
        setBounds: (r: unknown, clip: unknown, zoom: unknown) => send({ op: 'bounds', rect: rect(r), clip: rect(clip), zoom: n(zoom) || 1 }),
        hide: () => send({ op: 'hide' }),
        close: () => send({ op: 'close' }),
        navigate: (path: unknown) => send({ op: 'navigate', path: String(path) }),
        back: () => send({ op: 'back' }),
        forward: () => send({ op: 'forward' }),
        reload: (hard: unknown) => send({ op: 'reload', hard: hard === true }),
        home: () => send({ op: 'home' }),
        devtools: () => send({ op: 'devtools' }),
        onState: (cb: unknown) => {
          if (typeof cb !== 'function') return () => undefined;
          const l = (_e: unknown, s: unknown) => (cb as (s: unknown) => void)(s);
          ipcRenderer.on(STATE, l);
          return () => void ipcRenderer.removeListener(STATE, l);
        },
      }),
    }),
  );
}
