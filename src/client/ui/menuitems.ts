// What the ☰ menu offers, the same on every view: each item's icon, words, section, count and hint.
// The 3D office (features/hud) and the flat views (shared/flatmenu.ts) each add what it does there
// (`run`), and change what differs, so an item reads the same wherever you open the menu.
// No three.js here: the flat views load it too.

import { store } from '../state';
import { waitingInOrder, waitingLabel } from '../nextup';
import { needsSigningIn } from './signins';
import type { HudAction } from './menu';

export type MenuItem = Omit<HudAction, 'run'>;

const waitingNow = () => waitingInOrder(store.workers.values());

/** What the counts on Issues, PRs and the queue count (the 1D view's nav buttons count the same). */
export const COUNTS = {
  issues: () => store.issues.items.filter((i) => i.state === 'OPEN').length,
  pulls: () => store.pulls.items.filter((p) => p.state === 'OPEN').length,
  queue: () => store.queue.tasks.filter((t) => t.status !== 'done').length,
  services: () => store.services.items.length,
  /** Workers waiting on someone on the other floors. */
  floors: () => store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0),
};

export const MENU = {
  issues: { id: 'issues', icon: '📌', label: 'Issues', section: 'Open', count: COUNTS.issues },
  pulls: { id: 'pulls', icon: '🔀', label: 'Pull requests', section: 'Open', count: COUNTS.pulls },
  queue: { id: 'queue', icon: '📋', label: 'Task queue', section: 'Open', count: COUNTS.queue, title: () => 'Issues and tasks waiting for a worker' },
  services: { id: 'services', icon: '🌐', label: 'Services', section: 'Open', count: COUNTS.services, title: () => 'Web servers the workers are running' },
  whiteboard: { id: 'whiteboard', icon: '📝', label: 'Whiteboard', section: 'Open', title: () => 'Draw together, live' },
  // Up on the 3D top bar while a meeting is on: what's being worked through in the meeting room.
  meeting: {
    id: 'meeting',
    icon: '🤝',
    label: 'Meeting room',
    section: 'Open',
    status: () => store.meeting.current?.status === 'running',
    chip: () => 'In a meeting',
    title: () => 'Call a meeting: workers work through a question or a task together',
  },
  search: { id: 'search', icon: '🔎', label: 'Search', section: 'Open', key: '/', title: () => 'Search the chat and every terminal' },
  docs: { id: 'docs', icon: '📚', label: 'Project docs', section: 'Open', title: () => 'Read the project’s own Markdown: its README, team journals, standups' },
  elevator: { id: 'elevator', icon: '🛗', label: 'Floors', section: 'Open', count: COUNTS.floors, title: () => 'Go to another project, or add one' },
  roof: { id: 'roof', icon: '🍸', label: 'Rooftop bar', section: 'Open', title: () => 'Ride the elevator up to the roof: a DJ, drinks and the city' },
  voice: { id: 'voice', icon: '🎙️', label: 'Join voice', section: 'Together', key: 'V' },
  share: { id: 'share', icon: '🖥️', label: 'Share screen', section: 'Together' },
  decor: { id: 'decor', icon: '🖼️', label: 'Hang a picture', section: 'Together', key: 'F' },
  team: { id: 'team', icon: '👥', label: 'Invite teammates', section: 'Together', shown: () => store.invites },
  accounts: { id: 'accounts', icon: '🔑', label: 'Accounts', section: 'Together', shown: () => store.me.admin, title: () => 'Invite people, see who has an account, revoke them' },
  signins: {
    id: 'signins',
    icon: '🔐',
    label: 'Your sign-ins',
    section: 'Together',
    shown: () => !!store.me.account,
    tone: () => (needsSigningIn() ? 'danger' : undefined),
    status: needsSigningIn,
    chip: () => 'Sign in to Claude',
    title: () => 'The Claude plan and GitHub account your workers run on: your own',
  },
  settings: { id: 'settings', icon: '⚙️', label: 'Settings', section: 'Office' },
  help: { id: 'help', icon: '❓', label: 'Controls', section: 'Office', key: 'H' },
  // The office’s own manual, its own page (/docs): how everything here works.
  guide: { id: 'guide', icon: '📖', label: 'Documentation', section: 'Office', title: () => 'How the office works: guides, reference and FAQ (its own page, /docs)' },
  home: { id: 'home', icon: '🏠', label: 'Home', section: 'Office', title: () => 'Every project in the building, and the office in numbers (its own page, /home)' },
  upgrade: {
    id: 'upgrade',
    icon: '⬆️',
    label: () => (store.upgrade.phase === 'building' ? 'Upgrading…' : store.upgrade.latest ? 'Update the office' : 'Upgrade the office'),
    section: 'Office',
    shown: () => store.upgrade.available,
    // A new version, or one being built, gets a place on the top bar until it's in.
    status: () => !!store.upgrade.latest || store.upgrade.phase === 'building',
    chip: () => (store.upgrade.phase === 'building' ? 'Upgrading…' : 'Update'),
    tone: () => (store.upgrade.latest && store.upgrade.phase !== 'building' ? 'primary' : undefined),
    title: () => (store.upgrade.latest ? `New version: ${store.upgrade.latest.subject}` : 'Upgrade the office'),
  },
  // Up on the 3D top bar while workers wait on someone (N does the same), next to the Workers button.
  waiting: {
    id: 'waiting',
    icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
    label: 'Next worker that needs you',
    section: 'Open',
    key: 'N',
    count: () => waitingNow().length,
    shown: () => waitingNow().length > 0,
    status: () => waitingNow().length > 0,
    chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
    on: () => waitingNow().every((w) => w.status === 'done'),
    tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
    title: () => 'Go to the next worker waiting on someone: the ones that need you first (N)',
  },
} satisfies Record<string, MenuItem>;

export type MenuId = keyof typeof MENU;

// ---- Opening the 3D office at one of its items, from a flat view ---------------------------------------
/** Where a flat view leaves the item the 3D office should run once it's loaded. */
const PENDING_KEY = 'agent-office.menu-run';

/** Asks the 3D office, about to load, to run item `id` once it's up (sessionStorage: this tab only). */
export function runIn3d(id: MenuId) {
  try {
    sessionStorage.setItem(PENDING_KEY, id);
  } catch {
    // No storage: the 3D office opens without it.
  }
}

/** The item a flat view asked the 3D office to run, taken (so a reload doesn't run it again). */
export function takeRunIn3d(): string | undefined {
  try {
    const id = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return id ?? undefined;
  } catch {
    return undefined;
  }
}
