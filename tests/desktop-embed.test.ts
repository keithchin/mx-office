// Show here in the desktop app (desktop/src/core/embed.ts, src/client/ui/liveapp/embed-logic.ts): which
// bridge messages count, which address a project's view may open (its recording proxy only), where the
// native view goes (the part of the placeholder that shows, in window DIPs, at the office's zoom), and the
// controller keeping one view in step, against a fake WebContentsView and office window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedController, MIN_VISIBLE, navTarget, parseEmbedMsg, placement, showTarget, type EmbedState, type Rect, type ViewLike } from '../desktop/src/core/embed.ts';
import { clipOf, deviceBox, overlap, placeKey, probePoints, shownPath } from '../src/client/ui/liveapp/embed-logic.ts';

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

test('messages: only the bridge’s own shapes, with sane numbers and a project name', () => {
  assert.deepEqual(parseEmbedMsg({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' }), { op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  assert.equal(parseEmbedMsg({ op: 'show', floor: '../x', url: 'http://localhost:8120/' }), undefined);
  assert.equal(parseEmbedMsg({ op: 'show', floor: 'a', url: 5 }), undefined);
  assert.deepEqual(parseEmbedMsg({ op: 'bounds', rect: R(1, 2, 3, 4), clip: R(0, 0, 10, 10), zoom: 0.5 }), { op: 'bounds', rect: R(1, 2, 3, 4), clip: R(0, 0, 10, 10), zoom: 0.5 });
  assert.equal(parseEmbedMsg({ op: 'bounds', rect: R(1, 2, -3, 4), clip: R(0, 0, 10, 10), zoom: 1 }), undefined, 'negative size');
  assert.equal(parseEmbedMsg({ op: 'bounds', rect: { x: NaN, y: 0, width: 1, height: 1 }, clip: R(0, 0, 1, 1), zoom: 1 }), undefined);
  assert.equal(parseEmbedMsg({ op: 'bounds', rect: R(0, 0, 1, 1), clip: R(0, 0, 1, 1), zoom: 50 }), undefined, 'absurd zoom');
  assert.deepEqual(parseEmbedMsg({ op: 'reload', hard: 'yes' }), { op: 'reload', hard: false });
  assert.deepEqual(parseEmbedMsg({ op: 'devtools', extra: 1 }), { op: 'devtools' });
  for (const bad of [null, 'show', [], { op: 'eval', code: 'x' }, { op: 'navigate' }, { op: 'loadURL', url: 'file:///c:/' }]) assert.equal(parseEmbedMsg(bad), undefined, JSON.stringify(bad));
});

test('the address: exactly the project’s proxy port, plain HTTP on this machine, never the office’s port', () => {
  assert.deepEqual(showTarget('http://localhost:8120/', 8120, 4601), { url: 'http://localhost:8120/', origin: 'http://localhost:8120', home: 'http://localhost:8120/' });
  assert.equal(showTarget('http://127.0.0.1:8120/p/orders', 8120, 4601)?.origin, 'http://127.0.0.1:8120');
  assert.equal(showTarget('http://localhost:8121/', 8120, 4601), undefined, 'the runtime’s own port, not the proxy');
  assert.equal(showTarget('http://localhost:8120/', undefined, 4601), undefined, 'no proxy up');
  assert.equal(showTarget('http://localhost:4601/', 4601, 4601), undefined, 'the office itself');
  assert.equal(showTarget('https://localhost:8120/', 8120, 4601), undefined);
  assert.equal(showTarget('http://office-pc.example:8120/', 8120, 4601), undefined, 'another machine');
  assert.equal(showTarget('http://user:pw@localhost:8120/', 8120, 4601), undefined);
  assert.equal(showTarget('javascript:alert(1)', 8120, 4601), undefined);
});

test('the address field: paths and the app’s own address go; anywhere else does not', () => {
  const o = 'http://localhost:8120';
  assert.equal(navTarget('/p/orders', o), 'http://localhost:8120/p/orders');
  assert.equal(navTarget('p/orders?x=1', o), 'http://localhost:8120/p/orders?x=1');
  assert.equal(navTarget('', o), 'http://localhost:8120/');
  assert.equal(navTarget('http://localhost:8120/index.html', o), 'http://localhost:8120/index.html');
  assert.equal(navTarget('http://localhost:8121/', o), undefined);
  assert.equal(navTarget('//evil.example/', o), undefined);
  assert.equal(navTarget('file:///c:/windows', o), undefined);
});

test('placement: the part of the placeholder that shows, in DIPs at the office’s zoom; too little shows nothing', () => {
  assert.deepEqual(placement(R(10, 100, 800, 500), R(0, 0, 1400, 900), 1), R(10, 100, 800, 500));
  assert.deepEqual(placement(R(10, 100, 800, 500), R(0, 0, 1400, 900), 1.25), R(13, 125, 1000, 625), 'zoomed 125%');
  // Scrolled: the top of the placeholder is under the page's edge (the scrolling box starts at 60).
  assert.deepEqual(placement(R(10, -100, 800, 500), R(0, 60, 1400, 840), 1), R(10, 60, 800, 340));
  assert.equal(placement(R(10, 880, 800, 500), R(0, 0, 1400, 900), 1), undefined, `under ${MIN_VISIBLE} px left`);
  assert.equal(placement(R(0, 0, 0, 0), R(0, 0, 1400, 900), 1), undefined);
});

test('page side: device widths in the placeholder, the clip, the probes, the address shown', () => {
  const box = R(100, 50, 1000, 600);
  assert.deepEqual(deviceBox(box, 'desktop', 'fit'), { rect: box, zoom: 1 });
  assert.deepEqual(deviceBox(box, 'phone', 'fit'), { rect: R(405, 50, 390, 600), zoom: 1 }, 'centred at 390');
  assert.deepEqual(deviceBox(R(0, 0, 410, 600), 'tablet', 'fit'), { rect: R(0, 0, 410, 600), zoom: 0.5 }, 'fitted: laid out at 820, shrunk');
  assert.deepEqual(deviceBox(R(0, 0, 410, 600), 'tablet', '100'), { rect: R(0, 0, 410, 600), zoom: 1 });
  assert.deepEqual(clipOf(R(0, 0, 1400, 900), [R(0, 60, 1400, 900), R(20, 0, 1000, 2000)]), R(20, 60, 1000, 840));
  assert.deepEqual(overlap(R(0, 0, 10, 10), R(20, 20, 5, 5)), R(20, 20, 0, 0));
  assert.equal(probePoints(R(0, 0, 100, 60)).length, 9);
  assert.ok(probePoints(R(0, 0, 100, 60)).every((p) => p.x >= 0 && p.x < 100 && p.y >= 0 && p.y < 60), 'all inside');
  assert.deepEqual(probePoints(R(0, 0, 2, 2)), []);
  assert.notEqual(placeKey(box, box, 1, 1), placeKey(box, box, 1, 1.25), 'a new devicePixelRatio is sent again');
  assert.equal(shownPath('http://localhost:8120/p/orders?x=1', 'http://localhost:8120/'), '/p/orders?x=1');
  assert.equal(shownPath('http://elsewhere.example/', 'http://localhost:8120/'), 'http://elsewhere.example/');
});

// ---- the controller, against fakes

class FakeWC {
  url = '';
  history: string[] = [];
  at = -1;
  zoom = 1;
  closed = false;
  devtools = 0;
  reloads: string[] = [];
  handlers = new Map<string, (() => void)[]>();
  navigationHistory = {
    canGoBack: () => this.at > 0,
    canGoForward: () => this.at < this.history.length - 1,
    goBack: () => this.move(-1),
    goForward: () => this.move(1),
  };
  async loadURL(u: string) {
    this.history = [...this.history.slice(0, this.at + 1), u];
    this.at = this.history.length - 1;
    this.url = u;
    this.fire('did-navigate');
  }
  move(d: number) {
    this.at += d;
    this.url = this.history[this.at];
    this.fire('did-navigate');
  }
  fire(ev: string) {
    for (const f of this.handlers.get(ev) ?? []) f();
  }
  getURL = () => this.url;
  getTitle = () => 'Order desk';
  isLoading = () => false;
  reload = () => void this.reloads.push('soft');
  reloadIgnoringCache = () => void this.reloads.push('hard');
  setZoomFactor = (f: number) => void (this.zoom = f);
  openDevTools = () => void this.devtools++;
  close = () => void (this.closed = true);
  isDestroyed = () => this.closed;
  on(ev: string, f: () => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), f]);
    return this;
  }
}
class FakeView {
  webContents = new FakeWC();
  bounds?: Rect;
  visible = true;
  origin: () => string = () => '';
  setBounds = (r: Rect) => void (this.bounds = r);
  setVisible = (v: boolean) => void (this.visible = v);
}

