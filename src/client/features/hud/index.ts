/**
 * The HUD: a few buttons on the top bar, everything else in the ☰ menu (Tab), with H for the controls
 * and F to hang a picture; the project in the corner (click it for the floors); Settings, and your
 * character.
 */
import { ROOF } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { builtFloors } from '../../core/floors';
import { graphics, switchView } from '../../graphics';
import type { Parts } from '../../core/parts';
import { saveSettings, store } from '../../state';
import { openAccounts } from '../../ui/accounts';
import { openBoard } from '../../ui/boards';
import { openCharacter } from '../../ui/character';
import { $ } from '../../ui/dom';
import { toggleFloorMenu } from '../../ui/floormenu';
import { openHelp } from '../../ui/hud';
import { mountHud, type HudAction } from '../../ui/menu';
import { MENU, takeRunIn3d } from '../../ui/menuitems';
import { viewPicker } from '../../ui/viewpick';
import { openServices } from '../../ui/services';
import { openSettings, type SettingsPane } from '../../ui/settings';
import { openSignIns } from '../../ui/signins';
import { openTeam } from '../../ui/team';
import { openUpgrade } from '../../ui/upgrade';
import { openWhiteboard } from '../../ui/whiteboard';
import { describeSky } from '../../world/sky';

export type HudParts = Pick<Parts, 'worlds' | 'place' | 'travel' | 'you' | 'actions' | 'waiting' | 'meeting' | 'bookshelf' | 'hanging' | 'talk' | 'notifier'>;

