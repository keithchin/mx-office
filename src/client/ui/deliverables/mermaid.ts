// Mermaid diagrams in the deliverables viewer's Markdown (viewer.ts): each ```mermaid block drawn as a
// diagram, light or dark to match the office theme, with its source kept under it (and left as it was
// when Mermaid can't draw it). Mermaid is loaded only when a page has a diagram (it's big), and draws in
// a sandboxed frame of its own, off this page's main thread (frameMermaid).

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** A block to draw: its source, and what to do with the picture or the failure. */
export interface MermaidBlock {
  source: string;
  done(svg: string): void;
  failed(why: string): void;
}

const DARK_THEMES = new Set(['dark', 'terminal', 'clean-dark', 'portal-dark']);

/** Mermaid's theme for the office theme on <html data-theme>. */
export const mermaidTheme = (officeTheme: string | undefined): 'dark' | 'default' => (DARK_THEMES.has(officeTheme ?? '') ? 'dark' : 'default');

/** How long the drawing frame may take to load, and to draw one diagram. */
const FRAME_LOAD_MS = 20_000;
const DRAW_MS = 30_000;
let frame: Promise<MermaidApi> | undefined;

/**
 * Mermaid in a frame of its own (GET /api/deliverables/mermaid), sandboxed with no origin so the
 * browser runs it in another process: drawing a big diagram took seconds of this page's main thread
 * (3 s for an ER diagram), the whole office frozen meanwhile. Made on first use and kept.
 */
function frameMermaid(): Promise<MermaidApi> {
  frame ??= new Promise<MermaidApi>((resolve, reject) => {
    const el = document.createElement('iframe');
    el.setAttribute('sandbox', 'allow-scripts');
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    el.title = 'Mermaid';
    // Laid out (Mermaid measures its labels) but out of sight.
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none';
    el.src = '/api/deliverables/mermaid';
    const waiting = new Map<string, { resolve: (svg: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let theme = 'default';
    let n = 0;
    const loadTimer = setTimeout(() => {
      frame = undefined;
      el.remove();
      reject(new Error('the drawing frame did not load'));
    }, FRAME_LOAD_MS);
    addEventListener('message', (e: MessageEvent) => {
      if (e.source !== el.contentWindow || !e.data || typeof e.data !== 'object') return;
      const d = e.data as { ready?: boolean; id?: string; svg?: string; error?: string };
      if (d.ready) {
        clearTimeout(loadTimer);
        resolve({
          initialize: (c) => void (theme = c.theme === 'dark' ? 'dark' : 'default'),
          render: (_id, source) =>
            new Promise<{ svg: string }>((ok, fail) => {
              const id = `m${++n}`;
              const timer = setTimeout(() => (waiting.delete(id), fail(new Error('Mermaid took too long'))), DRAW_MS);
              waiting.set(id, { resolve: (svg) => ok({ svg }), reject: fail, timer });
              el.contentWindow?.postMessage({ id, source, theme }, '*');
            }),
        });
        return;
      }
      const w = d.id ? waiting.get(d.id) : undefined;
      if (!w) return;
      waiting.delete(d.id!);
      clearTimeout(w.timer);
      if (typeof d.svg === 'string') w.resolve(d.svg);
      else w.reject(new Error(d.error || 'Mermaid could not draw this'));
    });
    document.body.append(el);
  });
  return frame;
}

const loadMermaid = frameMermaid;

let seq = 0;

/** Draws `blocks` one by one; resolves to how many it drew. A block Mermaid can't parse keeps its source. */
export async function renderBlocks(blocks: readonly MermaidBlock[], theme: 'dark' | 'default', load: () => Promise<MermaidApi> = loadMermaid): Promise<number> {
  if (!blocks.length) return 0;
  let api: MermaidApi;
  try {
    api = await load();
  } catch (err) {
    for (const b of blocks) b.failed(`Mermaid didn't load: ${(err as Error).message}`);
    return 0;
  }
  // strict: no scripts or click handlers from the diagram, its labels sanitized by Mermaid.
  api.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
  let drawn = 0;
  for (const b of blocks) {
    try {
      const { svg } = await api.render(`dv-mermaid-${++seq}`, b.source);
      b.done(svg);
      drawn++;
    } catch (err) {
      b.failed((err as Error).message?.split('\n')[0] || 'Mermaid could not draw this');
    }
  }
  return drawn;
}

/** Every ```mermaid block in `root` (rendered Markdown) drawn in place, the source folded under it. */
export function renderMermaid(root: HTMLElement): Promise<number> {
  const theme = mermaidTheme(document.documentElement.dataset.theme);
  const blocks: MermaidBlock[] = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')].map((code) => {
    const pre = code.parentElement!;
    pre.classList.add('dv-mermaid');
    return {
      source: code.textContent ?? '',
      done(svg) {
        const fig = document.createElement('figure');
        fig.className = 'dv-diagram';
        fig.innerHTML = svg;
        const src = document.createElement('details');
        src.className = 'dv-diagram-src';
        const sum = document.createElement('summary');
        sum.textContent = 'Mermaid source';
        pre.replaceWith(fig);
        src.append(sum, pre);
        fig.append(src);
      },
      failed(why) {
        const note = document.createElement('p');
        note.className = 'dv-dim';
        note.textContent = `Shown as source: ${why}`;
        pre.after(note);
      },
    };
  });
  return renderBlocks(blocks, theme);
}
