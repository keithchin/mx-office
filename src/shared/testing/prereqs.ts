// What a project's tests need on this machine before they can run (server/testing/prereqs.ts): the Testing
// page's prerequisites, each with its state and one fix. Pure: the browser imports it too.

export interface TestPrereq {
  id: 'test-db' | 'playwright';
  title: string;
  /** ready: tests can use it; missing: the fix makes it; unknown: the office couldn't look (the text says why). */
  state: 'ready' | 'missing' | 'unknown';
  text: string;
  /** The button that fixes it, when the office can. */
  fix?: string;
  /** The command the fix runs (shown, so it can be run by hand). */
  command?: string;
  /** The SQL the fix runs (shown, so a database administrator can run it). */
  sql?: string[];
}

export interface TestPrereqs {
  items: TestPrereq[];
  ready: boolean;
}
