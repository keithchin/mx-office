// The Leads' subagents' first names: each subagent (one per Lead and subagent type, keyed
// `<lead role>/<type>` like its record) gets a person's name once, the first time the office sees it,
// kept in the roster file (`subagentNames`) and never changed unless the Project Manager renames it.
// Names are unique on a floor among the Leads and the subagents. The type stays its role: the Lead
// still dispatches it by type (`.claude/agents/<type>.md`), so the name is only what people and the
// Lead call it ("Nia · Tester (Hedy's subagent)"). Pure: the browser imports it too.

import { NAME_POOL, ROLES } from './roles.js';

/**
 * First names for subagents: short, people's names like the Leads' (NAME_POOL), and none of them, so a
 * fresh team never has a subagent sharing its Lead's name.
 */
export const SUBAGENT_NAME_POOL = [
  'Nia', 'Mae', 'Otis', 'Iris', 'Hugo', 'Lena', 'Felix', 'Rosa', 'Theo', 'Ivy',
  'Omar', 'Clara', 'Ravi', 'Zara', 'Milo', 'Elsa', 'Nora', 'Kofi', 'Wren', 'Juno',
  'Leo', 'Ines', 'Arlo', 'Maya', 'Emil', 'Tess', 'Rafa', 'Yara', 'Ezra', 'Lucy',
  'Bram', 'Cleo', 'Dara', 'Enzo', 'Gwen', 'Hana', 'Ilse', 'Jude', 'Kira', 'Lars',
  'Mina', 'Noel', 'Olga', 'Pia', 'Quinn', 'Rhea', 'Sami', 'Tara', 'Uma', 'Vera',
  'Wade', 'Yuki', 'Zoe', 'Abel', 'Bea', 'Cyrus', 'Dina', 'Eli', 'Faye', 'Gus',
  'Isla', 'Joel', 'Kai', 'Lila',
].filter((n) => !NAME_POOL.includes(n));

/** FNV-1a over the key: the same subagent always starts at the same name. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The name the subagent `key` would get, given the names already `taken` (lower case): its own spot in the pool, else the next free one. */
export function pickSubagentName(key: string, taken: ReadonlySet<string>): string {
  const n = SUBAGENT_NAME_POOL.length;
  const start = hash(key) % n;
  for (let i = 0; i < n; i++) {
    const name = SUBAGENT_NAME_POOL[(start + i) % n];
    if (!taken.has(name.toLowerCase())) return name;
  }
  // Every name is taken (a very big team): the pool again, numbered.
  for (let k = 2; ; k++) {
    const name = `${SUBAGENT_NAME_POOL[start]} ${k}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/**
 * Gives every key in `keys` a name in `names` (changed in place), keeping the ones it has unless one
 * clashes with a Lead's name or an earlier subagent's (in key order, so the same roster always comes
 * out the same). True when it named or renamed any.
 */
export function assignSubagentNames(names: Record<string, string>, keys: Iterable<string>, leadNames: Iterable<string>): boolean {
  const all = [...new Set([...Object.keys(names), ...keys])].sort();
  const taken = new Set([...leadNames].map((n) => n.toLowerCase()));
  const missing: string[] = [];
  for (const k of all) {
    const had = names[k];
    if (had && !taken.has(had.toLowerCase())) taken.add(had.toLowerCase());
    else missing.push(k);
  }
  for (const k of missing) {
    const name = pickSubagentName(k, taken);
    names[k] = name;
    taken.add(name.toLowerCase());
  }
  return missing.length > 0;
}

/** Whether `name` is already someone's on the floor: a Lead's, or another subagent's than `key`'s. */
export function nameTaken(name: string, names: Readonly<Record<string, string>>, leadNames: Iterable<string>, key?: string): boolean {
  const n = name.toLowerCase();
  return [...leadNames].some((x) => x.toLowerCase() === n) || Object.entries(names).some(([k, v]) => k !== key && v.toLowerCase() === n);
}

const TITLES = new Map(ROLES.flatMap((r) => r.subagents.map((s) => [s.id, s.title] as const)));

/** A subagent type as a role: its title in the team table ("Tester", "UI/UX Designer"), else the type in words ("General-purpose", "Explore"). */
export function roleWord(type: string): string {
  const t = TITLES.get(type);
  if (t) return t;
  const words = type.replace(/[_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : type;
}

/** The same in running text: "tester", "UI/UX designer", "general-purpose" (a word in capitals stays so). */
export const roleLower = (type: string) =>
  roleWord(type)
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ');

/** "Nia · Tester (Hedy's subagent)": a subagent everywhere it's shown in full. */
export const subagentLabel = (first: string, type: string, leadName: string) => `${first} · ${roleWord(type)} (${leadName}'s subagent)`;

/** "Nia (Hedy's tester)": its name tag in the 2D views. */
export const helperTag = (first: string, type: string, leadName: string) => `${first} (${leadName}'s ${roleLower(type)})`;

/** "Nia (tester)", or "Nia (tester, Sonnet)" with `more`: in a line that already says whose it is (activity, chatter, the Lead's prompts). */
export const subRef = (first: string | undefined, type: string, more?: string) => (first ? `${first} (${roleLower(type)}${more ? `, ${more}` : ''})` : more ? `${type} (${more})` : type);

/** A subagent's name as a browser has it from the roster view, else the one it would get (an older office sent none). */
export const firstNameIn = (names: Readonly<Record<string, string>> | undefined, key: string): string => names?.[key] ?? pickSubagentName(key, new Set());