/** Listens for clicks on the HUD and the project, registers what the HUD follows (see mountHud), and binds Tab, H and F. */
export function installHud(ctx: Ctx, core: CoreState, parts: HudParts) {
  const { net, voice, settings, player, sound } = ctx;
  const { inOffice } = parts.worlds;
  const { travel, waiting, actions, hanging, talk } = parts;

  // Buttons must not keep focus, or Space (jump) would click them again.
  $('hud').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn) setTimeout(() => btn.blur(), 0);
  });
  // The project in the corner is the floor you're on; click it for the list of floors to go to.
  $('project').addEventListener('click', () => {
    if (!store.floor) return travel.showElevator();
    toggleFloorMenu($('project'), { go: travel.switchFloor, indoors: () => (!inOffice() && !core.upTop) || parts.place.indoors(), elevator: travel.showElevator, roof: inOffice() ? () => travel.ride(ROOF) : null });
  });

  // ---- The HUD: a few buttons on the top bar, everything else in the ☰ menu ----------------------------
  const retro = graphics().view === 'retro';
  const noMedia = () => (window.isSecureContext ? undefined : 'Voice and screen sharing need HTTPS or localhost — use a TLS proxy, --self-signed, or an SSH tunnel');
  // What each item is (its icon, words, count) is ui/menuitems.ts, the same on every view; here, what it does in 3D.
  const menuActions: HudAction[] = [
    { ...MENU.issues, run: () => openBoard('issues', net, actions.boardActions()) },
    { ...MENU.pulls, run: () => openBoard('pulls', net, actions.boardActions()) },
    { ...MENU.queue, run: waiting.showQueue },
    { ...MENU.services, run: () => openServices() },
    { ...MENU.whiteboard, run: () => openWhiteboard(net) },
    { ...MENU.meeting, run: () => parts.meeting.showMeeting() },
    { ...MENU.search, run: waiting.showSearch },
    // The office has its bookshelf for them; a map of its own may not.
    { ...MENU.docs, shown: () => !inOffice(), run: parts.bookshelf.showBookshelf },
    { ...MENU.elevator, label: () => (inOffice() ? 'Elevator' : 'Floors'), title: () => (inOffice() ? 'Ride to another project' : 'Go to another project, or add one'), run: travel.showElevator },
    { ...MENU.roof, shown: () => !core.upTop && inOffice() && builtFloors().length > 0, run: () => travel.ride(ROOF) },
    // In voice, V is push to talk, so leaving is only from here.
    { ...MENU.voice, label: () => (voice.inVoice ? 'Leave voice' : 'Join voice'), key: () => (voice.inVoice ? undefined : 'V'), on: () => voice.inVoice, blocked: noMedia, run: () => void talk.toggleVoice() },
    // While you're in voice, the top bar keeps the mute button handy. Muted is the usual with push to talk, so it doesn't stand out then.
    {
      id: 'mute',
      icon: () => (voice.muted ? '🔇' : '🎙️'),
      label: () => (voice.muted ? 'Unmute' : 'Mute'),
      section: 'Together',
      key: 'M',
      shown: () => voice.inVoice,
      status: () => voice.inVoice,
      on: () => voice.inVoice,
      tone: () => (voice.muted && !settings.pushToTalk ? 'danger' : undefined),
      title: () => (voice.muted ? 'Muted: hold V to talk, or M to unmute' : 'Mute (M) · hold V to talk'),
      run: () => voice.toggleMute(),
    },
    { ...MENU.share, label: () => (voice.sharing ? 'Stop sharing' : 'Share screen'), on: () => voice.sharing, status: () => voice.sharing, chip: () => 'Sharing', blocked: noMedia, run: () => void talk.toggleShare() },
    { ...MENU.decor, label: () => (hanging.hanger.active ? 'Stop hanging the picture' : 'Hang a picture'), shown: () => inOffice(), on: () => hanging.hanger.active, status: () => hanging.hanger.active, run: () => (hanging.hanger.active ? hanging.hanger.cancel() : hanging.startHanging()) },
    { ...MENU.team, run: () => openTeam(net) },
    { ...MENU.accounts, run: () => openAccounts(net) },
    { ...MENU.signins, run: () => openSignIns(net) },
    { ...MENU.settings, run: showSettings },
    { ...MENU.help, run: openHelp },
    { ...MENU.home, run: () => location.assign('/home') },
    { id: 'lite', icon: '📱', label: '1D view', section: 'Office', title: () => 'The board, the workers and their terminals without the 3D: for a phone or a slow computer', run: () => switchView('1d') },
    { id: 'pixel', icon: '🗺️', label: '2D view', section: 'Office', title: () => 'The floor from above in pixel art: every worker at its desk, without the 3D', run: () => switchView('2d') },
    // The other way of drawing the office from the one you're in: retro's chunky pixels, or back to 3D.
    retro
      ? { id: 'view', icon: '🏢', label: '3D view', section: 'Office', title: () => 'The office drawn smooth again', run: () => switchView('3d') }
      : { id: 'view', icon: '👾', label: 'Retro view', section: 'Office', title: () => 'The office in chunky 16-bit pixels: lighter on a slow computer, too', run: () => switchView('retro') },
    { ...MENU.upgrade, run: () => openUpgrade(net) },
    // Its chip on the top bar says how many already, so no count beside it.
    { ...MENU.waiting, count: undefined, run: waiting.goToNextWaiting },
  ];
  const hud = mountHud(
    menuActions,
    settings,
    () => saveSettings(settings),
  );
  // The view dropdown, by the dock (ui/viewpick.ts).
  $('view-pick').replaceWith(viewPicker(graphics().view, 'dock-btn'));
  // A flat view's ☰ asked for something only the 3D office has (ui/menuitems.ts runIn3d): run it once the office is up.
  const asked = takeRunIn3d();
  const item = asked && menuActions.find((a) => a.id === asked && (a.shown?.() ?? true));
  if (item) {
    const wait = setInterval(() => {
      if (document.getElementById('loading')) return;
      clearInterval(wait);
      item.run();
    }, 250);
  }
  ctx.keys.bind({
    code: 'Tab',
    preventDefault: true,
    run: () => {
      hud.toggleMenu();
    },
  });
  ctx.keys.bind({
    code: 'KeyH',
    run: () => {
      openHelp();
    },
  });
  ctx.keys.bind({
    code: 'KeyF',
    run: () => {
      hanging.startHanging();
    },
  });
  function showSettings(pane?: SettingsPane) {
    openSettings(
      net,
      settings,
      (s) => {
        // Switching to push to talk mutes you now; back to an open mic turns it on.
        const talkChanged = s.pushToTalk !== settings.pushToTalk;
        Object.assign(settings, s);
        saveSettings(settings);
        if (talkChanged) {
          voice.setMuted(settings.pushToTalk);
          hud.refresh();
        }
        player.setView(settings.view);
        sound.setVolume(settings.volume, settings.muted);
        sound.setMusicVolume(settings.music, settings.musicMuted);
      },
      editProfile,
      sound,
      parts.notifier,
      signOut,
      store.sky ? { now: describeSky(store.sky, store.officeNow()), live: !!store.sky.city } : undefined,
      pane,
    );
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  }

  function editProfile() {
    openCharacter(false, (p) => {
      parts.you.showMyProfile(p);
      net.send({ t: 'profile', name: p.name, color: p.color, look: p.look });
    });
  }

  return { hud, showSettings, editProfile };
}
