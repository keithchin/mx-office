// One at a time, for an opener that asks the office something before it shows its window (Call an
// audit, Resume on the phone, Open in Studio Pro): clicked again while the answer is on its way, it
// hands back the call already going instead of starting another, so a slow office doesn't stack up a
// window per click once the answers arrive (the Deliverables window did, 2026-10-10).

export function oneAtATime<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let going: Promise<R> | undefined;
  return (...args: A) => {
    if (going) return going;
    const p: Promise<R> = fn(...args).finally(() => {
      if (going === p) going = undefined;
    });
    going = p;
    return p;
  };
}
