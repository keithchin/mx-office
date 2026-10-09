// What the ☰ menu offers: each item's icon, words, section, count and hint. The flat pages
// (shared/flatmenu.ts) add what each does there (`run`).

import { store } from '../state';
import { waitingInOrder, waitingLabel } from '../nextup';
import { needsSigningIn } from './signins';
import type { HudAction } from './menu';
import { studioBlocked, studioShown, studioTitle } from './studio';

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
  queue: { id: 'queue', icon: '📋', label: 'Task queue', section: 'Open', count: COUNTS.queue, title: () => 'Issues and tasks waiting for an agent' },
  services: { id: 'services', icon: '🌐', label: 'Services', section: 'Open', count: COUNTS.services, title: () => 'Web servers the agents are running' },
  whiteboard: { id: 'whiteboard', icon: '📝', label: 'Whiteboard', section: 'Open', title: () => 'Draw together, live' },
  meeting: {
    id: 'meeting',
    icon: '🤝',
    label: 'Meeting room',
    section: 'Open',
    status: () => store.meeting.current?.status === 'running',
    chip: () => 'In a meeting',
    title: () => 'Call a meeting: agents work through a question or a task together',
  },
  search: { id: 'search', icon: '🔎', label: 'Search', section: 'Open', key: '/', title: () => 'Search the chat and every terminal' },
  docs: { id: 'docs', icon: '📚', label: 'Project docs', section: 'Open', title: () => 'Read the project’s own Markdown: its README, team journals, standups' },
  // The floor's Mendix project in Studio Pro on the office's computer (ui/studio/): admins only, after a confirm.
  studio: { id: 'studio', icon: '🧱', label: 'Open in Studio Pro', section: 'Open', shown: studioShown, blocked: studioBlocked, title: studioTitle },
  elevator: { id: 'elevator', icon: '🏢', label: 'Projects', section: 'Open', count: COUNTS.floors, title: () => 'Go to another project, or add one' },
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
    title: () => 'The Claude plan and GitHub account your agents run on: your own',
  },
  settings: { id: 'settings', icon: '⚙️', label: 'Settings', section: 'Office' },
  // The office's tokens, password, git / gh, folders and worktree cleanup (ui/connections/): admins only.
  connections: { id: 'connections', icon: '🔌', label: 'Connections', section: 'Office', shown: () => store.me.admin, title: () => 'The office’s GitHub and Mendix tokens, Jev key and password, git & gh, its folders and worktree cleanup' },
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
  // While workers wait on someone (N does the same).
  waiting: {
    id: 'waiting',
    icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
    label: 'Next agent that needs you',
    section: 'Open',
    key: 'N',
    count: () => waitingNow().length,
    shown: () => waitingNow().length > 0,
    status: () => waitingNow().length > 0,
    chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
    on: () => waitingNow().every((w) => w.status === 'done'),
    tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
    title: () => 'Go to the next agent waiting on someone: the ones that need you first (N)',
  },
} satisfies Record<string, MenuItem>;

export type MenuId = keyof typeof MENU;
