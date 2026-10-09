// Redrawing a long list without rewriting what didn't change (the performance guard, 2026-10-09: the
// Workers view rebuilt its hundred-odd cards on every batched worker update, a few times a second, and
// each rebuild cost the page a 190 ms task: the Clean themes' emoji pass over every new node, then the
// style of every card worked out again). A view still builds its children afresh, as before (cheap,
// detached), and `keepSame` puts them in, reusing an element already on the page wherever the new one
// was built exactly the same (same markup as that one had when it was built), so the page keeps that
// element: its listeners (they only name things the markup names too), a <details> someone opened, focus.
// Only the children that are new, or in a new place, touch the page.

/** The markup each element had when it was built, before the page (the Clean themes' emoji pass, a flash) touched it. */
const builtAs = new WeakMap<object, string>();

/**
 * The children to show: each of `next`, or the one of `old` that was built the same (`sig` says what an
 * element was built as; `stored` remembers it for the elements put on the page). Pure, for the tests.
 */
export function reuseSame<N extends object>(old: Iterable<N>, next: readonly N[], sig: (n: N) => string, stored: WeakMap<object, string> = builtAs): N[] {
  const free = new Map<string, N[]>();
  for (const o of old) {
    const s = stored.get(o);
    if (s === undefined) continue;
    const list = free.get(s);
    if (list) list.push(o);
    else free.set(s, [o]);
  }
  return next.map((n) => {
    const s = sig(n);
    const same = free.get(s)?.shift();
    if (same) return same;
    stored.set(n, s);
    return n;
  });
}

/** The few parts of a parent node `syncChildren` uses (a DOM element has them; the tests' fake does too). */
export interface ChildParent<N> {
  readonly firstChild: N | null;
  insertBefore(node: N, ref: N | null): unknown;
  removeChild(node: N): unknown;
}

/**
 * Makes `parent`'s children exactly `nodes`, in order, moving or inserting only those not already in
 * their place and removing the rest: unlike replaceChildren, a child that stays where it was is never
 * taken off the page.
 */
export function syncChildren<N extends { readonly nextSibling: N | null }>(parent: ChildParent<N>, nodes: readonly N[]) {
  // The ones going first, so those staying close up and are already in their place.
  const staying = new Set(nodes);
  for (let c = parent.firstChild; c; ) {
    const next: N | null = c.nextSibling;
    if (!staying.has(c)) parent.removeChild(c);
    c = next;
  }
  let cur = parent.firstChild;
  for (const n of nodes) {
    if (cur === n) {
      cur = cur.nextSibling;
      continue;
    }
    parent.insertBefore(n, cur);
  }
  while (cur) {
    const next: N | null = cur.nextSibling;
    parent.removeChild(cur);
    cur = next;
  }
}

/** `parent.replaceChildren(...next)`, keeping each child already there that `next` would only build again the same. */
export function keepSame(parent: Element, next: readonly Element[]) {
  syncChildren<ChildNode>(parent, reuseSame<Element>(parent.children, next, (n) => n.outerHTML));
}
