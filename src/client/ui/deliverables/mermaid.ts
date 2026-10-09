// Mermaid diagrams in the deliverables viewer's Markdown (viewer.ts): each ```mermaid block drawn as a
// diagram, light or dark to match the office theme, with its source kept under it (and left as it was
// when Mermaid can't draw it). Mermaid is loaded only when a page has a diagram: it's big.

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

const loadMermaid = async (): Promise<MermaidApi> => (await import('mermaid')).default as unknown as MermaidApi;

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