function rig(ports: Record<string, number> = { 'order-desk': 8120 }) {
  const views: FakeView[] = [];
  const children: FakeView[] = [];
  const sent: (EmbedState | null)[] = [];
  let zoom = 1;
  const ctl = new EmbedController({
    officePort: 4601,
    viewPortOf: async (f) => ports[f],
    host: { add: (v) => void children.push(v as unknown as FakeView), remove: (v) => void children.splice(children.indexOf(v as unknown as FakeView), 1), zoom: () => zoom, send: (s) => void sent.push(s) },
    create: ({ origin }) => {
      const v = new FakeView();
      v.origin = origin;
      views.push(v);
      return v as unknown as ViewLike;
    },
  });
  return { ctl, views, children, sent, setZoom: (z: number) => (zoom = z) };
}

test('controller: show checks the project’s proxy; the view starts hidden and shows once placed', async () => {
  const r = rig();
  assert.equal((await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:9999/' })).ok, false, 'not the proxy');
  assert.equal((await r.ctl.handle({ op: 'show', floor: 'other', url: 'http://localhost:8120/' })).ok, false, 'not that project’s');
  assert.equal(r.views.length, 0);
  assert.equal((await r.ctl.handle({ op: 'bounds', rect: R(0, 0, 500, 500), clip: R(0, 0, 900, 900), zoom: 1 })).ok, false, 'nothing to place yet');
  assert.equal((await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' })).ok, true);
  const [v] = r.views;
  assert.equal(r.children.length, 1);
  assert.equal(v.visible, false, 'hidden until placed');
  assert.equal(v.webContents.url, 'http://localhost:8120/');
  assert.equal(v.origin(), 'http://localhost:8120', 'kept on the proxy’s origin');
  await r.ctl.handle({ op: 'bounds', rect: R(10, 100, 800, 500), clip: R(0, 0, 1400, 900), zoom: 1 });
  assert.deepEqual(v.bounds, R(10, 100, 800, 500));
  assert.equal(v.visible, true);
  assert.equal(r.sent.at(-1)?.visible, true);
});

test('controller: bounds follow resize, scroll and zoom; hidden when covered or scrolled away', async () => {
  const r = rig();
  await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  const [v] = r.views;
  await r.ctl.handle({ op: 'bounds', rect: R(10, 100, 800, 500), clip: R(0, 0, 1400, 900), zoom: 1 });
  r.setZoom(1.5);
  await r.ctl.handle({ op: 'bounds', rect: R(10, 100, 600, 400), clip: R(0, 0, 900, 600), zoom: 1 });
  assert.deepEqual(v.bounds, R(15, 150, 900, 600));
  assert.equal(v.webContents.zoom, 1.5, 'the app follows the office’s zoom');
  await r.ctl.handle({ op: 'bounds', rect: R(0, 0, 410, 600), clip: R(0, 0, 900, 600), zoom: 0.5 });
  assert.equal(v.webContents.zoom, 0.75, 'a fitted device width shrinks it further');
  await r.ctl.handle({ op: 'hide' });
  assert.equal(v.visible, false, 'a dialog over it');
  await r.ctl.handle({ op: 'bounds', rect: R(0, 0, 410, 600), clip: R(0, 0, 900, 600), zoom: 0.5 });
  assert.equal(v.visible, true, 'back once clear');
  await r.ctl.handle({ op: 'bounds', rect: R(0, 880, 410, 600), clip: R(0, 0, 900, 900), zoom: 1 });
  assert.equal(v.visible, false, 'scrolled away');
});

test('controller: real Back and Forward, Home, the address kept to the app, reload, devtools only on request', async () => {
  const r = rig();
  await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  const wc = r.views[0].webContents;
  assert.equal(wc.devtools, 0, 'no developer tools unless asked');
  await r.ctl.handle({ op: 'navigate', path: '/p/orders' });
  assert.equal(wc.url, 'http://localhost:8120/p/orders');
  assert.equal((await r.ctl.handle({ op: 'navigate', path: 'https://evil.example/' })).ok, false);
  assert.equal(wc.url, 'http://localhost:8120/p/orders');
  await r.ctl.handle({ op: 'back' });
  assert.equal(wc.url, 'http://localhost:8120/');
  assert.equal(r.sent.at(-1)?.canForward, true);
  await r.ctl.handle({ op: 'forward' });
  assert.equal(wc.url, 'http://localhost:8120/p/orders');
  await r.ctl.handle({ op: 'home' });
  assert.equal(wc.url, 'http://localhost:8120/');
  await r.ctl.handle({ op: 'reload', hard: true });
  await r.ctl.handle({ op: 'reload' });
  assert.deepEqual(wc.reloads, ['hard', 'soft']);
  await r.ctl.handle({ op: 'devtools' });
  assert.equal(wc.devtools, 1);
});

test('controller: shown again keeps the view; another project replaces it; close destroys it', async () => {
  const r = rig({ 'order-desk': 8120, 'field-app': 8130 });
  await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  await r.ctl.handle({ op: 'navigate', path: '/p/orders' });
  await r.ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  assert.equal(r.views.length, 1, 'the same view');
  assert.equal(r.views[0].webContents.url, 'http://localhost:8120/p/orders', 'not reloaded');
  await r.ctl.handle({ op: 'show', floor: 'field-app', url: 'http://localhost:8130/' });
  assert.equal(r.views.length, 2);
  assert.equal(r.views[0].webContents.closed, true, 'the old project’s view is destroyed');
  assert.deepEqual(r.children, [r.views[1]]);
  assert.equal(r.ctl.info()?.floor, 'field-app');
  await r.ctl.handle({ op: 'close' });
  assert.equal(r.views[1].webContents.closed, true);
  assert.equal(r.children.length, 0);
  assert.equal(r.sent.at(-1), null, 'the page is told it’s gone');
  assert.equal(r.ctl.info(), undefined);
  assert.equal((await r.ctl.handle({ op: 'back' })).ok, false);
});

test('controller: a show still asking the office when the page closed it makes no view', async () => {
  let answer!: (p: number) => void;
  const views: unknown[] = [];
  const ctl = new EmbedController({
    officePort: 4601,
    viewPortOf: () => new Promise((res) => (answer = res)),
    host: { add() {}, remove() {}, zoom: () => 1, send() {} },
    create: () => (views.push(1), new FakeView() as unknown as ViewLike),
  });
  const p = ctl.handle({ op: 'show', floor: 'order-desk', url: 'http://localhost:8120/' });
  await ctl.handle({ op: 'close' });
  answer(8120);
  assert.equal((await p).ok, false);
  assert.equal(views.length, 0);
});
