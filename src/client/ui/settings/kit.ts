// What ⚙️ Settings' sections are made of, in the 3D office's window (index.ts) and on the flat views'
// Settings page (page.ts) alike: a card per setting with who it's for, and what every section builder
// gets and gives back. No three.js here: the flat views load every section.

import './settings.css';
import type { Net } from '../../net';
import type { OfficeSound } from '../../sound';
import type { DesktopNotifier } from '../../notify';
import type { Settings } from '../../state';
import { h } from '../dom';

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
export type Scope = 'you' | 'floor' | 'office';
const SCOPE: Record<Scope, [label: string, title: string]> = {
  you: ['Just you', 'Only for you, kept in this browser'],
  floor: ['This floor', 'The same for everyone on this floor'],
  office: ['Everyone', 'The same for everyone in the building'],
};

/** One setting: its name and who it's for, then whatever sets it. */
export const setting = (title: string, scope: Scope | null, ...body: (Node | null | undefined | false)[]) =>
  h('div.setting', {}, h('div.setting-head', {}, h('h4', {}, title), scope && h('span.scope', { class: scope, title: SCOPE[scope][1] }, SCOPE[scope][0])), ...body.filter((n): n is Node => !!n));

/** A setting's frame, for the builders that make their own body (settings-teams.ts, settings-awake.ts…). */
export const framed = (title: string, scope: Scope | null) => (body: Node[]) => setting(title, scope, ...body);

/** What every section builder may use. */
export interface SettingsDeps {
  net: Net;
  /** Your own settings as they are now. */
  settings(): Settings;
  /** Changes some of your own settings, and has the page take them up. */
  change(some: Partial<Settings>): void;
  notifier: DesktopNotifier;
  /** The 3D office's sound, to play a sample; the flat views have none. */
  sound?: Pick<OfficeSound, 'ding' | 'needsYou'>;
  signOut(): void;
}

/** A section's settings, and what to call when it's put away (timers, store listeners). */
export interface Built {
  nodes: Node[];
  off(): void;
}

/** Puts several builders' results together. */
export function together(...parts: (Built | Node | null | undefined | false)[]): Built {
  const nodes: Node[] = [];
  const offs: (() => void)[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (p instanceof Node) nodes.push(p);
    else {
      nodes.push(...p.nodes);
      offs.push(p.off);
    }
  }
  return { nodes, off: () => offs.forEach((off) => off()) };
}

/** A section with nothing to let go of. */
export const plain = (...nodes: Node[]): Built => ({ nodes, off: () => {} });

/** Signs out, back to the sign-in page. */
export async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
}
