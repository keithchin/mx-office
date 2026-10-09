// ⚙️ Settings' sections, in the order its left-hand list has them, and the address of each. The full
// Settings page lives in the flat views (the 1D view's ⚙️ Settings tab, /lite?tab=settings, which the
// 2D view, the home page, the Needs-you strip, the team phone and the docs all link to by section), so
// no settings link ever sends anyone to the 3D office. The 3D office keeps its own ⚙️ window for what
// only it has (the camera, your character, the building's world). Pure: the pages, the server's
// Teams cards and the tests read the same list.

export interface SettingsSection {
  id: string;
  icon: string;
  label: string;
  /** One line under the section's name. */
  blurb: string;
  /** Only admins see it at all (the others are shown read-only to everyone, as in the 3D window). */
  admin?: true;
  /** It's about the floor you're on (the team, its budget, its project), so it needs one. */
  floor?: true;
}

export const SETTINGS_SECTIONS = [
  { id: 'you', icon: '🧍', label: 'You', blurb: 'How the office looks and sounds for you, the Command Center terminal, and how you’re signed in. Just you, kept in this browser.' },
  { id: 'workers', icon: '🤖', label: 'Workers', blurb: 'What workers start on, how many run at once, keeping the computer awake, restarting safely, and what the office tells them.' },
  { id: 'team', icon: '👥', label: 'Team', blurb: 'This project’s team: autonomy (and autonomy by stage), idle benching, the review loop, subagent cool-downs, the standup, cost caps and resume pacing.', floor: true },
  { id: 'jeff', icon: '⚖️', label: 'Jeff · Router', blurb: 'The office’s quick judge on this project: waiting on you, when to escalate, triage and priority.', floor: true },
  { id: 'notify', icon: '🔔', label: 'Notifications', blurb: 'Desktop alerts, the alarm when a worker needs you, Slack / Discord, and Microsoft Teams.' },
  { id: 'budget', icon: '💰', label: 'Budget', blurb: 'This project’s budget, alert threshold and auto-pause, and the office’s default threshold and local currency.', floor: true },
  { id: 'connections', icon: '🔌', label: 'Connections', blurb: 'The tokens and password the office signs in with, git & gh, its folders, phone access and worktree cleanup. Admins only.', admin: true },
  { id: 'deliverables', icon: '📦', label: 'Deliverables', blurb: 'What the teams make before their stage: early drafts while the Chief Analyst is on Stages 0–2.', floor: true },
  { id: 'incidents', icon: '🚨', label: 'Incidents', blurb: 'The detection rules that open an incident by themselves, and how long one counts again before a new one opens.' },
  { id: 'studio', icon: '🧱', label: 'Studio', blurb: 'This project’s Mendix model in Studio Pro on the office’s computer, and Studio mode (the agents’ mxcli writes paused while it’s open).', floor: true },
  { id: 'appearance', icon: '🎨', label: 'Appearance', blurb: 'The flat views’ color theme (yours), and the building’s holiday theme and map (everyone’s).' },
  { id: 'advanced', icon: '🛠️', label: 'Advanced', blurb: 'Where new projects are cloned, the sky’s clock, the office dog, and the office’s settings files.' },
  { id: 'testing', icon: '🧪', label: 'Testing', blurb: 'Test mode (whether this office is in it, and why), and the Test Mode page: the performance and journey suites, run against a throwaway test office. Admins only.', admin: true },
  { id: 'danger', icon: '⚠️', label: 'Danger zone', blurb: 'Remove this project from the office, or delete it (its folder and GitHub repository too, if you say so). Admins only.', admin: true, floor: true },
] as const satisfies readonly SettingsSection[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map((s) => s.id);

export const isSettingsSection = (s: unknown): s is SettingsSectionId => SETTINGS_SECTION_IDS.includes(s as SettingsSectionId);

export const settingsSection = (id: SettingsSectionId): SettingsSection => SETTINGS_SECTIONS.find((s) => s.id === id)!;

/** The page the full Settings is on: the 1D view's ⚙️ Settings tab. */
export const SETTINGS_PAGE = '/lite';

/**
 * The address of Settings at `section` (`/lite?tab=settings&section=workers`), on `floor` when one is
 * given (the 1D view opens the floor you were last on otherwise). Never the 3D office.
 */
export function settingsHref(section?: SettingsSectionId, floor?: string): string {
  const q = new URLSearchParams();
  if (floor) q.set('floor', floor);
  q.set('tab', 'settings');
  if (section) q.set('section', section);
  return `${SETTINGS_PAGE}?${q.toString()}`;
}

/** Settings' words for a section, for a link's text: "⚙️ Settings › 🤖 Workers". */
export const settingsPath = (id: SettingsSectionId): string => {
  const s = settingsSection(id);
  return `⚙️ Settings › ${s.icon} ${s.label}`;
};
