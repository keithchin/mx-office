/**
 * Being in the office from one of its flat views, the 1D board (/lite) or the 2D pixel office
 * (/pixel), and the home page (/home): the connection, the windows that hear from it, what you have open for the others to
 * see, notifications, and coming in (signing in, and your name the first time). No three.js here:
 * both flat views import it.
 */
import { Net } from '../net';
import { AVATAR_COLORS, loadProfile, loadSettings, saveProfile, store, type Settings } from '../state';
import { randomLook } from '../../shared/avatar';
import { ROOF } from '../../shared/rooftop';
import type { ServerMsg } from '../../shared/protocol';
import { $, doingNow, h, onDoingChange, onModalChange, openModal, readingNow, toast } from '../ui/dom';
import { openTerminalFor, routeTerminalMessage } from '../ui/terminal';
import { openChangesFor, routeChangesMessage } from '../ui/changes';
import { routeWorktreeMessage } from '../ui/prompt';
import { routePullMessage } from '../ui/pull';
import { routeElevatorMessage } from '../ui/elevator';
import { openSignIns } from '../ui/signins';
import { routeWhiteboardMessage } from '../ui/whiteboard';
import { routeTeamMessage } from '../ui/team';
import { routeAccountsMessage } from '../ui/accounts';
import { askNotifyPermission, DesktopNotifier, notifyPermission, waitingOnSomeone } from '../notify';
import { installReauth } from '../ui/reauth';
import { bootDown, bootDrawn, bootStep } from '../ui/loading/boot';
import { installOfficeDown } from '../ui/loading/office-down';

export interface FlatSession {
  net: Net;
  settings: Settings;
  /** The desktop notifications (the team phone sends its own through it, ui/phone/). */
  notifier: DesktopNotifier;
  /** Signs in (back to `page` afterwards), asks your name if this browser has none yet, and connects. */
  start(): void;
  /** The 🔔 to allow notifications, put before `el`, while the browser hasn't been asked. */
  bellBefore(el: HTMLElement): void;
}

/**
 * The connection for a flat view (or the home page) at `page`. `openWorker` opens a worker's terminal (a notification
 * clicked); `onMessage` hears every message after the store and the shared windows have.
 */
