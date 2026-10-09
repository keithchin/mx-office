/**
 * 📱 The phone version (/m): the team phone full screen, installable on a phone's home screen, with push
 * notifications for what needs you (client/mobile/, docs/site: "Phone version"). It connects like the flat
 * views do (shared/session.ts).
 */
import { store } from './state';
import { flatSession } from './shared/session';
import { setRoster } from './ui/teams/world';
import { installMobile, type MobileApp } from './mobile/app';
import './shared/perfwatch-on';

let app: MobileApp | undefined;
const session = flatSession('/m', (id) => app?.openChat(id), (msg) => app?.route(msg));
app = installMobile({ net: session.net, notifier: session.notifier });
session.start();

// Debug handle for headless screenshots and quick checks (setRoster puts in a team without hiring anyone).
(window as unknown as Record<string, unknown>).__m = { store, setRoster, net: session.net };
