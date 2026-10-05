// The docs page's "On this page" list (docs/layout.ts draws it): the heading you're reading is marked
// as you scroll, the way docs.mendix.com's right-hand list follows along.

/** Marks the heading in view in `toc`'s list; returns what stops it. */
export function watchToc(main: HTMLElement, toc: HTMLElement): () => void {
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of toc.querySelectorAll<HTMLAnchorElement>('a[data-id]')) links.set(a.dataset.id!, a);
  const heads = [...main.querySelectorAll<HTMLElement>('.dx-body h2[id], .dx-body h3[id]')].filter((x) => links.has(x.id));
  if (!heads.length) return () => {};
  let ticking = false;
  const mark = () => {
    ticking = false;
    // The last heading above a line a fifth of the way down the screen; the first one before any.
    const line = innerHeight * 0.2;
    let current = heads[0];
    for (const x of heads) {
      if (x.getBoundingClientRect().top <= line) current = x;
      else break;
    }
    // At the very bottom, the last one, even when it can't scroll up to the line.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = heads[heads.length - 1];
    for (const [id, a] of links) {
      const on = id === current.id;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(mark);
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  mark();
  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
  };
}
