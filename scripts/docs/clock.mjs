// The docs screenshots' clock (scripts/docs-shots.mjs): loaded into their test office with --import, it
// starts the office's Date at DOCS_CLOCK_AT (ms) and lets it run on from there, so every time and date a
// page shows is the same on every run. Timers and performance.now() are untouched.
const at = Number(process.env.DOCS_CLOCK_AT);
if (Number.isFinite(at) && at > 0) {
  const Real = Date;
  const offset = at - Real.now();
  class DocsDate extends Real {
    constructor(...a) {
      if (a.length) super(...a);
      else super(Real.now() + offset);
    }
    static now() {
      return Real.now() + offset;
    }
  }
  globalThis.Date = DocsDate;
}