export function flatSession(page: '/home' | '/lite' | '/pixel' | '/m', openWorker: (id: string) => void, onMessage?: (msg: ServerMsg) => void): FlatSession {
  // Your name and color from the 3D office, if this browser has been in it. Nobody sees a character
  // of yours from here, so a look is only made up to connect with.
  const saved = loadProfile();
  store.profile = { name: saved?.name ?? 'Guest', color: saved?.color ?? AVATAR_COLORS[1], look: saved?.look ?? randomLook() };
  const net = new Net(() => store.profile, () => null, true);
  const settings = loadSettings();
  const notifier = new DesktopNotifier(() => settings.notify, openWorker);
  // Through Phone access, risky actions ask for the password again (ui/reauth.ts); the phone version asks its own way.
  if (page !== '/m') installReauth(net);

  /** The server version this page was loaded with. */
  let bootVersion = '';

  /** Nothing to see up on the roof from here: down to the first floor instead (the 3D office left you up there, say). */
  const offTheRoof = () => {
    if (store.floor !== ROOF) return;
    const to = store.floors.find((f) => !f.cloning);
    if (to) net.send({ t: 'floor.go', floor: to.id });
  };

  net.onStatus((up) => $('conn').classList.toggle('hidden', up));
  // Mx Office's loading screen (ui/loading/boot.ts): the socket up, or gone (a restart).
  net.onStatus((up) => (up ? bootStep('socket') : bootDown()));
  // The office gone for more than a blip: "Restarting… reconnecting" or "The office has stopped", then a reload once it's back.
  installOfficeDown(net);
  net.onMessage((msg) => {
    store.apply(msg);
    routeTerminalMessage(msg);
    routeChangesMessage(msg);
    routePullMessage(msg);
    routeWorktreeMessage(msg);
    routeElevatorMessage(msg);
    // The windows the ☰ menu opens (shared/flatmenu.ts).
    routeWhiteboardMessage(msg, net);
    routeTeamMessage(msg);
    routeAccountsMessage(msg);
    switch (msg.t) {
      case 'welcome': {
        // Back from a restart on another version: this page's code is stale, so load the new one.
        if (!bootVersion) bootVersion = msg.version;
        else if (msg.version !== bootVersion) return location.reload();
        offTheRoof();
        // After a reconnect the server has forgotten which terminal we had open, and what we're doing.
        sendDoing(true);
        const openId = openTerminalFor();
        if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
        const watching = openChangesFor();
        if (watching && store.workers.has(watching.workerId)) net.send({ t: 'changes.watch', ...watching });
        bootStep('data');
        bootDrawn();
        break;
      }
      case 'floor.enter':
        offTheRoof();
        break;
      case 'toast':
        toast(msg.text, msg.level);
        break;
      case 'roster.changed':
        // An urgent escalation to the Project Manager: the server toasts it; this reaches you in another
        // tab. Clicking it brings this one forward, where the project console has the card.
        if (msg.alert) notifier.escalation(msg.alert, () => undefined);
        break;
      case 'signins.needed':
        openSignIns(net, msg.why);
        break;
      case 'upgrade':
        if (msg.state.phase === 'restarting') {
          net.expectRestart();
          toast('⬆️ The office is restarting on its new version. Back in a minute.');
        }
        break;
    }
    onMessage?.(msg);
  });

  // ---- What you have open, for the others (see PeerInfo.doing) ---------------------------------
  let doingSent: string | undefined;
  let readingSent = false;
  function sendDoing(reconnected = false) {
    if (reconnected) {
      doingSent = undefined;
      readingSent = false;
    }
    const what = doingNow();
    const reading = readingNow();
    if (what === doingSent && reading === readingSent) return;
    doingSent = what;
    readingSent = reading;
    net.send({ t: 'doing', what, reading });
  }
  onModalChange(() => sendDoing());
  onDoingChange(() => sendDoing());

  // ---- A worker needs input or is done: a notification while you're elsewhere, and a buzz -------
  /** What each worker was last, to tell when one starts waiting on someone. */
  const lastStatus = new Map<string, string>();
  store.on('workers', () => {
    for (const w of store.workers.values()) {
      const before = lastStatus.get(w.id);
      lastStatus.set(w.id, w.status);
      if (before === undefined || before === w.status || !waitingOnSomeone(w)) continue;
      notifier.alert(w);
      if (w.status === 'needs_input') navigator.vibrate?.(200);
    }
    notifier.sync(store.workers);
  });

  return {
    net,
    settings,
    notifier,
    start: () => void signIn(page, !!saved, net),
    bellBefore(el) {
      // The browser only asks from a tap, so there's a button for it while it hasn't been asked.
      if (notifyPermission() !== 'default' || !settings.notify) return;
      const bell = h('button.btn', { type: 'button', title: 'Get a notification when a worker needs input or is done', 'aria-label': 'Turn on notifications' }, '🔔');
      bell.addEventListener('click', async () => {
        await askNotifyPermission();
        bell.remove();
      });
      el.before(bell);
    },
  };
}

/** Your name, the first time this browser comes in on the shared password. */
function askName(done: (name: string) => void) {
  const input = h('input', { type: 'text', maxlength: 24, placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'nickname' }) as HTMLInputElement;
  const form = h(
    'form.modal.lite-name',
    {},
    h('header', {}, h('h2', {}, '👋 Who is it?')),
    h('div.body', {}, h('p', {}, 'Your teammates see this name on what you type and send.'), input),
    h('footer', {}, h('button.btn.primary', { type: 'submit' }, 'Come on in')),
  );
  const modal = openModal(form, { escCloses: false, backdropCloses: false });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    modal.close();
    done(name);
  });
  setTimeout(() => input.focus(), 30);
}

async function signIn(page: string, hasProfile: boolean, net: Net) {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (res.status === 401) return void (location.href = `/login?next=${page}`);
    const { me } = (await res.json()) as { me?: typeof store.me };
    if (me) store.me = me;
  } catch {
    // the welcome message says it too
  }
  bootStep('session');
  // With an account of your own, your name is that account's.
  if (store.me.account) store.profile.name = store.me.account.name;
  if (hasProfile || store.me.account) return net.connect();
  askName((name) => {
    store.profile.name = name;
    // No look: the 3D office still has you pick a character the first time you go in.
    saveProfile({ name, color: store.profile.color });
    net.connect();
  });
}
